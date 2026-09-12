import { useState } from 'react';
import { buildReceipt, type Bill } from '@shridhar/shared';
import { Dialog } from './Dialog';
import { ReceiptView } from './ReceiptView';
import { api } from '../lib/api';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

/**
 * One bill, as it printed -- with the option to print it again or cancel it.
 *
 * Shared by History and the customer's own list, because they are the same question asked from
 * two places, and a destructive action written twice is a destructive action that will diverge.
 *
 * Cancelling asks first, in the dialog that is already open rather than a second one on top: the
 * footer becomes the question. Nothing here nests a dialog inside a dialog, and the phone app
 * cannot.
 */
export function BillDialog({
  bill, onClose, onCancelled, onDeleted,
}: {
  bill: Bill;
  onClose: () => void;
  /** Called with the cancelled bill so the list behind can be brought up to date. */
  onCancelled?: (bill: Bill) => void;
  /** Called with the bill that has been removed, so the list behind can drop it. */
  onDeleted?: (bill: Bill) => void;
}) {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [error, setError] = useState<string | null>(null);
  /** Which question the footer is asking, if any: cancelling it, or removing it for good. */
  const [asking, setAsking] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setError(null);
    try {
      await printer.shareBill(bill, shop.settings);
    } catch (e) {
      setError(t('hist.couldNotShare') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const reprint = async () => {
    setError(null);
    try {
      await printer.printBill(bill, shop.settings);
      onClose();
    } catch (e) {
      setError(t('hist.couldNotPrint') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const cancel = async () => {
    setError(null);
    setBusy(true);
    try {
      const cancelled = await api.cancelBill(bill.no);
      // The customer's totals and today's takings both moved, and both are server-derived.
      await shop.reload();
      onCancelled?.(cancelled);
      onClose();
    } catch (e) {
      setError(t('hist.couldNotCancel') + ': ' + (e instanceof Error ? e.message : String(e)));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Gone for good, which the server allows only for a bill that is already cancelled.
   *
   * Cancelling is what takes a bill's money back out of the customer's figures, so this moves no
   * money at all -- it clears a mistake out of the history list and nothing more.
   */
  const remove = async () => {
    if (!bill) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteBill(bill.no);
      await shop.reload();
      onDeleted?.(bill);
      close();
    } catch (e) {
      setError(t('hist.couldNotDelete') + ': ' + (e instanceof Error ? e.message : String(e)));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  const footer = asking ? (
    <>
      <button className="btn plain" disabled={busy} onClick={() => setAsking(null)}>
        {t('hist.keepBill')}
      </button>
      <button
        className="btn danger"
        disabled={busy}
        onClick={() => void (asking === 'delete' ? remove() : cancel())}
      >
        {asking === 'delete'
          ? (busy ? t('hist.deleting') : t('hist.deleteYes'))
          : (busy ? t('hist.cancelling') : t('hist.cancelYes'))}
      </button>
    </>
  ) : (
    /* Cancelling sits apart from the buttons pressed a hundred times a day. */
    <>
      {/* Cancel while it is live; remove it once it is not. Never both: a bill has to be
          cancelled before it can go, which is what keeps the customer's balance right. */}
      {bill.cancelled ? (
        <button className="btn danger grow" onClick={() => setAsking('delete')}>
          {t('hist.deleteBill')}
        </button>
      ) : (
        <button className="btn plain grow" onClick={() => setAsking('cancel')}>{t('hist.cancelBill')}</button>
      )}
      <button className="btn plain" onClick={onClose}>{t('common.close')}</button>
      {/* A picture of the slip, for a customer who wants a copy on their phone. Offered for a
          cancelled bill too: what it said is still what it said. */}
      <button className="btn plain" disabled={printer.busy} onClick={() => void share()}>
        {printer.busy ? t('hist.sharing') : t('hist.share')}
      </button>
      <button className="btn" disabled={printer.busy || bill.cancelled} onClick={() => void reprint()}>
        {printer.busy ? t('hist.printing') : t('hist.printAgain')}
      </button>
    </>
  );

  return (
    <Dialog title={t('hist.billNo', { no: bill.no })} onClose={onClose} footer={footer}>
      {error ? <p className="error" role="alert">{error}</p> : null}

      {/* Said before the receipt, not after it: this is the thing that changes what follows. */}
      {bill.cancelled ? <p className="notice">{t('hist.cancelled')}</p> : null}
      {asking === 'cancel' ? <p className="notice">{t('hist.cancelNote')}</p> : null}
      {asking === 'delete' ? <p className="notice">{t('hist.deleteAsk', { no: bill.no })}</p> : null}

      <ReceiptView doc={buildReceipt(bill, shop.settings, shop.receiptLabels)} inkAlt={t('ink.alt')} />
    </Dialog>
  );
}
