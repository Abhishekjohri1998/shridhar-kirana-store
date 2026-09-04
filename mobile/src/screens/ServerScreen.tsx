import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorText, Field, Notice } from '../components/ui';
import { api, normaliseServerUrl } from '../lib/api';
import { useShop } from '../lib/useShop';
import { C } from '../theme';

/**
 * First run: where is the server?
 *
 * The web app never needs asking -- it is served by the same process it talks to. A phone is a
 * different machine, so this is unavoidable, and getting it wrong is the most likely reason the
 * app appears broken. Hence the check button: it tells you the address works before you commit
 * to it, and says which storage the server is on, which is a useful thing to know anyway.
 */
export function ServerScreen() {
  const shop = useShop();
  const [url, setUrl] = useState(shop.serverUrl || 'http://192.168.1.5:4000');
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    setError(null);
    setFound(null);
    const candidate = normaliseServerUrl(url);
    if (!candidate) {
      setError('Enter the server address.');
      return;
    }
    setBusy(true);
    try {
      // Saved before testing, because that is what the api module reads from.
      await shop.saveServerUrl(candidate);
      const health = await api.health();
      setFound(health.storage === 'mongo' ? 'MongoDB' : 'the local JSON file');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Shridhar Billing</Text>
      <Text style={styles.lede}>
        This phone needs the address of the billing server before it can do anything else.
      </Text>

      <Card>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {found ? <Notice>Connected. The server is storing data in {found}.</Notice> : null}

        <Field
          label="Server address"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="192.168.1.5:4000"
          hint={
            'On the shop wifi this is the counter computer: run `ipconfig` there and use its IPv4 ' +
            'address with port 4000. Once the app is hosted, use its https address instead.'
          }
        />

        <Button label={busy ? 'Checking…' : 'Check connection'} tone="plain" onPress={() => void test()} disabled={busy} />
        <View style={{ height: 10 }} />
        <Button
          label="Save and continue"
          onPress={() => void shop.saveServerUrl(normaliseServerUrl(url))}
          disabled={busy || !url.trim()}
        />
      </Card>

      <Text style={styles.note}>
        The phone and the computer have to be on the same wifi. If the check fails, the usual causes
        are a typed digit, the server not running, or Windows Firewall blocking port 4000.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingTop: 32 },
  title: { fontSize: 22, fontWeight: '800', color: C.ink },
  lede: { fontSize: 15, color: C.soft, lineHeight: 22, marginTop: 6, marginBottom: 16 },
  note: { fontSize: 13, color: C.soft, lineHeight: 19, marginTop: 16 },
});
