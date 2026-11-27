import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, R } from '../theme';

/**
 * A strip beside the bill that scrolls it: the list itself never scrolls by dragging, because
 * every row is a writing strip and the scroll took the pen's drag before anything could stop it.
 *
 * Faster and smoother than a plain one-for-one drag (build 96), at the shop's asking: the bill
 * moves SPEED times as far as the finger, at most once per frame (the drags arrive faster than the
 * screen draws, and each extra scroll was work for nothing), and a flick carries on gliding.
 */
const SPEED = 2.5;
/** How far a flick carries the bill on, per unit of speed: px/s -> px. */
const FLING = 0.35;

export function ScrollPad({ scrollTo, offset, max }: { scrollTo: (y: number, animated?: boolean) => void; offset: () => number; max: () => number }) {
  const start = useRef(0);
  const last = useRef(0);
  const frame = useRef<number | null>(null);
  const gesture = useMemo(() => {
    const clamp = (y: number) => Math.max(0, Math.min(max(), y));
    // The newest position, drawn on the next frame; anything in between is skipped.
    const go = (y: number) => {
      last.current = y;
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        scrollTo(last.current, false);
      });
    };
    return Gesture.Pan()
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .runOnJS(true)
      .onBegin(() => {
        start.current = offset();
        last.current = start.current;
      })
      .onUpdate((e) => {
        go(clamp(start.current - e.translationY * SPEED));
      })
      .onEnd((e) => {
        // A flick: on in the same direction, the native scroll easing it to a stop.
        if (Math.abs(e.velocityY) < 400) return;
        if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
        scrollTo(clamp(last.current - e.velocityY * FLING * SPEED * 0.5), true);
      });
  }, [scrollTo, offset, max]);
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
