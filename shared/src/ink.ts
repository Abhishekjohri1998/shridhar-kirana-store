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
export function inkToSvgPath(ink: Ink): string {
  const parts: string[] = [];
  for (const stroke of ink.strokes) {
    if (stroke.length < 2) continue;
    parts.push('M' + round(stroke[0] as number) + ' ' + round(stroke[1] as number));
    for (let i = 2; i + 1 < stroke.length; i += 2) {
      parts.push('L' + round(stroke[i] as number) + ' ' + round(stroke[i + 1] as number));
    }
    // A single tap is a dot, which needs a zero-length segment to be visible at all.
    if (stroke.length === 2) parts.push('l0.01 0');
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
