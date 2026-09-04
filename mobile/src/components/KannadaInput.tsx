import { useState } from 'react';
import { View } from 'react-native';
import { latinToKannada } from '@shridhar/shared';
import { Button, Field } from './ui';
import { useShop } from '../lib/useShop';

/**
 * A field for regional-language names, with two ways in.
 *
 * The phone's own Kannada keyboard works directly. The "English letters" box is for phones that
 * have never had one added: type "akki" and ಅಕ್ಕಿ appears. The result stays editable, because no
 * transliteration scheme guesses every word and seeing it is the point.
 */
export function KannadaInput({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useShop();
  const [latin, setLatin] = useState('');
  const [open, setOpen] = useState(false);

  return (
    <View>
      <Field
        label={label}
        value={value}
        placeholder={placeholder}
        onChangeText={(next) => {
          // Typed straight in, so the English box no longer describes what is in the field.
          setLatin('');
          onChange(next);
        }}
      />
      {open ? (
        <View>
          <Field
            label={t('kni.aria')}
            value={latin}
            placeholder={t('kni.placeholder')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(next) => {
              setLatin(next);
              onChange(latinToKannada(next));
            }}
            hint={t('kni.hint')}
          />
          <Button label={t('kni.hide')} tone="plain" onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Button label={t('kni.open')} tone="plain" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}
