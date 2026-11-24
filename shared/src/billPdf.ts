import { namelessLines, printedLines } from './link';
import { receiptLangOf, type Bill, type BillLine, type Ink, type Settings } from './types';
import { lineAmount, money, qtyText, rateText, round2 } from './money';
import { inkBounds, inkRowFit, inkSlipScale } from './ink';
import { EN_RECEIPT_LABELS, type ReceiptLabels } from './receiptLabels';
import { lineName, pickLang } from './i18n';
import { carriedBalance, dateStamp, inkStrips, shopAddressLines, shopPhoneLine, stamp } from './doc';
import { printedUnit } from './stock';

/**
 * A bill as an A4 PDF, for sharing.
 *
 * The slip picture is a 58mm roll drawn larger: fine for six lines, a long thin strip nobody can
 * read once a bill runs to forty (the shop's own words: "very hard to read if bill gets bigger").
 * This lays the same bill out as a table on A4 pages -- No, Item, Qty, Rate, Amount -- running
 * onto as many pages as it needs, the column headings repeated on each.
 *
 * Laid out here, once, as plain drawing steps in PDF points (595 x 842); the web page and the
 * tablet's hidden WebView both replay them on a canvas with PDF_PAGE_SCRIPT, so Kannada is shaped
 * by the browser and handwriting is drawn from its strokes, then each page goes into the file as
 * a picture (pdfFromJpegs).
 */

export const PDF_PAGE_W = 595;
export const PDF_PAGE_H = 842;
/** Pixels per point the pages are drawn at: about 144 dpi, sharp on a phone, small to send. */
export const PDF_DRAW_SCALE = 2;
export const PDF_FONT = '"Noto Sans Kannada","Noto Serif Kannada","Noto Sans",system-ui,sans-serif';

export type PdfOp =
  /** y is the baseline. Wider than maxW, the drawing shrinks the text to fit. */
  | { t: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; align?: 'left' | 'right' | 'center'; maxW?: number; color?: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string }
  /** Strokes in the ink's own units: page point = x + (inkX - ox) * scale, likewise y. */
  | { t: 'ink'; strokes: number[][]; x: number; y: number; ox: number; oy: number; scale: number; w: number };

export type PdfPage = { w: number; h: number; ops: PdfOp[] };

const M = 36;
const RIGHT = PDF_PAGE_W - M;
/** Room kept at the foot of every page for its page number. */
const FOOT = 30;
const COL = {
  no: { x: M, w: 30 },
  item: { x: M + 34, w: 250 },
  qtyR: 392,
  rateR: 466,
  amountR: RIGHT - 4,
};
const ITEM_SIZE = 11;
const ITEM_LEAD = 14;
const INK_ROW = 24;
const INK_PEN = 1.3;
const GREY = '#666666';
const RULE = '#d9d9d4';
const BAND = '#f5f5f1';
const HEAD_BAND = '#e4ece6';

/**
 * About how wide `text` prints at `size` points. Only for deciding where a long item name
 * wraps and how tall its row is; the drawing measures for real and shrinks anything that
 * still overflows, so a guess on the wide side costs a little white space and nothing else.
 */
export function pdfTextWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x0c80 && c <= 0x0cff) {
      // Vowel signs, virama and the like sit on the letter before them.
      em += (c >= 0x0cbe && c <= 0x0ccd) || (c >= 0x0c81 && c <= 0x0c83) || c === 0x0cd5 || c === 0x0cd6 ? 0.3 : 0.72;
    } else if (c === 0x20) em += 0.28;
    else if (c === 0x200c || c === 0x200d) em += 0;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39)) em += 0.64;
    else em += 0.54;
  }
  return em * size;
}

/** `text` broken into lines no wider than maxW, at most maxLines (the last one cut with …). */
export function pdfWrap(text: string, size: number, maxW: number, maxLines = 3): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const push = (s: string) => { if (s) lines.push(s); };
  for (const word of words) {
    const tryLine = cur ? cur + ' ' + word : word;
    if (pdfTextWidth(tryLine, size) <= maxW) { cur = tryLine; continue; }
    push(cur);
    cur = '';
    if (pdfTextWidth(word, size) <= maxW) { cur = word; continue; }
    // One word wider than the column: broken where it runs out of room.
    let piece = '';
    for (const ch of Array.from(word)) {
      if (piece && pdfTextWidth(piece + ch, size) > maxW) { push(piece); piece = ''; }
      piece += ch;
    }
    cur = piece;
  }
  push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1] + '…';
  return kept;
}

