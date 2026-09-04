import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkItemNames, checkUnit, money, parseRate, type Item } from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { KannadaInput } from '../components/KannadaInput';
import { Button, ErrorText, Field } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

type Draft = { id?: string; nameKn: string; nameEn: string; rate: string; unit: string };

const BLANK: Draft = { nameKn: '', nameEn: '', rate: '', unit: 'pc' };

export function ItemsScreen() {
  const shop = useShop();
  const t = shop.t;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shop.items;
    return shop.items.filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()));
  }, [query, shop.items]);

  const save = async () => {
    if (!draft) return;
    const names = checkItemNames(draft.nameKn, draft.nameEn);
    if (!names.ok) return setError(names.error);
    const rate = parseRate(draft.rate);
    if (!rate.ok) return setError(rate.error);
    const unit = checkUnit(draft.unit);
    if (!unit.ok) return setError(unit.error);
    try {
      await shop.saveItem({ id: draft.id, nameKn: names.nameKn, nameEn: names.nameEn, rate: rate.value, unit: unit.value });
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (item: Item) => {
    try {
      await shop.removeItem(item.id);
      setConfirm(null);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('items.searchPlaceholder')}
          placeholderTextColor={C.soft}
        />
        <Button label={t('common.new')} onPress={() => setDraft(BLANK)} style={{ paddingHorizontal: 14 }} />
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Text style={styles.note}>{t('items.note', { n: shop.items.length })}</Text>
        {results.map((item) => (
          <Pressable
            key={item.id}
            style={styles.row}
            onPress={() => setDraft({ id: item.id, nameKn: item.nameKn, nameEn: item.nameEn, rate: String(item.rate), unit: item.unit })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.kn}>{item.nameKn}</Text>
              <Text style={styles.en}>{item.nameEn}</Text>
            </View>
            <Text style={styles.rate}>
              {money(item.rate)}
              <Text style={styles.unit}> /{item.unit}</Text>
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <Dialog
        visible={draft != null}
        title={draft?.id ? t('items.editTitle') : t('items.newTitle')}
        onClose={() => { setDraft(null); setError(null); }}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button label={t('common.save')} onPress={() => void save()} style={{ flex: 1 }} />
          </>
        }
      >
        {draft ? (
          <View>
            <KannadaInput
              label={t('items.knName')}
              value={draft.nameKn}
              onChange={(nameKn) => setDraft((d) => (d ? { ...d, nameKn } : d))}
            />
            <Field label={t('items.enName')} value={draft.nameEn} onChangeText={(nameEn) => setDraft((d) => (d ? { ...d, nameEn } : d))} />
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <Field label={t('items.rate')} value={draft.rate} keyboardType="decimal-pad" onChangeText={(rate) => setDraft((d) => (d ? { ...d, rate } : d))} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={t('items.unit')} value={draft.unit} placeholder={t('items.unitPlaceholder')} onChangeText={(unit) => setDraft((d) => (d ? { ...d, unit } : d))} />
              </View>
            </View>
            {draft.id ? (
              <Button
                label={t('items.removeItem')}
                tone="danger"
                onPress={() => {
                  const existing = shop.items.find((i) => i.id === draft.id);
                  if (existing) setConfirm(existing);
                }}
              />
            ) : null}
          </View>
        ) : null}
      </Dialog>

      <Dialog
        visible={confirm != null}
        title={confirm ? t('items.removeTitle', { name: confirm.nameEn }) : ''}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button label={t('common.keep')} tone="plain" onPress={() => setConfirm(null)} style={{ flex: 1 }} />
            <Button label={t('common.remove')} tone="danger" onPress={() => confirm && void remove(confirm)} style={{ flex: 1 }} />
          </>
        }
      >
        <Text style={styles.note}>{t('items.removeBody')}</Text>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  bar: { flexDirection: 'row', gap: 8, padding: 12 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, minHeight: 48,
  },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  note: { color: C.soft, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  kn: { fontSize: 17, color: C.ink },
  en: { fontSize: 12, color: C.soft, marginTop: 1 },
  rate: { fontSize: 17, fontWeight: '700', color: C.ink },
  unit: { fontSize: 12, fontWeight: '400', color: C.soft },
  twoCol: { flexDirection: 'row', gap: 10 },
});
