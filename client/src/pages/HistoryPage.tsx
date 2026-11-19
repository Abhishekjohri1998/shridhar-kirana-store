import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { historyView, money, stamp, type Bill, type Payment, type Quotation } from '@shridhar/shared';
import { api } from '../lib/api';
import { BillDialog } from '../components/BillDialog';
import { QuotationDialog } from '../components/QuotationDialog';
import { useKeepFresh, useShop } from '../lib/useShop';
import { Empty } from '../components/Empty';
import { HistoryIcon } from '../components/Icons';

export function HistoryPage() {
  const shop = useShop();

  const [open, setOpen] = useState<Bill | null>(null);
  const navigate = useNavigate();
  /** Bills (and money received), or the quotations, which are never sales. */
  const [showing, setShowing] = useState<'bills' | 'quotations'>('bills');
  const [quotations, setQuotations] = useState<Quotation[] | null>(null);
  const [openQuote, setOpenQuote] = useState<Quotation | null>(null);
  const [quoteTick, setQuoteTick] = useState(0);
  useEffect(() => {
    if (showing !== 'quotations') return;
    let alive = true;
    api.listQuotations(100).then((q) => { if (alive) setQuotations(q); }).catch(() => { if (alive) setQuotations((x) => x ?? []); });
    return () => { alive = false; };
  }, [showing, quoteTick, shop.bills, shop.dataVersion]);
  useKeepFresh();
  // "No bills yet" only after a load that worked, never because one failed.
  const view = historyView(shop.loadState, shop.bills.length);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    setBusy(true);
    void shop.refresh().finally(() => setBusy(false));
  };

  const t = shop.t;
  // Money received with no bill, listed among the bills at the time it was received.
  const [payments, setPayments] = useState<Payment[]>([]);
  useEffect(() => {
    let alive = true;
    api.listPayments(100).then((p) => { if (alive) setPayments(p); }).catch(() => undefined);
    return () => { alive = false; };
  }, [shop.bills]);
  type Row = { at: string; bill?: Bill; pay?: Payment };
  const rows: Row[] = [
    ...shop.bills.map((bill) => ({ at: bill.at, bill })),
    ...payments.map((pay) => ({ at: pay.at, pay })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="page">

      {/* Not a reports module -- just the one number the shopkeeper counts the cash drawer against. */}
      <div className="summary">
        <div className="muted small" style={{ letterSpacing: '0.1em', fontWeight: 700 }}>{t('hist.today')}</div>
        <div className="value">{money(shop.today.total)}</div>
        <div className="muted small">
          {shop.today.count === 1 ? t('hist.oneBill') : t('hist.nBills', { n: shop.today.count })}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
        <div className="stock-chips" role="tablist" style={{ marginRight: 'auto' }}>
          <button type="button" role="tab" aria-selected={showing === 'bills'} className={'pay-all' + (showing === 'bills' ? ' on' : '')} onClick={() => setShowing('bills')}>
            {t('hist.bills')}
          </button>
          <button type="button" role="tab" aria-selected={showing === 'quotations'} className={'pay-all' + (showing === 'quotations' ? ' on' : '')} onClick={() => setShowing('quotations')}>
            📝 {t('hist.quotations')}
          </button>
        </div>
        <button className="btn plain" onClick={() => { refresh(); setQuoteTick((n) => n + 1); }} disabled={busy} title={t('hist.refresh')} aria-label={t('hist.refresh')}>
          ↻ {t('hist.refresh')}
        </button>
      </div>

      {view.banner === 'failed' ? (
        <div className="error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1 }}>{t('hist.loadFailed')}</span>
          <button className="btn plain" onClick={refresh} disabled={busy}>{t('hist.retry')}</button>
        </div>
      ) : null}

      {showing === 'quotations' ? (
        quotations == null ? (
          <p className="muted small">{t('hist.loadingBills')}</p>
        ) : quotations.length === 0 ? (
          <Empty icon={<HistoryIcon />}>{t('hist.noQuotations')}</Empty>
        ) : (
          <div className="list">
            {quotations.map((q) => (
              <button key={q.no} className="list-row" onClick={() => setOpenQuote(q)}>
                <span className="grow">
                  <span style={{ display: 'block', fontWeight: 700 }}>
                    {t('hist.quoteNo', { no: q.no })}{q.customer?.name ? ' · ' + q.customer.name : ''}
                  </span>
                  <span className="muted small">
                    {stamp(q.at)} ·{' '}
                    {q.lines.length === 1 ? t('hist.oneItem') : t('hist.nItems', { n: q.lines.length })}
                    {' · '}
                    {q.status === 'billed' ? t('hist.quoteBilled', { no: q.billNo ?? '?' }) : q.status === 'cancelled' ? t('hist.cancelled') : t('hist.quoteOpen')}
                  </span>
                </span>
                <span style={{ fontWeight: 700 }}>{q.status === 'cancelled' ? '—' : money(q.total)}</span>
              </button>
            ))}
          </div>
        )
      ) : view.body === 'empty' ? (
        <Empty icon={<HistoryIcon />}>{t('hist.noBills')}</Empty>
      ) : view.body === 'loading' ? (
        <p className="muted small">{t('hist.loadingBills')}</p>
      ) : view.body === 'none' ? null : (
        <div className="list">
          {rows.map(({ bill, pay }) => pay ? (
            <div key={pay.id} className="list-row">
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 700 }}>{t('pay.row')}</span>
                <span className="muted small">
                  {stamp(pay.at)}{pay.note ? ' · ' + pay.note : ''}{pay.cancelled ? ' · ' + t('pay.cancelled') : ''}
                </span>
              </span>
              <span style={{ fontWeight: 700 }}>{pay.cancelled ? '—' : money(pay.amount)}</span>
            </div>
          ) : bill ? (
            <button key={bill.no} className="list-row" onClick={() => setOpen(bill)}>
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 700 }}>{t('hist.billNo', { no: bill.no })}</span>
                <span className="muted small">
                  {stamp(bill.at)} ·{' '}
                  {bill.lines.length === 1 ? t('hist.oneItem') : t('hist.nItems', { n: bill.lines.length })}
                  {bill.cancelled ? ' · ' + t('hist.cancelled') : ''}
                </span>
              </span>
              {/* A cancelled bill shows no amount: it is not money the shop took. */}
              <span style={{ fontWeight: 700 }}>{bill.cancelled ? '—' : money(bill.total)}</span>
            </button>
          ) : null)}
        </div>
      )}

      {open ? <BillDialog bill={open} onClose={() => setOpen(null)} /> : null}
      {openQuote ? (
        <QuotationDialog
          quotation={openQuote}
          onClose={() => setOpenQuote(null)}
          onChanged={() => setQuoteTick((n) => n + 1)}
          onMakeBill={() => navigate('/bill')}
        />
      ) : null}
    </div>
  );
}
