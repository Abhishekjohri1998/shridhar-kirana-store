import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShop } from '../lib/useShop';
import { C, R } from '../theme';

/**
 * The keypad a price is typed on, laid out the way the shop drew it.
 *
 *     ⌫  ÷  ×  −
 *     7  8  9  +
 *     4  5  6
 *     1  2  3  ↵
 *     0     .
 *
 * Digits in a calculator's order rather than a phone's, `+` and `↵` two rows tall, `0` two
 * columns wide. Android's own number pad has no multiply or divide, so this replaces it outright
 * -- the fields ask for that with `showSoftInputOnFocus={false}` -- rather than sitting under it
 * as a second keyboard, which is what the first attempt did and what the shop objected to.
 *
 * It sits inline under the field. Guessing a keyboard's height is what left the tab bar stranded
 * mid-screen for three attempts, and there is no longer a keyboard whose height there would be
 * to guess.
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

  const back = () => onChange(value.slice(0, -1));

  const key = (label: string, press: () => void, hint?: string, kind?: 'op' | 'go') => (
    <Pressable
      key={label}
      style={[styles.key, kind === 'op' && styles.opKey, kind === 'go' && styles.goKey]}
      accessibilityLabel={hint ?? label}
      onPress={press}
    >
      <Text style={[styles.keyText, kind === 'op' && styles.opText, kind === 'go' && styles.goText]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.pad}>
      {/* Digits on the left, operators down the right. The two columns are laid out separately
          so the tall keys can span rows without a grid library: five rows of one unit on the
          left, and 1 + 2 + 2 on the right, which comes to the same height at any width. */}
      <View style={styles.digits}>
        <View style={styles.row}>
          {key('⌫', back, t('bill.erase'))}
          {key('÷', () => operator('÷'), t('bill.divide'), 'op')}
          {key('×', () => operator('×'), t('bill.times'), 'op')}
        </View>
        <View style={styles.row}>
          {key('7', () => digit('7'))}
          {key('8', () => digit('8'))}
          {key('9', () => digit('9'))}
        </View>
        <View style={styles.row}>
          {key('4', () => digit('4'))}
          {key('5', () => digit('5'))}
          {key('6', () => digit('6'))}
        </View>
        <View style={styles.row}>
          {key('1', () => digit('1'))}
          {key('2', () => digit('2'))}
          {key('3', () => digit('3'))}
        </View>
        <View style={styles.row}>
          {/* Two columns wide, the way it is on every calculator. */}
          <Pressable style={[styles.key, styles.wide]} accessibilityLabel="0" onPress={() => digit('0')}>
            <Text style={styles.keyText}>0</Text>
          </Pressable>
          {key('.', () => digit('.'))}
        </View>
      </View>

      <View style={styles.side}>
        <View style={styles.oneRow}>{key('−', () => operator('−'), t('bill.minus'), 'op')}</View>
        <View style={styles.twoRows}>{key('+', () => operator('+'), t('bill.plus'), 'op')}</View>
        <View style={styles.twoRows}>{key('↵', onDone, t('bill.equals'), 'go')}</View>
      </View>
    </View>
  );
}

const GAP = 6;

const styles = StyleSheet.create({
  pad: { flexDirection: 'row', gap: GAP, marginTop: 8 },
  digits: { flex: 3, gap: GAP },
  side: { flex: 1, gap: GAP },
  row: { flexDirection: 'row', gap: GAP, flex: 1 },
  /* One row and two rows tall. The gap between the rows it spans belongs to it as well, which is
     what keeps the two columns level rather than a gap out by a few pixels down the page. */
  oneRow: { flex: 1 },
  twoRows: { flex: 2 },
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
  wide: { flex: 2 },
  keyText: { fontSize: 22, color: C.ink },
  /* The operators are the reason this keypad exists, so they are the part that reads first. */
  opKey: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  opText: { color: C.accentDeep, fontWeight: '700' },
  goKey: { borderColor: C.accent, backgroundColor: C.accent },
  goText: { color: C.accentInk, fontWeight: '700' },
});
