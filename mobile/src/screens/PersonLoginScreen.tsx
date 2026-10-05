import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickLang } from '@shridhar/shared';
import { Mark } from '../components/Icons';
import { Button, ErrorText, Fade, Field } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C, R, SP, TYPE, handFont, shadow } from '../theme';

/**
 * The first screen after the server address: a person's own phone number and PIN.
 *
 * Checked by the stock server, through billing's server, and the role decides what opens: an
 * admin gets Billing and Stock, a shop worker or the godown gets stock's own screens only. When
 * stock cannot be asked, the shop PIN below still opens billing exactly as it always did.
 */
export function PersonLoginScreen() {
  const shop = useShop();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shopName = pickLang(shop.settings.shopName, shop.settings.shopNameKn, shop.lang);

  const submit = async () => {
    if (!phone.trim() || !pin.trim()) {
      setError(shop.t('login.enterPhone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shop.signInPerson(phone.trim(), pin.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Fade offset={14}>
        <View style={styles.card}>
          <View style={styles.markRow}>
            <Mark size={46} color={C.accent} />
          </View>
          <Text style={[styles.title, handFont(shopName, 22)]}>{shopName}</Text>
          <Text style={styles.lede}>{shop.t('login.personPrompt')}</Text>

          {error ? <ErrorText>{error}</ErrorText> : null}

          <Field
            label={shop.t('login.phone')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Field
            label={shop.t('login.pin')}
            value={pin}
            onChangeText={setPin}
            secureTextEntry
            keyboardType="number-pad"
            style={styles.pin}
            onSubmitEditing={() => void submit()}
          />
          <Button
            label={busy ? shop.t('login.checking') : shop.t('login.signIn')}
            onPress={() => void submit()}
            disabled={busy}
          />
          <Pressable style={styles.alt} onPress={() => shop.setPinMode(true)} hitSlop={8}>
            <Text style={styles.altText}>{shop.t('login.useShopPin')}</Text>
          </Pressable>
        </View>
      </Fade>

      <Pressable style={styles.serverRow} onPress={shop.forgetServer}>
        <Text style={styles.server}>{shop.serverUrl}</Text>
        <Text style={styles.serverChange}>{shop.t('set.changeServer')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingTop: 64 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 24,
    ...shadow(2),
  },
  markRow: { alignItems: 'center', marginBottom: SP.md },
  title: { ...TYPE.title, fontSize: 22, textAlign: 'center', marginBottom: 4 },
  lede: { fontSize: 14, color: C.soft, marginBottom: 20, lineHeight: 20, textAlign: 'center' },
  pin: { textAlign: 'center', fontSize: 22, letterSpacing: 10 },
  alt: { alignItems: 'center', marginTop: 16, paddingVertical: 6 },
  altText: { fontSize: 14, color: C.accent, fontWeight: '700', textDecorationLine: 'underline' },
  serverRow: { alignItems: 'center', marginTop: 18, paddingVertical: 8 },
  server: { fontSize: 12, color: C.faint, textAlign: 'center' },
  serverChange: {
    fontSize: 13, color: C.accent, fontWeight: '700', marginTop: 6,
    textDecorationLine: 'underline',
  },
});
