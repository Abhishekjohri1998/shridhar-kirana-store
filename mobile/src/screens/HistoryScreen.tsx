import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buildReceipt, money, stamp, type Bill } from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { ReceiptView } from '../components/ReceiptView';
import { Button, Empty, ErrorText } from '../components/ui';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import { C, R, shadow } from '../theme';
import { HistoryIcon } from '../components/Icons';

export function HistoryScreen() {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [open, setOpen] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doc = useMemo(
    () => (open ? buildReceipt(open, shop.settings, shop.receiptLabels) : null),
    [open, shop.settings, shop.receiptLabels],
  );

  const reprint = async (bill: Bill) => {
    setError(null);
    try {
      await printer.printBill(bill, shop.settings);
      setOpen(null);
    } catch (e) {
      setError(t('hist.couldNotPrint') + ': ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Not a reports module -- the one number the shopkeeper counts the drawer against. */}
      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>{t('hist.today')}</Text>
        <Text style={styles.summaryValue}>{money(shop.today.total)}</Text>
        <Text style={styles.summaryCount}>
          {shop.today.count === 1 ? t('hist.oneBill') : t('hist.nBills', { n: shop.today.count })}
        </Text>
      </View>

      {shop.bills.length === 0 ? (
        <Empty icon={<HistoryIcon size={26} color={C.faint} />}>{t('hist.noBills')}</Empty>
      ) : (
        shop.bills.map((bill) => (
          <Pressable key={bill.no} style={styles.row} onPress={() => setOpen(bill)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.no}>{t('hist.billNo', { no: bill.no })}</Text>
              <Text style={styles.when}>
                {stamp(bill.at)} ·{' '}
                {bill.lines.length === 1 ? t('hist.oneItem') : t('hist.nItems', { n: bill.lines.length })}
              </Text>
            </View>
            <Text style={styles.total}>{money(bill.total)}</Text>
          </Pressable>
        ))
      )}

      <Dialog
        visible={open != null}
        title={open ? t('hist.billNo', { no: open.no }) : ''}
        onClose={() => setOpen(null)}
        footer={
          <>
            <Button label={t('common.close')} tone="plain" onPress={() => setOpen(null)} style={{ flex: 1 }} />
            <Button
              label={printer.busy ? t('hist.printing') : t('hist.printAgain')}
              onPress={() => open && void reprint(open)}
              disabled={printer.busy}
              style={{ flex: 1 }}
            />
          </>
        }
      >
        {doc ? <ReceiptView doc={doc} /> : null}
      </Dialog>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, width: '100%', maxWidth: 820, alignSelf: 'center' },
  /* The takings block is the one thing on this screen the owner actually looks for, so it is the
     only surface in the app that is solid brand colour. */
  summary: {
    backgroundColor: C.accent, borderRadius: R.lg,
    paddingVertical: 22, paddingHorizontal: 18, alignItems: 'center', marginBottom: 14,
    ...shadow(2),
  },
  summaryLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 1.3 },
  summaryValue: { fontSize: 38, fontWeight: '800', color: '#fff', marginTop: 2, letterSpacing: -0.8 },
  summaryCount: { fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: R.md,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8, borderWidth: 1, borderColor: C.line,
    ...shadow(1),
  },
  no: { fontSize: 17, fontWeight: '700', color: C.ink },
  when: { fontSize: 13, color: C.soft, marginTop: 1 },
  total: { fontSize: 18, fontWeight: '700', color: C.ink },
});
