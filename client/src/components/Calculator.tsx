import { useEffect, useState } from 'react';
import { calcBus, evaluateCalc, money } from '@shridhar/shared';
import { useShop } from '../lib/useShop';

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '%', '+', '(', ')'];

/**
 * The 🧮 in the top bar and its pop-up (build 71). The sum is worked out by evaluateCalc -- no
 * eval -- and "Put in box" sends the answer to the price or qty box last focused on the bill.
 * F10 opens it too (calcBus.open). The pop-up sits under the top bar, inside the window.
 */
export function Calculator() {
  const t = useShop().t;
  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => calcBus.onOpen(() => setOpen(true)), []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const value = evaluateCalc(sum);
  const put = () => {
    if (value == null) return;
    if (calcBus.put(value)) { setOpen(false); setNote(null); setSum(''); }
    else setNote(t('calc.noBox'));
  };

  return (
    <>
      <button
        type="button"
        className="pay-all"
        style={{ alignSelf: 'center', padding: '6px 10px' }}
        title={t('calc.open') + ' (F10)'}
        aria-label={t('calc.open')}
        aria-expanded={open}
        // Keeps the bill box focused, so it stays the one the answer goes into.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        🧮
      </button>
      {open ? (
        <div className="calc-pop" role="dialog" aria-label={t('calc.title')}>
          <div className="calc-head">
            <strong>{t('calc.title')}</strong>
            <button type="button" className="pay-all" aria-label={t('calc.close')} onClick={() => setOpen(false)}>×</button>
          </div>
          <input
            className="input"
            autoFocus
            inputMode="decimal"
            value={sum}
            aria-label={t('calc.title')}
            onChange={(e) => { setSum(e.target.value); setNote(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); put(); } }}
          />
          <p className="calc-answer">{value != null ? '= ' + money(value) : ' '}</p>
          <div className="calc-keys">
            {KEYS.map((k) => (
              <button key={k} type="button" className="pay-all" onClick={() => setSum((s) => s + k)}>{k}</button>
            ))}
            <button type="button" className="pay-all" onClick={() => setSum((s) => s.slice(0, -1))}>{t('calc.back')}</button>
            <button type="button" className="pay-all" onClick={() => setSum('')}>{t('calc.clear')}</button>
          </div>
          {note ? <p className="small muted" role="status">{note}</p> : null}
          <button type="button" className="btn" style={{ width: '100%' }} disabled={value == null} onClick={put}>
            {t('calc.put')}
          </button>
        </div>
      ) : null}
    </>
  );
}