/** What one line of the bill puts in the table. */
type TableRow = {
  no: string;
  /** Typed words, already wrapped. */
  text: string[];
  given: boolean;
  /** Writing strips, drawn above any typed words. */
  strips: { ink: Ink; rows: number }[];
  qty: string;
  rate: string;
  amount: string;
};

function tableRows(bill: Bill, lang: 'en' | 'kn', labels: ReceiptLabels): TableRow[] {
  const lines = namelessLines(bill, printedLines(bill.lines));
  const out: TableRow[] = lines.map((line: BillLine, index) => {
    const typedAll = line.stockItemId ? lineName(line, lang) : line.nameKn || line.nameEn;
    const stripsAll = inkStrips(line);
    // Written and typed both: whichever was used last, as on the paper.
    const both = stripsAll.length > 0 && typedAll.trim() !== '';
    const strips = both && line.lastMode === 'text' ? [] : stripsAll;
    const typed = both && line.lastMode === 'ink' ? '' : typedAll;
    // As on the paper: a typed quantity with no unit of its own says NOS (printedUnit).
    const unit = printedUnit(line);
    // A plain "item, price" line has no quantity or rate worth a column: they would only say
    // 1 and the price again. Anything counted -- a unit, or more than one -- shows both.
    const counted = unit !== '' || line.qty !== 1;
    const tick = line.given === true;
    return {
      no: String(index + 1),
      text: typed.trim() ? pdfWrap((tick && strips.length === 0 ? '✓ ' : '') + typed, ITEM_SIZE, COL.item.w) : [],
      given: tick,
      strips,
      qty: counted ? qtyText(line.qty) + (unit ? ' ' + unit : '') : '',
      rate: counted && line.rate > 0 ? rateText(line.rate) : '',
      amount: money(lineAmount(line.qty, line.rate)),
    };
  });
  const carried = carriedBalance(bill.showBalance, bill.previousBalance);
  if (carried > 0) {
    out.push({
      no: String(lines.length + 1),
      text: [bill.previousBalanceAt ? labels.oldBalance + ' ' + dateStamp(bill.previousBalanceAt) : labels.oldBalance],
      given: false, strips: [], qty: '', rate: '', amount: money(carried),
    });
  }
  const advance = round2(bill.advance ?? 0);
  if (advance > 0) {
    out.push({ no: '', text: [labels.advance], given: false, strips: [], qty: '', rate: '', amount: '-' + money(advance) });
  }
  return out;
}

