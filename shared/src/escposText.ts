import type { ReceiptDoc, Row } from './doc';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Dots per character of the printer's built-in Font A (12 x 24). */
const FONT_A_DOTS = 12;
/** A row this size or larger (the shop name, TOTAL) prints at double height. */
const BIG = 28;
/** Narrowest the line-number column gets: "12 ". It widens to fit the "No." heading or a 3-digit line. */
const MIN_NO_COL = 3;

/** Characters across the paper in Font A: 32 on 58mm (384 dots), 48 on 80mm (576 dots). */
export function textColumns(widthDots: number): number {
  return Math.floor(widthDots / FONT_A_DOTS);
}

const printable = (s: string | undefined) => !s || /^[\x20-\x7e]*$/.test(s);

/** Every piece of text the slip would print. */
function textsOf(row: Row): Array<string | undefined> {
  switch (row.t) {
    case 'center': return [row.text];
    case 'kv': return [row.left, row.right];
    case 'item': return [row.no, row.name, row.amount, row.note];
    case 'ink': return [row.no, row.amount, row.note];
    default: return [];
  }
}

/**
 * Whether this slip can go out as the printer's own text instead of an image: no handwriting
 * anywhere, and nothing but plain ASCII -- no Kannada (shop name, labels, items, footer), no tick
 * mark, no rupee sign. Most of these printers carry no Kannada font, so anything else keeps the
 * image path.
 */
export function canPrintAsText(doc: ReceiptDoc): boolean {
  return doc.rows.every((r) => r.t !== 'ink' && textsOf(r).every(printable));
}

/** Words of `text` packed into lines of at most `cols`, breaking a word only when it alone is longer. */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > cols) {
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!word) continue;
    const next = cur ? cur + ' ' + word : word;
    if (next.length > cols) { out.push(cur); cur = word; }
    else cur = next;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** `left` and `right` on one line of `cols`, or on two when they will not fit. */
function spread(left: string, right: string, cols: number): string[] {
  if (left.length + 1 + right.length <= cols) return [left + ' '.repeat(cols - left.length - right.length) + right];
  return [...wrapText(left, cols), right.padStart(cols)];
}

/**
 * The plain lines of text a slip comes to, in Font A columns. What receiptAsText prints, without
 * the control codes -- so a test can read the slip as a person would.
 */
export function receiptTextLines(doc: ReceiptDoc): string[] {
  return layout(doc).filter((p): p is { text: string } => 'text' in p).map((p) => p.text);
}

type Piece = { text: string; big?: boolean; wide?: boolean; bold?: boolean; center?: boolean } | { feed: number };

function layout(doc: ReceiptDoc): Piece[] {
  const cols = textColumns(doc.width);
  const out: Piece[] = [];
  const NO_COL = doc.rows.reduce((w, r) => (r.t === 'item' && r.no ? Math.max(w, r.no.length + 1) : w), MIN_NO_COL);
  for (const row of doc.rows) {
    if (row.t === 'space') out.push({ feed: row.h });
    else if (row.t === 'sep') out.push({ text: '-'.repeat(cols) });
    else if (row.t === 'center') {
      const big = (row.size ?? 0) >= BIG;
      for (const text of wrapText(row.text, big ? Math.floor(cols / 2) : cols)) {
        out.push({ text, big, wide: big, bold: row.bold, center: true });
      }
    } else if (row.t === 'kv') {
      const big = (row.size ?? 0) >= BIG;
      for (const text of spread(row.left, row.right, cols)) out.push({ text, big, bold: row.bold });
    } else if (row.t === 'item') {
      const no = row.no.padEnd(NO_COL);
      const room = Math.max(8, cols - NO_COL - (row.amount ? row.amount.length + 1 : 0));
      const names = row.name.trim() ? wrapText(row.name, room) : [''];
      names.forEach((name, i) => {
        const left = (i === 0 ? no : ' '.repeat(NO_COL)) + name;
        const amount = i === 0 ? row.amount : '';
        out.push({ text: amount ? left.padEnd(cols - amount.length) + amount : left.trimEnd() });
      });
      if (row.note) for (const t of wrapText(row.note, cols - NO_COL)) out.push({ text: ' '.repeat(NO_COL) + t });
    }
  }
  return out;
}

/**
 * The slip as ESC/POS text in the printer's built-in font: a few hundred bytes where the image
 * is tens of thousands, which is what makes a typed bill print at once. Null when the slip cannot
 * be text (see canPrintAsText) -- the caller then rasterises it as before.
 *
 * Built from the same ReceiptDoc as the image, so every receipt rule (hidden names, compact,
 * rate under items, round off, old balance, paid / balance, note, footer) is already applied.
 */
export function receiptAsText(doc: ReceiptDoc): Uint8Array | null {
  if (!canPrintAsText(doc)) return null;
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, 0x00, ESC, 0x33, 30]; // ESC 3 30: fixed line spacing
  for (const p of layout(doc)) {
    if ('feed' in p) {
      if (p.feed > 0) bytes.push(ESC, 0x4a, Math.min(255, Math.round(p.feed)));
      continue;
    }
    bytes.push(ESC, 0x61, p.center ? 1 : 0);
    bytes.push(GS, 0x21, (p.wide ? 0x10 : 0) | (p.big ? 0x01 : 0));
    bytes.push(ESC, 0x45, p.bold ? 1 : 0);
    for (let i = 0; i < p.text.length; i++) bytes.push(p.text.charCodeAt(i));
    bytes.push(LF);
  }
  bytes.push(ESC, 0x61, 0, GS, 0x21, 0, ESC, 0x45, 0, ESC, 0x32); // ESC 2: default spacing back
  bytes.push(ESC, 0x64, 0x04); // clear the tear bar, as the image path does
  return Uint8Array.from(bytes);
}
