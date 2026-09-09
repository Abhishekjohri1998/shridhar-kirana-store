import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Field, SectionTitle } from '../components/ui';
import { usePrinter } from '../printer/PrintProvider';
import { listPairedPrinters, type PairedPrinter } from '../printer/bluetooth';
import { useStore } from '../store/store';
import { C } from '../theme';
import type { Bill } from '../types';

/** Reproduces the four lines from the shop's paper slip, so a test print proves the whole
 *  chain -- Kannada shaping, column alignment and the total -- against a known answer: 1370. */
const TEST_BILL: Bill = {
  no: 0,
  at: new Date().toISOString(),
  lines: [
    { itemId: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil', qty: 5, rate: 110 },
    { itemId: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', qty: 5, rate: 123 },
    { itemId: 'ot', nameKn: 'OT', nameEn: 'OT', qty: 1, rate: 50 },
    { itemId: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', qty: 1, rate: 155 },
  ],
  total: 1370,
};

export function SettingsScreen() {
  const store = useStore();
  const printer = usePrinter();
  const [shopName, setShopName] = useState(store.settings.shopName);
  const [footer, setFooter] = useState(store.settings.footer);
  const [picker, setPicker] = useState<PairedPrinter[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const openPicker = async () => {
    setScanning(true);
    try {
      const found = await listPairedPrinters();
      if (!found.length) {
        Alert.alert(
          'No paired devices',
          'Pair the printer first in the phone’s own Bluetooth settings, then come back here.',
        );
        return;
      }
      setPicker(found);
    } catch (e) {
      Alert.alert('Bluetooth', e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const choose = async (device: PairedPrinter) => {
    await store.saveSettings({ printerAddress: device.address, printerName: device.name });
    setPicker(null);
  };

  const testPrint = async () => {
    try {
      await printer.printBill({ ...TEST_BILL, at: new Date().toISOString() });
    } catch (e) {
      Alert.alert('Test print failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionTitle>What prints on the slip</SectionTitle>
      <Field
        label="Shop name"
        value={shopName}
        onChangeText={setShopName}
        onBlur={() => void store.saveSettings({ shopName: shopName.trim() })}
      />
      <Field
        label="Footer line"
        value={footer}
        onChangeText={setFooter}
        onBlur={() => void store.saveSettings({ footer: footer.trim() })}
      />

      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text style={styles.switchLabel}>Show the rate under each item</Text>
          <Text style={styles.switchHint}>The paper slip does not, so this is normally off.</Text>
        </View>
        <Switch
          value={store.settings.showRate}
          onValueChange={(v) => void store.saveSettings({ showRate: v })}
          trackColor={{ true: C.accent, false: C.line }}
        />
      </View>

      <View style={styles.divider} />

      <SectionTitle>Printer</SectionTitle>
      <View style={styles.card}>
        <Text style={styles.printerName}>
          {store.settings.printerName ?? 'No printer chosen'}
        </Text>
        {store.settings.printerAddress ? (
          <Text style={styles.printerAddr}>{store.settings.printerAddress}</Text>
        ) : (
          <Text style={styles.printerAddr}>
            Pair the 58mm printer in Android Bluetooth settings first, then choose it here.
          </Text>
        )}
      </View>

      {!printer.available ? (
        <Text style={styles.warn}>
          This build cannot reach Bluetooth. Billing and preview work, but printing needs the installed
          app rather than Expo Go.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={scanning ? 'Looking...' : 'Choose printer'}
          tone="plain"
          onPress={openPicker}
          disabled={scanning}
          style={styles.grow}
        />
        <Button
          label={printer.busy ? 'Printing...' : 'Test print'}
          onPress={testPrint}
          disabled={printer.busy || !store.settings.printerAddress}
          style={styles.grow}
        />
      </View>
      <Text style={styles.hint}>
        The test slip bills 5 + 5 + 1 + 1 of the four items from the shop’s own receipt. If the total
        reads 1370 and the Kannada is legible, the printer is set up correctly.
      </Text>

      <Modal visible={picker != null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicker(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Paired Bluetooth devices</Text>
            {(picker ?? []).map((d) => (
              <Pressable key={d.address} onPress={() => void choose(d)} style={styles.deviceRow}>
                <Text style={styles.deviceName}>{d.name}</Text>
                <Text style={styles.deviceAddr}>{d.address}</Text>
              </Pressable>
            ))}
            <Button label="Cancel" tone="plain" onPress={() => setPicker(null)} style={styles.stretch} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  grow: { flex: 1 },
  stretch: { alignSelf: 'stretch', marginTop: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  switchLabel: { fontSize: 16, color: C.ink },
  switchHint: { fontSize: 13, color: C.soft, marginTop: 2 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 22 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14, marginBottom: 12 },
  printerName: { fontSize: 17, fontWeight: '700', color: C.ink },
  printerAddr: { fontSize: 13, color: C.soft, marginTop: 3, lineHeight: 18 },
  warn: { fontSize: 13, color: C.danger, lineHeight: 19, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 13, color: C.soft, lineHeight: 19, marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 12 },
  deviceRow: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14, marginBottom: 8 },
  deviceName: { fontSize: 16, color: C.ink, fontWeight: '600' },
  deviceAddr: { fontSize: 12, color: C.soft, marginTop: 2 },
});
