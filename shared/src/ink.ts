import type { Ink } from './types';

/** Printed thickness of a pen stroke, in dots. Thin enough to keep Kannada legible at 58mm. */
export const INK_STROKE_DOTS = 3;

/**
 * How far the pen overhangs its own path, in dots.
 *
 * A stroke is centred on the path and capped round, so half its width lies outside the box
 * `inkBounds` returns. Size a viewport to those bounds, clip to it, and the outer edge of every
 * letter is shaved -- the first one most visibly, which is what the shop reported.
 */
export const INK_BLEED = Math.ceil(INK_STROKE_DOTS / 2);

/**
 * Space before the writing starts, in dots. A dot is an eighth of a millimetre at 203 dpi, so
 * this is about a millimetre: enough that the first letter never sits against the edge of the
 * column, cheap against the 260 the column has on a 58mm roll.
 */
export const INK_GUTTER = 8;

export type InkBox = { minX: number; minY: number; maxX: number; maxY: number };

/** The box the strokes actually occupy, which is usually smaller than the box drawn in. */
export function inkBounds(ink: Ink): InkBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of ink.strokes) {
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      const x = stroke[i] as number;
      const y = stroke[i + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: ink.w, maxY: ink.h };
  return { minX, minY, maxX, maxY };
}

export type InkFit = {
  /** Multiply an ink coordinate by this to get output units. */
  scale: number;
  /** Size of the drawn output, in the same units as maxWidth/targetHeight. */
  w: number;
  h: number;
  box: InkBox;
};

/**
 * Work out how to draw handwriting into a column: trim to what was actually written, scale it to
 * `targetHeight`, and shrink further if that would overrun `maxWidth`. Used by every renderer, so
 * the ink sits identically on screen and on paper.
 */
export function inkFit(ink: Ink, maxWidth: number, targetHeight: number): InkFit {
  const box = inkBounds(ink);
  const drawnW = Math.max(1, box.maxX - box.minX);
  const drawnH = Math.max(1, box.maxY - box.minY);
  const scale = Math.min(targetHeight / drawnH, maxWidth / drawnW);
  return { scale, w: drawnW * scale, h: drawnH * scale, box };
}

/**
 * One line of handwriting, sized for its row: at the size it was written.
 *
 * Scaled by the strip it was written on, not by the writing. `natural` maps the whole strip onto
 * the row, so a letter that filled half the strip fills half the row -- whatever else is on the
 * line. The rule before this scaled every line to fill the row's height and then capped it by
 * width, which made letter size depend on the word's length: a short "I" was blown up to the
 * full row, and a long line was stretched tall, ran out of column and was shrunk back. The shop
 * wrote six lines at one size and got six sizes.
 *
 * Two things from the rule before are kept. Each line starts at its own top, so a line written
 * low in its strip does not print low in its row. And scaling by the strip's own height cancels
 * the strip's pixel size: a roomier strip gives larger coordinates and a smaller `natural` in
 * proportion, so the same word prints the same size from any screen.
 *
 * Width is the only reason to shrink, and ordinary writing does not meet it: the tablet's strip,
 * mapped onto the row, comes out about as wide as the 58mm column. It catches the odd line
 * written edge to edge, and narrows that line alone.
 *
 * The gutter comes out of the width budget before a scale is chosen rather than being subtracted
 * from the drawing afterwards; otherwise the writing is sized to a space it no longer has and a
 * long line overruns the column.
 */
export function inkRowFit(
  ink: Ink,
  maxWidth: number,
  targetHeight: number,
): { scale: number; originY: number } {
  const box = inkBounds(ink);
  const drawnW = Math.max(1, box.maxX - box.minX);
  const roomW = Math.max(1, maxWidth - INK_GUTTER - 2 * INK_BLEED);
  const natural = targetHeight / Math.max(1, ink.h);
  return { scale: Math.min(natural, roomW / drawnW), originY: box.minY };
}

/**
 * SVG path data for the strokes, in the ink's own coordinates. The caller positions and scales it
 * with a viewBox or a transform, which keeps the handwriting resolution-independent -- crisp on a
 * screen and crisp at 384 dots.
 */
/**
 * Strokes as a path, smoothed.
 *
 * A pen reports positions in bursts, and joining them with straight lines makes handwriting look
 * like it was drawn with a ruler -- every sampled point becomes a visible corner. Curving through
 * the midpoints instead gives a continuous line that still passes where the hand went: each
 * sampled point becomes the control point of a quadratic, and the curve runs midpoint to
 * midpoint. It costs nothing, changes no stored data, and is the difference between writing that
 * looks written and writing that looks plotted.
 */
export function inkToSvgPath(ink: Ink): string {
  const parts: string[] = [];
  for (const stroke of ink.strokes) {
    if (stroke.length < 2) continue;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + 1 < stroke.length; i += 2) {
      xs.push(stroke[i] as number);
      ys.push(stroke[i + 1] as number);
    }

    parts.push('M' + round(xs[0] as number) + ' ' + round(ys[0] as number));

    // A single tap is a dot, which needs a zero-length segment to be visible at all.
    if (xs.length === 1) {
      parts.push('l0.01 0');
      continue;
    }
    if (xs.length === 2) {
      parts.push('L' + round(xs[1] as number) + ' ' + round(ys[1] as number));
      continue;
    }

    for (let i = 1; i < xs.length - 1; i++) {
      const midX = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      const midY = ((ys[i] as number) + (ys[i + 1] as number)) / 2;
      parts.push(
        'Q' + round(xs[i] as number) + ' ' + round(ys[i] as number) +
        ' ' + round(midX) + ' ' + round(midY),
      );
    }
    // The last sampled point is where the pen actually left the glass, so end there exactly.
    parts.push(
      'L' + round(xs[xs.length - 1] as number) + ' ' + round(ys[ys.length - 1] as number),
    );
  }
  return parts.join(' ');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Total points across every stroke, for the size limits. */
export function inkPointCount(ink: Ink): number {
  return ink.strokes.reduce((sum, s) => sum + Math.floor(s.length / 2), 0);
}

/**
 * Move points from one pad size to another.
 *
 * A pad seeds itself from ink the bill already holds, but those coordinates are in the pad that
 * wrote them. Draw one more stroke on a pad of a different width -- after a rotation, or after a
 * bill was parked on the tablet and picked up on a wider screen -- and the two spaces end up in
 * one strokes array under a single `w`/`h`, which prints as handwriting of two sizes on one line.
 * So the restored strokes are brought into the current space before anything is added to them.
 *
 * Aspect is deliberately not preserved: x and y scale independently, because that is exactly what
 * the pad itself does when it changes shape.
 */
export function rescaleStrokes<P extends { x: number; y: number }>(
  strokes: P[][],
  from: { w: number; h: number },
  to: { w: number; h: number },
): P[][] {
  const sx = from.w > 0 ? to.w / from.w : 1;
  const sy = from.h > 0 ? to.h / from.h : 1;
  if (sx === 1 && sy === 1) return strokes;
  return strokes.map((s) => s.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy })));
}
