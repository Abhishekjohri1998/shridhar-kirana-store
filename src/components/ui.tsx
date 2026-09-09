import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { C } from '../theme';

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  style?: object;
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

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} style={[styles.input, props.style]} placeholderTextColor={C.soft} />
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 14,
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
  },
  section: { fontSize: 13, fontWeight: '700', color: C.soft, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' },
});