/** The bill laid out on A4 pages, as drawing steps. Always at least one page. */
export function billPdfPages(bill: Bill, settings: Settings, labels: ReceiptLabels = EN_RECEIPT_LABELS): PdfPage[] {
  const lang = receiptLangOf(settings);
  const quotation = bill.kind === 'quotation';
  const shopName = pickLang(settings.shopName, settings.shopNameKn, lang);
  const billNo = (quotation ? labels.quote : labels.bill) + bill.no;
  const rows = tableRows(bill, lang, labels);

  // One size of handwriting for the whole bill, as on the slip.
  const allStrips = rows.flatMap((r) => r.strips);
  const tickW = rows.some((r) => r.given && r.strips.length > 0) ? 12 : 0;
  const inkRoom = COL.item.w - tickW;
  const inkK = inkSlipScale(allStrips.map((s) => s.ink), inkRoom, INK_ROW, allStrips.map((s) => s.rows));

  const pages: PdfPage[] = [];
  let ops: PdfOp[] = [];
  let y = M;
  const bottom = PDF_PAGE_H - M - FOOT;

  const text = (x: number, yy: number, s: string, size: number, o: Partial<Extract<PdfOp, { t: 'text' }>> = {}) => {
    if (s) ops.push({ t: 'text', x, y: yy, text: s, size, ...o });
  };
  const rule = (yy: number, color = RULE, w = 0.6) => ops.push({ t: 'line', x1: M, y1: yy, x2: RIGHT, y2: yy, w, color });

  const tableHead = () => {
    ops.push({ t: 'rect', x: M, y, w: RIGHT - M, h: 20, fill: HEAD_BAND });
    const base = y + 14;
    text(COL.no.x + COL.no.w / 2, base, labels.no, 10, { bold: true, align: 'center' });
    text(COL.item.x, base, labels.item, 10, { bold: true });
    text(COL.qtyR, base, labels.qty, 10, { bold: true, align: 'right' });
    text(COL.rateR, base, labels.rate, 10, { bold: true, align: 'right' });
    text(COL.amountR, base, labels.amount, 10, { bold: true, align: 'right' });
    y += 20;
  };

  const newPage = (withTable: boolean) => {
    pages.push({ w: PDF_PAGE_W, h: PDF_PAGE_H, ops });
    ops = [];
    y = M;
    // A short heading on every page after the first, so a loose page still says whose it is.
    text(M, y + 10, shopName + '  ·  ' + billNo, 10, { bold: true, maxW: 360 });
    text(RIGHT, y + 10, stamp(bill.at), 10, { align: 'right', color: GREY });
    y += 20;
    if (withTable) tableHead();
  };

  // ---------------------------------------------------------------- first page heading
  text(PDF_PAGE_W / 2, y + 20, shopName, 20, { bold: true, align: 'center', maxW: RIGHT - M });
  y += 28;
  for (const line of shopAddressLines(settings, lang).flatMap((l) => pdfWrap(l, 10, RIGHT - M - 40, 2))) {
    text(PDF_PAGE_W / 2, y + 10, line, 10, { align: 'center', color: GREY });
    y += 14;
  }
  const shopPhone = shopPhoneLine(settings, labels);
  if (shopPhone) {
    text(PDF_PAGE_W / 2, y + 10, shopPhone, 10, { align: 'center', color: GREY });
    y += 14;
  }
  if (settings.gstin && settings.gstin.trim() && settings.showGstin !== false) {
    text(PDF_PAGE_W / 2, y + 10, labels.gstin + ' ' + settings.gstin.trim(), 10, { align: 'center', color: GREY });
    y += 15;
  }
  if (quotation) {
    text(PDF_PAGE_W / 2, y + 15, labels.quoteTitle, 15, { bold: true, align: 'center' });
    y += 22;
  }
  y += 4;
  rule(y, '#999999', 0.8);
  y += 8;
  text(M, y + 12, billNo, 12, { bold: true });
  text(RIGHT, y + 12, stamp(bill.at), 11, { align: 'right' });
  y += 19;
  if (bill.customer) {
    const who = pickLang(bill.customer.name, bill.customer.nameKn, lang);
    if (who) text(M, y + 12, labels.name + ': ' + who, 11, { maxW: 330 });
    if (bill.customer.phone) text(RIGHT, y + 12, labels.phone + ': ' + bill.customer.phone, 11, { align: 'right' });
    if (who || bill.customer.phone) y += 19;
  }
  y += 6;
  tableHead();

  // ---------------------------------------------------------------- the lines
  rows.forEach((r, i) => {
    // Each strip as tall as its writing, the typed words under it.
    const stripFits = r.strips.map((s) => {
      const fit = inkRowFit(s.ink, inkRoom, INK_ROW * s.rows, inkK);
      const box = inkBounds(s.ink);
      const drawnH = (box.maxY - box.minY) * fit.scale;
      return { ...s, scale: fit.scale, box, h: Math.max(18, Math.ceil(drawnH + 8)) };
    });
    const inkH = stripFits.reduce((h, s) => h + s.h, 0);
    const textH = r.text.length ? r.text.length * ITEM_LEAD + 6 : 0;
    const h = Math.max(20, inkH + textH);
    if (y + h > bottom) newPage(true);

    if (i % 2 === 1) ops.push({ t: 'rect', x: M, y, w: RIGHT - M, h, fill: BAND });
    // Number and figures level with the first line of the item.
    const firstH = stripFits[0]?.h ?? h;
    const base = stripFits.length || !r.text.length ? y + Math.min(firstH, h) / 2 + 4 : y + 4 + ITEM_SIZE;
    text(COL.no.x + COL.no.w / 2, base, r.no, 10, { align: 'center', color: GREY });
    text(COL.qtyR, base, r.qty, ITEM_SIZE, { align: 'right', maxW: 66 });
    text(COL.rateR, base, r.rate, ITEM_SIZE, { align: 'right', maxW: 70 });
    text(COL.amountR, base, r.amount, ITEM_SIZE, { align: 'right', bold: true, maxW: 86 });

    let top = y;
    stripFits.forEach((s, k) => {
      if (k === 0 && r.given) text(COL.item.x, top + s.h / 2 + 4, '✓', ITEM_SIZE, { bold: true });
      const drawnH = (s.box.maxY - s.box.minY) * s.scale;
      ops.push({
        t: 'ink', strokes: s.ink.strokes, scale: s.scale, w: INK_PEN,
        x: COL.item.x + tickW, ox: s.box.minX,
        y: top + (s.h - drawnH) / 2, oy: s.box.minY,
      });
      top += s.h;
    });
    r.text.forEach((line, k) => text(COL.item.x, top + 4 + ITEM_SIZE + k * ITEM_LEAD, line, ITEM_SIZE, { maxW: COL.item.w }));
    y += h;
    ops.push({ t: 'line', x1: M, y1: y, x2: RIGHT, y2: y, w: 0.4, color: RULE });
  });

  // ---------------------------------------------------------------- totals
  const carried = carriedBalance(bill.showBalance, bill.previousBalance);
  const roundOff = round2(bill.roundOff ?? 0);
  const note = (bill.note ?? '').trim();
  const noteLines = note ? pdfWrap(labels.note + ': ' + note, 10, RIGHT - M, 6) : [];
  const totalsH = 12 + (roundOff !== 0 ? 18 : 0) + 26 + (bill.showBalance ? 36 : 0)
    + (noteLines.length ? noteLines.length * 13 + 8 : 0) + (quotation ? 22 : 0) + 30;
  if (y + totalsH > bottom) newPage(false);
  y += 12;
  const kv = (left: string, right: string, size: number, bold = false) => {
    text(340, y + size, left, size, { bold });
    text(COL.amountR, y + size, right, size, { bold, align: 'right' });
    y += size + 7;
  };
  if (roundOff !== 0) kv(labels.roundOff, (roundOff > 0 ? '+' : '') + money(roundOff), 11);
  ops.push({ t: 'line', x1: 336, y1: y, x2: RIGHT, y2: y, w: 1, color: '#333333' });
  y += 4;
  kv(labels.total, money(round2(bill.total + carried - round2(bill.advance ?? 0))), 15, true);
  if (bill.showBalance) {
    kv(labels.paid, money(bill.paid), 11);
    kv(labels.balance, money(bill.balance), 12, true);
  }
  if (noteLines.length) {
    y += 8;
    noteLines.forEach((line) => { text(M, y + 10, line, 10); y += 13; });
  }
  if (quotation) {
    y += 8;
    text(PDF_PAGE_W / 2, y + 12, labels.quoteNote, 12, { bold: true, align: 'center' });
    y += 14;
  }
  const footer = pickLang(settings.footer, settings.footerKn, lang);
  if (footer) {
    y += 14;
    text(PDF_PAGE_W / 2, y + 10, footer, 10, { align: 'center', color: GREY, maxW: RIGHT - M });
  }
  pages.push({ w: PDF_PAGE_W, h: PDF_PAGE_H, ops });

  // Page numbers, once the count is known.
  if (pages.length > 1) {
    pages.forEach((p, n) => p.ops.push({
      t: 'text', x: PDF_PAGE_W / 2, y: PDF_PAGE_H - M + 4, size: 9, align: 'center', color: GREY,
      text: labels.page + ' ' + (n + 1) + ' / ' + pages.length,
    }));
  }
  return pages;
}

