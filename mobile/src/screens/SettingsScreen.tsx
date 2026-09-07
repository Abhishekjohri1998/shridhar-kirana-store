import { useEffect, useState } from 'react';
import {
  Dimensions, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions,
} from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  LANGS, PAPERS, PAPER_KEYS, checkFooter, checkGstin, checkShopName, paperProfile, parseQuietDays,
  type Bill, type Lang, type MsgKey, type PaperKey,
} from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { ScriptField } from '../components/ScriptField';
import { Button, Card, ErrorText, Field, Notice, SectionTitle } from '../components/ui';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';
import type { PairedPrinter } from '../print/bluetooth';
import { C } from '../theme';

/** The four lines off the shop's own paper slip, so a test print checks the whole chain against a
 *  known answer: 1370. */
const TEST_BILL: Omit<Bill, 'at'> = {
  no: 0,
  lines: [
    { itemId: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil', qty: 5, rate: 110 },
    { itemId: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', qty: 5, rate: 123 },
    { itemId: 'ot', nameKn: 'OT', nameEn: 'OT', qty: 1, rate: 50 },
    { itemId: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', qty: 1, rate: 155 },
  ],
  total: 1370,
  paid: 1370,
  balance: 0,
  showBalance: false,
};

/** A row of choices that behaves like a radio group without pulling in a component library. */
function Choice<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((o) => (
        <Pressable
          key={o.key}
          onPress={() => onChange(o.key)}
          style={[styles.choice, value === o.key && styles.choiceOn]}
        >
          <Text style={[styles.choiceText, value === o.key && styles.choiceTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function SettingsScreen() {
  const shop = useShop();
  const printer = usePrint();
  const t = shop.t;
  const [shopName, setShopName] = useState(shop.settings.shopName);
  const [footer, setFooter] = useState(shop.settings.footer);
  const [gstin, setGstin] = useState(shop.settings.gstin ?? '');
  const [quiet, setQuiet] = useState(String(shop.settings.inactiveAfterDays));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<MsgKey | null>(null);
  const [picker, setPicker] = useState<PairedPrinter[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmServer, setConfirmServer] = useState(false);

  /**
   * What this device actually is, and what it gave the app.
   *
   * Written because three attempts to fix a tablet layout from a cropped screenshot all missed.
   * `window` against `screen` says whether Android handed the app the whole display or a
   * reduced one -- no arrangement of views can fill space the app was never given -- and
   * `shell` against `window` says whether the layout then used what it had.
   */
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const screen = Dimensions.get('screen');
  const build = Constants.expoConfig?.android?.versionCode ?? '?';
  const version = Constants.expoConfig?.version ?? '?';
  const updateId = Updates.updateId ? Updates.updateId.slice(0, 8) : 'none (built-in)';
  const size = (w: number, h: number) => Math.round(w) + ' x ' + Math.round(h);

  useEffect(() => {
    setShopName(shop.settings.shopName);
    setFooter(shop.settings.footer);
    setGstin(shop.settings.gstin ?? '');
    setQuiet(String(shop.settings.inactiveAfterDays));
  }, [shop.settings.shopName, shop.settings.footer, shop.settings.gstin, shop.settings.inactiveAfterDays]);

  const save = async (patch: Parameters<typeof shop.saveSettings>[0], labelKey: MsgKey) => {
    setError(null);
    try {
      await shop.saveSettings(patch);
      // The key, not the rendered text: switching to Kannada would otherwise leave the
      // confirmation of that very switch sitting there in English.
      setSaved(labelKey);
      setTimeout(() => setSaved(null), 2200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const paper = paperProfile(shop.settings.paper);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {error ? <ErrorText>{error}</ErrorText> : null}
      {saved ? <Notice>{t('set.saved', { what: t(saved) })}</Notice> : null}

      <Card style={styles.card}>
        <SectionTitle>{t('set.slipSection')}</SectionTitle>
        <ScriptField
          label={t('set.shopName')}
          value={shopName}
          onCommit={(next) => {
            setShopName(next);
            const checked = checkShopName(next);
            if (!checked.ok) {
              setError(checked.error);
              setShopName(shop.settings.shopName);
              return;
            }
            setError(null);
            if (checked.value !== shop.settings.shopName) void save({ shopName: checked.value }, 'set.savedShopName');
          }}
        />
        <ScriptField
          label={t('set.footer')}
          value={footer}
          onCommit={(next) => {
            setFooter(next);
            const checked = checkFooter(next);
            if (!checked.ok) {
              setError(checked.error);
              setFooter(shop.settings.footer);
              return;
            }
            setError(null);
            if (checked.value !== shop.settings.footer) void save({ footer: checked.value }, 'set.savedFooter');
          }}
        />
        {/* Not a ScriptField: a GST number is fifteen Latin characters by definition. */}
        <Field
          label={t('set.gstin')}
          value={gstin}
          onChangeText={setGstin}
          autoCapitalize="characters"
          autoCorrect={false}
          hint={checkGstin(gstin).warning ?? t('set.gstinHint')}
          onBlur={() => {
            const checked = checkGstin(gstin);
            setGstin(checked.value);
            setError(null);
            // Saved warning or not: a number the shop insists on is the shop's business.
            if (checked.value !== (shop.settings.gstin ?? '')) {
              void save({ gstin: checked.value }, 'set.savedGstin');
            }
          }}
        />

        <View style={styles.switchRow}>
          <Switch
            value={shop.settings.showRate}
            onValueChange={(v) => void save({ showRate: v }, 'set.savedRate')}
            trackColor={{ true: C.accent, false: C.line }}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{t('set.showRate')}</Text>
            <Text style={styles.hint}>{t('set.showRateHint')}</Text>
          </View>
        </View>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>{t('set.languageSection')}</SectionTitle>
        <Text style={styles.label}>{t('set.language')}</Text>
        <Choice<Lang>
          options={LANGS.map((code) => ({ key: code, label: code === 'kn' ? t('set.langKn') : t('set.langEn') }))}
          value={shop.settings.language}
          onChange={(next) => void save({ language: next }, 'set.savedLanguage')}
        />
        <Text style={styles.hint}>{t('set.languageNote')}</Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>{t('set.paperSection')}</SectionTitle>
        <Text style={styles.label}>{t('set.rollWidth')}</Text>
        <Choice<PaperKey>
          options={PAPER_KEYS.map((key) => ({ key, label: PAPERS[key].label }))}
          value={shop.settings.paper}
          onChange={(next) => void save({ paper: next }, 'set.savedPaper')}
        />
        <Text style={styles.hint}>{t('set.paperNote', { mm: paper.printableMm, dots: paper.dots })}</Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>{t('set.customersSection')}</SectionTitle>
        <Field
          label={t('set.quietDays')}
          value={quiet}
          keyboardType="number-pad"
          onChangeText={setQuiet}
          onBlur={() => {
            const parsed = parseQuietDays(quiet);
            if (!parsed.ok) {
              setError(parsed.error);
              setQuiet(String(shop.settings.inactiveAfterDays));
              return;
            }
            setError(null);
            if (parsed.value !== shop.settings.inactiveAfterDays) {
              void save({ inactiveAfterDays: parsed.value }, 'set.savedQuiet');
            }
          }}
          hint={t('set.quietNote')}
        />
      </Card>

      <Card style={styles.card}>
        <SectionTitle>{t('set.printerSection')}</SectionTitle>
        <Text style={styles.printerName}>{printer.printer?.name ?? t('set.printerNone')}</Text>
        {printer.printer ? <Text style={styles.hint}>{printer.printer.address}</Text> : null}
        {!printer.available ? <Text style={styles.warn}>{t('set.modeSerialUnavailable')}</Text> : null}
        <Text style={styles.hint}>
          Pair the printer in the phone&apos;s own Bluetooth settings first, then pick it here. This app
          talks Bluetooth Classic directly, which is what most portable thermal printers use — no
          RawBT and no computer in between.
        </Text>
        <View style={styles.row}>
          <Button
            label={scanning ? t('cust.looking') : t('set.connectPrinter')}
            tone="plain"
            disabled={scanning}
            style={{ flex: 1 }}
            onPress={() =>
              void guard(async () => {
                setScanning(true);
                try {
                  const found = await printer.listPrinters();
                  if (found.length === 0) throw new Error('No paired Bluetooth devices found.');
                  setPicker(found);
                } finally {
                  setScanning(false);
                }
              })
            }
          />
          <Button
            label={printer.busy ? t('bill.printing') : t('set.testPrint')}
            disabled={printer.busy || !printer.printer}
            style={{ flex: 1 }}
            onPress={() =>
              void guard(() => printer.printBill({ ...TEST_BILL, at: new Date().toISOString() }, shop.settings))
            }
          />
        </View>
        <Text style={styles.hint}>{t('set.testPrintNote')}</Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>{t('set.deviceSection')}</SectionTitle>
        <Text style={styles.hint}>{shop.serverUrl}</Text>

        {/* Diagnostics, not interface copy: left in English on purpose, since "window 1152 x 720"
            has no useful Kannada and the dictionary should not have to carry it. */}
        <Text style={styles.probe}>app {version} · build {build} · update {updateId}</Text>
        <Text style={styles.probe}>window {size(win.width, win.height)}</Text>
        <Text style={styles.probe}>screen {size(screen.width, screen.height)}</Text>
        <Text style={styles.probe}>
          insets top {Math.round(insets.top)} · bottom {Math.round(insets.bottom)}
        </Text>

        <View style={{ height: 10 }} />
        <Button label={t('set.signOut')} tone="plain" onPress={shop.signOut} />
        <View style={{ height: 8 }} />
        <Button label={t('set.changeServer')} tone="plain" onPress={() => setConfirmServer(true)} />
        <Text style={styles.hint}>{t('set.changeServerHint')}</Text>
      </Card>

      <Dialog
        visible={confirmServer}
        title={t('set.changeServer')}
        onClose={() => setConfirmServer(false)}
        footer={
          <>
            <Button label={t('common.cancel')} tone="plain" onPress={() => setConfirmServer(false)} style={{ flex: 1 }} />
            <Button
              label={t('set.changeServer')}
              onPress={() => {
                setConfirmServer(false);
                shop.forgetServer();
              }}
              style={{ flex: 1 }}
            />
          </>
        }
      >
        <Text style={styles.hint}>{t('set.changeServerHint')}</Text>
      </Dialog>

      <Dialog
        visible={picker != null}
        title={t('set.connectPrinter')}
        onClose={() => setPicker(null)}
        footer={<Button label={t('common.cancel')} tone="plain" onPress={() => setPicker(null)} style={{ flex: 1 }} />}
      >
        {(picker ?? []).map((d) => (
          <Pressable
            key={d.address}
            style={styles.device}
            onPress={() => {
              void printer.choosePrinter(d);
              setPicker(null);
            }}
          >
            <Text style={styles.deviceName}>{d.name}</Text>
            <Text style={styles.hint}>{d.address}</Text>
          </Pressable>
        ))}
      </Dialog>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, paddingBottom: 32, width: '100%', maxWidth: 820, alignSelf: 'center' },
  card: { marginBottom: 12 },
  label: { fontSize: 12, color: C.soft, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint: { fontSize: 12, color: C.soft, lineHeight: 18, marginTop: 4 },
  probe: { fontSize: 11, color: C.faint, lineHeight: 16, fontVariant: ['tabular-nums'] },
  warn: { fontSize: 12, color: C.danger, lineHeight: 18, marginTop: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  switchLabel: { fontSize: 15, color: C.ink },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  printerName: { fontSize: 16, fontWeight: '700', color: C.ink },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', backgroundColor: C.bg,
  },
  choiceOn: { borderColor: C.accent, backgroundColor: C.accentWash },
  choiceText: { color: C.ink, fontSize: 14 },
  choiceTextOn: { fontWeight: '700', color: C.accent },
  device: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14, marginBottom: 8, backgroundColor: C.card },
  deviceName: { fontSize: 16, fontWeight: '600', color: C.ink },
});
