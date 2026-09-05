import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { INK_LIMITS, inkToSvgPath, type Ink } from '@shridhar/shared';
import { Button } from './ui';
import { C, R } from '../theme';

/** Points closer together than this are dropped: a finger reports far more than a line needs. */
const MIN_STEP = 1.5;
const STROKE_WIDTH = 2.4;

type Point = { x: number; y: number };

/**
 * A strip to write the item description on.
 *
 * The shop writes item names by hand today, because Kannada is quicker to write than to type. The
 * pen path is captured rather than a picture of it, so the same handwriting redraws crisply here
 * and at the print head's dots.
 *
 * Unlike the browser version this cannot reject a resting palm: React Native's gesture events do
 * not carry Android's tool type, so a finger and a stylus look the same to it. Undo covers the
 * accident instead.
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

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          if (strokesRef.current.length >= INK_LIMITS.maxStrokes) return;
          const p = clamp(e.nativeEvent.locationX, e.nativeEvent.locationY);
          currentRef.current = [p];
          setCurrent([p]);
        },
        onPanResponderMove: (e) => {
          const stroke = currentRef.current;
          if (stroke.length === 0 || stroke.length >= INK_LIMITS.maxPointsPerStroke) return;
          const p = clamp(e.nativeEvent.locationX, e.nativeEvent.locationY);
          const last = stroke[stroke.length - 1]!;
          if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return;
          stroke.push(p);
          setCurrent([...stroke]);
        },
        onPanResponderRelease: () => {
          const stroke = currentRef.current;
          currentRef.current = [];
          setCurrent([]);
          if (stroke.length === 0) return;
          commit([...strokesRef.current, stroke]);
        },
        onPanResponderTerminate: () => {
          currentRef.current = [];
          setCurrent([]);
        },
      }),
    [clamp, commit],
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

  const asPath = (points: Point[]) =>
    inkToSvgPath({ w: sizeRef.current.w, h: sizeRef.current.h, strokes: [points.flatMap((p) => [p.x, p.y])] });

  const surface = (
    <View
      style={[variant === 'line' ? styles.line : styles.pad, { height }]}
      onLayout={onLayout}
      accessibilityLabel={label}
      {...responder.panHandlers}
    >
      <Svg style={StyleSheet.absoluteFill}>
        <Line x1={8} y1={height * 0.72} x2="98%" y2={height * 0.72} stroke={C.line} strokeWidth={1} />
        {[...strokes, current].map((stroke, i) =>
          stroke.length > 0 ? (
            <Path
              key={i}
              d={asPath(stroke)}
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
  );

  if (variant === 'line') return surface;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.pad, { height }]} onLayout={onLayout} {...responder.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {/* A baseline to write along, so the handwriting comes out level enough to read at 58mm. */}
          <Line x1={8} y1={height * 0.72} x2="98%" y2={height * 0.72} stroke={C.line} strokeWidth={1} />
          {[...strokes, current].map((stroke, i) =>
            stroke.length > 0 ? (
              <Path
                key={i}
                d={asPath(stroke)}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  slim: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12 },
  count: { flex: 1, textAlign: 'right', color: C.soft, fontSize: 12 },
});
