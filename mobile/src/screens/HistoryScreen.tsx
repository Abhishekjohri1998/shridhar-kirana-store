import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { money, stamp, type Bill } from '@shridhar/shared';
import { BillDialog } from '../components/BillDialog';
import { Empty } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C, R, shadow } from '../theme';
import { HistoryIcon } from '../components/Icons';

export function HistoryScreen() {
  const shop = useShop();
  const t = shop.t;
  const [open, setOpen] = useState<Bill | null>(null);

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
        shop.bills.map((bill) => (
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
        ))
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
