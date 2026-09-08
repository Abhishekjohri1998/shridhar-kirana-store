import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInputProps } from 'react-native';
import { latinToKannada } from '@shridhar/shared';
import { Field } from './ui';
import { useShop } from '../lib/useShop';
import { C, R, SP, TYPE } from '../theme';

/**
 * A text field that can be typed in Kannada without a Kannada keyboard.
 *
 * The tablet may never have had Gboard's Kannada layout added, and switching keyboards mid-sale
 * is the thing the shop asked to avoid. So the ಕ button turns on the transliterator that has been
 * sitting in shared/ since the item catalogue: type `akki` and ಅಕ್ಕಿ comes out.
 *
 * The typing box always holds what was actually typed, and the Kannada is shown above it. That
 * way editing behaves like editing -- backspace, the cursor, selecting a word -- while the
 * Kannada is the line your eye lands on, and it is the line that gets saved. No scheme guesses
 * every word right, which is exactly why the letters that produced it stay visible and fixable
 * rather than being swallowed.
 */
export function ScriptField({
  label, value, onChange, onCommit, hint, ...props
}: {
  label: string;
  /** The stored value. Held as typed while the field has focus. */
  value: string;
  /**
   * Called on every keystroke with what should be saved -- the Kannada when the toggle is on.
   *
   * This used to be reported on blur alone, and on Android tapping a button does not take focus
   * off a TextInput: the shopkeeper edited a name, pressed Save, and the old name was sent,
   * because blur had never happened. So a form binds to this and is never out of date.
   */
  onChange: (value: string) => void;
  /** Called when the shopkeeper leaves the field, for a caller that saves per field. */
  onCommit?: (value: string) => void;
  hint?: string;
} & Omit<TextInputProps, 'value' | 'onChange' | 'onChangeText' | 'onBlur'>) {
  const t = useShop().t;
  const [typed, setTyped] = useState(value);
  const [kannada, setKannada] = useState(false);

  const shown = kannada ? latinToKannada(typed) : typed;

  const type = (next: string) => {
    setTyped(next);
    onChange(kannada ? latinToKannada(next) : next);
  };

  // Flipping the toggle changes what the same letters mean, so what is stored has to change with
  // it -- otherwise `akki` stays `akki` until the next keystroke.
  const toggle = () => {
    const next = !kannada;
    setKannada(next);
    onChange(next ? latinToKannada(typed) : typed);
  };

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Pressable
          style={[styles.toggle, kannada && styles.toggleOn]}
          onPress={toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: kannada }}
          accessibilityLabel={t('common.typeKannada')}
        >
          <Text style={[styles.toggleText, kannada && styles.toggleTextOn]}>ಕ</Text>
        </Pressable>
      </View>

      {/* The Kannada, above the box that produced it. */}
      {kannada && typed.trim() ? <Text style={styles.preview}>{shown}</Text> : null}

      <Field
        {...props}
        label=""
        value={typed}
        onChangeText={type}
        onBlur={() => onCommit?.(shown)}
        hint={kannada && typed.trim() ? t('common.typed') + ': ' + typed : hint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  label: { ...TYPE.label },
  toggle: {
    minWidth: 34,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  toggleOn: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  toggleText: { fontSize: 15, color: C.faint, fontWeight: '700' },
  toggleTextOn: { color: C.accentDeep },
  /* Bigger than the box beneath it: this is the line that goes on the paper. */
  preview: { fontSize: 19, color: C.ink, marginBottom: SP.xs },
});
