import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions,
} from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ERASE_WORD, LANGS, PAPERS, PAPER_KEYS, checkFooter, checkGstin, checkShopName, paperProfile,
  parseQuietDays,
  type Bill, type Lang, type MsgKey, type PaperKey,
} from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { ScriptField } from '../components/ScriptField';
import { Button, Card, ErrorText, Field, Notice, SectionTitle } from '../components/ui';
import { usePrint } from '../lib/usePrint';
import { useHeldInsets } from '../lib/screenEdges';
import { ApiError, api } from '../lib/api';
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
  const [shopNameKn, setShopNameKn] = useState(shop.settings.shopNameKn ?? '');
  const [footerKn, setFooterKn] = useState(shop.settings.footerKn ?? '');
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
  const edges = useHeldInsets();
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
    setShopNameKn(shop.settings.shopNameKn ?? '');
    setFooterKn(shop.settings.footerKn ?? '');
    setQuiet(String(shop.settings.inactiveAfterDays));
  }, [
    shop.settings.shopName, shop.settings.footer, shop.settings.gstin,
    shop.settings.shopNameKn, shop.settings.footerKn, shop.settings.inactiveAfterDays,
  ]);

  const save = async (patch: Parameters<typeof shop.saveSettings>[0], labelKey: MsgKey) => {
    setError(null);
    try {
      await shop.saveSettings(patch);
      // The key, not the rendered text: switching to Kannada would otherwise leave the
      // confirmation of that very switch sitting there in English.
      setSaved(labelKey);
      fadeAfter(2200, () => setSaved(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Run something once the shopkeeper stops typing.
   *
   * This section has no Save button -- each box saves itself -- and it used to do that on blur
   * alone. On Android tapping elsewhere does not take focus off a TextInput, so a shop name
   * typed and then left alone was never saved at all. Waiting for a pause in the typing needs no
   * blur and is not a request per keystroke either.
   */
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * The confirmations clear themselves, and the handles are kept so they can be cancelled.
   * Without that, saving twice quickly left two timers running and the first one wiped the
   * second's message early -- and either could fire after the screen had gone.
   */
  const fading = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fadeAfter = (ms: number, clear: () => void) => {
    fading.current.push(setTimeout(clear, ms));
  };
  useEffect(() => () => { for (const id of fading.current) clearTimeout(id); }, []);
  const afterTyping = useCallback((fn: () => void) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(fn, 900);
  }, []);
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  /*
   * Two ways into the same save, and they differ on purpose.
   *
   * `typing` is the pause after a keystroke: it saves what is valid and otherwise does nothing.
   * Clearing the box to retype must not put an error on screen and snap the old name back while
   * the shopkeeper is still mid-word. `left` is blur, where an invalid value is worth saying so
   * about, because the shopkeeper has finished.
   */
  const commitShopName = (next: string, typing: boolean) => {
    const checked = checkShopName(next);
    if (!checked.ok) {
      if (typing) return;
      setError(checked.error);
      setShopName(shop.settings.shopName);
      return;
    }
    setError(null);
    if (checked.value !== shop.settings.shopName) {
      void save({ shopName: checked.value }, 'set.savedShopName');
    }
  };

  const commitFooter = (next: string, typing: boolean) => {
    const checked = checkFooter(next);
    if (!checked.ok) {
      if (typing) return;
      setError(checked.error);
      setFooter(shop.settings.footer);
      return;
    }
    setError(null);
    if (checked.value !== shop.settings.footer) {
      void save({ footer: checked.value }, 'set.savedFooter');
    }
  };

  const commitShopNameKn = (next: string) => {
    const value = next.trim();
    if (value !== (shop.settings.shopNameKn ?? '')) {
      void save({ shopNameKn: value }, 'set.savedShopName');
    }
  };

  const commitFooterKn = (next: string) => {
    const value = next.trim();
    if (value !== (shop.settings.footerKn ?? '')) {
      void save({ footerKn: value }, 'set.savedFooter');
    }
  };

  /*
   * Erasing the book.
   *
   * `backedUp` is deliberately not remembered anywhere: it resets when the screen does, so the
   * backup has to be taken in the same sitting as the erase rather than once, months ago.
   */
  const [busy, setBusy] = useState<'backup' | 'erase' | null>(null);
  /*
   * This section's own failures, shown inside it.
   *
   * The page-wide error sits at the very top of a long screen. A refusal from a button at the
   * bottom appeared up there, out of sight, and read on the tablet as nothing happening at all.
   */
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [erased, setErased] = useState<'all' | 'bills' | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetWord, setResetWord] = useState('');

  const takeBackup = async () => {
    setDangerError(null);
    setBusy('backup');
    try {
      const data = await api.backup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const path = FileSystem.cacheDirectory + 'shridhar-backup-' + stamp + '.json';
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
      // Handed to the share sheet rather than left in the app's own cache, which Android clears
      // whenever it likes -- the point is a copy somewhere the shop still has it afterwards.
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: t('set.backup') });
      }
      setBackedUp(true);
    } catch (e) {
      setDangerError(t('set.backupFailed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  /** `keepCustomers` spares their names and numbers; the same password and word cover both. */
  const eraseEverything = async (keepCustomers = false) => {
    setDangerError(null);
    setBusy('erase');
    try {
      await api.eraseAll(resetPw, resetWord, keepCustomers);
      setResetPw('');
      setResetWord('');
      setBackedUp(false);
      // Not reload: the books are gone, so the device has to let go of them rather than fetch
      // them again. Parked bills hold customers of their own, and one of those got written back.
      await shop.forgetEverything();
      setErased(keepCustomers ? 'bills' : 'all');
      fadeAfter(8000, () => setErased(null));
    } catch (e) {
      // A 404 from the reset endpoint is not "missing": it is the server saying no reset password
      // has been set on it, which deserves that explanation rather than a bare "not found".
      const off = e instanceof ApiError && e.status === 404;
      setDangerError(off
        ? t('set.eraseOff')
        : t('set.eraseFailed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
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
          onChange={(next) => {
            setShopName(next);
            afterTyping(() => commitShopName(next, true));
          }}
          onCommit={(next) => {
            setShopName(next);
            commitShopName(next, false);
          }}
        />
        <ScriptField
          label={t('set.footer')}
          value={footer}
          onChange={(next) => {
            setFooter(next);
            afterTyping(() => commitFooter(next, true));
          }}
          onCommit={(next) => {
            setFooter(next);
            commitFooter(next, false);
          }}
        />
        {/* Boxes of their own, for a Kannada keypad. Shown and printed in place of the English
            ones whenever the shop is set to Kannada; left empty, the English ones stand. */}
        <Field
          label={t('set.shopNameKn')}
          value={shopNameKn}
          onChangeText={(next) => {
            setShopNameKn(next);
            afterTyping(() => commitShopNameKn(next));
          }}
          onBlur={() => commitShopNameKn(shopNameKn)}
        />
        <Field
          label={t('set.footerKn')}
          value={footerKn}
          onChangeText={(next) => {
            setFooterKn(next);
            afterTyping(() => commitFooterKn(next));
          }}
          onBlur={() => commitFooterKn(footerKn)}
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

        {/* Directly under the number it governs. A shop may hold a GST number and not want it
            on every slip. */}
        <View style={styles.switchRow}>
          <Switch
            value={shop.settings.showGstin !== false}
            onValueChange={(v) => void save({ showGstin: v }, 'set.savedGstinShown')}
            trackColor={{ true: C.accent, false: C.line }}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>{t('set.showGstin')}</Text>
            <Text style={styles.hint}>{t('set.showGstinHint')}</Text>
          </View>
        </View>

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
        {/* The two apart is the whole question when the tab bar sits off the bottom edge: `live`
            follows the window, including while a dialog is up, and `held` is what the layout is
            actually drawn against. Equal means the holding is not hiding anything. */}
        <Text style={styles.probe}>
          held top {edges.top} · bottom {edges.bottom}
        </Text>

        <View style={{ height: 10 }} />
        <Button label={t('set.signOut')} tone="plain" onPress={shop.signOut} />
        <View style={{ height: 8 }} />
        <Button label={t('set.changeServer')} tone="plain" onPress={() => setConfirmServer(true)} />
        <Text style={styles.hint}>{t('set.changeServerHint')}</Text>
      </Card>

      {/* Last on the screen, and the only part of it that destroys anything. */}
      <Card style={styles.dangerCard}>
        <SectionTitle>{t('set.dangerSection')}</SectionTitle>
        <Text style={styles.hint}>{t('set.dangerNote')}</Text>
        <View style={{ height: 10 }} />

        <Button
          label={busy === 'backup' ? t('set.backingUp') : t('set.backup')}
          tone="plain"
          disabled={busy !== null}
          onPress={() => void takeBackup()}
        />
        {backedUp ? <Notice>{t('set.backupSaved')}</Notice> : null}
        {erased ? <Notice>{erased === 'bills' ? t('set.erasedBills') : t('set.erased')}</Notice> : null}

        <View style={{ height: 10 }} />
        <Field
          label={t('set.erasePassword')}
          value={resetPw}
          secureTextEntry
          autoCapitalize="none"
          onChangeText={setResetPw}
        />
        <Field
          label={t('set.eraseConfirmLabel')}
          value={resetWord}
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setResetWord}
        />

        {/* Three things have to be true: the backup taken in this sitting, the password given,
            and the word typed exactly. */}
        <Button
          label={busy === 'erase' ? t('set.erasing') : t('set.eraseAll')}
          tone="danger"
          disabled={busy !== null || !backedUp || !resetPw || resetWord !== ERASE_WORD}
          onPress={() => void eraseEverything(false)}
        />

        {/* The same backup, password and word cover both; only what is spared differs. */}
        <View style={{ height: 8 }} />
        <Button
          label={busy === 'erase' ? t('set.erasing') : t('set.eraseBills')}
          tone="danger"
          disabled={busy !== null || !backedUp || !resetPw || resetWord !== ERASE_WORD}
          onPress={() => void eraseEverything(true)}
        />
        <Text style={styles.hint}>{t('set.eraseBillsHint')}</Text>
        {!backedUp ? <Text style={styles.hint}>{t('set.eraseNeedsBackup')}</Text> : null}
        {/* Under the button that caused it, which is where the eye already is. */}
        {dangerError ? <ErrorText>{dangerError}</ErrorText> : null}
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
  /* Marked, not hidden: someone looking for it should find it, and someone scrolling past
     should know to stop. */
  dangerCard: { marginBottom: 12, borderWidth: 1, borderColor: C.dangerEdge },
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
