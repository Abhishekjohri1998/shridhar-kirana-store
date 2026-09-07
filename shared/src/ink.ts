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

export type InkPlan = {
  /** Multiply an ink coordinate by this to get output units. Shared by every line on a slip. */
  scale: number;
  /** Subtract this from a y before scaling, so every line sits on one baseline. */
  originY: number;
  /** Height of the tallest line once scaled, in output units. */
  height: number;
};

/**
 * One scale and one baseline for every hand-written line on a slip.
 *
 * `inkFit` sizes a single piece of writing to fill the space it is given, which is right for a
 * thumbnail and wrong for a bill: fitting each line separately blew a short word like "1k" up to
 * the same height as one with an ascender, so nothing on the paper looked like it came from the
 * same hand. Sizing the whole slip together keeps the proportions the shopkeeper wrote.
 *
 * The tallest line fills the row; the rest keep their true size against it. The vertical origin
 * is shared so the lines rest on a common baseline rather than each being trimmed to its own box.
 *
 * The gutter and the pen's overhang come out of the budget here, before a scale is chosen, rather
 * than being subtracted from the drawing afterwards -- otherwise the writing is sized to a space
 * it no longer has and the tallest line overruns its row. The row layout depends on that not
 * happening: it advances by a flat INK_ROW_HEIGHT.
 */
export function planInk(inks: readonly Ink[], maxWidth: number, targetHeight: number): InkPlan {
  let minY = Infinity;
  let maxY = -Infinity;
  let widest = 1;
  for (const ink of inks) {
    const box = inkBounds(ink);
    if (box.minY < minY) minY = box.minY;
    if (box.maxY > maxY) maxY = box.maxY;
    widest = Math.max(widest, box.maxX - box.minX);
  }
  // No handwriting on the slip: the numbers still have to be finite for the callers.
  if (!Number.isFinite(minY)) return { scale: 1, originY: 0, height: 0 };

  const unionH = Math.max(1, maxY - minY);
  const roomH = Math.max(1, targetHeight - 2 * INK_BLEED);
  const roomW = Math.max(1, maxWidth - INK_GUTTER - 2 * INK_BLEED);
  const scale = Math.min(roomH / unionH, roomW / widest);
  return { scale, originY: minY, height: unionH * scale };
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
