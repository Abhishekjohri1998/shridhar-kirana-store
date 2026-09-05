import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReceipt,
  lineAmount,
  money,
  parsePaid,
  parsePrice,
  parseQty,
  round2,
  type Bill,
  type Ink,
  type Item,
} from '@shridhar/shared';
import { CustomerBar } from '../components/CustomerBar';
import { Dialog } from '../components/Dialog';
import { InkPad } from '../components/InkPad';
import { InkThumb } from '../components/InkThumb';
import { KannadaInput } from '../components/KannadaInput';
import { ReceiptView } from '../components/ReceiptView';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import { Empty } from '../components/Empty';
import { ItemsIcon } from '../components/Icons';

type LooseDraft = { name: string; ink: Ink | null; rate: string; qty: string };

const BLANK_LOOSE: LooseDraft = { name: '', ink: null, rate: '', qty: '1' };

export function BillPage() {
  const shop = useShop();
  const printer = usePrint();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [qtyFor, setQtyFor] = useState<{ index: number; value: string } | null>(null);
  const [loose, setLoose] = useState<LooseDraft | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shop.items;
    return shop.items.filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()));
  }, [query, shop.items]);

  const paid = shop.paidInput;
  const showBalance = shop.printBalance;
  const paidCheck = parsePaid(paid, shop.cartTotal);
  const paidValid = paidCheck.ok;
  const paidAmount = paidCheck.ok ? paidCheck.value : shop.cartTotal;
  const balanceAfter = shop.customer
    ? round2(shop.customer.balance + shop.cartTotal - paidAmount)
    : 0;

  // Suggest printing the balance when there is one -- but stop suggesting once the shopkeeper has
  // made the choice themselves, otherwise changing a quantity would silently re-tick the box.
  useEffect(() => {
    if (shop.printBalanceTouched) return;
    shop.setPrintBalance(shop.customer != null && balanceAfter !== 0, false);
  }, [shop, balanceAfter]);

  const add = (item: Item) => {
    shop.addItemToCart(item, 1);
    setQuery('');
    searchRef.current?.focus();
  };

  /** Enter bills the top match, so a counter with a keyboard never needs the mouse. */
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const first = results[0];
    if (first) add(first);
  };

  const draft = (): Bill => ({
    no: (shop.bills[0]?.no ?? 0) + 1,
    at: new Date().toISOString(),
    ...(shop.customer
      ? { customer: { id: shop.customer.id, name: shop.customer.name, phone: shop.customer.phone } }
      : {}),
    lines: shop.cart,
    total: shop.cartTotal,
    paid: paidValid ? paidAmount : shop.cartTotal,
    balance: balanceAfter,
    showBalance: showBalance && shop.customer != null,
  });

  const onPrint = async () => {
    setError(null);
    if (!paidCheck.ok) {
      setError(paidCheck.error);
      return;
    }
    let bill: Bill;
    try {
      bill = await shop.commitBill({ paid: paidAmount, showBalance });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(shop.t('bill.savedNotPrinted', { no: bill.no, reason }));
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
    // Name and handwriting are both optional: the shop does ring up bare prices.
    shop.addLooseLine({ name: loose.name, ink: loose.ink, rate: price.value, qty: qty.value });
    setLoose(null);
    setQuery('');
  };

  return (
    <div className="bill-layout">
      <div className="picker">
        {shop.offline ? (
          <p className="error" style={{ marginTop: 0 }}>
            {shop.t('bill.offline')}
          </p>
        ) : null}
        {error ? (
          <p className="error" style={{ marginTop: 0 }} role="alert">
            {error}
          </p>
        ) : null}

        <CustomerBar />

        <div className="search-row">
          <input
            ref={searchRef}
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={shop.t('bill.searchPlaceholder')}
            aria-label={shop.t('bill.searchAria')}
            autoComplete="off"
          />
          <button
            className="btn"
            style={{ flex: '0 0 auto', paddingInline: 14 }}
            onClick={() => setLoose({ ...BLANK_LOOSE, name: query })}
          >
            {shop.t('bill.writePrice')}
          </button>
        </div>

        {results.length === 0 ? (
          <Empty icon={<ItemsIcon />}>{shop.t('bill.noMatch')}</Empty>
        ) : (
          <div className="items-grid">
            {results.map((item) => (
              <button key={item.id} className="item-btn" onClick={() => add(item)}>
                <span className="grow">
                  <span className="kn" style={{ display: 'block' }}>{item.nameKn}</span>
                  <span className="en">{item.nameEn}</span>
                </span>
                <span className="rate">
                  {money(item.rate)}
                  <span className="unit"> /{item.unit}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="cart">
        <div className="cart-head">
          <span className="cart-title">
            {shop.t('bill.currentBill')}
            {shop.cart.length > 0 ? <span className="cart-count">{shop.cart.length}</span> : null}
          </span>
          {shop.cart.length > 0 ? (
            <button className="btn plain slim" onClick={shop.clearCart}>{shop.t('bill.clear')}</button>
          ) : null}
        </div>

        <div className="cart-lines">
          {shop.cart.length === 0 ? (
            <p className="cart-empty">{shop.t('bill.emptyCart')}</p>
          ) : (
            shop.cart.map((line, index) => (
              <div className="cart-line" key={line.itemId + '-' + index}>
                <button
                  className="qty-btn"
                  onClick={() => setQtyFor({ index, value: String(line.qty) })}
                  aria-label={shop.t('bill.changeQty', { n: index + 1 })}
                >
                  {line.qty}
                </button>
                <span className="grow">
                  {line.ink ? (
                    <span style={{ display: 'block' }}><InkThumb ink={line.ink} alt={shop.t('ink.alt')} /></span>
                  ) : line.nameKn ? (
                    <span style={{ display: 'block' }}>{line.nameKn}</span>
                  ) : (
                    <span style={{ display: 'block' }} className="muted">{shop.t('bill.priceOnly')}</span>
                  )}
                  <span className="muted small">@ {money(line.rate)}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button className="step" onClick={() => shop.setLineQty(index, line.qty - 1)} aria-label={shop.t('bill.oneLess')}>
                    &minus;
                  </button>
                  <button className="step" onClick={() => shop.setLineQty(index, line.qty + 1)} aria-label={shop.t('bill.oneMore')}>
                    +
                  </button>
                </span>
                <span className="cart-amount">{money(lineAmount(line.qty, line.rate))}</span>
              </div>
            ))
          )}
        </div>

        <div className="total-row">
          <span className="label">{shop.t('bill.total')}</span>
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
                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--soft)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {shop.t('bill.paidNow')}
                </span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={paid}
                  onChange={(e) => shop.setPaidInput(e.target.value)}
                  placeholder={shop.t('bill.paidPlaceholder', { amount: money(shop.cartTotal) })}
                />
              </label>
              <span style={{ textAlign: 'right', minWidth: 96 }}>
                <span className="muted small" style={{ display: 'block' }}>{shop.t('bill.balanceAfter')}</span>
                <strong style={{ fontSize: '1.1rem' }}>{paidValid ? money(balanceAfter) : '—'}</strong>
              </span>
            </div>
            <label className="row" style={{ marginTop: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showBalance}
                onChange={(e) => shop.setPrintBalance(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span className="small">{shop.t('bill.printBalance')}</span>
            </label>
          </div>
        ) : null}

        <div className="cart-actions">
          <button className="btn plain" disabled={shop.cart.length === 0} onClick={() => setPreview(draft())}>
            {shop.t('bill.preview')}
          </button>
          <button
            className={printer.busy ? 'btn busy' : 'btn'}
            disabled={shop.cart.length === 0 || printer.busy}
            onClick={onPrint}
          >
            {printer.busy ? shop.t('bill.printing') : shop.t('bill.print')}
          </button>
        </div>
      </div>

      {qtyFor ? (
        <Dialog
          title={shop.t('bill.qtyTitle')}
          onClose={() => setQtyFor(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setQtyFor(null)}>{shop.t('common.cancel')}</button>
              <button className="btn" onClick={commitQty}>{shop.t('common.set')}</button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="qty">{shop.t('bill.qtyTitle')}</label>
            <input
              id="qty"
              className="input"
              inputMode="decimal"
              autoFocus
              value={qtyFor.value}
              onChange={(e) => setQtyFor({ ...qtyFor, value: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && commitQty()}
            />
          </div>
          <p className="muted small">{shop.t('bill.qtyHint')}</p>
        </Dialog>
      ) : null}

      {loose ? (
        <Dialog
          title={shop.t('bill.addLine')}
          onClose={() => setLoose(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setLoose(null)}>{shop.t('common.cancel')}</button>
              <button className="btn" onClick={commitLoose}>{shop.t('bill.addToBill')}</button>
            </>
          }
        >
          <div className="stack">
            <InkPad
              onChange={(ink) => setLoose((s) => (s ? { ...s, ink } : s))}
              label={shop.t('ink.label')}
              penNotice={shop.t('ink.penDetected')}
              undoLabel={shop.t('ink.undo')}
              clearLabel={shop.t('ink.clear')}
              hint={shop.t('ink.hint')}
              strokeCount={(n) => shop.t('ink.strokes', { n })}
            />
            <KannadaInput
              id="l-name"
              label={shop.t('bill.orType')}
              value={loose.name}
              onChange={(name) => setLoose((s) => (s ? { ...s, name } : s))}
              placeholder={shop.t('bill.leaveBlank')}
            />
            <div className="row">
              <div className="field grow">
                <label htmlFor="l-rate">{shop.t('bill.price')}</label>
                <input
                  id="l-rate"
                  className="input"
                  inputMode="decimal"
                  autoFocus
                  value={loose.rate}
                  onChange={(e) => setLoose({ ...loose, rate: e.target.value })}
                />
              </div>
              <div className="field grow">
                <label htmlFor="l-qty">{shop.t('bill.qtyShort')}</label>
                <input
                  id="l-qty"
                  className="input"
                  inputMode="decimal"
                  value={loose.qty}
                  onChange={(e) => setLoose({ ...loose, qty: e.target.value })}
                />
              </div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {shop.t('bill.looseHint')}
            </p>
          </div>
        </Dialog>
      ) : null}

      {preview ? (
        <Dialog
          title={shop.t('bill.receiptPreview')}
          onClose={() => setPreview(null)}
          footer={<button className="btn plain" style={{ gridColumn: '1 / -1' }} onClick={() => setPreview(null)}>{shop.t('common.close')}</button>}
        >
          <ReceiptView doc={buildReceipt(preview, shop.settings, shop.receiptLabels)} inkAlt={shop.t('ink.alt')} />
          <p className="muted small center" style={{ marginBottom: 0 }}>
            {shop.t('bill.provisional')}
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
