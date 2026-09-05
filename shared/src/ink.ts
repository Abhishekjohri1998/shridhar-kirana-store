import type { Ink } from './types';

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
