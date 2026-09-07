import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { INK_LIMITS, type Ink } from '@shridhar/shared';

/** Ink coordinates are CSS pixels of the pad, so the stored box is whatever the pad measured. */
const STROKE_WIDTH = 2.8;
/** Points closer together than this are dropped: pens fire far more events than a line needs. */
const MIN_STEP = 1.2;

type Point = { x: number; y: number };

/**
 * A strip to write the item description on with a stylus.
 *
 * The shop already writes item names by hand on a Galaxy Tab, because Kannada is quicker to write
 * than to type on a phone keypad. This captures the pen path rather than a picture of it, so the
 * same handwriting can be redrawn crisply on screen and at the print head's 384 dots.
 */
/** What a slip row can ask of the strip it contains. */
export type InkPadHandle = { undo: () => void; clear: () => void };

type InkPadProps = {
  onChange: (ink: Ink | null) => void;
  height?: number;
  label: string;
  penNotice: string;
  undoLabel: string;
  clearLabel: string;
  hint: string;
  /** Called with the stroke count so the caller supplies the wording. */
  strokeCount: (n: number) => string;
  /**
   * 'pad' is the standalone writing box with its own label and buttons. 'line' is one ruled line
   * of the slip: the canvas alone, with the controls left to the row around it.
   */
  variant?: 'pad' | 'line';
  /** Ink to start from, so a line already written can be written on again. */
  value?: Ink | null;
};

export const InkPad = forwardRef<InkPadHandle, InkPadProps>(function InkPad({
  onChange,
  height = 140,
  label,
  penNotice,
  undoLabel,
  clearLabel,
  hint,
  strokeCount,
  variant = 'pad',
  value,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * The ref is the source of truth, the state is only there to trigger a repaint. Reading the
   * finished strokes out of the render closure loses them when two pen-ups land in the same React
   * batch -- which is what writing quickly does, and Kannada is a lot of short strokes.
   */
  const strokesRef = useRef<Point[][]>([]);
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const current = useRef<Point[] | null>(null);
  /** Set once a real pen is seen. After that, touches are palm contact and get ignored. */
  const sawPen = useRef(false);
  const [usingPen, setUsingPen] = useState(false);

  const box = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { w: 1, h: 1 };
    return { w: canvas.clientWidth || 1, h: canvas.clientHeight || 1 };
  }, []);

  const emit = useCallback(
    (next: Point[][]) => {
      const { w, h } = box();
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
    [box, onChange],
  );

  /** Repaint everything. Cheap at these sizes, and it keeps the in-progress stroke honest. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // A baseline to write on, so the handwriting comes out level enough to read at 58mm.
    ctx.strokeStyle = '#d8d3c6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, h * 0.72);
    ctx.lineTo(w - 8, h * 0.72);
    ctx.stroke();

    ctx.strokeStyle = '#000';
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const all = current.current ? [...strokes, current.current] : strokes;
    for (const stroke of all) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      const first = stroke[0]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i]!.x, stroke[i]!.y);
      if (stroke.length === 1) ctx.lineTo(first.x + 0.01, first.y);
      ctx.stroke();
    }
  }, [strokes]);

  /**
   * Seed from ink that already exists, once.
   *
   * A line of the slip keeps its strokes in the bill, not in this component, so a pad that
   * mounted fresh -- after switching tabs and back, say -- would show an empty strip over
   * handwriting the bill still holds. Restoring it keeps what is on screen and what will print
   * the same thing.
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

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Clamped to the pad: pointer capture keeps delivering events after the pen leaves the
    // canvas, and a stray point outside it would stretch the saved bounding box and shrink the
    // handwriting when it is scaled to fit the receipt column.
    // Bounded by the content box -- the same box `box()` records and `redraw()` paints into --
    // so a saved point can never sit outside the box it is measured against.
    const canvas = e.currentTarget;
    // Held half a pen-width in from the edges. Clamped to 0 the line is drawn centred on the
    // boundary and half of it falls off the bitmap, which is exactly the content box -- so the
    // shopkeeper saw the first letter cut while writing it. In pad pixels, not printer dots.
    const edge = STROKE_WIDTH / 2;
    const span = (v: number, size: number) =>
      Math.min(Math.max(v, edge), Math.max(edge, size - edge));
    return {
      x: span(e.clientX - rect.left, canvas.clientWidth),
      y: span(e.clientY - rect.top, canvas.clientHeight),
    };
  };

  /** True for events that should be ignored: palm contact once a pen is in use. */
  const isPalm = (e: React.PointerEvent<HTMLCanvasElement>) =>
    sawPen.current && e.pointerType === 'touch';

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen' && !sawPen.current) {
      sawPen.current = true;
      setUsingPen(true);
    }
    if (isPalm(e)) return;
    if (strokesRef.current.length >= INK_LIMITS.maxStrokes) return;
    try {
      // Throws if the pointer has already gone away, which must not abort the stroke.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* drawing still works without capture */
    }
    current.current = [pointFrom(e)];
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!current.current || isPalm(e)) return;
    const stroke = current.current;
    if (stroke.length >= INK_LIMITS.maxPointsPerStroke) return;
    const p = pointFrom(e);
    const last = stroke[stroke.length - 1]!;
    if (Math.hypot(p.x - last.x, p.y - last.y) < MIN_STEP) return;
    stroke.push(p);
    redraw();
  };

  const commit = (next: Point[][]) => {
    strokesRef.current = next;
    setStrokes(next);
    emit(next);
  };

  const finishStroke = () => {
    const stroke = current.current;
    current.current = null;
    if (!stroke || stroke.length === 0) return;
    commit([...strokesRef.current, stroke]);
  };

  const undo = () => commit(strokesRef.current.slice(0, -1));

  const clear = () => {
    current.current = null;
    commit([]);
  };

  // A slip row draws no buttons of its own, so it reaches in for these.
  useImperativeHandle(ref, () => ({ undo, clear }));

  if (variant === 'line') {
    return (
      <canvas
        ref={canvasRef}
        className="inkline"
        style={{ height }}
        aria-label={label}
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onPointerLeave={finishStroke}
      />
    );
  }

  return (
    <div className="field">
      <label>
        {label}
        {usingPen ? <span className="muted">{penNotice}</span> : null}
      </label>
      <canvas
        ref={canvasRef}
        className="inkpad"
        style={{ height }}
        aria-label={label}
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onPointerLeave={finishStroke}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn plain slim" onClick={undo} disabled={strokes.length === 0}>
          {undoLabel}
        </button>
        <button type="button" className="btn plain slim" onClick={clear} disabled={strokes.length === 0}>
          {clearLabel}
        </button>
        <span className="muted small grow" style={{ textAlign: 'right' }}>
          {strokes.length === 0 ? hint : strokeCount(strokes.length)}
        </span>
      </div>
    </div>
  );
});
