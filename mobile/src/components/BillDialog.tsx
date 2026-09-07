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
  bill, onClose, onCancelled,
}: {
  bill: Bill | null;
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

  const doc = useMemo(
    () => (bill ? buildReceipt(bill, shop.settings, shop.receiptLabels) : null),
    [bill, shop.settings, shop.receiptLabels],
  );

  const close = () => {
    setAsking(false);
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
      setAsking(false);
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
        onPress={() => setAsking(false)}
        style={{ flex: 1 }}
      />
      <Button
        label={busy ? t('hist.cancelling') : t('hist.cancelYes')}
        tone="danger"
        disabled={busy}
        onPress={() => void cancel()}
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
      {bill?.cancelled ? null : (
        <Button label={t('hist.cancelBill')} tone="plain" onPress={() => setAsking(true)} />
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
      {asking ? <Notice>{t('hist.cancelNote')}</Notice> : null}

      {doc ? <ReceiptView doc={doc} /> : null}
    </Dialog>
  );
}
