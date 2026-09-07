import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import {
  buildReceipt, carriedBalance, checkCustomer, dateStamp, money, parsePaid, parsePrice, round2,
  type Bill, type Customer,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad, type InkPadHandle } from '../components/InkPad';
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
  /**
   * The totals stay at the foot at every width.
   *
   * They were put beside the slip on wide screens, which cost the writing a third of its length
   * and bought a column that holds one number and two buttons. Length is what a line of Kannada
   * needs; the total is read once at the end.
   */
  const { width } = useWindowDimensions();
  const roomy = width >= 820;
  /**
   * A phone in portrait cannot spare the width for a single row.
   *
   * The number, price box and two icons are all fixed, and on a 360-point screen they and their
   * gaps take 214 of the 316 available -- leaving about a hundred points to write a Kannada item
   * name in. Below 600 the row becomes two: writing across the full width, and the price and
   * buttons underneath.
   */
  const compact = width < 600;
  const [error, setError] = useState<string | null>(null);
  /** The bill just saved, so a copy can go to the customer while they are still standing here. */
  const [justSaved, setJustSaved] = useState<Bill | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);
  /** Price text per line, so half-typed values like "12." survive keystrokes. */
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  /** One writing strip per line, so a row's undo button can reach its own strokes. */
  const pads = useRef<Record<string, InkPadHandle | null>>({});
  /** The same, for the price boxes, so one line's price can hand on to the next one's. */
  const prices = useRef<Record<string, TextInput | null>>({});
  const sheet = useRef<ScrollView>(null);

  /** Keep one empty line at the foot, always: on paper the next line is simply there. */
  useEffect(() => {
    const last = shop.cart[shop.cart.length - 1];
    const lastIsBlank = last && !last.ink && last.rate === 0;
    if (!lastIsBlank) shop.addBlankLine();
  }, [shop]);

  /**
   * Follow the writing down the page, but only once a line is finished.
   *
   * After forty entries the empty line is forty rows below the fold, and reaching it by hand
   * between every item is what sends a counter back to paper. The first attempt scrolled
   * whenever a line was added -- which happens on the very first stroke, so the row slid upward
   * from under the pen mid-word. Leaving the price field is the unambiguous "done with this one"
   * moment, and it can never land mid-stroke.
   */
  const goToNewestLine = useCallback(() => {
    requestAnimationFrame(() => sheet.current?.scrollToEnd({ animated: true }));
  }, []);

  /**
   * Price entered, on to the next one.
   *
   * A bill is written-then-priced, written-then-priced, and reaching across the row for each
   * price box in turn is the friction that makes forty items feel like forty tasks. The action
   * key moves to the line below instead; on the last line there is nothing below yet, so the
   * fresh blank one is simply scrolled into view.
   */
  const goToNextPrice = useCallback((index: number) => {
    const next = shop.cart[index + 1];
    const field = next ? prices.current[next.itemId] : null;
    if (field) field.focus();
    else goToNewestLine();
  }, [shop.cart, goToNewestLine]);

  const paid = shop.paidInput;
  const showBalance = shop.printBalance;
  const paidCheck = parsePaid(paid, shop.cartTotal);
  const paidValid = paidCheck.ok;
  const paidAmount = paidCheck.ok ? paidCheck.value : shop.cartTotal;
  // Deliberately unchanged: customer.balance + cartTotal is already carried + today, so this
  // is (carried + today) - paid. Rewriting it in terms of grandTotal would count the old
  // balance twice.
  const balanceAfter = shop.customer
    ? round2(shop.customer.balance + shop.cartTotal - paidAmount)
    : 0;

  /*
   * What the customer is actually being asked for: today's lines plus whatever they already
   * owed. cartTotal stays the lines alone -- it is what the server stores as the bill's own
   * total and what buildReceipt is handed, and buildReceipt adds the carried balance itself.
   * The same carriedBalance() decides both, so the footer and the paper cannot disagree.
   */
  const carried = carriedBalance(showBalance, shop.customer?.balance);
  const grandTotal = round2(shop.cartTotal + carried);

  useEffect(() => {
    if (shop.printBalanceTouched) return;
    /*
     * On when there is anything to say about a balance at all -- what they walked in owing, or
     * what they leave owing. It used to look only at what was left, so paying an old debt off in
     * full switched the balance lines back off: the slip lost the line explaining the larger
     * total and printed TOTAL 150 against Paid 600. The bill that settles an account is exactly
     * the one the customer most needs the arithmetic on.
     */
    const anyBalance = (shop.customer?.balance ?? 0) !== 0 || balanceAfter !== 0;
    shop.setPrintBalance(shop.customer != null && anyBalance, false);
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
    // What they owed walking in. `balanceAfter` above is already this plus today's lines less
    // what is paid, so the preview and the printed slip cannot disagree on any figure.
    previousBalance: shop.customer ? shop.customer.balance : 0,
    previousBalanceAt: shop.customerBalanceAt,
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
    setJustSaved(bill);
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(t('bill.savedNotPrinted', { no: bill.no, reason }));
    }
  };

  return (
    <View style={styles.wrap}>
      {/* Pinned at the top, above the writing. Forty lines down a bill these fields used to be
          off the top of the screen, so attaching somebody meant scrolling back and losing your
          place in what you were writing. */}
      <View style={styles.top}>
        <CustomerBar />
        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* Offered here rather than only from History: the moment a customer asks for a copy is
            the moment they are still at the counter. */}
        {justSaved ? (
          <View style={styles.savedRow}>
            <Text style={styles.savedText}>{t('bill.savedBill', { no: justSaved.no })}</Text>
            <Button
              label={printer.busy ? t('hist.sharing') : t('hist.share')}
              tone="plain"
              disabled={printer.busy}
              onPress={() => {
                void printer.shareBill(justSaved, shop.settings).catch((e: unknown) => {
                  setError(t('hist.couldNotShare') + ': ' + (e instanceof Error ? e.message : String(e)));
                });
              }}
              style={styles.savedButton}
            />
            <Pressable onPress={() => setJustSaved(null)} accessibilityLabel={t('common.close')}>
              <Text style={styles.savedDismiss}>×</Text>
            </Pressable>
          </View>
        ) : null}
        {shop.offline ? <Text style={styles.offline}>{t('bill.offline')}</Text> : null}
      </View>

      {/* The card is the fixed thing; only its rows scroll, so the column names stay above the
          column they name however far down the slip you are. */}
      <View style={styles.slip}>
          <View style={styles.slipHead}>
            <Text style={[styles.slipHeadText, styles.colNo, styles.slipHeadNo]}>{t('bill.no')}</Text>
            <Text style={[styles.slipHeadText, { flex: 1 }]}>{t('bill.item')}</Text>
            {compact ? null : (
              <>
                <Text style={[styles.slipHeadText, styles.colPrice, { textAlign: 'right' }]}>
                  {t('bill.price')}
                </Text>
                <View style={styles.colIcon} />
                <View style={styles.colIcon} />
              </>
            )}
          </View>

          <ScrollView
            ref={sheet}
            style={styles.sheet}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >

          {shop.cart.map((line, index) => {
            const blank = !line.ink && line.rate === 0;
            return (
              <View
                style={[styles.slipLine, compact && styles.slipLineCompact]}
                key={line.itemId}
              >
                {/* Narrow screens split the row in two so the writing takes the whole width;
                    wide ones keep everything on one line. Same children either way. */}
                <View style={compact ? styles.slipRowTop : styles.slipRowWideLeft}>
                <Text style={[styles.slipNo, styles.colNo]}>{index + 1}</Text>

                <View style={styles.slipWrite}>
                  <InkPad
                    ref={(handle) => { pads.current[line.itemId] = handle; }}
                    variant="line"
                    height={roomy ? 116 : 96}
                    value={line.ink ?? null}
                    onChange={(ink) => shop.setLineInk(index, ink)}
                    label={t('bill.writeLine', { n: index + 1 })}
                    undoLabel=""
                    clearLabel=""
                    hint=""
                    strokeCount={() => ''}
                  />
                  {/* pointerEvents none, or the hint sits on top of the writing strip and eats
                      every stroke aimed at it -- which is exactly where someone starts writing.
                      The web stylesheet has always said this; the phone did not. */}
                  {!line.ink ? (
                    <View style={styles.slipGhostWrap} pointerEvents="none">
                      <Text style={styles.slipGhost}>{t('bill.writeHint')}</Text>
                    </View>
                  ) : null}
                </View>
                </View>

                <View style={compact ? styles.slipRowBottom : styles.slipRowWideRight}>
                {/* The heading for this column lives up in the header row when there is space for
                    it; in the stacked layout the box has moved down here, so its name comes with
                    it rather than pointing at the writing strip. */}
                {compact ? <Text style={styles.slipPriceTag}>{t('bill.price')}</Text> : null}
                <TextInput
                  ref={(el) => { prices.current[line.itemId] = el; }}
                  style={[styles.slipPrice, styles.colPrice]}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  placeholderTextColor={C.faint}
                  accessibilityLabel={t('bill.priceOfLine', { n: index + 1 })}
                  value={priceText[line.itemId] ?? (line.rate > 0 ? String(line.rate) : '')}
                  onChangeText={(text) => onPrice(index, line.itemId, text)}
                  returnKeyType="next"
                  // Without this the keyboard closes on the way past, and the next field has to
                  // raise it again -- a flicker on every single line.
                  blurOnSubmit={false}
                  onSubmitEditing={() => goToNextPrice(index)}
                  // The line is done; bring the fresh blank one into view.
                  onBlur={() => { if (index >= shop.cart.length - 2) goToNewestLine(); }}
                />

                <Pressable
                  style={styles.colIcon}
                  disabled={!line.ink}
                  accessibilityLabel={t('bill.undoLine', { n: index + 1 })}
                  onPress={() => pads.current[line.itemId]?.undo()}
                >
                  <Text style={[styles.slipUndo, !line.ink && styles.slipRemoveOff]}>⟲</Text>
                </Pressable>

                <Pressable
                  style={styles.colIcon}
                  disabled={blank}
                  accessibilityLabel={t('bill.clearLine', { n: index + 1 })}
                  onPress={() => shop.removeLine(index)}
                >
                  <Text style={[styles.slipRemove, blank && styles.slipRemoveOff]}>×</Text>
                </Pressable>
                </View>
              </View>
            );
          })}
          </ScrollView>
        </View>

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
              {/* The settling figure, one tap away. Blank still means today's shopping only,
                  so clearing a debt has to be a thing the shopkeeper does on purpose. */}
              {grandTotal > 0 ? (
                <Pressable style={styles.payAll} onPress={() => shop.setPaidInput(String(grandTotal))}>
                  <Text style={styles.payAllText}>{t('bill.payAll', { amount: money(grandTotal) })}</Text>
                </Pressable>
              ) : null}
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

        {/* Without this line a TOTAL larger than the lines above has nothing explaining it. */}
        {carried > 0 ? (
          <View style={styles.carriedRow}>
            <Text style={styles.carriedLabel}>
              {t('bill.oldBalance')}
              {shop.customerBalanceAt ? '  ' + dateStamp(shop.customerBalanceAt) : ''}
            </Text>
            <Text style={styles.carriedValue}>{money(carried)}</Text>
          </View>
        ) : null}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('bill.total')}</Text>
          <Text style={styles.totalValue}>{money(grandTotal)}</Text>
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
  wrap: { flex: 1, minHeight: 0, backgroundColor: C.bg },
  /* Padding lives here rather than on the wrap, so the totals strip below keeps its full-width
     border instead of being inset from the edges of the screen. */
  top: { paddingHorizontal: 12, paddingTop: 12 },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
    backgroundColor: C.accentWash, borderWidth: 1, borderColor: C.accentEdge,
    borderRadius: R.sm, paddingLeft: 12, paddingRight: 10, paddingVertical: 6,
  },
  savedText: { flex: 1, fontSize: 13, fontWeight: '700', color: C.accentDeep },
  savedButton: { minHeight: 38 },
  savedDismiss: { fontSize: 20, color: C.accentDeep, paddingHorizontal: 4 },
  /* Side by side once there is room: the slip on the left, the total parked on the right. */
  sheet: { flex: 1, minHeight: 0 },
  /* flexGrow so the sheet fills its half even when the slip is one line long -- without it the
     whole screen collapsed to the height of its contents and the footer rode up under the
     header. */
  sheetContent: { paddingBottom: 8 },
  offline: { ...TYPE.hint, color: C.gold, marginBottom: 8 },

  /* A ruled sheet, because that is what it replaces. */
  slip: {
    // The card fills what is left between the customer strip and the totals; the rows inside it
    // are what scroll.
    flex: 1,
    minHeight: 0,
    marginHorizontal: 12,
    marginBottom: 12,
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
  slipHeadNo: { textAlign: 'center' },
  /* Sits to the left of the price box on the stacked layout, where the header cannot reach. */
  slipPriceTag: { ...TYPE.label, fontSize: 10, alignSelf: 'center' },
  colNo: { width: 22 },
  colPrice: { width: 92 },
  colIcon: { width: 34, alignItems: 'center', justifyContent: 'center' },

  slipLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  /* Two stacked halves instead of one line, so the writing can have the full width. */
  slipLineCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 2, paddingVertical: 7 },
  /* On a wide row the two halves behave as the old single row did: the left one takes the
     slack so the writing keeps it, the right one is only as wide as its buttons. Giving both
     flex: 1 would split the row down the middle and halve the strip. */
  slipRowWideLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  slipRowWideRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slipRowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slipRowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  slipNo: { fontSize: 12, color: C.faint, textAlign: 'center' },
  slipWrite: { flex: 1, justifyContent: 'center' },
  slipGhostWrap: { position: 'absolute', left: 10, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  slipGhost: { fontSize: 13, color: C.faint },
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
  /* Undo takes back the last stroke; the cross removes the whole line. Kept apart because one is
     recoverable and the other is not. */
  slipUndo: { fontSize: 19, color: C.accent },
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

  carriedRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingBottom: 6,
  },
  carriedLabel: { fontSize: 13, color: C.soft },
  carriedValue: { fontSize: 15, fontWeight: '700', color: C.ink700 },
  payAll: {
    alignSelf: 'flex-end', marginBottom: 2,
    borderWidth: 1, borderColor: C.accentEdge, backgroundColor: C.accentWash,
    borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 9,
  },
  payAllText: { fontSize: 13, fontWeight: '700', color: C.accentDeep },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingTop: 10, paddingBottom: 10, borderTopWidth: 2, borderColor: C.ink,
  },
  totalLabel: { ...TYPE.label, fontSize: 12, letterSpacing: 1.3 },
  totalValue: { ...TYPE.display },

  actions: { flexDirection: 'row', gap: 10 },
  provisional: { ...TYPE.hint, textAlign: 'center', marginTop: 8 },
});
