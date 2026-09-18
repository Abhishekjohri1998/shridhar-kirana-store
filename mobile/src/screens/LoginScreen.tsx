import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { pickLang } from '@shridhar/shared';
import { Mark } from '../components/Icons';
import { Button, ErrorText, Fade, Field } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C, R, SP, TYPE, handFont, shadow } from '../theme';

/**
 * The PIN screen, in both of its jobs.
 *
 * `locked` is a session that is already signed in and only needs the PIN again -- the app was
 * closed and reopened. It says so, because a shopkeeper who sees a login screen with a parked
 * bill behind it needs to know the bill is still there.
 */
export function LoginScreen({ locked = false }: { locked?: boolean }) {
  const shop = useShop();
  const [pin, setPin] = useState('');
  const shopName = pickLang(shop.settings.shopName, shop.settings.shopNameKn, shop.lang);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pin.trim()) {
      setError(shop.t('login.enterPin'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (locked) await shop.unlock(pin.trim());
      else await shop.signIn(pin.trim());
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
          <Text style={styles.lede}>
            {locked ? shop.t('login.lockedPrompt') : shop.t('login.prompt')}
          </Text>

          {error ? <ErrorText>{error}</ErrorText> : null}

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
            label={
              busy ? shop.t('login.checking')
                : (locked ? shop.t('login.unlock') : shop.t('login.signIn'))
            }
            onPress={() => void submit()}
            disabled={busy}
          />
        </View>
      </Fade>

      {/* The address, and a way out of it.
          A wrong address saved on the first screen leaves the operator here for ever: signing in
          is impossible because the server cannot be reached, and the only control that could fix
          it used to live in Settings, on the far side of this login. */}
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
  /* Widely spaced dots, so the operator can count what they typed without unmasking it. */
  pin: { textAlign: 'center', fontSize: 22, letterSpacing: 10 },
  serverRow: { alignItems: 'center', marginTop: 18, paddingVertical: 8 },
  server: { fontSize: 12, color: C.faint, textAlign: 'center' },
  serverChange: {
    fontSize: 13, color: C.accent, fontWeight: '700', marginTop: 6,
    textDecorationLine: 'underline',
  },
});
