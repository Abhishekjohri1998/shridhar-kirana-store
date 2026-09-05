import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Mark } from '../components/Icons';
import { Button, ErrorText, Fade, Field } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C, R, SP, TYPE, shadow } from '../theme';

export function LoginScreen() {
  const shop = useShop();
  const [pin, setPin] = useState('');
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
      await shop.signIn(pin.trim());
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
          <Text style={styles.title}>{shop.settings.shopName}</Text>
          <Text style={styles.lede}>{shop.t('login.prompt')}</Text>

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
            label={busy ? shop.t('login.checking') : shop.t('login.signIn')}
            onPress={() => void submit()}
            disabled={busy}
          />
        </View>
      </Fade>

      <Text style={styles.server}>{shop.serverUrl}</Text>
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
  server: { fontSize: 12, color: C.faint, textAlign: 'center', marginTop: 16 },
});
