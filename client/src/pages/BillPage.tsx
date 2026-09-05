import { useEffect, useState } from 'react';
import {
  buildReceipt,
  checkCustomer,
  money,
  parsePaid,
  parsePrice,
  round2,
  type Bill,
  type Customer,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad } from '../components/InkPad';
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
  const [preview, setPreview] = useState<Bill | null>(null);
  /** Price text per line, so half-typed values like "12." survive keystrokes. */
  const [priceText, setPriceText] = useState<Record<string, string>>({});

  /**
   * Keep one empty line at the foot, always. The shopkeeper should never have to ask for
   * somewhere to write -- on paper the next line is simply there.
   */
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

  // Suggest printing the balance when there is one -- but stop suggesting once the shopkeeper has
  // made the choice themselves, otherwise editing a price would silently re-tick the box.
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
    <div className="bill-layout">
      <div className="slip-pane">
        {error ? <p className="error" role="alert">{error}</p> : null}
        {shop.offline ? <p className="notice">{t('bill.offline')}</p> : null}

        <CustomerBar />

        <div className="slip">
          <div className="slip-head">
            <span className="slip-head-desc">{t('bill.whatWasSold')}</span>
            <span className="slip-head-price">{t('bill.price')}</span>
          </div>

          <ol className="slip-lines">
            {shop.cart.map((line, index) => {
              const blank = !line.ink && line.rate === 0;
              return (
                <li className="slip-line" key={line.itemId}>
                  <span className="slip-no">{index + 1}</span>

                  <div className="slip-write">
                    <InkPad
                      variant="line"
                      height={62}
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
                  </div>

                  <input
                    className="slip-price"
                    inputMode="decimal"
                    aria-label={t('bill.priceOfLine', { n: index + 1 })}
                    placeholder="—"
                    value={priceText[line.itemId] ?? (line.rate > 0 ? String(line.rate) : '')}
                    onChange={(e) => onPrice(index, line.itemId, e.target.value)}
                  />

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

        <div className="total-row">
          <span className="label">{t('bill.total')}</span>
          {/* Keyed on the amount so React replaces the node whenever the number moves, which is
              what restarts the CSS pop. Cheaper than a counter animation and it never lands on a
              value that was not real. */}
          <span className="value" key={shop.cartTotal}>{money(shop.cartTotal)}</span>
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
              </label>
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

        <div className="cart-actions">
          <button className="btn plain" disabled={!hasSomething} onClick={() => setPreview(draft())}>
            {t('bill.preview')}
          </button>
          <button
            className={printer.busy ? 'btn busy' : 'btn'}
            disabled={!hasSomething || printer.busy}
            onClick={onPrint}
          >
            {printer.busy ? t('bill.printing') : t('bill.print')}
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
