import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { money, stamp, type Bill, type Payment } from '@shridhar/shared';
import { api } from '../lib/api';
import { BillDialog } from '../components/BillDialog';
import { Empty } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C, R, shadow } from '../theme';
import { HistoryIcon } from '../components/Icons';

export function HistoryScreen() {
  const shop = useShop();
  const t = shop.t;
  const [open, setOpen] = useState<Bill | null>(null);
  /* Money received with no bill, shown among the bills at the time it was received. Fetched
     again whenever the bills move, which is also when a payment is likely to have been taken. */
  const [payments, setPayments] = useState<Payment[]>([]);
  useEffect(() => {
    let alive = true;
    void api.listPayments(100)
      .then((list) => { if (alive) setPayments(list); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [shop.bills, shop.dataVersion]);

  type Row = { kind: 'bill'; at: string; bill: Bill } | { kind: 'pay'; at: string; pay: Payment };
  const rows: Row[] = [
    ...shop.bills.map((bill): Row => ({ kind: 'bill', at: bill.at, bill })),
    ...payments.map((pay): Row => ({ kind: 'pay', at: pay.at, pay })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>

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
        rows.map((row) => row.kind === 'pay' ? (
          <View key={row.pay.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.no}>{t('pay.row')}</Text>
              <Text style={styles.when}>
                {stamp(row.pay.at)}
                {row.pay.note ? ' · ' + row.pay.note : ''}
                {row.pay.cancelled ? ' · ' + t('pay.cancelled') : ''}
              </Text>
            </View>
            <Text style={styles.total}>{row.pay.cancelled ? '—' : money(row.pay.amount)}</Text>
          </View>
        ) : (({ bill }) => (
          <Pressable key={bill.no} style={styles.row} onPress={() => setOpen(bill)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.no}>{t('hist.billNo', { no: bill.no })}</Text>
              <Text style={styles.when}>
                {stamp(bill.at)} ·{' '}
                {bill.lines.length === 1 ? t('hist.oneItem') : t('hist.nItems', { n: bill.lines.length })}
                {bill.cancelled ? ' · ' + t('hist.cancelled') : ''}
              </Text>
            </View>
            {/* A cancelled bill shows no amount: it is not money the shop took. */}
            <Text style={styles.total}>{bill.cancelled ? '—' : money(bill.total)}</Text>
          </Pressable>
        ))(row))
      )}

      <BillDialog bill={open} onClose={() => setOpen(null)} />
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
