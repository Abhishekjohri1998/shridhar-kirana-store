import {
  GIVEN_MARK, INK_BLEED, INK_GUTTER, INK_ROW_ADVANCE, INK_STROKE_DOTS, INK_TEXT_DY, RASTER, fitPrefix, inkBounds,
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
  | { op: 'ink'; ink: Ink; x: number; y: number; scale: number; originY: number }
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
function drawInk(
  ctx: CanvasRenderingContext2D,
  ink: Ink,
  x: number,
  y: number,
  scale: number,
  originY: number,
): void {
  // The scale and the vertical origin come from the document, worked out across every line on
  // the slip at once. Fitting each line here on its own is what made short words print large.
  const box = inkBounds(ink);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-box.minX, -originY);
  ctx.strokeStyle = '#000';
  // Scaled back out of the transform, so the printed thickness is the same whatever the writing size.
  ctx.lineWidth = INK_STROKE_DOTS / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of ink.strokes) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0] as number, stroke[1] as number);
    // Curved through the midpoints, exactly as the screen draws it: every sampled point becomes
    // the control point of a quadratic and the line runs midpoint to midpoint. Joining the
    // samples with straight segments printed handwriting with a visible corner at every sample.
    const n = stroke.length / 2;
    if (n === 1) {
      ctx.lineTo((stroke[0] as number) + 0.01, stroke[1] as number);
    } else if (n === 2) {
      ctx.lineTo(stroke[2] as number, stroke[3] as number);
    } else {
      for (let i = 1; i < n - 1; i++) {
        const cx = stroke[i * 2] as number;
        const cy = stroke[i * 2 + 1] as number;
        const mx = (cx + (stroke[(i + 1) * 2] as number)) / 2;
        const my = (cy + (stroke[(i + 1) * 2 + 1] as number)) / 2;
        ctx.quadraticCurveTo(cx, cy, mx, my);
      }
      ctx.lineTo(stroke[(n - 1) * 2] as number, stroke[(n - 1) * 2 + 1] as number);
    }
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
  return draw(doc).raster();
}

/**
 * A picture of the slip, for sharing rather than printing.
 *
 * Same document, same layout, same renderer -- drawn larger than the print head's 384 dots so it
 * is legible on a screen. Sharing a typed summary was the alternative and it is not one: the item
 * descriptions on this shop's bills are handwriting, and handwriting has no text to send.
 */
export async function receiptPng(doc: ReceiptDoc, scale = 3): Promise<Blob> {
  const canvas = draw(doc, scale).canvas;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('This browser would not turn the receipt into a picture');
  return blob;
}

function draw(doc: ReceiptDoc, scale = 1): { canvas: HTMLCanvasElement; raster: () => Raster } {
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
    // The gutter belongs to the whole description column, not to the handwriting alone: indent
    // only the ink and a typed line like "Old bal." would sit a millimetre to its left.
    const nameX = PAD + RASTER.qtyCol + INK_GUTTER;
    const nameMax = Math.max(40, W - PAD - amountW - 12 - nameX);
    // A hand-written row is three times the height of a line of text, so its number and price
    // drop to the middle to sit level with the writing rather than above it.
    const textY = row.t === 'ink' ? y + INK_TEXT_DY : y;
    ops.push({ op: 'text', text: row.no, x: PAD, y: textY, size: ITEM, bold: false, align: 'left' });
    ops.push({ op: 'text', text: row.amount, x: W - PAD, y: textY, size: ITEM, bold: false, align: 'right' });

    if (row.t === 'ink') {
      // A typed row carries its tick inside the name; handwriting has no string to put it in, so
      // it is drawn and the writing starts after it. The mobile rasteriser does the same thing in
      // the same order -- rastertest compares the two dot for dot.
      const markW = row.given ? meas.measureText(GIVEN_MARK).width : 0;
      if (row.given) {
        ops.push({ op: 'text', text: GIVEN_MARK, x: nameX, y: textY, size: ITEM, bold: false, align: 'left' });
      }
      // Shifted by the pen's overhang so its painted edge lands on the column, not half outside
      // it. The width cap is already in row.scale, worked out by planInk across the whole slip.
      ops.push({
        op: 'ink', ink: row.ink, x: nameX + markW + INK_BLEED, y: y + INK_BLEED,
        scale: row.scale, originY: row.originY,
      });
      // A shared scale means nothing overruns the row, so the advance is simply the row: the
      // writing, plus the room the pen needs above and below it.
      y += INK_ROW_ADVANCE;
      if (row.note) {
        ops.push({ op: 'text', text: row.note, x: nameX, y, size: 18, bold: false, align: 'left' });
        y += lineHeight(18);
      }
      y += 4;
      continue;
    }

    // Only the column heading carries one, so the word sits over the item names rather than
    // over the tick in front of them.
    const indent = row.indent ?? 0;
    for (const line of wrap(meas, row.name, ITEM, false, nameMax - indent)) {
      ops.push({ op: 'text', text: line, x: nameX + indent, y, size: ITEM, bold: false, align: 'left' });
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
  // One multiplier on the whole context, so every op below is written in dots and knows nothing
  // about which of the two jobs it is doing. At scale 1 this is byte-for-byte the print path.
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser will not give us a canvas to draw the receipt on');
  if (scale !== 1) ctx.scale(scale, scale);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  for (const op of ops) {
    if (op.op === 'dash') {
      for (let x = PAD; x < W - PAD; x += 8) ctx.fillRect(x, op.y, 4, 2);
    } else if (op.op === 'ink') {
      drawInk(ctx, op.ink, op.x, op.y, op.scale, op.originY);
    } else {
      ctx.font = font(op.size, op.bold);
      ctx.textAlign = op.align;
      ctx.fillText(op.text, op.x, op.y);
    }
  }

  // Packing to dots is only asked for by the printing path, and only ever at scale 1.
  const raster = (): Raster => {
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
  };

  return { canvas, raster };
}
