import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { buildReceipt, type Bill } from '@shridhar/shared';
import { Dialog } from './Dialog';
import { ReceiptView } from './ReceiptView';
import { Button, ErrorText, Notice } from './ui';
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
 * footer becomes the question. Nothing in this app nests a Modal inside a Modal.
 */
export function BillDialog({
  bill, onClose, onCancelled, onDeleted,
}: {
  bill: Bill | null;
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

  const doc = useMemo(
    () => (bill ? buildReceipt(bill, shop.settings, shop.receiptLabels) : null),
    [bill, shop.settings, shop.receiptLabels],
  );

  const close = () => {
    setAsking(null);
    setError(null);
    onClose();
  };

  const share = async () => {
    if (!bill) return;
    setError(null);
    try {
      await printer.shareBill(bill, shop.settings);
    } catch (e) {
      setError(t('hist.couldNotShare') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const reprint = async () => {
    if (!bill) return;
    setError(null);
    try {
      await printer.printBill(bill, shop.settings);
      close();
    } catch (e) {
      setError(t('hist.couldNotPrint') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const cancel = async () => {
    if (!bill) return;
    setError(null);
    setBusy(true);
    try {
      const cancelled = await api.cancelBill(bill.no);
      // The customer's totals and today's takings both moved, and both are server-derived.
      await shop.reload();
      onCancelled?.(cancelled);
      close();
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
      <Button
        label={t('hist.keepBill')}
        tone="plain"
        disabled={busy}
        onPress={() => setAsking(null)}
        style={{ flex: 1 }}
      />
      <Button
        label={
          asking === 'delete'
            ? (busy ? t('hist.deleting') : t('hist.deleteYes'))
            : (busy ? t('hist.cancelling') : t('hist.cancelYes'))
        }
        tone="danger"
        disabled={busy}
        onPress={() => void (asking === 'delete' ? remove() : cancel())}
        style={{ flex: 1 }}
      />
    </>
  ) : (
    /*
     * Two rows, not four buttons in one.
     *
     * Cancelling sits on its own line above the rest: four labels across a phone leaves none of
     * them readable, and a destructive action does not belong shoulder to shoulder with the one
     * pressed a hundred times a day.
     */
    <View style={{ flex: 1, gap: 8 }}>
      {/* Cancel while it is live; remove it once it is not. Never both: a bill has to be
          cancelled before it can go, which is what keeps the customer's balance right. */}
      {bill?.cancelled ? (
        <Button label={t('hist.deleteBill')} tone="danger" onPress={() => setAsking('delete')} />
      ) : (
        <Button label={t('hist.cancelBill')} tone="plain" onPress={() => setAsking('cancel')} />
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={t('common.close')} tone="plain" onPress={close} style={{ flex: 1 }} />
        {/* A picture of the slip, for a customer who wants a copy on their phone. Offered for a
            cancelled bill too: what it said is still what it said. */}
        <Button
          label={printer.busy ? t('hist.sharing') : t('hist.share')}
          tone="plain"
          onPress={() => void share()}
          disabled={printer.busy}
          style={{ flex: 1 }}
        />
        <Button
          label={printer.busy ? t('hist.printing') : t('hist.printAgain')}
          onPress={() => void reprint()}
          disabled={printer.busy || bill?.cancelled === true}
          style={{ flex: 1.3 }}
        />
      </View>
    </View>
  );

  return (
    <Dialog
      visible={bill != null}
      title={bill ? t('hist.billNo', { no: bill.no }) : ''}
      onClose={close}
      footer={footer}
    >
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Said before the receipt, not after it: this is the thing that changes what follows. */}
      {bill?.cancelled ? <Notice>{t('hist.cancelled')}</Notice> : null}
      {asking === 'cancel' ? <Notice>{t('hist.cancelNote')}</Notice> : null}
      {asking === 'delete' && bill ? <Notice>{t('hist.deleteAsk', { no: bill.no })}</Notice> : null}

      {doc ? <ReceiptView doc={doc} /> : null}
    </Dialog>
  );
}
