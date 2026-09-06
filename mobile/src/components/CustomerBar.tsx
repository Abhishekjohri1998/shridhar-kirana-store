import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkCustomer, money, type Customer } from '@shridhar/shared';
import { Button, ErrorText } from './ui';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

/**
 * Customer name and number for the top of the slip.
 *
 * Typing either one searches the customers already on file and offers them, so a regular does not
 * get re-entered by hand -- which is how the same person ends up stored twice with the khata split
 * between the copies.
 */
export function CustomerBar() {
  const shop = useShop();
  const t = shop.t;
  // Held in the shared draft, not here: the bill needs to read it at print time, and switching
  // tabs used to throw it away.
  const name = shop.customerDraft.name;
  const phone = shop.customerDraft.phone;
  const setName = (next: string) => shop.setCustomerDraft({ name: next, phone });
  const setPhone = (next: string) => shop.setCustomerDraft({ name, phone: next });
  const [matches, setMatches] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const query = name.trim() || phone.trim();

  useEffect(() => {
    if (shop.customer || query.length < 1) {
      setMatches([]);
      return;
    }
    // Debounced, and a stale answer is dropped: otherwise a slow reply overwrites the suggestions
    // for what is now a different query.
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await api.searchCustomers(query);
        if (seq.current === mine) setMatches(found);
      } catch {
        if (seq.current === mine) setMatches([]);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, shop.customer]);

  const attach = (customer: Customer) => {
    shop.setCustomer(customer);
    setMatches([]);
    setOpen(false);
    setError(null);
  };

  const saveNew = async () => {
    const fields = checkCustomer(name, phone);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    setError(null);
    try {
      await shop.saveCustomer({ name: fields.name, phone: fields.phone });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (shop.customer && !open) {
    const c = shop.customer;
    return (
      <View style={styles.chip}>
        {/* One line, because this strip is pinned above the totals now and every millimetre it
            takes is a millimetre off the writing area. Who they are on the left, what they owe
            on the right -- and the bill-count sentence only when there is no balance to say
            instead, since that is the number the shopkeeper is actually looking for. */}
        <Text style={styles.chipName} numberOfLines={1}>
          {c.name || t('cust.unnamed')}
          {c.phone ? <Text style={styles.small}> · {c.phone}</Text> : null}
        </Text>
        <Text style={styles.chipFigure} numberOfLines={1}>
          {c.balance !== 0
            ? t('cust.balanceOf', { amount: money(c.balance) })
            : c.billCount === 0
              ? t('cust.firstBill')
              : t('cust.totalOf', { amount: money(c.totalBilled) })}
        </Text>
        <Button
          label={t('cust.change')}
          tone="plain"
          onPress={() => {
            shop.setCustomer(null);
            setName('');
            setPhone('');
            setOpen(true);
          }}
          style={styles.slim}
        />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      {error ? <ErrorText>{error}</ErrorText> : null}

      {/* Above the strip, not inside it. A live-search list in flow would push a pinned footer
          up over the writing with every keystroke. */}
      {matches.length > 0 ? (
        <View style={styles.matches}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {matches.map((m) => (
              <Pressable key={m.id} style={styles.suggestion} onPress={() => attach(m)}>
                <Text style={{ flex: 1, color: C.ink }} numberOfLines={1}>
                  {m.name || t('cust.unnamed')}
                  {m.phone ? <Text style={styles.small}> · {m.phone}</Text> : null}
                </Text>
                <Text style={styles.small}>
                  {m.balance !== 0
                    ? t('cust.balanceOf', { amount: money(m.balance) })
                    : t('cust.totalOf', { amount: money(m.totalBilled) })}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.fields}>
        <TextInput
          style={[styles.input, { flex: 2 }]}
          value={name}
          onChangeText={setName}
          placeholder={t('cust.namePlaceholder')}
          placeholderTextColor={C.soft}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('cust.phonePlaceholder')}
          placeholderTextColor={C.soft}
          keyboardType="phone-pad"
        />

        {query.length > 0 ? (
          <Button
            label={searching ? t('cust.looking') : t('cust.addToBill')}
            tone="plain"
            onPress={() => void saveNew()}
            style={styles.slim}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginBottom: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10,
  },
  chipName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.ink },
  chipFigure: { fontSize: 13, fontWeight: '700', color: C.accentDeep },
  small: { fontSize: 12, color: C.soft, fontWeight: '400' },
  /* The two fields share a row; the button wraps onto the next one. Inline, its label refuses
     to shrink and squeezes the inputs down to a thumb's width. */
  fields: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  /* Capped and scrolling, so a long list of Rameshes cannot grow the footer without limit. */
  matches: {
    maxHeight: 150, marginBottom: 8, backgroundColor: C.card,
    borderWidth: 1, borderColor: C.lineStrong, borderRadius: 10, overflow: 'hidden',
  },
  input: {
    backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, minHeight: 46,
  },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line,
  },
  slim: { flexBasis: '100%', minHeight: 46, paddingVertical: 8, paddingHorizontal: 14 },
});
