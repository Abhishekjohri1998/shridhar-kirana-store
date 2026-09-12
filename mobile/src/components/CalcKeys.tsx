import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShop } from '../lib/useShop';
import { C, R } from '../theme';

/**
 * The keypad a price is typed on.
 *
 * Android's own number pad has no multiply or divide, so the first version of this put a row of
 * operator keys under it -- which meant two keyboards stacked up the screen, one of them the
 * shop's and one of them Android's. This is the whole thing instead: digits and operators in one
 * block, and the system keyboard never opens for a price at all (the fields ask for that with
 * `showSoftInputOnFocus={false}`).
 *
 * It sits inline under the field rather than floating where the keyboard used to be. Guessing a
 * keyboard's height is what left the tab bar stranded mid-screen for three attempts, and there
 * is no longer a keyboard whose height there would be to guess.
 *
 * Nothing here takes focus: on Android a Pressable does not pull focus off a TextInput, so the
 * caret stays where it was between taps.
 */
export function CalcKeys({
  value, onChange, onDone,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The number is finished: work out the sum and move on. */
  onDone: () => void;
}) {
  const t = useShop().t;

  const digit = (d: string) => {
    // One decimal point per number, so `12..5` cannot be typed at all.
    if (d === '.' && /\.[0-9]*$/.test(value.split(/[+\-×÷]/).pop() ?? '')) return;
    onChange(value + d);
  };

  const operator = (op: string) => {
    const text = value.trimEnd();
    // An operator needs something in front of it, and a second one is a slip rather than an
    // intention -- take the newest and move on.
    if (text === '') return;
    onChange(/[+\-×÷]$/.test(text) ? text.slice(0, -1) + op : text + op);
  };

  /** Four across, because that is what fits a price box's width without shrinking the digits. */
  const rows: { label: string; hint?: string; press: () => void }[][] = [
    [
      { label: '7', press: () => digit('7') },
      { label: '8', press: () => digit('8') },
      { label: '9', press: () => digit('9') },
      { label: '×', hint: t('bill.times'), press: () => operator('×') },
    ],
    [
      { label: '4', press: () => digit('4') },
      { label: '5', press: () => digit('5') },
      { label: '6', press: () => digit('6') },
      { label: '÷', hint: t('bill.divide'), press: () => operator('÷') },
    ],
    [
      { label: '1', press: () => digit('1') },
      { label: '2', press: () => digit('2') },
      { label: '3', press: () => digit('3') },
      { label: '−', hint: t('bill.minus'), press: () => operator('−') },
    ],
    [
      { label: '.', press: () => digit('.') },
      { label: '0', press: () => digit('0') },
      { label: '⌫', hint: t('bill.erase'), press: () => onChange(value.slice(0, -1)) },
      { label: '+', hint: t('bill.plus'), press: () => operator('+') },
    ],
  ];

  return (
    <View style={styles.pad}>
      {rows.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((k) => {
            const isOperator = k.hint != null && k.label !== '⌫';
            return (
              <Pressable
                key={k.label}
                style={[styles.key, isOperator && styles.operator]}
                accessibilityLabel={k.hint ?? k.label}
                onPress={k.press}
              >
                <Text style={[styles.keyText, isOperator && styles.operatorText]}>{k.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      {/* Across the whole width: it is the key pressed on every single line. */}
      <Pressable style={styles.done} accessibilityLabel={t('bill.equals')} onPress={onDone}>
        <Text style={styles.doneText}>✓</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { gap: 6, marginTop: 8 },
  row: { flexDirection: 'row', gap: 6 },
  key: {
    flex: 1,
    /* A thumb at a counter, not a mouse. */
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    backgroundColor: C.card,
  },
  keyText: { fontSize: 22, color: C.ink },
  /* The operators are the reason this keypad exists, so they are the column that reads first. */
  operator: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  operatorText: { color: C.accentDeep, fontWeight: '700' },
  done: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.sm,
    backgroundColor: C.accent,
  },
  doneText: { fontSize: 22, color: C.accentInk, fontWeight: '700' },
});
