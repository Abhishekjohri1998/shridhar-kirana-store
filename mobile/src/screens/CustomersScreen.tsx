import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkCustomer, money, stamp, type Bill, type Customer } from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { Button, ErrorText, Field, Notice } from '../components/ui';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function CustomersScreen() {
  const shop = useShop();
  const t = shop.t;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ customer: Customer; bills: Bill[] } | null>(null);
  const [draft, setDraft] = useState<{ id?: string; name: string; phone: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCustomers(await api.listCustomers());
      await shop.refreshInactive();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    void load();
    // Loaded once on mount; the actions on this screen refresh it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    // Only match the number when the query has digits in it: includes of an empty string is
    // true for every string, which would make a name search that finds nothing list everybody.
    const digits = q.replace(/\D/g, '');
    return customers.filter(
      (c) => c.name.toLowerCase().includes(q) || (digits.length > 0 && c.phone.includes(digits)),
    );
  }, [query, customers]);

  const owing = customers.filter((c) => c.balance > 0);

  const quietList = shop.inactive
    .slice(0, 6)
    .map((c) => {
      const who = c.name || c.phone || t('cs.unnamed');
      const when = t('cs.inactiveRow', { n: daysSince(c.lastVisit) ?? 0 });
      const owes = c.balance > 0 ? t('cs.inactiveOwes', { amount: money(c.balance) }) : '';
      return '• ' + who + ' — ' + when + owes;
    })
    .join('\n');

  const save = async () => {
    if (!draft) return;
    const fields = checkCustomer(draft.name, draft.phone);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    try {
      await api.saveCustomer({ ...(draft.id ? { id: draft.id } : {}), name: fields.name, phone: fields.phone });
      setDraft(null);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeCustomer = async (id: string) => {
    try {
      await api.deleteCustomer(id);
      setDraft(null);
      setOpen(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openCustomer = async (c: Customer) => {
    try {
      setOpen(await api.getCustomer(c.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <ErrorText>{error}</ErrorText> : null}

        {shop.inactive.length > 0 ? (
          <Notice>
            {(shop.inactive.length === 1
              ? t('cs.inactiveOne', { days: shop.settings.inactiveAfterDays })
              : t('cs.inactiveMany', { n: shop.inactive.length, days: shop.settings.inactiveAfterDays })) +
              '\n' +
              quietList}
          </Notice>
        ) : null}

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t('cs.customers')}</Text>
            <Text style={styles.statValue}>{customers.length}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t('cs.owing')}</Text>
            <Text style={styles.statValue}>{owing.length}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>{t('cs.outstanding')}</Text>
            <Text style={styles.statValue}>{money(owing.reduce((s, c) => s + c.balance, 0))}</Text>
          </View>
        </View>

        <View style={styles.bar}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={t('cs.searchPlaceholder')}
            placeholderTextColor={C.soft}
          />
          <Button label={t('common.new')} onPress={() => setDraft({ name: '', phone: '' })} style={styles.slim} />
        </View>

        {loading ? (
          <Text style={styles.empty}>{t('cs.loading')}</Text>
        ) : results.length === 0 ? (
          <Text style={styles.empty}>{customers.length === 0 ? t('cs.noneYet') : t('cs.nobody')}</Text>
        ) : (
          results.map((c) => {
            const quiet = daysSince(c.lastVisit);
            const detail =
              (c.phone || t('cs.noNumber')) +
              ' · ' +
              (c.billCount === 0
                ? t('cs.noBillsYet')
                : (c.billCount === 1 ? t('cs.oneBill') : t('cs.nBills', { n: c.billCount })) +
                  (quiet == null ? '' : quiet === 0 ? t('cs.lastInToday') : t('cs.lastInDays', { n: quiet })));
            return (
              <Pressable key={c.id} style={styles.row} onPress={() => void openCustomer(c)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{c.name || t('cs.unnamed')}</Text>
                  <Text style={styles.small}>{detail}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.name}>{money(c.totalBilled)}</Text>
                  {c.balance !== 0 ? (
                    <Text style={[styles.small, { color: c.balance > 0 ? C.danger : C.soft }]}>
                      {(c.balance > 0 ? t('cs.owes') : t('cs.credit')) + money(Math.abs(c.balance))}
                    </Text>
                  ) : (
                    <Text style={styles.small}>{t('cs.settled')}</Text>
                  )}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Dialog
        visible={open != null}
        title={open ? open.customer.name || open.customer.phone || t('cs.customers') : ''}
        onClose={() => setOpen(null)}
        footer={
          <>
            <Button label={t('common.close')} tone="plain" onPress={() => setOpen(null)} style={{ flex: 1 }} />
            <Button
              label={t('common.edit')}
              onPress={() =>
                open && setDraft({ id: open.customer.id, name: open.customer.name, phone: open.customer.phone })
              }
              style={{ flex: 1 }}
            />
          </>
        }
      >
        {open ? (
          <View>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>{t('cs.totalTransaction')}</Text>
                <Text style={styles.statValue}>{money(open.customer.totalBilled)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>{t('cs.paid')}</Text>
                <Text style={styles.statValue}>{money(open.customer.totalPaid)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>{t('cs.balance')}</Text>
                <Text style={styles.statValue}>{money(open.customer.balance)}</Text>
              </View>
            </View>
            <Text style={styles.small}>
              {(open.customer.phone ? open.customer.phone + ' · ' : '') +
                t('cs.since', { date: stamp(open.customer.since) }) +
                (open.customer.lastVisit ? t('cs.lastVisit', { date: stamp(open.customer.lastVisit) }) : '')}
            </Text>
            {open.bills.length === 0 ? (
              <Text style={styles.empty}>{t('cs.noBills')}</Text>
            ) : (
              open.bills.map((b) => (
                <View key={b.no} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.ink }}>{t('hist.billNo', { no: b.no })}</Text>
                    <Text style={styles.small}>{stamp(b.at)}</Text>
                  </View>
                  <View style={styles.right}>
                    <Text style={styles.name}>{money(b.total)}</Text>
                    {b.paid !== b.total ? (
                      <Text style={styles.small}>{t('cs.paidOf', { amount: money(b.paid) })}</Text>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}
      </Dialog>

      <Dialog
        visible={draft != null}
        title={draft?.id ? t('cs.editTitle') : t('cs.newTitle')}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setDraft(null)} style={{ flex: 1 }} />
            <Button label={t('common.save')} onPress={() => void save()} style={{ flex: 1 }} />
          </>
        }
      >
        {draft ? (
          <View>
            <Field
              label={t('cs.name')}
              value={draft.name}
              onChangeText={(name) => setDraft((d) => (d ? { ...d, name } : d))}
            />
            <Field
              label={t('cs.phone')}
              value={draft.phone}
              keyboardType="phone-pad"
              onChangeText={(phone) => setDraft((d) => (d ? { ...d, phone } : d))}
            />
            {draft.id ? (
              <Button
                label={t('cs.removeCustomer')}
                tone="danger"
                onPress={() => draft.id && void removeCustomer(draft.id)}
              />
            ) : null}
            <Text style={styles.small}>{t('cs.removeNote')}</Text>
          </View>
        ) : null}
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, paddingBottom: 24 },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line,
    borderRadius: 10, padding: 10, alignItems: 'center',
  },
  statLabel: { fontSize: 11, color: C.soft, textAlign: 'center' },
  statValue: { fontSize: 17, fontWeight: '800', color: C.ink, marginTop: 2 },
  bar: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  slim: { paddingHorizontal: 14 },
  search: {
    flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, minHeight: 48,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line,
  },
  right: { alignItems: 'flex-end' },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  small: { fontSize: 12, color: C.soft, marginTop: 2, lineHeight: 18 },
  empty: { color: C.soft, textAlign: 'center', paddingVertical: 18 },
});
