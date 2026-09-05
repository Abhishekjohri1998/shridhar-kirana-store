import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  buildReceipt, checkCustomer, money, parsePaid, parsePrice, round2, type Bill, type Customer,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad } from '../components/InkPad';
import { ReceiptView } from '../components/ReceiptView';
import { Button, ErrorText } from '../components/ui';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import { C, R, TYPE, shadow } from '../theme';

/**
 * The slip.
 *
 * The shop's paper receipt, on glass. Each line is written by hand -- the quantity and the item,
 * in Kannada, the way the shopkeeper already writes them -- and the price is typed beside it in
 * digits, because a total can only be added up from numbers the machine can read.
 *
 * There is no product catalogue and no search. The shop does not keep one.
 */
export function BillScreen() {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);
  /** Price text per line, so half-typed values like "12." survive keystrokes. */
  const [priceText, setPriceText] = useState<Record<string, string>>({});

  /** Keep one empty line at the foot, always: on paper the next line is simply there. */
  useEffect(() => {
    const last = shop.cart[shop.cart.length - 1];
    const lastIsBlank = last && !last.ink && last.rate === 0;
    if (!lastIsBlank) shop.addBlankLine();
  }, [shop]);

  const paid = shop.paidInput;
  const showBalance = shop.printBalance;
  const paidCheck = parsePaid(paid, shop.cartTotal);
  const paidValid = paidCheck.ok;
  const paidAmount = paidCheck.ok ? paidCheck.value : shop.cartTotal;
  const balanceAfter = shop.customer
    ? round2(shop.customer.balance + shop.cartTotal - paidAmount)
    : 0;

  useEffect(() => {
    if (shop.printBalanceTouched) return;
    shop.setPrintBalance(shop.customer != null && balanceAfter !== 0, false);
  }, [shop, balanceAfter]);

  /** Lines that carry something. The trailing blank is scaffolding, not a purchase. */
  const written = shop.cart.filter((l) => l.ink || l.rate > 0);
  const hasSomething = written.length > 0;

  const onPrice = (index: number, key: string, text: string) => {
    setPriceText((prev) => ({ ...prev, [key]: text }));
    if (text.trim() === '') {
      shop.setLineRate(index, 0);
      return;
    }
    const parsed = parsePrice(text);
    if (parsed.ok) shop.setLineRate(index, parsed.value);
  };

  /**
   * Who the preview should show. The attached customer if there is one; otherwise whatever has
   * been typed and is valid, because that is who the printed slip will name once Print attaches
   * them. A preview that differs from the paper is worse than no preview.
   */
  const previewCustomer = (): Bill['customer'] | undefined => {
    if (shop.customer) {
      return { id: shop.customer.id, name: shop.customer.name, phone: shop.customer.phone };
    }
    const { name, phone } = shop.customerDraft;
    if (!name.trim() && !phone.trim()) return undefined;
    const checked = checkCustomer(name, phone);
    return checked.ok ? { id: 'pending', name: checked.name, phone: checked.phone } : undefined;
  };

  const draft = (): Bill => ({
    no: (shop.bills[0]?.no ?? 0) + 1,
    at: new Date().toISOString(),
    ...(previewCustomer() ? { customer: previewCustomer() } : {}),
    lines: written,
    total: shop.cartTotal,
    paid: paidValid ? paidAmount : shop.cartTotal,
    balance: balanceAfter,
    showBalance: showBalance && shop.customer != null,
  });

  /**
   * A customer typed in but never attached.
   *
   * The fields sit right above the slip, so filling them in and pressing Print is an entirely
   * reasonable thing to do -- and it used to print a receipt with no customer on it and no word
   * of explanation. If what was typed is valid, attach it; if it is not, say so rather than
   * printing something that quietly omits them.
   */
  const attachTypedCustomer = async (): Promise<{ ok: boolean; customer?: Customer }> => {
    const { name, phone } = shop.customerDraft;
    if (shop.customer || (!name.trim() && !phone.trim())) return { ok: true };
    const checked = checkCustomer(name, phone);
    if (!checked.ok) {
      setError(checked.error);
      return { ok: false };
    }
    try {
      // Returned rather than only stored: commitBill closed over the customer as it was a moment
      // ago, so a customer attached in this very click is invisible to it unless handed over.
      const saved = await shop.saveCustomer({ name: checked.name, phone: checked.phone });
      return { ok: true, customer: saved };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return { ok: false };
    }
  };

  const onPrint = async () => {
    setError(null);
    if (!paidCheck.ok) {
      setError(paidCheck.error);
      return;
    }
    const attached = await attachTypedCustomer();
    if (!attached.ok) return;
    let bill: Bill;
    try {
      bill = await shop.commitBill({
        paid: paidAmount,
        showBalance,
        ...(attached.customer ? { customer: attached.customer } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setPriceText({});
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(t('bill.savedNotPrinted', { no: bill.no, reason }));
    }
  };

  return (
    <View style={styles.wrap}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        {error ? <ErrorText>{error}</ErrorText> : null}
        {shop.offline ? <Text style={styles.offline}>{t('bill.offline')}</Text> : null}

        <CustomerBar />

        <View style={styles.slip}>
          <View style={styles.slipHead}>
            <Text style={[styles.slipHeadText, styles.colNo]} />
            <Text style={[styles.slipHeadText, { flex: 1 }]}>{t('bill.whatWasSold')}</Text>
            <Text style={[styles.slipHeadText, styles.colPrice, { textAlign: 'right' }]}>{t('bill.price')}</Text>
            <View style={styles.colRemove} />
          </View>

          {shop.cart.map((line, index) => {
            const blank = !line.ink && line.rate === 0;
            return (
              <View style={styles.slipLine} key={line.itemId}>
                <Text style={[styles.slipNo, styles.colNo]}>{index + 1}</Text>

                <View style={styles.slipWrite}>
                  <InkPad
                    variant="line"
                    height={64}
                    value={line.ink ?? null}
                    onChange={(ink) => shop.setLineInk(index, ink)}
                    label={t('bill.writeLine', { n: index + 1 })}
                    undoLabel=""
                    clearLabel=""
                    hint=""
                    strokeCount={() => ''}
                  />
                  {!line.ink ? <Text style={styles.slipGhost}>{t('bill.writeHint')}</Text> : null}
                </View>

                <TextInput
                  style={[styles.slipPrice, styles.colPrice]}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={C.faint}
                  accessibilityLabel={t('bill.priceOfLine', { n: index + 1 })}
                  value={priceText[line.itemId] ?? (line.rate > 0 ? String(line.rate) : '')}
                  onChangeText={(text) => onPrice(index, line.itemId, text)}
                />

                <Pressable
                  style={styles.colRemove}
                  disabled={blank}
                  accessibilityLabel={t('bill.clearLine', { n: index + 1 })}
                  onPress={() => shop.removeLine(index)}
                >
                  <Text style={[styles.slipRemove, blank && styles.slipRemoveOff]}>×</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.foot}>
        <View style={styles.footHead}>
          <Text style={styles.footTitle}>{t('bill.currentBill')}</Text>
          {hasSomething ? (
            <Pressable onPress={shop.clearCart}>
              <Text style={styles.clear}>{t('bill.clear')}</Text>
            </Pressable>
          ) : null}
        </View>

        {shop.customer ? (
          <View style={styles.payBox}>
            <View style={styles.payRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.payLabel}>{t('bill.paidNow')}</Text>
                <TextInput
                  style={styles.payInput}
                  keyboardType="decimal-pad"
                  value={paid}
                  placeholder={t('bill.paidPlaceholder', { amount: money(shop.cartTotal) })}
                  placeholderTextColor={C.faint}
                  onChangeText={shop.setPaidInput}
                />
              </View>
              <View style={styles.balanceBox}>
                <Text style={styles.payLabel}>{t('bill.balanceAfter')}</Text>
                <Text style={styles.balanceValue}>{paidValid ? money(balanceAfter) : '—'}</Text>
              </View>
            </View>
            <View style={styles.switchRow}>
              <Switch
                value={showBalance}
                onValueChange={(v) => shop.setPrintBalance(v)}
                trackColor={{ true: C.accent, false: C.line }}
              />
              <Text style={styles.switchLabel}>{t('bill.printBalance')}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('bill.total')}</Text>
          <Text style={styles.totalValue}>{money(shop.cartTotal)}</Text>
        </View>

        <View style={styles.actions}>
          <Button
            label={t('bill.preview')}
            tone="plain"
            disabled={!hasSomething}
            style={{ flex: 1 }}
            onPress={() => setPreview(draft())}
          />
          <Button
            label={printer.busy ? t('bill.printing') : t('bill.print')}
            disabled={!hasSomething || printer.busy}
            style={{ flex: 1.4 }}
            onPress={() => void onPrint()}
          />
        </View>
      </View>

      <Dialog
        visible={preview != null}
        title={t('bill.receiptPreview')}
        onClose={() => setPreview(null)}
        footer={<Button label={t('common.close')} tone="plain" onPress={() => setPreview(null)} style={{ flex: 1 }} />}
      >
        {preview ? <ReceiptView doc={buildReceipt(preview, shop.settings, shop.receiptLabels)} /> : null}
        <Text style={styles.provisional}>{t('bill.provisional')}</Text>
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  sheet: { flex: 1 },
  sheetContent: { padding: 12, paddingBottom: 20 },
  offline: { ...TYPE.hint, color: C.gold, marginBottom: 8 },

  /* A ruled sheet, because that is what it replaces. */
  slip: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.md,
    overflow: 'hidden',
    ...shadow(1),
  },
  slipHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: C.well,
    borderBottomWidth: 1,
    borderColor: C.lineStrong,
  },
  slipHeadText: { ...TYPE.label, fontSize: 10 },
  colNo: { width: 22 },
  colPrice: { width: 92 },
  colRemove: { width: 30, alignItems: 'center', justifyContent: 'center' },

  slipLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  slipNo: { fontSize: 12, color: C.faint, textAlign: 'center' },
  slipWrite: { flex: 1, justifyContent: 'center' },
  slipGhost: {
    position: 'absolute',
    left: 10,
    fontSize: 13,
    color: C.faint,
  },
  slipPrice: {
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'right',
    fontSize: 17,
    fontWeight: '700',
    color: C.ink,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.sm,
  },
  slipRemove: { fontSize: 20, color: C.faint },
  slipRemoveOff: { opacity: 0.25 },

  foot: {
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    ...shadow(2),
  },
  footHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  footTitle: { ...TYPE.label, letterSpacing: 1.1 },
  clear: { color: C.danger, fontWeight: '700' },

  payBox: { backgroundColor: C.well, borderWidth: 1, borderColor: C.line, borderRadius: R.md, padding: 12, marginBottom: 8 },
  payRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  payLabel: { ...TYPE.label, marginBottom: 4 },
  payInput: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: C.ink, minHeight: 46,
  },
  balanceBox: { minWidth: 92, alignItems: 'flex-end' },
  balanceValue: { fontSize: 18, fontWeight: '700', color: C.ink },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  switchLabel: { flex: 1, fontSize: 13, color: C.ink, lineHeight: 18 },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingTop: 10, paddingBottom: 10, borderTopWidth: 2, borderColor: C.ink,
  },
  totalLabel: { ...TYPE.label, fontSize: 12, letterSpacing: 1.3 },
  totalValue: { ...TYPE.display },

  actions: { flexDirection: 'row', gap: 10 },
  provisional: { ...TYPE.hint, textAlign: 'center', marginTop: 8 },
});
