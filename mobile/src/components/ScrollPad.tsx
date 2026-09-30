import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, R } from '../theme';

/**
 * A strip down the side of the bill to scroll it with the pen or a finger.
 *
 * Every line of the slip is a writing strip, so dragging on a line writes on it: with a stylus
 * there was nowhere to put the pen to move the list. This strip sits outside the lines, never
 * writes, and moves the list exactly as far as the pen moves, the way dragging a sheet of paper
 * would. The shop drew one on each side of the bill.
 */
export function ScrollPad({ scrollTo, offset, max }: { scrollTo: (y: number) => void; offset: () => number; max: () => number }) {
  const start = useRef(0);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          start.current = offset();
        })
        .onUpdate((e) => {
          scrollTo(Math.max(0, Math.min(max(), start.current - e.translationY)));
        }),
    [scrollTo, offset, max],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.pad} accessibilityLabel="Scroll the bill" accessible>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.grip} />
        ))}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pad: {
    width: 22,
    alignSelf: 'stretch',
    backgroundColor: C.well,
    borderRadius: R.sm,
    marginVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  grip: { width: 8, height: 3, borderRadius: 2, backgroundColor: C.lineStrong },
});
