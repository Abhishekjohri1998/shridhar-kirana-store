import { useState, type InputHTMLAttributes } from 'react';
import { latinToKannada } from '@shridhar/shared';
import { useShop } from '../lib/useShop';

/**
 * A text field that can be typed in Kannada without a Kannada keyboard.
 *
 * The counter PC may have no Kannada layout at all, and on the tablet switching keyboards
 * mid-sale is the thing the shop asked to avoid. So the ಕ button turns on the transliterator
 * that has been sitting in shared/ since the item catalogue: type `akki` and ಅಕ್ಕಿ comes out.
 *
 * The typing box always holds what was actually typed, and the Kannada is shown above it. That
 * way editing behaves like editing -- backspace, the cursor, selecting a word -- while the
 * Kannada is the line your eye lands on, and it is the line that gets saved. No scheme guesses
 * every word right, which is exactly why the letters that produced it stay visible and fixable
 * rather than being swallowed.
 */
export function ScriptField({
  id, label, value, onChange, onCommit, hint, ...props
}: {
  id: string;
  label: string;
  /** The stored value. Held as typed while the field has focus. */
  value: string;
  /**
   * Called on every keystroke with what should be saved -- the Kannada when the toggle is on.
   *
   * Reported per keystroke rather than on blur, which is what the phone needs: there, tapping a
   * button leaves the field focused, so a form that waited for blur saved the old value. Both
   * apps behave the same way for the same reason.
   */
  onChange: (value: string) => void;
  /** Called when the shopkeeper leaves the field, for a caller that saves per field. */
  onCommit?: (value: string) => void;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'onBlur'>) {
  const t = useShop().t;
  const [typed, setTyped] = useState(value);
  const [kannada, setKannada] = useState(false);

  const shown = kannada ? latinToKannada(typed) : typed;

  const type = (next: string) => {
    setTyped(next);
    onChange(kannada ? latinToKannada(next) : next);
  };

  // Flipping the toggle changes what the same letters mean, so what is stored changes with it.
  const toggle = () => {
    const next = !kannada;
    setKannada(next);
    onChange(next ? latinToKannada(typed) : typed);
  };
  const showPreview = kannada && typed.trim().length > 0;

  return (
    <div className="field">
      <div className="script-head">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className={'script-toggle' + (kannada ? ' on' : '')}
          onClick={toggle}
          aria-pressed={kannada}
          title={t('common.typeKannada')}
          aria-label={t('common.typeKannada')}
        >
          ಕ
        </button>
      </div>

      {/* The Kannada, above the box that produced it. */}
      {showPreview ? <p className="script-preview">{shown}</p> : null}

      <input
        {...props}
        id={id}
        className={'input ' + (props.className ?? '')}
        value={typed}
        onChange={(e) => type(e.target.value)}
        onBlur={() => onCommit?.(shown)}
      />

      {showPreview ? (
        <p className="muted small">{t('common.typed')}: {typed}</p>
      ) : hint ? (
        <p className="muted small">{hint}</p>
      ) : null}
    </div>
  );
}
