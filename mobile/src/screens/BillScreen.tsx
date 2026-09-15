import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import {
  lineHasSomething,
  MAX_PARKED, buildReceipt, carriedBalance, checkCustomer, customerName, dateStamp, draftTotal,
  isDraftEmpty, money, pageFlip, parsePaid, parsePrice, round2, slipTailPadding,
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
  /** Which parked bill is being thrown away, once it has something on it worth asking about. */
  const [closing, setClosing] = useState<string | null>(null);
  // Cleared when the shopkeeper moves to another bill: "Bill #14 saved" offering to share a
  // different bill's slip is worse than not offering at all.
  useEffect(() => setJustSaved(null), [shop.activeDraftId]);
  const [preview, setPreview] = useState<Bill | null>(null);
  /** Price text per line, so half-typed values like "12." survive keystrokes. */
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  /** One writing strip per line, so a row's undo button can reach its own strokes. */
  const pads = useRef<Record<string, InkPadHandle | null>>({});
  /** The same, for the price boxes, so one line's price can hand on to the next one's. */
  const prices = useRef<Record<string, TextInput | null>>({});
  /** And for the item boxes, so a list can be typed straight down without touching the glass. */
  const names = useRef<Record<string, TextInput | null>>({});
  const sheet = useRef<ScrollView>(null);
  /*
   * What the slip actually measures, so the page can be turned rather than guessed at.
   *
   * A row is not a fixed height -- the compact and wide layouts differ, and so does the writing
   * strip on a roomy screen -- so every one of these is taken from a layout event.
   */
  const rowY = useRef<Record<string, number>>({});
  const rowH = useRef(0);
  const offset = useRef(0);
  const [viewport, setViewport] = useState(0);
  /**
   * Which lines are being written rather than typed, by line id.
   *
   * Not on the line itself: it is how the shopkeeper is entering this one row right now, not
   * anything the bill should carry to the printer or remember tomorrow. A line that already has
   * strokes opens as writing without needing an entry here.
   */
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  /** Keep one empty line at the foot, always: on paper the next line is simply there. */
  useEffect(() => {
    const last = shop.cart[shop.cart.length - 1];
    // A typed name makes the line non-blank too, so typing an item brings the next one up the
    // same way a first pen stroke always has.
    const lastIsBlank = last != null && !lineHasSomething(last);
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
  /** Set when a line is finished; read after the render that adds the next blank one. */
  const wantFlip = useRef(false);

  const goToNewestLine = useCallback(() => {
    // Asked for here, done once the row it is about exists: pricing the last line appends a
    // fresh blank one, and that lands after this. Measuring straight away asks about the wrong
    // row and finds it comfortably in view.
    wantFlip.current = true;
  }, []);

  const turnPage = useCallback(() => {
    requestAnimationFrame(() => {
      const cart = shop.cart;
      const newest = cart[cart.length - 1];
      if (!newest) return;
      // Scrolling to the very end pinned the line being written to the bottom edge, so every
      // item was written at the foot of the glass. This turns the page instead: the newest line
      // goes to the top, with a page of room under it, and only once it has fallen out of view.
      const y = pageFlip({
        rowTop: rowY.current[newest.itemId] ?? 0,
        rowHeight: rowH.current,
        offset: offset.current,
        viewport,
      });
      if (y != null) sheet.current?.scrollTo({ y, animated: true });
    });
  }, [shop.cart, viewport]);

  useEffect(() => {
    if (!wantFlip.current) return;
    wantFlip.current = false;
    turnPage();
  });

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

  /**
   * Item entered, on to the next item -- never to the price beside it.
   *
   * The shop writes the whole list first and prices it afterwards, so the action key on a
   * description goes down the column, the way the price key already goes down its own. On the
   * last line there is no next row yet: typing a name is what makes the blank one appear, and
   * that lands after this. So the wanted row is remembered by id and focused once it exists --
   * the same shape as wantFlip above, for the same reason.
   */
  const wantName = useRef<string | null>(null);

  const goToNextName = useCallback((index: number) => {
    const next = shop.cart[index + 1];
    if (next) {
      const field = names.current[next.itemId];
      if (field) field.focus();
      else wantName.current = next.itemId;
      return;
    }
    // The blank line this typing has just earned does not exist yet, and neither does its id.
    wantName.current = '';
    goToNewestLine();
  }, [shop.cart, goToNewestLine]);

  useEffect(() => {
    const wanted = wantName.current;
    if (wanted == null) return;
    // '' means "whichever line is newest", which is the one the typing brought into being.
    const target = wanted === '' ? shop.cart[shop.cart.length - 1]?.itemId : wanted;
    const field = target ? names.current[target] : null;
    if (!field) return;
    wantName.current = null;
    field.focus();
  });

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
  // A typed name counts as much as a written one now that most lines are typed: a line with a
  // description and no price yet is still a line the shopkeeper has started.
  const written = shop.cart.filter(lineHasSomething);
  const hasSomething = written.length > 0;
  /** Every line that has anything on it is ticked, so the button offers to undo rather than redo. */
  const allGiven = written.length > 0 && written.every((l) => l.given === true);

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
      return {
        id: shop.customer.id,
        name: shop.customer.name,
        nameKn: shop.customer.nameKn ?? '',
        phone: shop.customer.phone,
      };
    }
    const { name, nameKn, phone } = shop.customerDraft;
    if (!name.trim() && !nameKn.trim() && !phone.trim()) return undefined;
    const checked = checkCustomer(name, phone, nameKn);
    return checked.ok
      ? { id: 'pending', name: checked.name, nameKn: checked.nameKn, phone: checked.phone }
      : undefined;
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
    note: shop.note,
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
    const { name, nameKn, phone } = shop.customerDraft;
    if (shop.customer || (!name.trim() && !nameKn.trim() && !phone.trim())) return { ok: true };
    const checked = checkCustomer(name, phone, nameKn);
    if (!checked.ok) {
      setError(checked.error);
      return { ok: false };
    }
    try {
      // Returned rather than only stored: commitBill closed over the customer as it was a moment
      // ago, so a customer attached in this very click is invisible to it unless handed over.
      const saved = await shop.saveCustomer({
        name: checked.name, nameKn: checked.nameKn, phone: checked.phone,
      });
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
    const printed = bill;
    // Only this bill's lines: the map is keyed by line id and shared with the bills still
    // parked, so wiping it wholesale would blank their half-typed prices too.
    setPriceText((prev) => {
      const gone = new Set(printed.lines.map((l) => l.itemId));
      const left: Record<string, string> = {};
      for (const [id, text] of Object.entries(prev)) if (!gone.has(id)) left[id] = text;
      return left;
    });
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
      {/* One tab per bill in progress. A second customer in a hurry no longer means making them
          wait or throwing the slip away -- park this one, serve them, come back. Scrolls
          sideways: a second row here would come straight out of the writing area. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsRow}
      >
        {shop.drafts.map((d, i) => {
          const total = draftTotal(d);
          const label = d.customer
            ? customerName(d.customer, shop.lang) || d.customer.phone
            : d.typed.name.trim() || d.typed.nameKn.trim() || t('bill.billN', { n: i + 1 });
          const on = d.id === shop.activeDraftId;
          return (
            <View key={d.id} style={[styles.tab, on && styles.tabOn]}>
              <Pressable onPress={() => shop.switchBill(d.id)} style={styles.tabFace}>
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]} numberOfLines={1}>
                  {label}
                </Text>
                {total > 0 ? (
                  <Text style={[styles.tabTotal, on && styles.tabLabelOn]}>{money(total)}</Text>
                ) : null}
              </Pressable>
              {shop.drafts.length > 1 ? (
                <Pressable
                  onPress={() => (isDraftEmpty(d) ? shop.closeBill(d.id) : setClosing(d.id))}
                  accessibilityLabel={t('bill.closeBill')}
                  style={styles.tabClose}
                >
                  <Text style={styles.tabCloseText}>×</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {shop.drafts.length < MAX_PARKED ? (
          <Pressable onPress={shop.newBill} style={styles.tabNew}>
            <Text style={styles.tabNewText}>{t('bill.newBill')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

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
            {/* The row spends this much on the given tick before the description starts. Without
                it here every heading after NO. sat 36px left of its own column, putting ITEM on
                top of the checkbox. */}
            <View style={styles.colTick} />
            <Text style={[styles.slipHeadText, { flex: 1, textAlign: 'center' }]}>{t('bill.item')}</Text>
            {compact ? null : (
              <>
                {/* Pen, price, undo, remove -- the same four the row lays out, so PRICE sits
                    over the figures rather than 42px to their left. */}
                <View style={styles.colIcon} />
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
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: 8 + slipTailPadding(viewport, rowH.current) },
            ]}
            keyboardShouldPersistTaps="handled"
            onLayout={(e) => setViewport(Math.round(e.nativeEvent.layout.height))}
            onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={16}
          >

          {shop.cart.map((line, index) => {
            const blank = !lineHasSomething(line);
            return (
              <View
                style={[styles.slipLine, compact && styles.slipLineCompact]}
                key={line.itemId}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  rowY.current[line.itemId] = y;
                  rowH.current = Math.round(height);
                }}
              >
                {/* Narrow screens split the row in two so the writing takes the whole width;
                    wide ones keep everything on one line. Same children either way. */}
                <View style={compact ? styles.slipRowTop : styles.slipRowWideLeft}>
                <Text style={[styles.slipNo, styles.colNo]}>{index + 1}</Text>

                {/* Handed over, as against merely listed. Before the description, where the
                    shop's own drawing put it. */}
                <Pressable
                  style={[styles.tick, line.given && styles.tickOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: line.given === true }}
                  accessibilityLabel={t('bill.givenLine', { n: index + 1 })}
                  onPress={() => shop.setLineGiven(index, !line.given)}
                >
                  <Text style={[styles.tickText, line.given && styles.tickTextOn]}>
                    {line.given ? '✓' : ''}
                  </Text>
                </Pressable>

                <View style={styles.slipWrite}>
                  {/*
                    * Typed by default, written when asked for.
                    *
                    * Handwriting was the founding idea of this slip, and it stays one tap away --
                    * but with a Kannada keypad on the tablet, typing is quicker for most lines,
                    * and a line that already holds strokes opens as writing so a parked bill
                    * comes back the way it was left.
                    */}
                  {writing[line.itemId] ?? (line.ink != null) ? (
                    <>
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
                      {/* pointerEvents none, or the hint sits on top of the writing strip and
                          eats every stroke aimed at it -- which is exactly where someone starts
                          writing. The web stylesheet has always said this; the phone did not. */}
                      {!line.ink ? (
                        <View style={styles.slipGhostWrap} pointerEvents="none">
                          <Text style={styles.slipGhost}>{t('bill.writeHint')}</Text>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <TextInput
                      ref={(el) => { names.current[line.itemId] = el; }}
                      style={styles.slipName}
                      value={line.nameKn}
                      onChangeText={(text) => shop.setLineName(index, text)}
                      placeholder={t('bill.typeHint')}
                      placeholderTextColor={C.faint}
                      accessibilityLabel={t('bill.writeLine', { n: index + 1 })}
                      // Down the item column, not across to the price: the shop writes the whole
                      // list first. blurOnSubmit false or the keyboard shuts before the next box
                      // can take it, and it comes back up with a flicker.
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => goToNextName(index)}
                    />
                  )}
                </View>

                {/* Swaps this one line between the two, and says which way it will go. */}
                <Pressable
                  style={styles.colIcon}
                  accessibilityLabel={t('bill.handwriteLine', { n: index + 1 })}
                  onPress={() => setWriting((w) => ({
                    ...w, [line.itemId]: !(w[line.itemId] ?? (line.ink != null)),
                  }))}
                >
                  <Text style={styles.slipUndo}>
                    {writing[line.itemId] ?? (line.ink != null) ? '⌨' : '✎'}
                  </Text>
                </Pressable>
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

          {/* Under the last line, because it is about all of them. The same button undoes
              itself, and says which way it will go rather than leaving it to be guessed. */}
          {written.length > 0 ? (
            <Pressable
              style={styles.selectAll}
              onPress={() => shop.setAllGiven(!allGiven)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allGiven }}
            >
              <View style={[styles.tick, allGiven && styles.tickOn]}>
                <Text style={[styles.tickText, allGiven && styles.tickTextOn]}>
                  {allGiven ? '✓' : ''}
                </Text>
              </View>
              <Text style={styles.selectAllText}>
                {allGiven ? t('bill.selectNone') : t('bill.selectAll')}
              </Text>
            </Pressable>
          ) : null}
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

        {/* The bill's own note. Outside the pay box on purpose: a walk-in cash sale is exactly
            the one that needs "to be collected Friday" written on it. */}
        <View style={styles.noteBox}>
          <Text style={styles.payLabel}>{t('bill.note')}</Text>
          <TextInput
            style={styles.payInput}
            value={shop.note}
            maxLength={200}
            placeholder={t('bill.notePlaceholder')}
            placeholderTextColor={C.faint}
            onChangeText={shop.setNote}
          />
        </View>

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
        visible={closing != null}
        title={t('bill.closeBill')}
        onClose={() => setClosing(null)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setClosing(null)} style={{ flex: 1 }} />
            <Button
              label={t('bill.closeBill')}
              tone="danger"
              onPress={() => {
                if (closing) shop.closeBill(closing);
                setClosing(null);
              }}
              style={{ flex: 1 }}
            />
          </>
        }
      >
        <Text style={styles.offline}>{t('bill.closeBillAsk')}</Text>
      </Dialog>

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
  tabs: { flexGrow: 0, backgroundColor: C.bg },
  tabsRow: { flexDirection: 'row', alignItems: 'stretch', gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'stretch',
    borderWidth: 1, borderColor: C.lineStrong, borderRadius: R.sm, backgroundColor: C.card,
  },
  tabOn: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  tabFace: { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: 180, paddingHorizontal: 10, paddingVertical: 7 },
  tabLabel: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: C.soft },
  tabLabelOn: { color: C.accentDeep },
  tabTotal: { fontSize: 13, fontWeight: '700', color: C.soft, fontVariant: ['tabular-nums'] },
  tabClose: { justifyContent: 'center', paddingRight: 8, paddingLeft: 2 },
  tabCloseText: { fontSize: 16, color: C.faint },
  tabNew: {
    justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.lineStrong,
    borderRadius: R.sm, paddingHorizontal: 11,
  },
  tabNewText: { fontSize: 13, fontWeight: '700', color: C.soft },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
    backgroundColor: C.accentWash, borderWidth: 1, borderColor: C.accentEdge,
    borderRadius: R.sm, paddingLeft: 12, paddingRight: 10, paddingVertical: 6,
  },
  savedText: { flex: 1, fontSize: 13, fontWeight: '700', color: C.accentDeep },
  savedButton: { minHeight: 38 },
  savedDismiss: { fontSize: 20, color: C.accentDeep, paddingHorizontal: 4 },
  /* Side by side once there is room: the slip on the left, the total parked on the right. */
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 10 },
  selectAllText: { fontSize: 15, color: C.soft },
  /* The given tick, before the description where the shop's own drawing put it. */
  tick: {
    width: 30, height: 30, borderRadius: R.sm, borderWidth: 1, borderColor: C.lineStrong,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, marginRight: 6,
  },
  tickOn: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  tickText: { fontSize: 17, color: C.faint },
  tickTextOn: { color: C.accentDeep, fontWeight: '700' },
  /* The typed description. Same height as the writing strip's baseline so a mixed bill does not
     look like two different slips stacked together. */
  slipName: {
    flex: 1, minHeight: 44, fontSize: 17, color: C.ink, paddingHorizontal: 8,
    borderBottomWidth: 1, borderColor: C.line,
  },
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
  /** Matches styles.tick, width and margin both, so the header tracks the row. */
  colTick: { width: 30, marginRight: 6 },
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
  noteBox: { marginBottom: 8 },
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
