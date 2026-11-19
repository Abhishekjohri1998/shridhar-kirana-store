import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { buildReceipt, historyViewSettings, quotationAsBill, type Quotation } from '@shridhar/shared';
import { Dialog } from './Dialog';
import { ReceiptView } from './ReceiptView';
import { Button, ErrorText, Notice } from './ui';
import { api } from '../lib/api';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

/**
 * One quotation, as it prints -- with Make bill, print, share, WhatsApp, cancel and delete.
 *
 * Like BillDialog the footer becomes the question when something cannot be undone; nothing nests
 * a Modal in a Modal. Nothing here moves money: a quotation never did.
 */
export function QuotationDialog({
  quotation: listed, onClose, onChanged, onMakeBill,
}: {
  quotation: Quotation | null;
  onClose: () => void;
  /** The list behind should read again: one was cancelled or deleted. */
  onChanged?: () => void;
  /** "Make bill" opened a bill tab from it; the app goes to the Bill screen. */
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
    setAsking(null);
    setError(null);
    if (!listed?.hasInk) return;
    let alive = true;
    void api.getQuotation(listed.no)
      .then((q) => { if (alive) setFull(q); })
      .catch((e) => { if (alive) setError(t('hist.couldNotLoad') + ': ' + (e instanceof Error ? e.message : String(e))); });
    return () => { alive = false; };
  }, [listed]);
  const q = listed?.hasInk ? full : listed;
  const loading = listed != null && q == null;
  const bill = useMemo(() => (q ? quotationAsBill(q) : null), [q]);
  const doc = useMemo(
    () => (bill ? buildReceipt(bill, historyViewSettings(shop.settings), shop.receiptLabels) : null),
    [bill, shop.settings, shop.receiptLabels],
  );

  const run = async (what: () => Promise<unknown>, failKey: Parameters<typeof t>[0]) => {
    setError(null);
    try {
      await what();
    } catch (e) {
      setError(t(failKey) + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const makeBill = async () => {
    if (!q) return;
    setBusy(true);
    await run(async () => {
      if (await shop.billFromQuotation(q)) {
        onClose();
        onMakeBill?.();
      } else {
        setError(t('hist.tooManyTabs'));
      }
    }, 'hist.couldNotLoad');
    setBusy(false);
  };
  const act = async () => {
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      if (asking === 'delete') await api.deleteQuotation(q.no);
      else await api.cancelQuotation(q.no);
      onChanged?.();
      onClose();
    } catch (e) {
      setError(t(asking === 'delete' ? 'hist.couldNotDelete' : 'hist.couldNotCancel') + ': ' + (e instanceof Error ? e.message : String(e)));
      setAsking(null);
    } finally {
      setBusy(false);
    }
  };

  const footer = asking ? (
    <>
      <Button label={t('hist.keepBill')} tone="plain" disabled={busy} onPress={() => setAsking(null)} style={{ flex: 1 }} />
      <Button
        label={asking === 'delete' ? (busy ? t('hist.deleting') : t('hist.deleteYes')) : (busy ? t('hist.cancelling') : t('hist.cancelYes'))}
        tone="danger"
        disabled={busy}
        onPress={() => void act()}
        style={{ flex: 1 }}
      />
    </>
  ) : (
    <View style={{ flex: 1, gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {q?.status === 'open' ? (
          <Button label={t('hist.cancelQuote')} tone="plain" onPress={() => setAsking('cancel')} style={{ flex: 1 }} />
        ) : null}
        <Button label={t('hist.deleteBill')} tone="danger" onPress={() => setAsking('delete')} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label={t('common.close')} tone="plain" onPress={onClose} style={{ flex: 1 }} />
        <Button
          label={printer.busy ? t('hist.sharing') : t('hist.share')}
          tone="plain"
          disabled={printer.busy || loading}
          onPress={() => void run(() => printer.shareBill(bill!, shop.settings), 'hist.couldNotShare')}
          style={{ flex: 1 }}
        />
        <Button
          label={t('wa.send')}
          tone="plain"
          disabled={printer.busy || loading}
          onPress={() => void run(() => printer.whatsappBill(bill!, shop.settings), 'wa.failed')}
          style={{ flex: 1 }}
        />
        <Button
          label={printer.busy ? t('hist.printing') : t('hist.printAgain')}
          tone="plain"
          disabled={printer.busy || loading}
          onPress={() => void run(() => printer.printBill(bill!, shop.settings), 'hist.couldNotPrint')}
          style={{ flex: 1 }}
        />
      </View>
      {/* Turning it into the sale: a new bill tab with its lines and customer. */}
      {q && q.status !== 'billed' ? (
        <Button label={t('hist.makeBill')} disabled={busy || loading} onPress={() => void makeBill()} />
      ) : null}
    </View>
  );

  return (
    <Dialog visible={listed != null} title={listed ? t('hist.quoteNo', { no: listed.no }) : ''} onClose={onClose} footer={footer}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {q?.status === 'billed' ? <Notice>{t('hist.quoteBilled', { no: q.billNo ?? '?' })}</Notice> : null}
      {q?.status === 'cancelled' ? <Notice>{t('hist.cancelled')}</Notice> : null}
      {asking === 'delete' && q ? <Notice>{t('hist.deleteQuoteAsk', { no: q.no })}</Notice> : null}
      {loading || !doc ? <Notice>{t('hist.loading')}</Notice> : <ReceiptView doc={doc} />}
    </Dialog>
  );
}