/**
 * Replays a PdfPage on a 2D canvas: `drawPdfPage(ctx, page, pixelsPerPoint, font)`. Kept as
 * source text so the tablet's WebView runs the very same lines the website does.
 */
export const PDF_PAGE_SCRIPT = `
var drawPdfPage = function (ctx, page, k, FONT) {
  ctx.save();
  ctx.scale(k, k);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, page.w, page.h);
  ctx.textBaseline = 'alphabetic';
  for (var i = 0; i < page.ops.length; i++) {
    var o = page.ops[i];
    if (o.t === 'rect') {
      ctx.fillStyle = o.fill;
      ctx.fillRect(o.x, o.y, o.w, o.h);
    } else if (o.t === 'line') {
      ctx.strokeStyle = o.color;
      ctx.lineWidth = o.w;
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
    } else if (o.t === 'ink') {
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
      ctx.lineWidth = o.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (var s = 0; s < o.strokes.length; s++) {
        var p = o.strokes[s];
        if (p.length < 2) continue;
        var x0 = o.x + (p[0] - o.ox) * o.scale, y0 = o.y + (p[1] - o.oy) * o.scale;
        if (p.length < 4) { ctx.beginPath(); ctx.arc(x0, y0, o.w / 2, 0, Math.PI * 2); ctx.fill(); continue; }
        ctx.beginPath(); ctx.moveTo(x0, y0);
        for (var j = 2; j + 1 < p.length; j += 2) ctx.lineTo(o.x + (p[j] - o.ox) * o.scale, o.y + (p[j + 1] - o.oy) * o.scale);
        ctx.stroke();
      }
    } else if (o.t === 'text') {
      var size = o.size;
      ctx.font = (o.bold ? 'bold ' : '') + size + 'px ' + FONT;
      if (o.maxW) {
        var w = ctx.measureText(o.text).width;
        if (w > o.maxW) {
          size = Math.max(size * 0.6, size * o.maxW / w);
          ctx.font = (o.bold ? 'bold ' : '') + size + 'px ' + FONT;
        }
      }
      ctx.fillStyle = o.color || '#111';
      ctx.textAlign = o.align || 'left';
      ctx.fillText(o.text, o.x, o.y);
    }
  }
  ctx.restore();
};
`;

