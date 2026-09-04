import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Button, Card, ErrorText, Field } from '../components/ui';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

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
      <Card>
        <Text style={styles.title}>{shop.settings.shopName}</Text>
        <Text style={styles.lede}>{shop.t('login.prompt')}</Text>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Field
          label={shop.t('login.pin')}
          value={pin}
          onChangeText={setPin}
          secureTextEntry
          keyboardType="number-pad"
          onSubmitEditing={() => void submit()}
        />
        <Button label={busy ? shop.t('login.checking') : shop.t('login.signIn')} onPress={() => void submit()} disabled={busy} />
      </Card>
      <Text style={styles.server}>{shop.serverUrl}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 48 },
  title: { fontSize: 19, fontWeight: '800', color: C.ink, marginBottom: 4 },
  lede: { fontSize: 14, color: C.soft, marginBottom: 12, lineHeight: 20 },
  server: { fontSize: 12, color: C.soft, textAlign: 'center', marginTop: 14 },
});
