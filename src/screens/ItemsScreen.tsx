import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Field } from '../components/ui';
import { money } from '../lib/money';
import { useStore } from '../store/store';
import { C } from '../theme';
import type { Item } from '../types';

type Draft = { id: string | null; nameKn: string; nameEn: string; rate: string; unit: string };

const BLANK: Draft = { id: null, nameKn: '', nameEn: '', rate: '', unit: 'pc' };

function toDraft(item: Item): Draft {
  return { id: item.id, nameKn: item.nameKn, nameEn: item.nameEn, rate: String(item.rate), unit: item.unit };
}

/** Slug from the English name, so ids stay readable in exported data. */
function makeId(nameEn: string): string {
  const base = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (base || 'item') + '-' + Date.now().toString(36).slice(-4);
}

export function ItemsScreen() {
  const store = useStore();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...store.items].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
    if (!q) return sorted;
    return sorted.filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()));
  }, [query, store.items]);

  const save = async () => {
    if (!draft) return;
    const rate = Number(draft.rate);
    const nameEn = draft.nameEn.trim();
    const nameKn = draft.nameKn.trim();
    if (!nameEn && !nameKn) {
      Alert.alert('Name needed', 'Fill at least one of the two names.');
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      Alert.alert('Check the rate', 'The rate has to be a number above zero.');
      return;
    }
    await store.upsertItem({
      id: draft.id ?? makeId(nameEn || nameKn),
      // Either name falls back to the other, so a half-filled item still bills and prints.
      nameKn: nameKn || nameEn,
      nameEn: nameEn || nameKn,
      rate,
      unit: draft.unit.trim() || 'pc',
    });
    setDraft(null);
  };

  const confirmDelete = (item: Item) => {
    Alert.alert('Remove ' + item.nameEn + '?', 'Past bills keep their own copy, so they are not affected.', [
      { text: 'Keep' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void store.deleteItem(item.id);
          setDraft(null);
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search items"
          placeholderTextColor={C.soft}
          style={styles.search}
        />
        <Pressable onPress={() => setDraft(BLANK)} style={styles.plus}>
          <Text style={styles.plusText}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={results}
        keyExtractor={(i) => i.id}
        style={styles.list}
        ListHeaderComponent={
          <Text style={styles.note}>
            {store.items.length} items. Tap one to change its name or rate. Changing a rate here never
            rewrites a bill already printed.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setDraft(toDraft(item))} style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.kn}>{item.nameKn}</Text>
              <Text style={styles.en}>{item.nameEn}</Text>
            </View>
            <Text style={styles.rate}>
              {money(item.rate)}
              <Text style={styles.unit}>{' /' + item.unit}</Text>
            </Text>
          </Pressable>
        )}
      />

      <Modal visible={draft != null} transparent animationType="fade" onRequestClose={() => setDraft(null)}>
        <Pressable style={styles.backdrop} onPress={() => setDraft(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>{draft?.id ? 'Edit item' : 'New item'}</Text>
            <Field
              label="Kannada name (this is what prints)"
              value={draft ? draft.nameKn : ''}
              onChangeText={(v) => setDraft((s) => (s ? { ...s, nameKn: v } : s))}
            />
            <Field
              label="English name (for searching)"
              value={draft ? draft.nameEn : ''}
              onChangeText={(v) => setDraft((s) => (s ? { ...s, nameEn: v } : s))}
            />
            <View style={styles.twoCol}>
              <View style={styles.grow}>
                <Field
                  label="Rate"
                  value={draft ? draft.rate : ''}
                  onChangeText={(v) => setDraft((s) => (s ? { ...s, rate: v } : s))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.grow}>
                <Field
                  label="Unit"
                  value={draft ? draft.unit : ''}
                  onChangeText={(v) => setDraft((s) => (s ? { ...s, unit: v } : s))}
                  placeholder="kg, pc, ltr"
                />
              </View>
            </View>
            <View style={styles.sheetActions}>
              <Button label="Cancel" tone="plain" onPress={() => setDraft(null)} style={styles.grow} />
              <Button label="Save" onPress={save} style={styles.grow} />
            </View>
            {draft?.id ? (
              <Button
                label="Remove item"
                tone="danger"
                onPress={() => {
                  const existing = store.items.find((i) => i.id === draft.id);
                  if (existing) confirmDelete(existing);
                }}
                style={styles.stretch}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  grow: { flex: 1 },
  stretch: { alignSelf: 'stretch', marginTop: 10 },
  twoCol: { flexDirection: 'row', gap: 10 },
  bar: { flexDirection: 'row', gap: 8, padding: 12 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: C.ink,
  },
  plus: { width: 48, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: C.accentInk, fontSize: 26, fontWeight: '700', marginTop: -2 },
  list: { flex: 1, paddingHorizontal: 12 },
  note: { color: C.soft, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  kn: { fontSize: 18, color: C.ink },
  en: { fontSize: 13, color: C.soft, marginTop: 1 },
  rate: { fontSize: 17, fontWeight: '700', color: C.ink },
  unit: { fontSize: 12, fontWeight: '400', color: C.soft },
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 12 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
