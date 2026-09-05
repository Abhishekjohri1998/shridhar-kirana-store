import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, PointerType } from 'react-native-gesture-handler';
import Svg, { Line, Path } from 'react-native-svg';
import { INK_LIMITS, inkToSvgPath, type Ink } from '@shridhar/shared';
import { Button } from './ui';
import { C, R } from '../theme';

/** Points closer together than this are dropped: a finger reports far more than a line needs. */
const MIN_STEP = 1.5;
const STROKE_WIDTH = 2.8;

type Point = { x: number; y: number };

/**
 * A strip to write the item description on.
 *
 * The shop writes item names by hand today, because Kannada is quicker to write than to type. The
 * pen path is captured rather than a picture of it, so the same handwriting redraws crisply here
 * and at the print head's dots.
 *
 * Palm rejection is the real thing here, not a heuristic. Android knows whether a contact came
 * from a stylus or from skin, and react-native-gesture-handler passes that through as
 * `pointerType`. So the rule is the same one the browser version uses: the first time a stylus
 * is seen, this strip stops accepting fingers for good. A hand can then rest anywhere on the
 * glass and leave nothing behind.
 *
 * Devices with no stylus keep working: until one is seen, touch draws as before.
 */
/** What a slip row can ask of the strip it contains. */
export type InkPadHandle = { undo: () => void; clear: () => void };

type InkPadProps = {
  onChange: (ink: Ink | null) => void;
  height?: number;
  label: string;
  undoLabel: string;
  clearLabel: string;
  hint: string;
  strokeCount: (n: number) => string;
  /**
   * 'pad' is the standalone writing box with its own label and buttons. 'line' is one ruled line
   * of the slip: the writing surface alone, with the controls left to the row around it.
   */
  variant?: 'pad' | 'line';
  /** Ink to start from, so a line already written can be written on again. */
  value?: Ink | null;
};

