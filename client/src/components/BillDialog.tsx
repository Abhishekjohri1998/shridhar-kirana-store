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
  bill, onClose, onCancelled,
}: {
  bill: Bill;
  onClose: () => void;
  /** Called with the cancelled bill so the list behind can be brought up to date. */
  onCancelled?: (bill: Bill) => void;
}) {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

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
      setAsking(false);
    } finally {
      setBusy(false);
    }
  };

  const footer = asking ? (
    <>
      <button className="btn plain" disabled={busy} onClick={() => setAsking(false)}>
        {t('hist.keepBill')}
      </button>
      <button className="btn danger" disabled={busy} onClick={() => void cancel()}>
        {busy ? t('hist.cancelling') : t('hist.cancelYes')}
      </button>
    </>
  ) : (
    <>
      <button className="btn plain" onClick={onClose}>{t('common.close')}</button>
      {bill.cancelled ? null : (
        <button className="btn plain" onClick={() => setAsking(true)}>{t('hist.cancelBill')}</button>
      )}
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
      {asking ? <p className="notice">{t('hist.cancelNote')}</p> : null}

      <ReceiptView doc={buildReceipt(bill, shop.settings, shop.receiptLabels)} inkAlt={t('ink.alt')} />
    </Dialog>
  );
}
