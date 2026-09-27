import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  blankItem, blankUnit, draftToItem, itemMatches, itemToDraft, itemsToCsv, unitSummary,
  type Item, type ItemDraft, type UnitDraft,
} from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { ItemsIcon } from '../components/Icons';
import { Button, Empty, ErrorText, Field, Notice } from '../components/ui';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

/**
 * The item list on the tablet: what the typing mode will search and stock will count.
 *
 * Spreadsheet import lives on the web app instead. Filling in two hundred prices happens at a
 * computer, and bringing a file into the tablet would need a file-picker added to the app --
 * which means rebuilding it -- for something the counter PC already does. Export works here,
 * through the share sheet, the same way the backup does.
 */
export function ItemsScreen() {
  const shop = useShop();
  const t = shop.t;
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.listItems(true));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.dataVersion]);

  const results = useMemo(
    () => (query.trim() ? items.filter((i) => itemMatches(i, query)) : items),
    [items, query],
  );
  const selling = items.filter((i) => i.active).length;

  const save = async () => {
    if (!draft) return;
    const checked = draftToItem(draft);
    if (!checked.ok) {
      setDraftError(checked.error);
      return;
    }
    setBusy(true);
    try {
      const { id, ...fields } = checked.item;
      if (id) await api.updateItem(id, fields);
      else await api.createItem(fields);
      setDraft(null);
      setDraftError(null);
      await load();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await api.deleteItem(draft.id);
      setDraft(null);
      await load();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const path = FileSystem.cacheDirectory + 'items-' + new Date().toISOString().slice(0, 10) + '.csv';
      await FileSystem.writeAsStringAsync(path, itemsToCsv(items));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: t('it.export') });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setUnit = (i: number, patch: Partial<UnitDraft>) =>
    setDraft((d) => (d ? { ...d, units: d.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) } : d));

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <ErrorText onDismiss={() => setError(null)}>{error}</ErrorText> : null}

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>{t('it.count')}</Text>
          <Text style={styles.statValue}>{selling}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>{t('it.retiredCount')}</Text>
          <Text style={styles.statValue}>{items.length - selling}</Text>
        </View>
      </View>

      <View style={styles.bar}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder={t('it.searchPlaceholder')}
          placeholderTextColor={C.faint}
          accessibilityLabel={t('it.searchAria')}
        />
        <Button
          label={t('common.new')}
          style={styles.slim}
          onPress={() => { setDraft(blankItem()); setDraftError(null); }}
        />
      </View>
      <View style={styles.bar}>
        <Button label={t('it.export')} tone="plain" disabled={items.length === 0}
          style={{ flex: 1 }} onPress={() => void exportCsv()} />
      </View>

      {loading ? (
        <Text style={styles.empty}>{t('it.loading')}</Text>
      ) : results.length === 0 ? (
        <Empty icon={<ItemsIcon size={30} color={C.faint} />}>
          {items.length === 0 ? t('it.noneYet') : t('it.nothing')}
        </Empty>
      ) : (
        results.map((it) => (
          <Pressable
            key={it.id}
            style={styles.row}
            onPress={() => { setDraft(itemToDraft(it)); setDraftError(null); }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{[it.nameKn, it.nameEn].filter(Boolean).join(' · ')}</Text>
              <Text style={styles.small}>
                {unitSummary(it)}
                {it.place ? ' · ' + it.place : ''}
                {!it.active ? ' · ' + t('it.retired') : ''}
              </Text>
            </View>
          </Pressable>
        ))
      )}

      <Dialog
        visible={draft != null}
        title={draft?.id ? t('it.editTitle') : t('it.newTitle')}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" style={{ flex: 1 }} onPress={() => setDraft(null)} />
            <Button label={t('common.save')} style={{ flex: 1 }} busy={busy} onPress={() => void save()} />
          </>
        }
      >
        {draft ? (
          <View>
            {draftError ? <ErrorText>{draftError}</ErrorText> : null}
            <Field label={t('it.nameKn')} value={draft.nameKn}
              onChangeText={(nameKn) => setDraft({ ...draft, nameKn })} />
            <Field label={t('it.nameEn')} value={draft.nameEn}
              onChangeText={(nameEn) => setDraft({ ...draft, nameEn })} />

            <Text style={styles.section}>{t('it.units')}</Text>
            <Text style={styles.small}>{t('it.unitsHint')}</Text>
            {draft.units.map((u, i) => (
              <View key={i} style={styles.unitBox}>
                <View style={styles.unitRow}>
                  <Cell label={t('it.unitCode')} value={u.code} placeholder="pc"
                    onChangeText={(code) => setUnit(i, { code })} />
                  <Cell label={t('it.perBase')} value={i === 0 ? '1' : u.perBase} editable={i !== 0}
                    keyboardType="decimal-pad" placeholder="24" onChangeText={(perBase) => setUnit(i, { perBase })} />
                  <Cell label={t('it.price')} value={u.price} keyboardType="decimal-pad"
                    onChangeText={(price) => setUnit(i, { price })} />
                </View>
                <View style={styles.unitRow}>
                  <Cell label={t('it.min')} value={u.min} keyboardType="decimal-pad"
                    onChangeText={(min) => setUnit(i, { min })} />
                  <Cell label={t('it.max')} value={u.max} keyboardType="decimal-pad"
                    onChangeText={(max) => setUnit(i, { max })} />
                </View>
                <Cell label={t('it.slabs')} value={u.slabs} placeholder="10:4.5; 50:4"
                  onChangeText={(slabs) => setUnit(i, { slabs })} />
                {i > 0 ? (
                  <Button label={t('it.removeUnit')} tone="plain"
                    onPress={() => setDraft({ ...draft, units: draft.units.filter((_, j) => j !== i) })} />
                ) : null}
              </View>
            ))}
            <Text style={styles.small}>{t('it.slabsHint')}</Text>
            <Button label={t('it.addUnit')} tone="plain" disabled={draft.units.length >= 8}
              onPress={() => setDraft({ ...draft, units: [...draft.units, blankUnit(false)] })} />

            <View style={{ height: 12 }} />
            <Field label={t('it.place')} hint={t('it.placeHint')} value={draft.place}
              onChangeText={(place) => setDraft({ ...draft, place })} />
            <Field label={t('it.reorderAt')} hint={t('it.reorderHint')} value={draft.reorderAt}
              keyboardType="decimal-pad" onChangeText={(reorderAt) => setDraft({ ...draft, reorderAt })} />
            <View style={styles.switchRow}>
              <Switch value={draft.active} onValueChange={(active) => setDraft({ ...draft, active })}
                trackColor={{ true: C.accent, false: C.line }} />
              <Text style={styles.switchLabel}>{t('it.active')}</Text>
            </View>
            {draft.id ? (
              <>
                <Button label={t('it.delete')} tone="danger" busy={busy} onPress={() => void remove()} />
                <Notice>{t('it.deleteNote')}</Notice>
              </>
            ) : null}
          </View>
        ) : null}
      </Dialog>
    </ScrollView>
  );
}

/** One small labelled box in a unit's row. */
function Cell({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <TextInput style={[styles.cellInput, props.editable === false && styles.cellOff]}
        placeholderTextColor={C.faint} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, paddingBottom: 24, width: '100%', maxWidth: 820, alignSelf: 'center' },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 10, padding: 10, alignItems: 'center',
  },
  statLabel: { fontSize: 11, color: C.soft, textAlign: 'center' },
  statValue: { fontSize: 17, fontWeight: '800', color: C.ink, marginTop: 2 },
  bar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  slim: { paddingHorizontal: 14 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, minHeight: 48,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  small: { fontSize: 12, color: C.soft, marginTop: 2, lineHeight: 18, marginBottom: 6 },
  empty: { color: C.soft, textAlign: 'center', paddingVertical: 18 },
  section: { fontSize: 14, fontWeight: '700', color: C.ink, marginTop: 6 },
  unitBox: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 10, gap: 8 },
  unitRow: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1 },
  cellLabel: { fontSize: 11, color: C.soft, marginBottom: 3 },
  cellInput: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.lineStrong, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: C.ink, minHeight: 42,
  },
  cellOff: { color: C.faint, backgroundColor: C.well },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  switchLabel: { flex: 1, fontSize: 14, color: C.ink },
});
