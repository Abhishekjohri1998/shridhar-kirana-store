import { useEffect, useState } from 'react';
import { money, stamp, type Bill, type Payment } from '@shridhar/shared';
import { api } from '../lib/api';
import { BillDialog } from '../components/BillDialog';
import { useShop } from '../lib/useShop';
import { Empty } from '../components/Empty';
import { HistoryIcon } from '../components/Icons';

export function HistoryPage() {
  const shop = useShop();

  const [open, setOpen] = useState<Bill | null>(null);

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

      {shop.bills.length === 0 ? (
        <Empty icon={<HistoryIcon />}>{t('hist.noBills')}</Empty>
      ) : (
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
    </div>
  );
}
