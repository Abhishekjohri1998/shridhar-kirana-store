import { useEffect, useState } from 'react';
import { buildReceipt, historyViewSettings, quotationAsBill, type Quotation } from '@shridhar/shared';
import { Dialog } from './Dialog';
import { ReceiptView } from './ReceiptView';
import { api } from '../lib/api';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

/**
 * One quotation, as it prints -- with Make bill, print, share, cancel and delete.
 *
 * Like BillDialog the footer becomes the question when something cannot be undone, rather than a
 * second dialog on top. Nothing here moves money: a quotation never did.
 */
export function QuotationDialog({
  quotation: listed, onClose, onChanged, onMakeBill,
}: {
  quotation: Quotation;
  onClose: () => void;
  /** The list behind should read again: one was cancelled or deleted. */
  onChanged?: () => void;
  /** "Make bill" opened a bill tab from it; the page goes to the Bill screen. */
  onMakeBill?: () => void;
}) {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  // The list leaves the handwriting out; the slip needs it.
  const [full, setFull] = useState<Quotation | null>(null);
  useEffect(() => {
    setFull(null);
    if (!listed.hasInk) return;
    let alive = true;
    void api.getQuotation(listed.no)
      .then((q) => { if (alive) setFull(q); })
      .catch((e) => { if (alive) setError(t('hist.couldNotLoad') + ': ' + (e instanceof Error ? e.message : String(e))); });
    return () => { alive = false; };
  }, [listed]);
  const q: Quotation = (listed.hasInk ? full : null) ?? listed;
  const loading = listed.hasInk === true && full == null;
  const bill = quotationAsBill(q);

  const fail = (key: Parameters<typeof t>[0]) => (e: unknown) =>
    setError(t(key) + ': ' + (e instanceof Error ? e.message : String(e)));

  const print = async () => {
    setError(null);
    try {
      await printer.printBill(bill, shop.settings);
    } catch (e) {
      fail('hist.couldNotPrint')(e);
    }
  };
  const share = async () => {
    setError(null);
    try {
      await printer.shareBill(bill, shop.settings);
    } catch (e) {
      fail('hist.couldNotShare')(e);
    }
  };
  const makeBill = async () => {
    setError(null);
    setBusy(true);
    try {
      if (await shop.billFromQuotation(q)) {
        onClose();
        onMakeBill?.();
      } else {
        setError(t('hist.tooManyTabs'));
      }
    } catch (e) {
      fail('hist.couldNotLoad')(e);
    } finally {
      setBusy(false);
    }
  };
  const act = async () => {
    setError(null);
    setBusy(true);
    try {
      if (asking === 'delete') await api.deleteQuotation(q.no);
      else await api.cancelQuotation(q.no);
      onChanged?.();
      onClose();
    } catch (e) {
      fail(asking === 'delete' ? 'hist.couldNotDelete' : 'hist.couldNotCancel')(e);
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  const open = q.status === 'open';
  const footer = asking ? (
    <>
      <button className="btn plain" disabled={busy} onClick={() => setAsking(null)}>{t('hist.keepBill')}</button>
      <button className="btn danger" disabled={busy} onClick={() => void act()}>
        {asking === 'delete' ? (busy ? t('hist.deleting') : t('hist.deleteYes')) : (busy ? t('hist.cancelling') : t('hist.cancelYes'))}
      </button>
    </>
  ) : (
    <>
      {open ? <button className="btn plain grow" onClick={() => setAsking('cancel')}>{t('hist.cancelQuote')}</button> : null}
      <button className="btn danger" onClick={() => setAsking('delete')}>{t('hist.deleteBill')}</button>
      <button className="btn plain" onClick={onClose}>{t('common.close')}</button>
      <button className="btn plain" disabled={printer.busy || loading} onClick={() => void share()}>
        {printer.busy ? t('hist.sharing') : t('hist.share')}
      </button>
      <button className="btn plain" disabled={printer.busy || loading} onClick={() => void print()}>
        {printer.busy ? t('hist.printing') : t('hist.printAgain')}
      </button>
      {/* Turning it into the sale: a new bill tab with its lines and customer. */}
      {q.status === 'open' ? (
        <button className="btn" disabled={busy || loading} onClick={() => void makeBill()}>{t('hist.makeBill')}</button>
      ) : null}
    </>
  );

  return (
    <Dialog title={t('hist.quoteNo', { no: q.no })} onClose={onClose} footer={footer}>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {q.status === 'billed' ? <p className="notice">{t('hist.quoteBilled', { no: q.billNo ?? '?' })}</p> : null}
      {q.status === 'cancelled' ? <p className="notice">{t('hist.cancelled')}</p> : null}
      {asking === 'delete' ? <p className="notice">{t('hist.deleteQuoteAsk', { no: q.no })}</p> : null}
      {loading
        ? <p className="notice">{t('hist.loading')}</p>
        : <ReceiptView doc={buildReceipt(bill, historyViewSettings(shop.settings), shop.receiptLabels)} inkAlt={t('ink.alt')} />}
    </Dialog>
  );
}
