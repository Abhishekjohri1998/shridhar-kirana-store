import { useCallback, useEffect, useRef, useState } from 'react';
import {
  checkFooter,
  checkGstin,
  ERASE_WORD,
  checkShopName,
  LANGS,
  PAPER_KEYS,
  paperProfile,
  PAPERS,
  parseQuietDays,
  type Bill,
  type Lang,
  type PaperKey,
} from '@shridhar/shared';
import { ScriptField } from '../components/ScriptField';
import { ApiError, api } from '../lib/api';
import { SERIAL_BAUD_RATES } from '../print';
import { usePrint } from '../lib/usePrint';
import { useShop } from '../lib/useShop';

/** Reproduces the four lines from the shop's paper slip, so a test print checks the whole chain --
 *  Kannada shaping, column alignment and the total -- against a known answer: 1370. */
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

export function SettingsPage() {
  const shop = useShop();
  const t = shop.t;
  const printer = usePrint();
  const [shopName, setShopName] = useState(shop.settings.shopName);
  const [footer, setFooter] = useState(shop.settings.footer);
  const [gstin, setGstin] = useState(shop.settings.gstin ?? '');
  const [shopNameKn, setShopNameKn] = useState(shop.settings.shopNameKn ?? '');
  const [footerKn, setFooterKn] = useState(shop.settings.footerKn ?? '');
  const [inactiveDays, setInactiveDays] = useState(String(shop.settings.inactiveAfterDays));
  const [error, setError] = useState<string | null>(null);
  // The key, not the rendered text: switching to Kannada would otherwise leave the
  // confirmation of that very switch sitting there in English.
  const [saved, setSaved] = useState<Parameters<typeof t>[0] | null>(null);

  // Settings can arrive after this page first renders (the initial load, or another device's edit).
  useEffect(() => {
    setShopName(shop.settings.shopName);
    setFooter(shop.settings.footer);
    setGstin(shop.settings.gstin ?? '');
    setShopNameKn(shop.settings.shopNameKn ?? '');
    setFooterKn(shop.settings.footerKn ?? '');
    setInactiveDays(String(shop.settings.inactiveAfterDays));
  }, [
    shop.settings.shopName, shop.settings.footer, shop.settings.gstin,
    shop.settings.shopNameKn, shop.settings.footerKn, shop.settings.inactiveAfterDays,
  ]);

  const save = async (patch: Parameters<typeof shop.saveSettings>[0], labelKey: Parameters<typeof t>[0]) => {
    setError(null);
    try {
      await shop.saveSettings(patch);
      setSaved(labelKey);
      window.setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Run something once the shopkeeper stops typing.
   *
   * This section has no Save button -- each box saves itself. Blur alone was enough in a browser
   * but not on the tablet, where tapping elsewhere leaves the field focused, so both apps now
   * save on a pause in the typing as well and behave the same way.
   */
  const pending = useRef<number | null>(null);
  const afterTyping = useCallback((fn: () => void) => {
    if (pending.current) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(fn, 900);
  }, []);
  useEffect(() => () => {
    if (pending.current) window.clearTimeout(pending.current);
  }, []);

  /*
   * Two ways into the same save, and they differ on purpose. `typing` is the pause after a
   * keystroke: it saves what is valid and otherwise does nothing, because clearing the box to
   * retype must not put an error on screen and snap the old name back mid-word. Blur is where an
   * invalid value is worth saying so about.
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
   * `backedUp` is deliberately not remembered anywhere: it resets when the page does, so the
   * backup has to be taken in the same sitting as the erase rather than once, months ago.
   */
  const [busy, setBusy] = useState<'backup' | 'erase' | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  /* Its own message rather than the shared "… saved." one, which would read "the book starts
     again at bill 1. saved." */
  const [erased, setErased] = useState(false);
  const [resetPw, setResetPw] = useState('');
  const [resetWord, setResetWord] = useState('');

  const takeBackup = async () => {
    setError(null);
    setBusy('backup');
    try {
      const data = await api.backup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'shridhar-backup-' + stamp + '.json';
      a.click();
      URL.revokeObjectURL(url);
      setBackedUp(true);
    } catch (e) {
      setError(t('set.backupFailed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  const eraseEverything = async () => {
    setError(null);
    setBusy('erase');
    try {
      await api.eraseAll(resetPw, resetWord);
      setResetPw('');
      setResetWord('');
      setBackedUp(false);
      await shop.reload();
      setErased(true);
      window.setTimeout(() => setErased(false), 8000);
    } catch (e) {
      // A 404 from the reset endpoint is not "missing": it is the server saying no reset password
      // has been set on it, which deserves that explanation rather than a bare "not found".
      const off = e instanceof ApiError && e.status === 404;
      setError(off
        ? t('set.eraseOff')
        : t('set.eraseFailed') + ': ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  /** Surfaces a thrown message instead of losing it, for the connect and print buttons. */
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
    <div className="page stack">
      {error ? <p className="error" role="alert">{error}</p> : null}
      {saved ? <p className="notice" role="status">{t('set.saved', { what: t(saved) })}</p> : null}

      <section className="card stack">
        <h2 className="section-title">{t('set.slipSection')}</h2>
        <ScriptField
          id="s-name"
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
          id="s-footer"
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
        <div className="field">
          <label htmlFor="s-name-kn">{t('set.shopNameKn')}</label>
          <input
            id="s-name-kn"
            className="input"
            value={shopNameKn}
            onChange={(e) => {
              const next = e.target.value;
              setShopNameKn(next);
              afterTyping(() => commitShopNameKn(next));
            }}
            onBlur={() => commitShopNameKn(shopNameKn)}
          />
        </div>
        <div className="field">
          <label htmlFor="s-footer-kn">{t('set.footerKn')}</label>
          <input
            id="s-footer-kn"
            className="input"
            value={footerKn}
            onChange={(e) => {
              const next = e.target.value;
              setFooterKn(next);
              afterTyping(() => commitFooterKn(next));
            }}
            onBlur={() => commitFooterKn(footerKn)}
          />
        </div>

        {/* Not a ScriptField: a GST number is fifteen Latin characters by definition. */}
        <div className="field">
          <label htmlFor="s-gstin">{t('set.gstin')}</label>
          <input
            id="s-gstin"
            className="input"
            value={gstin}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setGstin(e.target.value)}
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
          <p className="muted small">{checkGstin(gstin).warning ?? t('set.gstinHint')}</p>
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={shop.settings.showRate}
            onChange={(e) => void save({ showRate: e.target.checked }, 'set.savedRate')}
            style={{ width: 20, height: 20 }}
          />
          <span className="grow">
            <span style={{ display: 'block' }}>{t('set.showRate')}</span>
            <span className="muted small">{t('set.showRateHint')}</span>
          </span>
        </label>
      </section>

      <section className="card stack">
        <h2 className="section-title">{t('set.languageSection')}</h2>
        <div className="field">
          <label htmlFor="s-lang">{t('set.language')}</label>
          <select
            id="s-lang"
            className="input"
            value={shop.settings.language}
            onChange={(e) => void save({ language: e.target.value as Lang }, 'set.savedLanguage')}
          >
            {LANGS.map((code) => (
              <option key={code} value={code}>
                {code === 'kn' ? t('set.langKn') : t('set.langEn')}
              </option>
            ))}
          </select>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('set.languageNote')}</p>
      </section>

      <section className="card stack">
        <h2 className="section-title">{t('set.paperSection')}</h2>
        <div className="field">
          <label htmlFor="s-paper">{t('set.rollWidth')}</label>
          <select
            id="s-paper"
            className="input"
            value={shop.settings.paper}
            onChange={(e) => void save({ paper: e.target.value as PaperKey }, 'set.savedPaper')}
          >
            {PAPER_KEYS.map((key) => (
              <option key={key} value={key}>{PAPERS[key].label}</option>
            ))}
          </select>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {t('set.paperNote', { mm: paper.printableMm, dots: paper.dots })}
        </p>
      </section>

      <section className="card stack">
        <h2 className="section-title">{t('set.customersSection')}</h2>
        <div className="field">
          <label htmlFor="s-inactive">{t('set.quietDays')}</label>
          <input
            id="s-inactive"
            className="input"
            inputMode="numeric"
            value={inactiveDays}
            onChange={(e) => setInactiveDays(e.target.value)}
            onBlur={() => {
              const parsed = parseQuietDays(inactiveDays);
              if (!parsed.ok) {
                setError(parsed.error);
                setInactiveDays(String(shop.settings.inactiveAfterDays));
                return;
              }
              setError(null);
              if (parsed.value !== shop.settings.inactiveAfterDays) {
                void save({ inactiveAfterDays: parsed.value }, 'set.savedQuiet');
              }
            }}
          />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {t('set.quietNote')}
        </p>
      </section>

      <section className="card stack">
        <h2 className="section-title">{t('set.printerSection')}</h2>

        <div className="stack">
          <label className="row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="printMode"
              checked={printer.mode === 'system'}
              onChange={() => printer.setMode('system')}
              style={{ width: 18, height: 18, marginTop: 3 }}
            />
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{t('set.modeSystem')}</span>
              <span className="muted small">{t('set.modeSystemHint')}</span>
            </span>
          </label>

          <label className="row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="printMode"
              checked={printer.mode === 'serial'}
              onChange={() => printer.setMode('serial')}
              disabled={!printer.serialAvailable}
              style={{ width: 18, height: 18, marginTop: 3 }}
            />
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{t('set.modeSerial')}</span>
              <span className="muted small">
                {printer.serialAvailable ? t('set.modeSerialHint') : t('set.modeSerialUnavailable')}
              </span>
            </span>
          </label>

          <label className="row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="printMode"
              checked={printer.mode === 'bluetooth'}
              onChange={() => printer.setMode('bluetooth')}
              disabled={!printer.bluetoothAvailable}
              style={{ width: 18, height: 18, marginTop: 3 }}
            />
            <span className="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{t('set.modeBle')}</span>
              <span className="muted small">
                {printer.bluetoothAvailable ? t('set.modeBleHint') : t('set.modeBleUnavailable')}
              </span>
            </span>
          </label>
        </div>

        {printer.mode === 'serial' ? (
          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              {printer.serialPrinter ? t('set.portConnected', { name: printer.serialPrinter }) : t('set.portNone')}
            </p>
            <div className="field">
              <label htmlFor="s-baud">{t('set.baud')}</label>
              <select
                id="s-baud"
                className="input"
                value={printer.baudRate}
                onChange={(e) => printer.setBaudRate(Number(e.target.value))}
              >
                {SERIAL_BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>{rate}</option>
                ))}
              </select>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {t('set.baudNote')}
            </p>
            <button className="btn plain" onClick={() => void guard(printer.connectSerial)}>
              {printer.serialPrinter ? t('set.chooseOtherPort') : t('set.choosePort')}
            </button>
          </div>
        ) : null}

        {printer.mode === 'bluetooth' ? (
          <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              {printer.bluetoothPrinter ? t('set.portConnected', { name: printer.bluetoothPrinter }) : t('set.printerNone')}
            </p>
            <button className="btn plain" onClick={() => void guard(printer.connectBluetooth)}>
              {printer.bluetoothPrinter ? t('set.connectOther') : t('set.connectPrinter')}
            </button>
          </div>
        ) : null}

        <button
          className="btn"
          onClick={() => void guard(() => printer.printBill({ ...TEST_BILL, at: new Date().toISOString() }, shop.settings))}
          disabled={printer.busy}
        >
          {printer.busy ? t('bill.printing') : t('set.testPrint')}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          {t('set.testPrintNote')}
        </p>
      </section>

      <section className="card stack">
        <h2 className="section-title">{t('set.deviceSection')}</h2>
        <button className="btn plain" onClick={shop.signOut}>{t('set.signOut')}</button>
      </section>

      {/* Last on the page, and the only section that destroys anything. */}
      <section className="card stack danger-zone">
        <h2 className="section-title">{t('set.dangerSection')}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t('set.dangerNote')}</p>

        <button className="btn plain" disabled={busy !== null} onClick={() => void takeBackup()}>
          {busy === 'backup' ? t('set.backingUp') : t('set.backup')}
        </button>
        {backedUp ? <p className="notice" role="status">{t('set.backupSaved')}</p> : null}
        {erased ? <p className="notice" role="status">{t('set.erased')}</p> : null}

        <div className="field">
          <label htmlFor="s-reset-pw">{t('set.erasePassword')}</label>
          <input
            id="s-reset-pw"
            className="input"
            type="password"
            autoComplete="off"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="s-reset-word">{t('set.eraseConfirmLabel')}</label>
          <input
            id="s-reset-word"
            className="input"
            autoComplete="off"
            value={resetWord}
            onChange={(e) => setResetWord(e.target.value)}
          />
        </div>

        {/*
         * Three things have to be true, and the button says which one is missing rather than
         * sitting there greyed out with no explanation: the backup taken, the password given,
         * and the word typed exactly.
         */}
        <button
          className="btn danger"
          disabled={busy !== null || !backedUp || !resetPw || resetWord !== ERASE_WORD}
          onClick={() => void eraseEverything()}
        >
          {busy === 'erase' ? t('set.erasing') : t('set.eraseAll')}
        </button>
        {!backedUp ? <p className="muted small" style={{ margin: 0 }}>{t('set.eraseNeedsBackup')}</p> : null}
      </section>
    </div>
  );
}
