import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';

export function Dialog({
  visible, title, onClose, children, footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 12 },
  body: { flexGrow: 0 },
  footer: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
