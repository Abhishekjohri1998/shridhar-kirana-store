import {
  INK_ROW_HEIGHT, INK_STROKE_DOTS, RASTER, fitPrefix, inkFit, inkMaxWidth,
  type Ink, type ReceiptDoc,
} from '@shridhar/shared';

export type Raster = { width: number; height: number; bits: Uint8Array };

const FONT = "'Noto Sans Kannada', 'Noto Serif Kannada', system-ui, sans-serif";
const PAD = RASTER.pad;
const ITEM = RASTER.itemSize;
const THRESHOLD = RASTER.threshold;

function font(size: number, bold: boolean): string {
  return (bold ? 'bold ' : '') + size + 'px ' + FONT;
}

function lineHeight(size: number): number {
  // Kannada stacks vowel signs above and below the base, so it needs more leading than Latin.
  return Math.round(size * 1.5);
}

type Op =
  | { op: 'text'; text: string; x: number; y: number; size: number; bold: boolean; align: CanvasTextAlign }
  | { op: 'ink'; ink: Ink; x: number; y: number; maxWidth: number }
  | { op: 'dash'; y: number };

function wrap(meas: CanvasRenderingContext2D, text: string, size: number, bold: boolean, maxW: number): string[] {
  meas.font = font(size, bold);
  const words = String(text ?? '').split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let cur = words[0] as string;
  for (let i = 1; i < words.length; i++) {
    const candidate = cur + ' ' + words[i];
    if (meas.measureText(candidate).width <= maxW) cur = candidate;
    else {
      lines.push(cur);
      cur = words[i] as string;
    }
  }
  lines.push(cur);

  // A single word wider than the column still has to break somewhere -- but only where Kannada
  // allows, so a fragment never begins with a stray virama or splits a conjunct.
  const out: string[] = [];
  const width = (candidate: string) => meas.measureText(candidate).width;
  for (const line of lines) {
    let rest = line;
    while (width(rest) > maxW) {
      const head = fitPrefix(rest, maxW, width);
      if (!head || head === rest) break; // Even one cluster will not fit; let it overhang.
      out.push(head);
      rest = rest.slice(head.length);
    }
    out.push(rest);
  }
  return out;
}

/** Replay the pen strokes into the dot grid, trimmed and scaled to the item column. */
function drawInk(ctx: CanvasRenderingContext2D, ink: Ink, x: number, y: number, maxWidth: number): void {
  const fit = inkFit(ink, maxWidth, INK_ROW_HEIGHT);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(fit.scale, fit.scale);
  ctx.translate(-fit.box.minX, -fit.box.minY);
  ctx.strokeStyle = '#000';
  // Scaled back out of the transform, so the printed thickness is the same whatever the writing size.
  ctx.lineWidth = INK_STROKE_DOTS / fit.scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of ink.strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0] as number, stroke[1] as number);
    for (let i = 2; i + 1 < stroke.length; i += 2) {
      ctx.lineTo(stroke[i] as number, stroke[i + 1] as number);
    }
    // A single tap is a dot, which needs a zero-length segment to show up at all.
    if (stroke.length === 2) ctx.lineTo((stroke[0] as number) + 0.01, stroke[1] as number);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw the receipt onto a canvas and reduce it to one bit per printer dot.
 *
 * This exists because cheap ESC/POS printers carry code pages for Latin, Cyrillic and CJK and
 * none of them can render Kannada as text. The browser can, so we let it draw and send dots.
 */
export function rasterize(doc: ReceiptDoc): Raster {
  const W = doc.width || 384;
  const measCanvas = document.createElement('canvas');
  const meas = measCanvas.getContext('2d');
  if (!meas) throw new Error('This browser will not give us a canvas to draw the receipt on');

  const ops: Op[] = [];
  let y = 0;

  for (const row of doc.rows) {
    if (row.t === 'space') {
      y += row.h;
      continue;
    }
    if (row.t === 'sep') {
      y += 6;
      ops.push({ op: 'dash', y });
      y += 10;
      continue;
    }
    if (row.t === 'center') {
      const size = row.size ?? 22;
      for (const line of wrap(meas, row.text, size, !!row.bold, W - 2 * PAD)) {
        ops.push({ op: 'text', text: line, x: W / 2, y, size, bold: !!row.bold, align: 'center' });
        y += lineHeight(size);
      }
      continue;
    }
    if (row.t === 'kv') {
      const size = row.size ?? 22;
      ops.push({ op: 'text', text: row.left, x: PAD, y, size, bold: !!row.bold, align: 'left' });
      ops.push({ op: 'text', text: row.right, x: W - PAD, y, size, bold: !!row.bold, align: 'right' });
      y += lineHeight(size);
      continue;
    }

    meas.font = font(ITEM, false);
    const amountW = meas.measureText(row.amount).width;
    const nameX = PAD + RASTER.qtyCol;
    const nameMax = Math.max(40, W - PAD - amountW - 12 - nameX);
    ops.push({ op: 'text', text: row.qty, x: PAD, y, size: ITEM, bold: false, align: 'left' });
    ops.push({ op: 'text', text: row.amount, x: W - PAD, y, size: ITEM, bold: false, align: 'right' });

    if (row.t === 'ink') {
      const inkMax = Math.min(inkMaxWidth(W), nameMax);
      ops.push({ op: 'ink', ink: row.ink, x: nameX, y, maxWidth: inkMax });
      y += Math.max(INK_ROW_HEIGHT, inkFit(row.ink, inkMax, INK_ROW_HEIGHT).h);
      if (row.note) {
        ops.push({ op: 'text', text: row.note, x: nameX, y, size: 18, bold: false, align: 'left' });
        y += lineHeight(18);
      }
      y += 4;
      continue;
    }

    for (const line of wrap(meas, row.name, ITEM, false, nameMax)) {
      ops.push({ op: 'text', text: line, x: nameX, y, size: ITEM, bold: false, align: 'left' });
      y += lineHeight(ITEM);
    }
    if (row.note) {
      ops.push({ op: 'text', text: row.note, x: nameX, y, size: 18, bold: false, align: 'left' });
      y += lineHeight(18);
    }
    y += 4;
  }

  const H = Math.max(1, Math.ceil(y));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give us a canvas to draw the receipt on');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  for (const op of ops) {
    if (op.op === 'dash') {
      for (let x = PAD; x < W - PAD; x += 8) ctx.fillRect(x, op.y, 4, 2);
    } else if (op.op === 'ink') {
      drawInk(ctx, op.ink, op.x, op.y, op.maxWidth);
    } else {
      ctx.font = font(op.size, op.bold);
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    }
  }

  const px = ctx.getImageData(0, 0, W, H).data;
  const bytesPerRow = Math.ceil(W / 8);
  const bits = new Uint8Array(bytesPerRow * H);
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const p = (row * W + col) * 4;
      const lum = 0.299 * (px[p] ?? 255) + 0.587 * (px[p + 1] ?? 255) + 0.114 * (px[p + 2] ?? 255);
      if ((px[p + 3] ?? 0) > 32 && lum < THRESHOLD) {
        bits[row * bytesPerRow + (col >> 3)]! |= 0x80 >> (col & 7);
      }
    }
  }

  return { width: W, height: H, bits };
}
