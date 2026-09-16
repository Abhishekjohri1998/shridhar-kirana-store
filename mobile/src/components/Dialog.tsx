import { useEffect, type ReactNode } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { enterModal, exitModal } from '../lib/screenEdges';
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
  /*
   * Says so while it is up.
   *
   * A transparent Modal is a separate Android window, and the safe-area insets the app is told
   * about change while one exists. The shell holds its last dialog-free measurements rather than
   * following that, or the tab bar lifts off the bottom of the screen every time a bill preview
   * opens -- which is exactly what it did.
   */
  useEffect(() => {
    if (!visible) return;
    enterModal();
    return () => exitModal();
  }, [visible]);

  /*
   * Measured rather than asked for as a percentage, and the scrolling part is capped in pixels
   * of its own.
   *
   * A percentage caps the sheet but leaves the ScrollView free to lay itself out at the full
   * height of a forty-line receipt, and what overflows is the footer -- so the way out of the
   * dialog went off the bottom of the screen on exactly the bills worth previewing. Telling the
   * scroller its own ceiling does not depend on anything shrinking correctly underneath it.
   */
  const win = useWindowDimensions();
  const sheetMax = Math.round(win.height * 0.88);
  // The title, the gap under it, the footer and the sheet's own padding. Deliberately generous:
  // a little unused room at the foot of a long preview costs nothing, a hidden button costs the
  // shopkeeper the bill.
  const bodyMax = Math.max(120, sheetMax - 140);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { maxHeight: sheetMax }]} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={[styles.body, { maxHeight: bodyMax }]} keyboardShouldPersistTaps="handled">
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
  sheet: { backgroundColor: C.bg, borderRadius: 14, padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: C.ink, marginBottom: 12 },
  /*
   * flexShrink is the whole fix. A ScrollView does not shrink by default, so a receipt of forty
   * lines laid itself out at full height, the sheet ran past its own 88% and the Close button
   * under it went off the bottom of the screen -- on the longest bills, which are exactly the
   * ones worth previewing. Shrinking, it gives the footer its room and scrolls inside instead.
   */
  body: { flexGrow: 0, flexShrink: 1 },
  /* Never gives up its height: the way out of a dialog does not scroll off. */
  footer: { flexDirection: 'row', gap: 10, marginTop: 12, flexShrink: 0 },
});
