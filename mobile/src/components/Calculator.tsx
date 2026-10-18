import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { calcBus, evaluateCalc, money } from '@shridhar/shared';
import { useShop } from '../lib/useShop';
import { C, R, shadow } from '../theme';

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '%', '+', '(', ')'];

/**
 * The 🧮 in the billing header and its pop-up (build 71). Same parser as the web (evaluateCalc,
 * no eval); "Put in box" sends the answer to the price or qty box last focused on the bill. F10
 * opens it too. The card sits under the header and never runs off the screen.
 */
export function Calculator() {
  const t = useShop().t;
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [sum, setSum] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => calcBus.onOpen(() => setOpen(true)), []);

  const value = evaluateCalc(sum);
  const put = () => {
    if (value == null) return;
    if (calcBus.put(value)) { setOpen(false); setNote(null); setSum(''); }
    else setNote(t('calc.noBox'));
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={styles.chip}
        accessibilityRole="button"
        accessibilityLabel={t('calc.open')}
      >
        <Text style={styles.chipText}>🧮</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel={t('calc.close')}>
          <Pressable
            style={[styles.card, { width: Math.min(340, width - 32), maxHeight: height - 80 }]}
            onPress={() => undefined}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.head}>
                <Text style={styles.title}>{t('calc.title')}</Text>
                <Pressable style={styles.chip} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('calc.close')}>
                  <Text style={styles.chipText}>×</Text>
                </Pressable>
              </View>
              <TextInput
                style={styles.box}
                value={sum}
                // The keys below do the typing; a hardware keyboard still types straight in.
                showSoftInputOnFocus={false}
                autoFocus
                accessibilityLabel={t('calc.title')}
                onChangeText={(s) => { setSum(s); setNote(null); }}
                onSubmitEditing={put}
              />
              <Text style={styles.answer}>{value != null ? '= ' + money(value) : ' '}</Text>
              <View style={styles.keys}>
                {KEYS.map((k) => (
                  <Pressable key={k} style={styles.key} onPress={() => setSum((s) => s + k)} accessibilityRole="button">
                    <Text style={styles.chipText}>{k}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.key} onPress={() => setSum((s) => s.slice(0, -1))} accessibilityRole="button">
                  <Text style={styles.chipText}>{t('calc.back')}</Text>
                </Pressable>
                <Pressable style={styles.key} onPress={() => setSum('')} accessibilityRole="button">
                  <Text style={styles.chipText}>{t('calc.clear')}</Text>
                </Pressable>
              </View>
              {note ? <Text style={styles.note}>{note}</Text> : null}
              <Pressable
                style={[styles.put, value == null && { opacity: 0.5 }]}
                disabled={value == null}
                onPress={put}
                accessibilityRole="button"
              >
                <Text style={styles.putText}>{t('calc.put')}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'flex-end', paddingTop: 60, paddingHorizontal: 16 },
  card: {
    backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: 14, ...shadow(3),
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 16, fontWeight: '700', color: C.ink },
  box: {
    borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 18, color: C.ink, textAlign: 'right',
  },
  answer: { fontSize: 17, fontWeight: '700', color: C.ink, textAlign: 'right', marginVertical: 6 },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  key: {
    width: '23%', alignItems: 'center', borderWidth: 1, borderColor: C.accentEdge, backgroundColor: C.accentWash,
    borderRadius: R.pill, paddingVertical: 10,
  },
  chip: {
    borderWidth: 1, borderColor: C.accentEdge, backgroundColor: C.accentWash,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  chipText: { fontSize: 15, fontWeight: '700', color: C.accentDeep },
  note: { fontSize: 12, color: C.soft, marginTop: 6 },
  put: { marginTop: 10, backgroundColor: C.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  putText: { color: C.accentInk, fontWeight: '700', fontSize: 16 },
});
