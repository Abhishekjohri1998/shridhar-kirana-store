import { useState } from 'react';
import { buildReceipt, money, stamp, type Bill } from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { ReceiptView } from '../components/ReceiptView';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

export function HistoryPage() {
  const shop = useShop();
  const printer = usePrint();
  const [open, setOpen] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reprint = async (bill: Bill) => {
    setError(null);
    try {
      await printer.printBill(bill, shop.settings);
      setOpen(null);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      setError(shop.t('hist.couldNotPrint') + ': ' + reason);
    }
  };

  const t = shop.t;

  return (
    <div className="page">
      {error ? <p className="error" role="alert">{error}</p> : null}

      {/* Not a reports module -- just the one number the shopkeeper counts the cash drawer against. */}
      <div className="summary">
        <div className="muted small" style={{ letterSpacing: '0.1em', fontWeight: 700 }}>{t('hist.today')}</div>
        <div className="value">{money(shop.today.total)}</div>
        <div className="muted small">
          {shop.today.count === 1 ? t('hist.oneBill') : t('hist.nBills', { n: shop.today.count })}
        </div>
      </div>

      {shop.bills.length === 0 ? (
        <p className="muted center small">{t('hist.noBills')}</p>
      ) : (
        <div className="list">
          {shop.bills.map((bill) => (
            <button key={bill.no} className="list-row" onClick={() => setOpen(bill)}>
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 700 }}>{t('hist.billNo', { no: bill.no })}</span>
                <span className="muted small">
                  {stamp(bill.at)} ·{' '}
                  {bill.lines.length === 1 ? t('hist.oneItem') : t('hist.nItems', { n: bill.lines.length })}
                </span>
              </span>
              <span style={{ fontWeight: 700 }}>{money(bill.total)}</span>
            </button>
          ))}
        </div>
      )}

      {open ? (
        <Dialog
          title={t('hist.billNo', { no: open.no })}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setOpen(null)}>{t('common.close')}</button>
              <button className="btn" disabled={printer.busy} onClick={() => void reprint(open)}>
                {printer.busy ? t('hist.printing') : t('hist.printAgain')}
              </button>
            </>
          }
        >
          <ReceiptView doc={buildReceipt(open, shop.settings, shop.receiptLabels)} inkAlt={t('ink.alt')} />
        </Dialog>
      ) : null}
    </div>
  );
}
