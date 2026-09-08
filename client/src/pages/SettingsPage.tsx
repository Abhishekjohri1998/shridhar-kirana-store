import { useEffect, useState } from 'react';
import {
  checkFooter,
  checkGstin,
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
          id="s-footer"
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

        {/* Boxes of their own, for a Kannada keypad. Shown and printed in place of the English
            ones whenever the shop is set to Kannada; left empty, the English ones stand. */}
        <div className="field">
          <label htmlFor="s-name-kn">{t('set.shopNameKn')}</label>
          <input
            id="s-name-kn"
            className="input"
            value={shopNameKn}
            onChange={(e) => setShopNameKn(e.target.value)}
            onBlur={() => {
              const next = shopNameKn.trim();
              setShopNameKn(next);
              if (next !== (shop.settings.shopNameKn ?? '')) {
                void save({ shopNameKn: next }, 'set.savedShopName');
              }
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="s-footer-kn">{t('set.footerKn')}</label>
          <input
            id="s-footer-kn"
            className="input"
            value={footerKn}
            onChange={(e) => setFooterKn(e.target.value)}
            onBlur={() => {
              const next = footerKn.trim();
              setFooterKn(next);
              if (next !== (shop.settings.footerKn ?? '')) {
                void save({ footerKn: next }, 'set.savedFooter');
              }
            }}
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
    </div>
  );
}
