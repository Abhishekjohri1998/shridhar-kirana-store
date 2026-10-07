import { useEffect, useRef, useState } from 'react';
import {
  lineHasSomething, nextTypingLine,
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
  lineAmount,
  lineName,
  slipTailPadding,
  carriedBalance,
  dateStamp,
  type Bill,
  type Customer, inkStripAspect, INK_MARK_W, INK_ROW_HEIGHT, paperProfile, lineHasInk,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad, type InkPadHandle } from '../components/InkPad';
import { ReceiptView } from '../components/ReceiptView';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import { useStockSuggest } from '../lib/useStockSuggest';

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
/** The writing strip's height. Shorter than the old 80 at the shop's asking; its shape still
 *  follows the paper, so the printed size is unchanged. */
const STRIP_H = 56;
/** Longer than the paper's shape, for more room to write; the tablet uses the same. */
const STRIP_LONG = 1.3;

/**
 * A strip down the side of the bill for scrolling it with the pen or a finger: every line is a
 * writing strip, so dragging on one writes. Moves the list as far as the pen moves.
 */
function ScrollPad({ target }: { target: React.RefObject<HTMLOListElement | null> }) {
  const start = useRef<{ y: number; top: number } | null>(null);
  return (
    <div
      className="scroll-pad"
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuenow={0}
      aria-label="Scroll the bill"
      onPointerDown={(e) => {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ }
        start.current = { y: e.clientY, top: target.current?.scrollTop ?? 0 };
      }}
      onPointerMove={(e) => {
        if (!start.current || !target.current) return;
        target.current.scrollTop = start.current.top - (e.clientY - start.current.y);
      }}
      onPointerUp={() => { start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
    >
      <span /><span /><span /><span /><span />
    </div>
  );
}

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
  /** The same for the quantity of a line picked from stock, the only lines that show one. */
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  /** Stock's suggestions and re-quoting, which hide themselves when the link is off. */
  const stock = useStockSuggest();
  /** The line whose unit menu is open, if any; a click elsewhere or Escape shuts it. */
  const [unitMenu, setUnitMenu] = useState<string | null>(null);
  const unitMenuRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!unitMenu) return;
    const away = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (unitMenuRef.current?.contains(el) || el?.closest?.('.stock-unit')) return;
      setUnitMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setUnitMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [unitMenu]);
  /** A pick or a unit change sets the line's own price and quantity, so half-typed text goes. */
  const clearTyped = (key: string) => {
    setPriceText((prev) => { const { [key]: _d, ...rest } = prev; return rest; });
    setQtyText((prev) => { const { [key]: _d, ...rest } = prev; return rest; });
  };
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
  /** The line whose pen is rubbing out rather than writing, if any. */
  const [erasing, setErasing] = useState<string | null>(null);

  /*
   * Rubbing out the last stroke of a line puts the pen back to writing. The eraser was left on
   * with its button greyed out -- nothing left to erase -- so the line could not be written on
   * again until the bill was cleared.
   */
  useEffect(() => {
    if (!erasing) return;
    const line = shop.cart.find((l) => l.itemId === erasing);
    if (!line || !lineHasInk(line)) setErasing(null);
  }, [erasing, shop.cart]);
  /** The strip has the printed item column's shape. See inkStripAspect. */
  const stripAspect = inkStripAspect(paperProfile(shop.settings.paper).dots, INK_MARK_W, INK_ROW_HEIGHT);

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
    // The next line with nothing written on it, turned to typing -- written lines are stepped
    // over. Focused once it has re-rendered as a text box.
    const at = nextTypingLine(shop.cart, index);
    const next = at >= 0 ? shop.cart[at] : undefined;
    if (next) {
      const field = names.current[next.itemId];
      if (field) {
        field.focus();
        return;
      }
      setWriting((w) => ({ ...w, [next.itemId]: false }));
      wantName.current = next.itemId;
      return;
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
    const line = shop.cart[index];
    if (line) stock.onRateTyped(line);
    if (text.trim() === '') {
      shop.setLineRate(index, 0);
      return;
    }
    // The box holds the line total (qty x rate); typing one sets the rate from it.
    const parsed = parsePrice(text);
    if (parsed.ok) shop.setLineTotal(index, parsed.value);
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
            {/* Select all, in the tick column's header: no row of its own under the list. */}
            {written.length > 0 ? (
              <input
                type="checkbox"
                className="slip-head-given"
                checked={allGiven}
                aria-label={allGiven ? t('bill.selectNone') : t('bill.selectAll')}
                title={allGiven ? t('bill.selectNone') : t('bill.selectAll')}
                onChange={() => shop.setAllGiven(!allGiven)}
              />
            ) : null}
            <span className="slip-head-desc">{t('bill.item')}</span>
            <span className="slip-head-price">{t('bill.price')}</span>
          </div>

          <div className="slip-body">
          <ScrollPad target={sheet} />
          <ol className="slip-lines" ref={sheet} style={{ paddingBottom: tail }}>
            {shop.cart.map((line, index) => {
              const blank = !lineHasSomething(line);
              // Written by default, typed when asked for -- see the mobile copy.
              const isWriting = writing[line.itemId] ?? line.lastMode !== 'text';
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

                  <div className="slip-write" style={{ maxWidth: STRIP_H * stripAspect * STRIP_LONG }}>
                    {/* Typed by default, written when asked for: handwriting is one click away
                        and a line that already holds strokes opens as writing. */}
                    {isWriting ? (
                      <>
                        <InkPad
                          ref={(handle) => { pads.current[line.itemId] = handle; }}
                          variant="line"
                          height={STRIP_H * (line.inkRows === 2 ? 2 : 1)}
                          value={line.ink ?? null}
                          onChange={(ink) => shop.setLineInk(index, ink)}
                          erasing={erasing === line.itemId}
                          label={t('bill.writeLine', { n: index + 1 })}
                          penNotice=""
                          undoLabel=""
                          clearLabel=""
                          hint=""
                          strokeCount={() => ''}
                        />
                        {/* A long item carried on to the next line, the same height as the first. */}
                        {(line.moreInk ?? []).map((extra, s) => (
                          <div key={s} className="slip-more">
                            <InkPad
                              variant="line"
                              height={STRIP_H}
                              value={extra.strokes.length ? extra : null}
                              onChange={(ink) => shop.setLineMoreInk(index, s, ink)}
                              erasing={erasing === line.itemId}
                              label={t('bill.writeLine', { n: index + 1 })}
                              penNotice=""
                              undoLabel=""
                              clearLabel=""
                              hint=""
                              strokeCount={() => ''}
                            />
                            <button
                              className="slip-remove"
                              aria-label={t('bill.removeStrip', { n: index + 1 })}
                              title={t('bill.removeStrip', { n: index + 1 })}
                              onClick={() => shop.removeLineStrip(index, s)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </>
                    ) : (
                      <>
                      <div className="stock-row">
                      <input
                        ref={(el) => { names.current[line.itemId] = el; }}
                        className="slip-name"
                        // Picked from stock: the name in the app's language. Typing over it lets go
                        // of the pick (setLineName); a typed line shows just what was typed.
                        value={line.stockItemId ? lineName(line, shop.lang) : line.nameKn}
                        placeholder={t('bill.typeHint')}
                        aria-label={t('bill.writeLine', { n: index + 1 })}
                        onChange={(e) => {
                          shop.setLineName(index, e.target.value);
                          stock.onNameTyped(line.itemId, e.target.value);
                        }}
                        // A beat late, so a click on a unit below lands before the list goes.
                        onBlur={() => { window.setTimeout(stock.close, 300); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') stock.close();
                          if (e.key !== 'Enter') return;
                          // Or the form around the slip takes it as "print this bill".
                          e.preventDefault();
                          stock.close();
                          goToNextName(index);
                        }}
                      />
                      {/* A line picked from stock counts in its unit, so its quantity shows --
                          changing it asks stock for the rate again, slabs and all. */}
                      {stock.on && line.unit ? (
                        <>
                          <input
                            className="slip-price stock-qty"
                            inputMode="decimal"
                            aria-label={t('stock.qtyOf', { n: index + 1 })}
                            value={qtyText[line.itemId] ?? String(line.qty)}
                            onChange={(e) => {
                              const text = e.target.value;
                              setQtyText((prev) => ({ ...prev, [line.itemId]: text }));
                              const qty = Number(text.replace(',', '.'));
                              if (text.trim() !== '' && Number.isFinite(qty)) stock.onQty(index, line, qty);
                            }}
                            onBlur={() => setQtyText((prev) => {
                              const { [line.itemId]: _d, ...rest } = prev;
                              return rest;
                            })}
                          />
                          <span className="stock-unit-wrap">
                            <button
                              type="button"
                              className="stock-unit"
                              aria-label={t('stock.unitOf', { n: index + 1 })}
                              aria-expanded={unitMenu === line.itemId}
                              onClick={() => {
                                if (unitMenu === line.itemId) { setUnitMenu(null); return; }
                                stock.loadUnits(line);
                                setUnitMenu(line.itemId);
                              }}
                            >
                              {line.unit} ▾
                            </button>
                            {unitMenu === line.itemId && stock.unitsFor(line).length > 0 ? (
                              <ul className="stock-list stock-unit-menu" ref={unitMenuRef}>
                                {stock.unitsFor(line).map((u) => {
                                  const label = (shop.lang === 'kn' && u.labelKn) || u.label || u.code;
                                  return (
                                    <li key={u.code}>
                                      <button
                                        type="button"
                                        className="stock-unit-opt"
                                        aria-current={u.code === line.unit}
                                        onClick={() => {
                                          clearTyped(line.itemId);
                                          stock.changeUnit(index, line, u);
                                          setUnitMenu(null);
                                        }}
                                      >
                                        {label + ' ₹' + money(u.price)}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                          </span>
                        </>
                      ) : null}
                      </div>
                      {stock.openFor === line.itemId ? (
                        <ul className="stock-list" aria-label={t('stock.matches')}>
                          {stock.items.map((item) => (
                            <li key={item.id} className="stock-item">
                              {/* The item itself: a tap puts it on in stock's selling unit. */}
                              <button
                                type="button"
                                className="stock-name"
                                aria-label={t('stock.pickItem', { name: lineName(item, shop.lang) })}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  clearTyped(line.itemId);
                                  stock.pickItem(index, line, item);
                                }}
                              >
                                {item.nameKn && item.nameEn && item.nameKn !== item.nameEn
                                  ? lineName(item, shop.lang) + ' · ' + lineName(item, shop.lang === 'kn' ? 'en' : 'kn')
                                  : item.nameKn || item.nameEn}
                              </button>
                              <span className="stock-chips">
                                {item.units.map((u) => {
                                  const label = (shop.lang === 'kn' && u.labelKn) || u.label || u.code;
                                  return (
                                    <button
                                      key={u.code}
                                      type="button"
                                      className="pay-all stock-chip"
                                      aria-label={t('stock.pick', {
                                        name: lineName(item, shop.lang), unit: label, price: money(u.price),
                                      })}
                                      // Before the name box loses focus, so the list is still there.
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => {
                                        clearTyped(line.itemId);
                                        stock.pick(index, line, item, u);
                                      }}
                                    >
                                      {label + ' ₹' + money(u.price)}
                                    </button>
                                  );
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {stock.warnFor(line) ? (
                        <span className="stock-warn">
                          {stock.warnFor(line) === 'below' ? t('stock.warnBelow') : t('stock.warnAbove')}
                        </span>
                      ) : null}
                      </>
                    )}
                  </div>

                  {/* Names the column in the stacked layout, where the price box has dropped
                      below the writing strip and the header above cannot point at it. */}
                  {/* The eraser, right beside the writing it rubs out. */}
                  <button
                    className={'slip-erase' + (erasing === line.itemId ? ' on' : '')}
                    aria-label={t('bill.eraseLine', { n: index + 1 })}
                    aria-pressed={erasing === line.itemId}
                    title={t('bill.eraseLine', { n: index + 1 })}
                    disabled={!isWriting || (!lineHasInk(line) && erasing !== line.itemId)}
                    onClick={() => setErasing((e) => (e === line.itemId ? null : line.itemId))}
                  >
                    🧽
                  </button>
                  {/* A new line to write on for this same item, under the one there. Up to two. */}
                  <button
                    className="slip-rows"
                    disabled={!isWriting || (line.moreInk ?? []).length >= 2}
                    aria-label={t('bill.addStrip', { n: index + 1 })}
                    title={t('bill.addStrip', { n: index + 1 })}
                    onClick={() => shop.addLineStrip(index)}
                  >
                    ↵
                  </button>

                  <span className="slip-price-tag" aria-hidden="true">{t('bill.price')}</span>
                  <div className="slip-price-cell">
                  <input
                    className="slip-price"
                    inputMode="decimal"
                    aria-label={t('bill.priceOfLine', { n: index + 1 })}
                    placeholder={t('bill.price')}
                    value={priceText[line.itemId] ?? (line.rate > 0 ? money(lineAmount(line.qty, line.rate)) : '')}
                    onChange={(e) => onPrice(index, line.itemId, e.target.value)}
                    onBlur={() => {
                      wantFlip.current = true;
                      // Show the total worked out from the rate again once the box is left.
                      setPriceText((prev) => { const { [line.itemId]: _d, ...rest } = prev; return rest; });
                    }}
                  />
                  {/* The box is the line total; the rate it comes from sits small underneath. */}
                  {line.rate > 0 && line.qty !== 1 ? (
                    <span className="line-amount">{t('bill.each', { rate: money(line.rate) })}</span>
                  ) : null}
                  </div>
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

                  {/* Swaps this one line between writing and typing. */}
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
          <ScrollPad target={sheet} />
          </div>
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