export const InkPad = forwardRef<InkPadHandle, InkPadProps>(function InkPad({
  onChange, height = 150, label, undoLabel, clearLabel, hint, strokeCount,
  variant = 'pad', value,
}, ref) {
  /**
   * The ref is the source of truth and state only mirrors it for repaints. Reading the finished
   * strokes out of the render closure loses them when two lifts land in one React batch, which is
   * what writing quickly does -- and Kannada is a lot of short strokes.
   */
  const strokesRef = useRef<Point[][]>([]);
  const currentRef = useRef<Point[]>([]);
  /** Which contact is drawing the current line. Everything else on the glass is ignored. */
  const ownerRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const [current, setCurrent] = useState<Point[]>([]);

  const emit = useCallback(
    (next: Point[][]) => {
      const { w, h } = sizeRef.current;
      const drawn = next.filter((s) => s.length > 0);
      if (drawn.length === 0) {
        onChange(null);
        return;
      }
      onChange({
        w,
        h,
        strokes: drawn.map((s) => s.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10])),
      });
    },
    [onChange],
  );

  const commit = useCallback(
    (next: Point[][]) => {
      strokesRef.current = next;
      setStrokes(next);
      emit(next);
    },
    [emit],
  );

  /** Clamped to the pad: a finger dragged past the edge would stretch the saved bounding box and
   *  shrink the handwriting once it is scaled to fit the receipt column. */
  const clamp = useCallback((x: number, y: number): Point => {
    const { w, h } = sizeRef.current;
    return { x: Math.min(Math.max(x, 0), w), y: Math.min(Math.max(y, 0), h) };
  }, []);

  /**
   * Once a stylus has been seen, skin is not a drawing implement any more.
   *
   * Kept in a ref rather than state so it takes effect on the very next event, without waiting
   * for a render -- a palm can land a millisecond after the pen.
   */
  const sawStylus = useRef(false);
  const [usingStylus, setUsingStylus] = useState(false);

  const startStroke = useCallback((x: number, y: number) => {
    if (strokesRef.current.length >= INK_LIMITS.maxStrokes) return;
    const p = clamp(x, y);
    currentRef.current = [p];
    setCurrent([p]);
  }, [clamp]);

  const extendStroke = useCallback((x: number, y: number) => {
    const stroke = currentRef.current;
    if (stroke.length === 0 || stroke.length >= INK_LIMITS.maxPointsPerStroke) return;
    const p = clamp(x, y);
    const last = stroke[stroke.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return;
    stroke.push(p);
    setCurrent([...stroke]);
  }, [clamp]);

  const endStroke = useCallback(() => {
    const stroke = currentRef.current;
    currentRef.current = [];
    setCurrent([]);
    if (stroke.length === 0) return;
    commit([...strokesRef.current, stroke]);
  }, [commit]);

  /** True when this contact must be ignored: skin, on a strip that has met a stylus. */
  const rejected = useCallback((pointerType: PointerType) => {
    if (pointerType === PointerType.STYLUS) {
      if (!sawStylus.current) {
        sawStylus.current = true;
        setUsingStylus(true);
      }
      return false;
    }
    return sawStylus.current;
  }, []);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        // Zero, so a single dot of a Kannada conjunct registers rather than being taken for a tap.
        .minDistance(0)
        // The slip scrolls; without this a stroke that starts with a downward flick would be
        // stolen by the scroll view before a single point was recorded.
        .shouldCancelWhenOutside(false)
        .onBegin((e) => {
          if (rejected(e.pointerType)) return;
          startStroke(e.x, e.y);
        })
        .onUpdate((e) => {
          if (rejected(e.pointerType)) return;
          extendStroke(e.x, e.y);
        })
        .onEnd(() => endStroke())
        .onFinalize(() => endStroke()),
    [rejected, startStroke, extendStroke, endStroke],
  );

  /**
   * Seed from ink that already exists, once. A line of the slip keeps its strokes in the bill,
   * not in this component, so a pad that mounted fresh would show an empty strip over
   * handwriting the bill still holds.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !value || value.strokes.length === 0) return;
    seeded.current = true;
    const restored: Point[][] = value.strokes.map((flat) => {
      const points: Point[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) points.push({ x: flat[i]!, y: flat[i + 1]! });
      return points;
    });
    strokesRef.current = restored;
    setStrokes(restored);
  }, [value]);

  // A slip row draws no buttons of its own, so it reaches in for these.
  useImperativeHandle(ref, () => ({
    undo: () => commit(strokesRef.current.slice(0, -1)),
    clear: () => {
      currentRef.current = [];
      setCurrent([]);
      commit([]);
    },
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    sizeRef.current = { w: Math.max(1, width), h: Math.max(1, h) };
  };

  const asPath = useCallback(
    (points: Point[]) =>
      inkToSvgPath({
        w: sizeRef.current.w,
        h: sizeRef.current.h,
        strokes: [points.flatMap((p) => [p.x, p.y])],
      }),
    [],
  );

  /**
   * Finished strokes are turned into paths once and reused.
   *
   * Kannada is a great many short strokes, and rebuilding every one of them on every sampled
   * point of the stroke in progress is what makes writing feel like it is dragging. Only the
   * live stroke changes between frames now.
   */
  const finishedPaths = useMemo(() => strokes.map(asPath), [strokes, asPath]);
  const livePath = current.length > 0 ? asPath(current) : null;

  const surface = (
    <GestureDetector gesture={gesture}>
      <View
        style={[variant === 'line' ? styles.line : styles.pad, { height }]}
        onLayout={onLayout}
        accessibilityLabel={label}
      >
        <Svg style={StyleSheet.absoluteFill}>
          <Line x1={8} y1={height * 0.72} x2="98%" y2={height * 0.72} stroke={C.line} strokeWidth={1} />
          {[...finishedPaths, ...(livePath ? [livePath] : [])].map((d, i) =>
            d ? (
              <Path
                key={i}
                d={d}
                stroke="#000"
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null,
          )}
        </Svg>
      </View>
    </GestureDetector>
  );

  if (variant === 'line') return surface;

  return (
    <View>
      <Text style={styles.label}>
        {label}
        {usingStylus ? <Text style={styles.penNote}>{'  ·  pen detected, palm ignored'}</Text> : null}
      </Text>
      {surface}
      <View style={styles.row}>
        <Button
          label={undoLabel}
          tone="plain"
          onPress={() => commit(strokesRef.current.slice(0, -1))}
          disabled={strokes.length === 0}
          style={styles.slim}
        />
        <Button
          label={clearLabel}
          tone="plain"
          onPress={() => {
            currentRef.current = [];
            setCurrent([]);
            commit([]);
          }}
          disabled={strokes.length === 0}
          style={styles.slim}
        />
        <Text style={styles.count}>{strokes.length === 0 ? hint : strokeCount(strokes.length)}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  label: { fontSize: 12, color: C.soft, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  pad: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden' },
  line: { backgroundColor: 'transparent', borderRadius: R.sm, overflow: 'hidden' },
  penNote: { fontSize: 11, color: C.accent, textTransform: 'none', letterSpacing: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  slim: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12 },
  count: { flex: 1, textAlign: 'right', color: C.soft, fontSize: 12 },
});
