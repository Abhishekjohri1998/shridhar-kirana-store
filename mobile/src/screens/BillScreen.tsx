import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  INK_STROKE_DOTS, buildReceipt, lineAmount, money, parsePaid, parsePrice, parseQty, round2,
  type Bill, type Ink, type Item,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad } from '../components/InkPad';
import { InkView } from '../components/InkView';
import { KannadaInput } from '../components/KannadaInput';
import { ReceiptView } from '../components/ReceiptView';
import { Button, ErrorText, Field } from '../components/ui';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

type LooseDraft = { name: string; ink: Ink | null; rate: string; qty: string };

const BLANK: LooseDraft = { name: '', ink: null, rate: '', qty: '1' };

export function BillScreen() {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [qtyFor, setQtyFor] = useState<{ index: number; value: string } | null>(null);
  const [loose, setLoose] = useState<LooseDraft | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shop.items;
    return shop.items.filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()));
  }, [query, shop.items]);

  const paidCheck = parsePaid(shop.paidInput, shop.cartTotal);
  const paidAmount = paidCheck.ok ? paidCheck.value : shop.cartTotal;
  const balanceAfter = shop.customer ? round2(shop.customer.balance + shop.cartTotal - paidAmount) : 0;

  // Suggest printing the balance when there is one, but stop once the shopkeeper has chosen.
  useEffect(() => {
    if (shop.printBalanceTouched) return;
    shop.setPrintBalance(shop.customer != null && balanceAfter !== 0, false);
  }, [shop, balanceAfter]);

  const add = (item: Item) => {
    shop.addItemToCart(item, 1);
    setQuery('');
  };

  const draft = (): Bill => ({
    no: (shop.bills[0]?.no ?? 0) + 1,
    at: new Date().toISOString(),
    ...(shop.customer
      ? { customer: { id: shop.customer.id, name: shop.customer.name, phone: shop.customer.phone } }
      : {}),
    lines: shop.cart,
    total: shop.cartTotal,
    paid: paidAmount,
    balance: balanceAfter,
    showBalance: shop.printBalance && shop.customer != null,
  });

  const onPrint = async () => {
    setError(null);
    if (!paidCheck.ok) {
      setError(paidCheck.error);
      return;
    }
    let bill: Bill;
    try {
      bill = await shop.commitBill({ paid: paidCheck.value, showBalance: shop.printBalance });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(t('bill.savedNotPrinted', { no: bill.no, reason }));
    }
  };

  const commitQty = () => {
    if (!qtyFor) return;
    const parsed = parseQty(qtyFor.value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    shop.setLineQty(qtyFor.index, parsed.value);
    setQtyFor(null);
  };

  const commitLoose = () => {
    if (!loose) return;
    const price = parsePrice(loose.rate);
    if (!price.ok) {
      setError(price.error);
      return;
    }
    const qty = parseQty(loose.qty);
    if (!qty.ok) {
      setError(qty.error);
      return;
    }
    setError(null);
    shop.addLooseLine({ name: loose.name, ink: loose.ink, rate: price.value, qty: qty.value });
    setLoose(null);
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      <ScrollView style={styles.picker} contentContainerStyle={styles.pickerContent} keyboardShouldPersistTaps="handled">
        {shop.offline ? <ErrorText>{t('bill.offline')}</ErrorText> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}

        <CustomerBar />

        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={t('bill.searchPlaceholder')}
            placeholderTextColor={C.soft}
          />
          <Button label={t('bill.writePrice')} onPress={() => setLoose({ ...BLANK, name: query })} style={styles.writeBtn} />
        </View>

        {results.length === 0 ? (
          <Text style={styles.empty}>{t('bill.noMatch')}</Text>
        ) : (
          results.map((item) => (
            <Pressable key={item.id} style={styles.itemRow} onPress={() => add(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemKn}>{item.nameKn}</Text>
                <Text style={styles.itemEn}>{item.nameEn}</Text>
              </View>
              <Text style={styles.itemRate}>
                {money(item.rate)}
                <Text style={styles.itemUnit}> /{item.unit}</Text>
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>

      <View style={styles.cart}>
        <View style={styles.cartHead}>
          <Text style={styles.cartTitle}>{t('bill.currentBill')}</Text>
          {shop.cart.length > 0 ? (
            <Pressable onPress={shop.clearCart}>
              <Text style={styles.clear}>{t('bill.clear')}</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView style={styles.cartLines} keyboardShouldPersistTaps="handled">
          {shop.cart.length === 0 ? (
            <Text style={styles.empty}>{t('bill.emptyCart')}</Text>
          ) : (
            shop.cart.map((line, index) => (
              <View key={line.itemId + '-' + index} style={styles.cartLine}>
                <Pressable style={styles.qtyBox} onPress={() => setQtyFor({ index, value: String(line.qty) })}>
                  <Text style={styles.qtyText}>{line.qty}</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  {line.ink ? (
                    <InkView ink={line.ink} height={26} maxWidth={150} strokeDots={INK_STROKE_DOTS * 0.6} />
                  ) : line.nameKn ? (
                    <Text style={styles.cartName}>{line.nameKn}</Text>
                  ) : (
                    <Text style={[styles.cartName, { color: C.soft }]}>{t('bill.priceOnly')}</Text>
                  )}
                  <Text style={styles.cartRate}>@ {money(line.rate)}</Text>
                </View>
                <Pressable style={styles.step} onPress={() => shop.setLineQty(index, line.qty - 1)}>
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <Pressable style={styles.step} onPress={() => shop.setLineQty(index, line.qty + 1)}>
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
                <Text style={styles.cartAmount}>{money(lineAmount(line.qty, line.rate))}</Text>
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('bill.total')}</Text>
          <Text style={styles.totalValue}>{money(shop.cartTotal)}</Text>
        </View>

        {shop.customer ? (
          <View style={styles.payBox}>
            <View style={styles.payRow}>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('bill.paidNow')}
                  value={shop.paidInput}
                  onChangeText={shop.setPaidInput}
                  keyboardType="decimal-pad"
                  placeholder={t('bill.paidPlaceholder', { amount: money(shop.cartTotal) })}
                  style={{ marginBottom: 0 }}
                />
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.cartRate}>{t('bill.balanceAfter')}</Text>
                <Text style={styles.balanceValue}>{paidCheck.ok ? money(balanceAfter) : '—'}</Text>
              </View>
            </View>
            <View style={styles.switchRow}>
              <Switch
                value={shop.printBalance}
                onValueChange={(v) => shop.setPrintBalance(v)}
                trackColor={{ true: C.accent, false: C.line }}
              />
              <Text style={styles.switchLabel}>{t('bill.printBalance')}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={t('bill.preview')}
            tone="plain"
            onPress={() => setPreview(draft())}
            disabled={shop.cart.length === 0}
            style={{ flex: 1 }}
          />
          <Button
            label={printer.busy ? t('bill.printing') : t('bill.print')}
            onPress={() => void onPrint()}
            disabled={shop.cart.length === 0 || printer.busy}
            style={{ flex: 2 }}
          />
        </View>
      </View>

      <Dialog
        visible={qtyFor != null}
        title={t('bill.qtyTitle')}
        onClose={() => setQtyFor(null)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setQtyFor(null)} style={{ flex: 1 }} />
            <Button label={t('common.set')} onPress={commitQty} style={{ flex: 1 }} />
          </>
        }
      >
        <Field
          label={t('bill.qtyTitle')}
          value={qtyFor?.value ?? ''}
          onChangeText={(v) => setQtyFor((s) => (s ? { ...s, value: v } : s))}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
          hint={t('bill.qtyHint')}
        />
      </Dialog>

      <Dialog
        visible={loose != null}
        title={t('bill.addLine')}
        onClose={() => setLoose(null)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setLoose(null)} style={{ flex: 1 }} />
            <Button label={t('bill.addToBill')} onPress={commitLoose} style={{ flex: 1 }} />
          </>
        }
      >
        {loose ? (
          <View>
            <InkPad
              onChange={(ink) => setLoose((s) => (s ? { ...s, ink } : s))}
              label={t('ink.label')}
              undoLabel={t('ink.undo')}
              clearLabel={t('ink.clear')}
              hint={t('ink.hint')}
              strokeCount={(n) => t('ink.strokes', { n })}
            />
            <View style={{ height: 12 }} />
            <KannadaInput
              label={t('bill.orType')}
              value={loose.name}
              onChange={(name) => setLoose((s) => (s ? { ...s, name } : s))}
              placeholder={t('bill.leaveBlank')}
            />
            <View style={styles.twoCol}>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('bill.price')}
                  value={loose.rate}
                  onChangeText={(v) => setLoose((s) => (s ? { ...s, rate: v } : s))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={t('bill.qtyShort')}
                  value={loose.qty}
                  onChangeText={(v) => setLoose((s) => (s ? { ...s, qty: v } : s))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Text style={styles.hint}>{t('bill.looseHint')}</Text>
          </View>
        ) : null}
      </Dialog>

      <Dialog
        visible={preview != null}
        title={t('bill.receiptPreview')}
        onClose={() => setPreview(null)}
        footer={<Button label={t('common.close')} tone="plain" onPress={() => setPreview(null)} style={{ flex: 1 }} />}
      >
        {preview ? <ReceiptView doc={buildReceipt(preview, shop.settings, shop.receiptLabels)} /> : null}
        <Text style={[styles.hint, { textAlign: 'center' }]}>{t('bill.provisional')}</Text>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  picker: { flex: 1 },
  pickerContent: { padding: 12 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, minHeight: 48,
  },
  writeBtn: { paddingHorizontal: 14 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  itemKn: { fontSize: 18, color: C.ink },
  itemEn: { fontSize: 12, color: C.soft, marginTop: 1 },
  itemRate: { fontSize: 17, fontWeight: '700', color: C.ink },
  itemUnit: { fontSize: 12, fontWeight: '400', color: C.soft },
  empty: { color: C.soft, textAlign: 'center', paddingVertical: 18, paddingHorizontal: 12, lineHeight: 20 },

  cart: { backgroundColor: C.card, borderTopWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  cartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cartTitle: { fontSize: 12, fontWeight: '700', color: C.soft, letterSpacing: 0.8 },
  clear: { color: C.danger, fontWeight: '700' },
  cartLines: { maxHeight: 190 },
  cartLine: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line,
  },
  qtyBox: { minWidth: 42, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: C.bg, alignItems: 'center' },
  qtyText: { fontSize: 16, fontWeight: '700', color: C.ink },
  cartName: { fontSize: 16, color: C.ink },
  cartRate: { fontSize: 12, color: C.soft },
  step: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 19, color: C.ink, marginTop: -2 },
  cartAmount: { minWidth: 70, textAlign: 'right', fontSize: 16, fontWeight: '700', color: C.ink },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 10 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: C.soft, letterSpacing: 1 },
  totalValue: { fontSize: 28, fontWeight: '800', color: C.ink },

  payBox: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 10 },
  payRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  balanceBox: { minWidth: 92, alignItems: 'flex-end' },
  balanceValue: { fontSize: 18, fontWeight: '700', color: C.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  switchLabel: { flex: 1, fontSize: 13, color: C.ink, lineHeight: 18 },

  actions: { flexDirection: 'row', gap: 10 },
  twoCol: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 12, color: C.soft, lineHeight: 18, marginTop: 4 },
});
