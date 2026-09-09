import React, { useMemo, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { money } from '../lib/money';
import { usePrinter } from '../printer/PrintProvider';
import { buildReceipt, stamp } from '../receipt/doc';
import { useStore } from '../store/store';
import { C } from '../theme';
import type { Bill } from '../types';

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  );
}

export function HistoryScreen() {
  const store = useStore();
  const printer = usePrinter();
  const [open, setOpen] = useState<Bill | null>(null);

  /** Not a reports module -- just the number the shopkeeper counts the cash drawer against. */
  const today = useMemo(() => {
    const bills = store.bills.filter((b) => isToday(b.at));
    return { count: bills.length, total: bills.reduce((s, b) => s + b.total, 0) };
  }, [store.bills]);

  const reprint = async (bill: Bill) => {
    try {
      await printer.printBill(bill);
      setOpen(null);
    } catch (e) {
      Alert.alert('Could not print', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>TODAY</Text>
        <Text style={styles.summaryValue}>{money(today.total)}</Text>
        <Text style={styles.summaryCount}>{today.count === 1 ? '1 bill' : today.count + ' bills'}</Text>
      </View>

      <FlatList
        data={store.bills}
        keyExtractor={(b) => String(b.no)}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No bills yet.</Text>}
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.no}>{'Bill ' + item.no}</Text>
              <Text style={styles.when}>
                {stamp(item.at) + '  ·  ' + (item.lines.length === 1 ? '1 item' : item.lines.length + ' items')}
              </Text>
            </View>
            <Text style={styles.total}>{money(item.total)}</Text>
          </Pressable>
        )}
      />

      <Modal visible={open != null} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <ScrollView style={styles.scroll}>
              {open ? <ReceiptPreview doc={buildReceipt(open, store.settings)} /> : null}
            </ScrollView>
            <View style={styles.actions}>
              <Button label="Close" tone="plain" onPress={() => setOpen(null)} style={styles.grow} />
              <Button
                label={printer.busy ? 'Printing...' : 'Print again'}
                onPress={() => open && void reprint(open)}
                disabled={printer.busy}
                style={styles.grow}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  grow: { flex: 1 },
  summary: {
    margin: 12, padding: 16, backgroundColor: C.card, borderRadius: 12,
    borderWidth: 1, borderColor: C.line, alignItems: 'center',
  },
  summaryLabel: { fontSize: 12, fontWeight: '700', color: C.soft, letterSpacing: 1.2 },
  summaryValue: { fontSize: 34, fontWeight: '800', color: C.ink, marginTop: 2 },
  summaryCount: { fontSize: 13, color: C.soft },
  list: { flex: 1, paddingHorizontal: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  no: { fontSize: 17, fontWeight: '700', color: C.ink },
  when: { fontSize: 13, color: C.soft, marginTop: 1 },
  total: { fontSize: 18, fontWeight: '700', color: C.ink },
  empty: { color: C.soft, textAlign: 'center', paddingVertical: 24 },
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16, alignItems: 'center' },
  scroll: { maxHeight: 460 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12, alignSelf: 'stretch' },
});
