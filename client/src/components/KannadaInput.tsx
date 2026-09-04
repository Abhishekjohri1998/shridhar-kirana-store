import { useState } from 'react';
import { latinToKannada } from '@shridhar/shared';
import { useShop } from '../lib/useShop';

/**
 * A text field for regional-language item names, with two ways in.
 *
 * The device keyboard works directly, so a tablet with Gboard's Kannada layout needs nothing else.
 * The "English letters" box is for the ones that do not have it: type "akki" and ಅಕ್ಕಿ appears.
 * The result is shown as it is built and stays editable, because no transliteration scheme guesses
 * every word and being able to see and fix it is the point.
 */
export function KannadaInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useShop();
  const [latin, setLatin] = useState('');
  const [helperOpen, setHelperOpen] = useState(false);

  const onLatin = (next: string) => {
    setLatin(next);
    onChange(latinToKannada(next));
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          // Typed straight in, so the English box no longer describes what is in the field.
          setLatin('');
          onChange(e.target.value);
        }}
        // Hints an Indic keyboard where the device offers one.
        lang="kn"
        inputMode="text"
      />

      {helperOpen ? (
        <div className="kn-helper">
          <input
            className="input"
            value={latin}
            onChange={(e) => onLatin(e.target.value)}
            placeholder={t('kni.placeholder')}
            aria-label={t('kni.aria')}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="muted small" style={{ margin: '6px 0 0' }}>{t('kni.hint')}</p>
          <button type="button" className="btn plain slim" style={{ marginTop: 8 }} onClick={() => setHelperOpen(false)}>
            {t('kni.hide')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn plain slim" style={{ marginTop: 6 }} onClick={() => setHelperOpen(true)}>
          {t('kni.open')}
        </button>
      )}
    </div>
  );
}
