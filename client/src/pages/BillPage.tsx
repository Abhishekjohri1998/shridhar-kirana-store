import { useEffect, useRef, useState } from 'react';
import {
  lineHasSomething,
  buildReceipt,
  checkCustomer,
  customerName,
  draftTotal,
  isDraftEmpty,
  MAX_PARKED,
  evaluateAmount,
  looksLikeSum,
  money,
  pageFlip,
  parsePaid,
  parsePrice,
  round2,
  slipTailPadding,
  carriedBalance,
  dateStamp,
  type Bill,
  type Customer,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad, type InkPadHandle } from '../components/InkPad';
import { ReceiptView } from '../components/ReceiptView';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

/**
 * The slip.
 *
 * This is the shop's paper receipt, on glass. Each line is written by hand -- the quantity and
 * the item, in Kannada, the way the shopkeeper already writes them -- and the price is typed
 * beside it in digits. Typed, because a total can only be added up from numbers the machine can
 * read; handwriting a price would mean guessing at it.
 *
 * There is no product catalogue and no search. The shop does not keep one, and asking it to
 * maintain one was the software's idea rather than the shop's.
 */
export function BillPage() {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [error, setError] = useState<string | null>(null);
  /** The bill just saved, so a copy can go to the customer while they are still standing here. */
  const [justSaved, setJustSaved] = useState<Bill | null>(null);
  // Cleared when the shopkeeper moves to another bill: "Bill #14 saved" offering to share a
  // different bill's slip is worse than not offering at all.
  useEffect(() => setJustSaved(null), [shop.activeDraftId]);
  const [preview, setPreview] = useState<Bill | null>(null);
  /** Price text per line, so half-typed values like "12." survive keystrokes. */
  const [priceText, setPriceText] = useState<Record<string, string>>({});
  /** One writing strip per line, so a row's undo button can reach its own strokes. */
  const pads = useRef<Record<string, InkPadHandle | null>>({});
  /** The scrolling slip and its rows, for turning the page -- see `pageFlip`. */
  const sheet = useRef<HTMLOListElement>(null);
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  /** The item boxes, so a list can be typed straight down without reaching for the mouse. */
  const names = useRef<Record<string, HTMLInputElement | null>>({});
  const [tail, setTail] = useState(0);
  /** Which lines are being written rather than typed, by line id. See the mobile copy. */
  const [writing, setWriting] = useState<Record<string, boolean>>({});

  /*
   * A page of blank slip under the last line, so the newest row can reach the top.
   *
   * Measured rather than assumed: the row is one height on a wide screen and another where it
   * has stacked into two lines.
   */
  useEffect(() => {
    const list = sheet.current;
    const last = shop.cart[shop.cart.length - 1];
    const row = last ? rows.current[last.itemId] : null;
    if (!list || !row) return;
    setTail(slipTailPadding(list.clientHeight, row.offsetHeight));
  }, [shop.cart, shop.activeDraftId]);

  /**
   * Turn the page when the newest line has fallen out of sight.
   *
   * Leaving the price box is the moment: it means "done with this one" and can never land
   * mid-stroke, which is what makes it safe to move the page at all.
   */
  const goToNewestLine = () => {
    const list = sheet.current;
    const last = shop.cart[shop.cart.length - 1];
    const row = last ? rows.current[last.itemId] : null;
    if (!list || !row) return;
    const y = pageFlip({
      rowTop: row.offsetTop,
      rowHeight: row.offsetHeight,
      offset: list.scrollTop,
      viewport: list.clientHeight,
    });
    if (y != null) list.scrollTo({ top: y, behavior: 'smooth' });
  };

  /*
   * Asked for on leaving the price box, done once the row it is about exists.
   *
   * Pricing the last line appends a fresh blank one, and that happens after the blur -- so
   * measuring straight away asks about the wrong row and finds it comfortably in view. The flag
   * is read after the render that added it.
   */
  const wantFlip = useRef(false);
  useEffect(() => {
    if (!wantFlip.current) return;
    wantFlip.current = false;
    goToNewestLine();
  });

  /**
   * Enter in an item box goes to the next item box -- never across to the price beside it.
   *
   * The shop writes the whole list first and prices it afterwards. On the last line there is no
   * next row yet: typing a name is what makes the blank one appear, and that lands after this,
   * so the wanted row is remembered and focused once it exists -- the same shape as wantFlip.
   */
  const wantName = useRef<string | null>(null);
  useEffect(() => {
    const wanted = wantName.current;
    if (wanted == null) return;
    // '' means "whichever line is newest", which is the one this typing brought into being.
    const target = wanted === '' ? shop.cart[shop.cart.length - 1]?.itemId : wanted;
    const field = target ? names.current[target] : null;
    if (!field) return;
    wantName.current = null;
    field.focus();
  });

  const goToNextName = (index: number) => {
    // Down to the next line there is something to type in: a hand-written line has no box, and
    // stopping at it left the cursor waiting for a field that would never appear.
    for (let i = index + 1; i < shop.cart.length; i += 1) {
      const field = names.current[shop.cart[i]!.itemId];
      if (field) {
        field.focus();
        return;
      }
    }
    wantName.current = '';
    wantFlip.current = true;
  };

  /**
   * Keep one empty line at the foot, always. The shopkeeper should never have to ask for
   * somewhere to write -- on paper the next line is simply there.
   */
  useEffect(() => {
    const last = shop.cart[shop.cart.length - 1];
    // A typed name makes the line non-blank too, so typing an item brings the next one up the
    // same way a first pen stroke always has.
    const lastIsBlank = last != null && !lineHasSomething(last);
    if (!lastIsBlank) shop.addBlankLine();
  }, [shop]);

  const paid = shop.paidInput;
  const showBalance = shop.printBalance;
  const paidCheck = parsePaid(paid, shop.cartTotal);
  const paidValid = paidCheck.ok;
  const paidAmount = paidCheck.ok ? paidCheck.value : shop.cartTotal;
  // Deliberately unchanged: customer.balance + cartTotal is already carried + today, so this is
  // (carried + today) - paid. Rewriting it in terms of grandTotal would count the old balance
  // twice.
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

  // Suggest printing the balance when there is one -- but stop suggesting once the shopkeeper has
  // made the choice themselves, otherwise editing a price would silently re-tick the box.
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
  /** Every started line is ticked, so the control offers to undo rather than redo. */
  const allGiven = written.length > 0 && written.every((l) => l.given === true);
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

  /**
   * Record the bill. Everything both buttons do before they part company. See the phone's copy.
   */
  const commitCurrentBill = async (): Promise<Bill | null> => {
    setError(null);
    if (!paidCheck.ok) {
      setError(paidCheck.error);
      return null;
    }
    const attached = await attachTypedCustomer();
    if (!attached.ok) return null;
    let bill: Bill;
    try {
      bill = await shop.commitBill({
        paid: paidAmount,
        showBalance,
        ...(attached.customer ? { customer: attached.customer } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
    const saved = bill;
    // Only this bill's lines: the map is keyed by line id and shared with the bills still
    // parked, so wiping it wholesale would blank their half-typed prices too.
    setPriceText((prev) => {
      const gone = new Set(saved.lines.map((l) => l.itemId));
      const left: Record<string, string> = {};
      for (const [id, text] of Object.entries(prev)) if (!gone.has(id)) left[id] = text;
      return left;
    });
    setJustSaved(bill);
    return bill;
  };

  /* Saving touches no printer, so it waits on nothing but itself. */
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await commitCurrentBill();
    } finally {
      setSaving(false);
    }
  };

  const onPrint = async () => {
    const bill = await commitCurrentBill();
    if (!bill) return;
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // One banner, not two -- the phone learned this in build 31 and the browser never did.
      setJustSaved(null);
      setError(t('bill.savedNotPrinted', { no: bill.no, reason }));
    }
  };

  return (
    <div className="bill-layout">
      {/* One tab per bill in progress. A second customer in a hurry no longer means making them
          wait or throwing the slip away -- park this one, serve them, come back. */}
      <div className="bill-tabs" role="tablist">
        {shop.drafts.map((d, i) => {
          const total = draftTotal(d);
          const label = d.customer
            ? customerName(d.customer, shop.lang) || d.customer.phone
            : d.typed.name.trim() || d.typed.nameKn.trim() || t('bill.billN', { n: i + 1 });
          const on = d.id === shop.activeDraftId;
          return (
            <span key={d.id} className={'bill-tab' + (on ? ' on' : '')}>
              <button type="button" role="tab" aria-selected={on} onClick={() => shop.switchBill(d.id)}>
                <span className="ellipsis">{label}</span>
                {total > 0 ? <span className="bill-tab-total">{money(total)}</span> : null}
              </button>
              {shop.drafts.length > 1 ? (
                <button
                  type="button"
                  className="bill-tab-close"
                  aria-label={t('bill.closeBill')}
                  onClick={() => {
                    if (isDraftEmpty(d) || window.confirm(t('bill.closeBillAsk'))) shop.closeBill(d.id);
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
        {shop.drafts.length < MAX_PARKED ? (
          <button type="button" className="bill-tab-new" onClick={shop.newBill}>
            {t('bill.newBill')}
          </button>
        ) : null}
      </div>

      {/* Pinned at the top, above the writing. Forty lines into a bill these fields used to be
          off-screen, so attaching somebody meant scrolling back and losing your place. */}
      <CustomerBar />

      <div className="slip-pane">
        {error ? <p className="error" role="alert">{error}</p> : null}

        {/* Offered here rather than only from History: the moment a customer asks for a copy is
            the moment they are still at the counter. */}
        {justSaved ? (
          <div className="saved-row">
            <span className="grow">{t('bill.savedBill', { no: justSaved.no })}</span>
            <button
              className="btn plain slim"
              disabled={printer.busy}
              onClick={() => {
                void printer.shareBill(justSaved, shop.settings).catch((e: unknown) => {
                  setError(t('hist.couldNotShare') + ': ' + (e instanceof Error ? e.message : String(e)));
                });
              }}
            >
              {printer.busy ? t('hist.sharing') : t('hist.share')}
            </button>
            <button
              className="saved-dismiss"
              onClick={() => setJustSaved(null)}
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
        ) : null}
        {shop.offline ? <p className="notice">{t('bill.offline')}</p> : null}

        <div className="slip">
          <div className="slip-head">
            <span className="slip-head-no">{t('bill.no')}</span>
            <span className="slip-head-desc">{t('bill.item')}</span>
            <span className="slip-head-price">{t('bill.price')}</span>
          </div>

          <ol className="slip-lines" ref={sheet} style={{ paddingBottom: tail }}>
            {shop.cart.map((line, index) => {
              const blank = !lineHasSomething(line);
              // Written by default, typed when asked for -- see the mobile copy.
              const isWriting = writing[line.itemId] ?? true;
              return (
                <li
                  className="slip-line"
                  key={line.itemId}
                  ref={(el) => { rows.current[line.itemId] = el; }}
                >
                  <span className="slip-no">{index + 1}</span>

                  {/* Handed over, as against merely listed. Before the description, where the
                      shop's own drawing put it. */}
                  <input
                    type="checkbox"
                    className="slip-given"
                    checked={line.given === true}
                    aria-label={t('bill.givenLine', { n: index + 1 })}
                    onChange={(e) => shop.setLineGiven(index, e.target.checked)}
                  />

                  <div className="slip-write">
                    {/* Typed by default, written when asked for: handwriting is one click away
                        and a line that already holds strokes opens as writing. */}
                    {isWriting ? (
                      <>
                        <InkPad
                          ref={(handle) => { pads.current[line.itemId] = handle; }}
                          variant="line"
                          height={96}
                          value={line.ink ?? null}
                          onChange={(ink) => shop.setLineInk(index, ink)}
                          label={t('bill.writeLine', { n: index + 1 })}
                          penNotice=""
                          undoLabel=""
                          clearLabel=""
                          hint=""
                          strokeCount={() => ''}
                        />
                        {!line.ink ? <span className="slip-ghost">{t('bill.writeHint')}</span> : null}
                      </>
                    ) : (
                      <input
                        ref={(el) => { names.current[line.itemId] = el; }}
                        className="slip-name"
                        value={line.nameKn}
                        placeholder={t('bill.typeHint')}
                        aria-label={t('bill.writeLine', { n: index + 1 })}
                        onChange={(e) => shop.setLineName(index, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          // Or the form around the slip takes it as "print this bill".
                          e.preventDefault();
                          goToNextName(index);
                        }}
                      />
                    )}
                  </div>

                  {/* Names the column in the stacked layout, where the price box has dropped
                      below the writing strip and the header above cannot point at it. */}
                  {/* Swaps this one line between the two. */}
                  <button
                    className="slip-undo"
                    aria-label={isWriting ? t('bill.typeLine', { n: index + 1 })
                      : t('bill.handwriteLine', { n: index + 1 })}
                    title={isWriting ? t('bill.typeLine', { n: index + 1 })
                      : t('bill.handwriteLine', { n: index + 1 })}
                    onClick={() => setWriting((w) => ({ ...w, [line.itemId]: !isWriting }))}
                  >
                    {isWriting ? '⌨' : '✎'}
                  </button>

                  <span className="slip-price-tag" aria-hidden="true">{t('bill.price')}</span>
                  <input
                    className="slip-price"
                    inputMode="decimal"
                    aria-label={t('bill.priceOfLine', { n: index + 1 })}
                    placeholder="—"
                    value={priceText[line.itemId] ?? (line.rate > 0 ? String(line.rate) : '')}
                    onChange={(e) => onPrice(index, line.itemId, e.target.value)}
                    onBlur={() => { wantFlip.current = true; }}
                  />
                  {/* Two kilos at 44 is typed as 44*2 and priced at 88. The counter PC has a
                      real keyboard, so the operators need no keys of their own here -- only the
                      answer, shown before it is committed so a wrong sum is caught on the screen
                      rather than on the paper. */}
                  {looksLikeSum(priceText[line.itemId] ?? '')
                    && evaluateAmount(priceText[line.itemId] ?? '') != null ? (
                    <span className="calc-result">
                      = {money(evaluateAmount(priceText[line.itemId] ?? '') as number)}
                    </span>
                  ) : null}

                  <button
                    className="slip-undo"
                    aria-label={t('bill.undoLine', { n: index + 1 })}
                    title={t('bill.undoLine', { n: index + 1 })}
                    disabled={!line.ink}
                    onClick={() => pads.current[line.itemId]?.undo()}
                  >
                    ⟲
                  </button>

                  <button
                    className="slip-remove"
                    aria-label={t('bill.clearLine', { n: index + 1 })}
                    disabled={blank}
                    onClick={() => shop.removeLine(index)}
                  >
                    &times;
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Under the last line, because it is about all of them. The same control undoes
              itself and says which way it will go. */}
          {written.length > 0 ? (
            <label className="select-all">
              <input
                type="checkbox"
                checked={allGiven}
                onChange={() => shop.setAllGiven(!allGiven)}
              />
              <span>{allGiven ? t('bill.selectNone') : t('bill.selectAll')}</span>
            </label>
          ) : null}
        </div>
      </div>

      <div className="cart">
        <div className="cart-head">
          <span className="cart-title">
            {t('bill.currentBill')}
            {written.length > 0 ? <span className="cart-count">{written.length}</span> : null}
          </span>
          {hasSomething ? (
            <button className="btn plain slim" onClick={shop.clearCart}>{t('bill.clear')}</button>
          ) : null}
        </div>

        {/* Without this line a TOTAL larger than the lines above has nothing explaining it. */}
        {carried > 0 ? (
          <div className="carried-row">
            <span className="muted small">
              {t('bill.oldBalance')}
              {shop.customerBalanceAt ? '  ' + dateStamp(shop.customerBalanceAt) : ''}
            </span>
            <strong>{money(carried)}</strong>
          </div>
        ) : null}

        <div className="total-row">
          <span className="label">{t('bill.total')}</span>
          {/* Keyed on the amount so React replaces the node whenever the number moves, which is
              what restarts the CSS pop. Cheaper than a counter animation and it never lands on a
              value that was not real. */}
          <span className="value" key={grandTotal}>{money(grandTotal)}</span>
        </div>

        {/* Part payment and the balance line, which the shop wants optional per bill. */}
        {shop.customer ? (
          <div className="pay-box">
            <div className="row">
              <label className="field grow" style={{ marginBottom: 0 }}>
                <span className="pay-label">{t('bill.paidNow')}</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={paid}
                  onChange={(e) => shop.setPaidInput(e.target.value)}
                  placeholder={t('bill.paidPlaceholder', { amount: money(shop.cartTotal) })}
                />
                {/* Cash is counted out in notes, so it can be typed as one: 100+50+20. */}
                {looksLikeSum(paid) && evaluateAmount(paid) != null ? (
                  <span className="calc-result">= {money(evaluateAmount(paid) as number)}</span>
                ) : null}
              </label>
              {/* The settling figure, one click away. Blank still means today's shopping only,
                  so clearing a debt has to be a thing the shopkeeper does on purpose. */}
              {grandTotal > 0 ? (
                <button
                  type="button"
                  className="pay-all"
                  onClick={() => shop.setPaidInput(String(grandTotal))}
                >
                  {t('bill.payAll', { amount: money(grandTotal) })}
                </button>
              ) : null}
              <span style={{ textAlign: 'right', minWidth: 96 }}>
                <span className="muted small" style={{ display: 'block' }}>{t('bill.balanceAfter')}</span>
                <strong style={{ fontSize: '1.1rem' }}>{paidValid ? money(balanceAfter) : '—'}</strong>
              </span>
            </div>
            <label className="row" style={{ marginTop: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showBalance}
                onChange={(e) => shop.setPrintBalance(e.target.checked)}
              />
              <span className="small">{t('bill.printBalance')}</span>
            </label>
          </div>
        ) : null}

        {/* The bill's own note. Not inside the pay box: a walk-in cash sale is exactly the one
            that needs "to be collected Friday" written on it. */}
        <label className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="pay-label">{t('bill.note')}</span>
          <input
            className="input"
            value={shop.note}
            maxLength={200}
            onChange={(e) => shop.setNote(e.target.value)}
            placeholder={t('bill.notePlaceholder')}
          />
        </label>

        <div className="cart-actions">
          <button className="btn plain" disabled={!hasSomething} onClick={() => setPreview(draft())}>
            {t('bill.preview')}
          </button>
          {/* The bill written down without going to paper. */}
          <button className="btn plain" disabled={!hasSomething || saving} onClick={onSave}>
            📂 {t('common.save')}
          </button>
          <button
            className={printer.busy ? 'btn busy' : 'btn'}
            disabled={!hasSomething || printer.busy}
            onClick={onPrint}
          >
            🖨️ {printer.busy ? t('bill.printing') : t('bill.print')}
          </button>
        </div>
      </div>

      {preview ? (
        <Dialog
          title={t('bill.receiptPreview')}
          onClose={() => setPreview(null)}
          footer={
            <button className="btn plain" style={{ gridColumn: '1 / -1' }} onClick={() => setPreview(null)}>
              {t('common.close')}
            </button>
          }
        >
          <ReceiptView doc={buildReceipt(preview, shop.settings, shop.receiptLabels)} />
          <p className="muted small center" style={{ marginBottom: 0 }}>
            {t('bill.provisional')}
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
