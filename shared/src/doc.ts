import type { Bill, BillLine, Ink, Settings } from './types';
import { lineAmount, money, round2 } from './money';
import { inkMaxWidth, paperProfile } from './paper';
import { EN_RECEIPT_LABELS, type ReceiptLabels } from './receiptLabels';

/** Kept for the 58mm default; the live width now comes from the shop's paper setting. */
export const PAPER_WIDTH = 384;

/** Dot height a handwritten description is scaled to. Tall enough for Kannada vowel signs to
 *  survive the print head, short enough that a long bill still fits on a sensible length of roll. */
export const INK_ROW_HEIGHT = 46;

/** Printed thickness of a pen stroke, in dots. Thin enough to keep Kannada legible at 58mm. */
export const INK_STROKE_DOTS = 3;

/**
 * Measurements both rasterisers need. They live here because there are two of them -- the web
 * app draws on a real canvas, the phone app draws in a hidden WebView -- and the two must not
 * disagree about how wide the quantity column is or where a dot turns black.
 */
export const RASTER = {
  /** Left and right margin, in dots. */
  pad: 4,
  /** Font size of an item line, in dots. */
  itemSize: 24,
  /** Width of the quantity column, in dots. */
  qtyCol: 44,
  /** Below this luminance a canvas pixel becomes a black dot. */
  threshold: 170,
};

export type Row =
  | { t: 'center'; text: string; size?: number; bold?: boolean }
  | { t: 'kv'; left: string; right: string; size?: number; bold?: boolean }
  | { t: 'item'; no: string; name: string; amount: string; note?: string }
  /** A handwritten description in the item column, with the price beside it. */
  | { t: 'ink'; no: string; ink: Ink; amount: string; note?: string }
  | { t: 'sep' }
  | { t: 'space'; h: number };

export type ReceiptDoc = { width: number; rows: Row[] };

/** "03/09/26 9:06 am" -- day-first, the way it is written everywhere else in India. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'am' : 'pm';
  return (
    p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) +
    ' ' + h12 + ':' + p2(d.getMinutes()) + ' ' + ampm
  );
}

/**
 * The one description of what a receipt looks like. The screen preview, the browser print sheet
 * and the Bluetooth raster all render from this, so what the shopkeeper sees is what comes out
 * of the paper.
 */
export function buildReceipt(
  bill: Bill,
  settings: Settings,
  labels: ReceiptLabels = EN_RECEIPT_LABELS,
): ReceiptDoc {
  const rows: Row[] = [
    { t: 'center', text: settings.shopName, size: 30, bold: true },
    { t: 'space', h: 6 },
    { t: 'kv', left: labels.bill + bill.no, right: stamp(bill.at), size: 20 },
  ];

  // Customer details sit at the top of the slip, above the item table.
  if (bill.customer && (bill.customer.name || bill.customer.phone)) {
    rows.push({ t: 'sep' });
    if (bill.customer.name) rows.push({ t: 'kv', left: labels.name, right: bill.customer.name, size: 20 });
    if (bill.customer.phone) rows.push({ t: 'kv', left: labels.phone, right: bill.customer.phone, size: 20 });
  }

  rows.push({ t: 'sep' });

  bill.lines.forEach((line, index) => {
    const shared = {
      // The line's place on the slip, not its quantity. Quantity is part of what the shopkeeper
      // writes by hand -- "2 kg rice" -- so a separate column of ones told nobody anything, while
      // a serial number matches the numbering on screen and makes a line easy to point at.
      no: String(index + 1),
      amount: money(lineAmount(line.qty, line.rate)),
      note: settings.showRate ? '@ ' + money(line.rate) : undefined,
    };
    // Handwriting wins over the typed names: it is what the shopkeeper actually wrote.
    if (line.ink && line.ink.strokes.length > 0) rows.push({ t: 'ink', ink: line.ink, ...shared });
    else rows.push({ t: 'item', name: line.nameKn || line.nameEn, ...shared });
  });

  rows.push(
    { t: 'sep' },
    { t: 'kv', left: labels.total, right: money(bill.total), size: 30, bold: true },
  );

  if (bill.showBalance) {
    rows.push(
      { t: 'kv', left: labels.paid, right: money(bill.paid), size: 22 },
      { t: 'kv', left: labels.balance, right: money(bill.balance), size: 24, bold: true },
    );
  }

  rows.push(
    { t: 'sep' },
    { t: 'space', h: 8 },
    { t: 'center', text: settings.footer, size: 22 },
    { t: 'space', h: 10 },
  );

  return { width: paperProfile(settings.paper).dots, rows };
}

export function billTotal(lines: BillLine[]): number {
  return round2(lines.reduce((sum, l) => sum + lineAmount(l.qty, l.rate), 0));
}

/** True when a line carries no description at all -- a bare price, which the shop does use. */
export function isPriceOnly(line: BillLine): boolean {
  return !line.nameKn && !line.nameEn && !(line.ink && line.ink.strokes.length > 0);
}
