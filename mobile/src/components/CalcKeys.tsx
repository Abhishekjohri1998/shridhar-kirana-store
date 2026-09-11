import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShop } from '../lib/useShop';
import { C, R } from '../theme';

/**
 * The keys Android's number pad does not have.
 *
 * `decimal-pad` offers digits and a dot and nothing else, so a shopkeeper cannot type two kilos
 * at 44 as `44*2` however willing the app is to understand it. This is that half of the keyboard,
 * drawn by the app and sat directly under the box being typed into.
 *
 * Under the box, not floating above the keyboard: a strip positioned over the keyboard has to
 * guess the keyboard's height, and guessing heights on this tablet is what left the tab bar
 * stranded mid-screen for three attempts running.
 *
 * Nothing here takes focus. On Android a Pressable does not pull focus off a TextInput, so the
 * number pad stays up and the cursor stays where it was -- the same behaviour that once swallowed
 * an edit on the way to a Save button, working the right way round this time.
 */
export function CalcKeys({
  value, onChange, onDone,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The sum is finished: work it out and move on. */
  onDone: () => void;
}) {
  const t = useShop().t;

  const append = (op: string) => {
    const text = value.trimEnd();
    // An operator on an empty box would start a sum with nothing in front of it, and a second
    // operator is a slip rather than an intention -- take the newest one and move on.
    if (text === '') return;
    onChange(/[+\-×÷]$/.test(text) ? text.slice(0, -1) + op : text + op);
  };

  const keys: { label: string; hint: string; press: () => void }[] = [
    { label: '×', hint: t('bill.times'), press: () => append('×') },
    { label: '÷', hint: t('bill.divide'), press: () => append('÷') },
    { label: '+', hint: t('bill.plus'), press: () => append('+') },
    { label: '−', hint: t('bill.minus'), press: () => append('−') },
    { label: '⌫', hint: t('bill.erase'), press: () => onChange(value.slice(0, -1)) },
  ];

  return (
    <View style={styles.row}>
      {keys.map((k) => (
        <Pressable
          key={k.label}
          style={styles.key}
          accessibilityLabel={k.hint}
          onPress={k.press}
        >
          <Text style={styles.keyText}>{k.label}</Text>
        </Pressable>
      ))}
      <Pressable style={[styles.key, styles.done]} accessibilityLabel={t('bill.equals')} onPress={onDone}>
        <Text style={[styles.keyText, styles.doneText]}>✓</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginTop: 6 },
  key: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    backgroundColor: C.card,
  },
  /* Bigger than the label it sits under: these are aimed at with a thumb, mid-sale. */
  keyText: { fontSize: 20, color: C.ink },
  done: { borderColor: C.accentEdge, backgroundColor: C.accentWash },
  doneText: { color: C.accentDeep, fontWeight: '700' },
});
