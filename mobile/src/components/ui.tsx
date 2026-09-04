import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { C } from '../theme';

export function Button({
  label, onPress, tone = 'primary', disabled, style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = tone === 'primary' ? C.accent : tone === 'danger' ? C.danger : C.card;
  const fg = tone === 'plain' ? C.ink : C.accentInk;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, borderWidth: tone === 'plain' ? 1 : 0 },
        style,
      ]}
    >
      <Text style={[styles.btnLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} style={[styles.input, props.style]} placeholderTextColor={C.soft} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={styles.error}>{children}</Text>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <Text style={styles.notice}>{children}</Text>;
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: C.line,
  },
  btnLabel: { fontSize: 16, fontWeight: '700' },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, color: C.soft, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    color: C.ink,
    minHeight: 48,
  },
  hint: { fontSize: 12, color: C.soft, marginTop: 4, lineHeight: 17 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 14 },
  section: { fontSize: 13, fontWeight: '700', color: C.soft, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' },
  error: {
    backgroundColor: '#fdecea', borderWidth: 1, borderColor: '#f0b8b0', color: C.danger,
    borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 10, lineHeight: 19,
  },
  notice: {
    backgroundColor: C.accentWash, borderWidth: 1, borderColor: '#bfdfd2', color: C.ink,
    borderRadius: 10, padding: 10, fontSize: 13, marginBottom: 10, lineHeight: 19,
  },
});
