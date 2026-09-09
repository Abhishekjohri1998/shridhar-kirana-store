import React, { useMemo, useState } from 'react';
import {
  Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Button, Field } from '../components/ui';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { usePrinter } from '../printer/PrintProvider';
import { buildReceipt } from '../receipt/doc';
import { useStore } from '../store/store';
import { lineAmount, money } from '../lib/money';
import { C } from '../theme';
import type { Bill, Item } from '../types';

export function BillScreen() {
  const store = useStore();
  const printer = usePrinter();
  const [query, setQuery] = useState('');
  const [qtyFor, setQtyFor] = useState<{ index: number; value: string } | null>(null);
  const [custom, setCustom] = useState<{ name: string; rate: string; qty: string } | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return store.items;
    return store.items.filter(
      (i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()),
    );
  }, [query, store.items]);

  /** The cart as it would look on paper, for the preview button. */
  const draftBill = (): Bill => ({
    no: store.bills.length ? store.bills[0]!.no + 1 : 1,
    at: new Date().toISOString(),
    lines: store.cart,
    total: store.cartTotal,
  });

  const onAdd = (item: Item) => {
    store.addItemToCart(item, 1);
    setQuery('');
  };

  const onPrint = async () => {
    if (!store.cart.length) return;
    let bill: Bill;
    try {
      bill = await store.commitBill();
    } catch (e) {
      Alert.alert('Bill not saved', e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await printer.printBill(bill);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      Alert.alert(
        'Bill ' + bill.no + ' saved, but did not print',
        reason + '\n\nThe bill is safe. Open History to print it again.',
      );
    }
  };

  const confirmClear = () => {
    Alert.alert('Clear bill?', 'This removes every line.', [
      { text: 'Keep' },
      { text: 'Clear', style: 'destructive', onPress: store.clearCart },
    ]);
  };

  const commitQty = () => {
    if (!qtyFor) return;
    const q = Number(qtyFor.value);
    if (!Number.isFinite(q)) {
      Alert.alert('Enter a number', 'For example 2, or 1.5 for one and a half kilos.');
      return;
    }
    store.setLineQty(qtyFor.index, q);
    setQtyFor(null);
  };

  const commitCustom = () => {
    if (!custom) return;
    const rate = Number(custom.rate);
    const qty = Number(custom.qty);
    if (!custom.name.trim() || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(qty) || qty <= 0) {
      Alert.alert('Check the details', 'A name, a rate above zero and a quantity above zero.');
      return;
    }
    store.addCustomLine(custom.name.trim(), rate, qty);
    setCustom(null);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.searchBar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search item (English or Kannada)"
          placeholderTextColor={C.soft}
          style={styles.search}
        />
        <Pressable onPress={() => setCustom({ name: query, rate: '', qty: '1' })} style={styles.plus}>
          <Text style={styles.plusText}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={results}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Nothing matches that. Tap + to bill it as a one-off, or add it in the Items tab.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => onAdd(item)} style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]}>
            <View style={styles.grow}>
              <Text style={styles.itemKn}>{item.nameKn}</Text>
              <Text style={styles.itemEn}>{item.nameEn}</Text>
            </View>
            <Text style={styles.itemRate}>
              {money(item.rate)}
              <Text style={styles.itemUnit}>{' /' + item.unit}</Text>
            </Text>
          </Pressable>
        )}
      />

      <View style={styles.cart}>
        <View style={styles.cartHead}>
          <Text style={styles.cartTitle}>Current bill</Text>
          {store.cart.length > 0 && (
            <Pressable onPress={confirmClear}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          )}
        </View>

        <ScrollView style={styles.cartList} keyboardShouldPersistTaps="handled">
          {store.cart.length === 0 ? (
            <Text style={styles.empty}>Tap items above to start the bill.</Text>
          ) : (
            store.cart.map((line, index) => (
              <View key={line.itemId + '-' + index} style={styles.cartRow}>
                <Pressable onPress={() => setQtyFor({ index, value: String(line.qty) })} style={styles.qtyBox}>
                  <Text style={styles.qtyText}>{line.qty}</Text>
                </Pressable>
                <View style={styles.grow}>
                  <Text style={styles.cartName}>{line.nameKn}</Text>
                  <Text style={styles.cartRate}>{'@ ' + money(line.rate)}</Text>
                </View>
                <Pressable onPress={() => store.setLineQty(index, line.qty - 1)} style={styles.step}>
                  <Text style={styles.stepText}>-</Text>
                </Pressable>
                <Pressable onPress={() => store.setLineQty(index, line.qty + 1)} style={styles.step}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.cartAmount}>{money(lineAmount(line.qty, line.rate))}</Text>
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalValue}>{money(store.cartTotal)}</Text>
        </View>

        <View style={styles.actions}>
          <Button label="Preview" tone="plain" onPress={() => setPreview(draftBill())} disabled={!store.cart.length} style={styles.grow} />
          <Button
            label={printer.busy ? 'Printing...' : 'Print bill'}
            onPress={onPrint}
            disabled={!store.cart.length || printer.busy}
            style={styles.growTwo}
          />
        </View>
      </View>

      {/* Quantity entry. Weighed goods need 1.5 or 0.25, so it is a decimal field, not a stepper. */}
      <Modal visible={qtyFor != null} transparent animationType="fade" onRequestClose={() => setQtyFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setQtyFor(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Field
              label="Quantity"
              value={qtyFor ? qtyFor.value : ''}
              onChangeText={(v) => setQtyFor((s) => (s ? { ...s, value: v } : s))}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.sheetActions}>
              <Button label="Cancel" tone="plain" onPress={() => setQtyFor(null)} style={styles.grow} />
              <Button label="Set" onPress={commitQty} style={styles.grow} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Goods not worth keeping in the item list. */}
      <Modal visible={custom != null} transparent animationType="fade" onRequestClose={() => setCustom(null)}>
        <Pressable style={styles.backdrop} onPress={() => setCustom(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>One-off item</Text>
            <Field
              label="Name (prints as typed)"
              value={custom ? custom.name : ''}
              onChangeText={(v) => setCustom((s) => (s ? { ...s, name: v } : s))}
              autoFocus
            />
            <View style={styles.twoCol}>
              <View style={styles.grow}>
                <Field
                  label="Rate"
                  value={custom ? custom.rate : ''}
                  onChangeText={(v) => setCustom((s) => (s ? { ...s, rate: v } : s))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.grow}>
                <Field
                  label="Qty"
                  value={custom ? custom.qty : ''}
                  onChangeText={(v) => setCustom((s) => (s ? { ...s, qty: v } : s))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <View style={styles.sheetActions}>
              <Button label="Cancel" tone="plain" onPress={() => setCustom(null)} style={styles.grow} />
              <Button label="Add to bill" onPress={commitCustom} style={styles.grow} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* What the paper will look like. */}
      <Modal visible={preview != null} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPreview(null)}>
          <Pressable style={styles.previewSheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Receipt preview</Text>
            <ScrollView style={styles.previewScroll}>
              {preview ? <ReceiptPreview doc={buildReceipt(preview, store.settings)} /> : null}
            </ScrollView>
            <Button label="Close" tone="plain" onPress={() => setPreview(null)} style={styles.stretch} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  grow: { flex: 1 },
  growTwo: { flex: 2 },
  stretch: { alignSelf: 'stretch', marginTop: 12 },
  twoCol: { flexDirection: 'row', gap: 10 },

  searchBar: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 8 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: C.ink,
  },
  plus: { width: 48, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: C.accentInk, fontSize: 26, fontWeight: '700', marginTop: -2 },

  list: { flex: 1, paddingHorizontal: 12 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  pressed: { backgroundColor: '#eef6f1' },
  itemKn: { fontSize: 19, color: C.ink },
  itemEn: { fontSize: 13, color: C.soft, marginTop: 1 },
  itemRate: { fontSize: 17, fontWeight: '700', color: C.ink },
  itemUnit: { fontSize: 12, fontWeight: '400', color: C.soft },
  empty: { color: C.soft, textAlign: 'center', paddingVertical: 20, paddingHorizontal: 16, lineHeight: 20 },

  cart: { backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  cartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  cartTitle: { fontSize: 13, fontWeight: '700', color: C.soft, letterSpacing: 0.8 },
  clear: { color: C.danger, fontWeight: '700' },
  cartList: { maxHeight: 210 },
  cartRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line,
  },
  qtyBox: { minWidth: 40, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: C.bg, alignItems: 'center' },
  qtyText: { fontSize: 17, fontWeight: '700', color: C.ink },
  cartName: { fontSize: 17, color: C.ink },
  cartRate: { fontSize: 12, color: C.soft },
  step: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 20, color: C.ink, marginTop: -2 },
  cartAmount: { minWidth: 74, textAlign: 'right', fontSize: 17, fontWeight: '700', color: C.ink },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: C.soft, letterSpacing: 1 },
  totalValue: { fontSize: 30, fontWeight: '800', color: C.ink },
  actions: { flexDirection: 'row', gap: 10 },

  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16 },
  previewSheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16, alignItems: 'center' },
  previewScroll: { maxHeight: 460 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 12 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