/**
 * A PDF holding one JPEG per page, each filling an A4 page. Hand-written because it is this
 * small: a catalogue, a page tree, and per page a page, its picture and a one-line drawing.
 */
export function pdfFromJpegs(
  images: { jpeg: Uint8Array; width: number; height: number }[],
  pageW = PDF_PAGE_W,
  pageH = PDF_PAGE_H,
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const offsets: number[] = [];
  const ascii = (s: string) => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  };
  const put = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? ascii(b) : b;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = size;
    put(n + ' 0 obj\n' + body + '\nendobj\n');
  };

  const n = images.length;
  const pageObj = (i: number) => 3 + i * 3;
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Count ' + n + ' /Kids [' + images.map((_, i) => pageObj(i) + ' 0 R').join(' ') + '] >>');
  images.forEach((img, i) => {
    const p = pageObj(i);
    obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] '
      + '/Resources << /XObject << /Im0 ' + (p + 1) + ' 0 R >> >> /Contents ' + (p + 2) + ' 0 R >>');
    offsets[p + 1] = size;
    put((p + 1) + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + img.jpeg.length + ' >>\nstream\n');
    put(img.jpeg);
    put('\nendstream\nendobj\n');
    const draw = 'q\n' + pageW + ' 0 0 ' + pageH + ' 0 0 cm\n/Im0 Do\nQ\n';
    obj(p + 2, '<< /Length ' + draw.length + ' >>\nstream\n' + draw + 'endstream');
  });
  const count = 3 + n * 3;
  const xref = size;
  let table = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
  for (let i = 1; i < count; i++) table += String(offsets[i] ?? 0).padStart(10, '0') + ' 00000 n \n';
  put(table + 'trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** The file name a shared bill goes by. */
export function billPdfName(bill: { kind?: string; no: number | string }): string {
  return (bill.kind === 'quotation' ? 'quotation-' : 'bill-') + bill.no + '.pdf';
}
