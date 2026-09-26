import type { Bill, BillLine, Ink, Settings } from './types';
import { lineAmount, money, round2 } from './money';
import { INK_BLEED, INK_GUTTER, INK_STROKE_DOTS, inkRowFit, inkSlipScale } from './ink';
import { inkMaxWidth, paperProfile } from './paper';
import { EN_RECEIPT_LABELS, type ReceiptLabels } from './receiptLabels';
import { pickLang } from './i18n';

/** Kept for the 58mm default; the live width now comes from the shop's paper setting. */
export const PAPER_WIDTH = 384;

/**
 * What marks an item as handed over rather than merely listed.
 *
 * Composed into the item's name here rather than drawn by each renderer. A slip is drawn four
 * ways -- the screen preview, the browser's print stylesheet, the counter PC's canvas and the
 * phone's WebView -- and rastertest exists because the last two must agree dot for dot. One
 * string handed to all four cannot disagree with itself; four separate drawing changes could.
 */
export const GIVEN_MARK = '✓ ';

/** Dot height a handwritten description is scaled to. Tall enough for Kannada vowel signs to
 *  survive the print head, short enough that a long bill still fits on a sensible length of roll.
 *  Raised from 46 at the shop's asking: their own hand is the point of the slip, and it was
 *  printing smaller than the machine text beside it. */
export const INK_ROW_HEIGHT = 64;

/** What a hand-written row advances by: the writing, plus room for the pen above and below it. */
export const INK_ROW_ADVANCE = INK_ROW_HEIGHT + 2 * INK_BLEED;


// The pen's thickness, its overhang and the gutter before it all live with the rest of the
// handwriting geometry; re-exported here because every renderer already imports them from doc.
export { INK_BLEED, INK_GUTTER, INK_STROKE_DOTS } from './ink';

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

/**
 * How far down a hand-written row a line of text starts.
 *
 * The writing fills all 68 dots of the row; a 24-dot glyph drawn at the top of it -- the line
 * number, the price, the given tick -- sat in a band of its own with the handwriting underneath,
 * so one row read as two. This drops them to the middle, level with the writing.
 *
 * It lives here, and not in each renderer, for the reason `GIVEN_MARK` does: four renderers draw
 * this row and rastertest holds two of them to the same dots. One number they all read cannot
 * disagree with itself.
 */
export const INK_TEXT_DY = Math.round((INK_ROW_ADVANCE - RASTER.itemSize) / 2);

/**
 * Every number and glyph the phone's rasteriser needs, in one object.
 *
 * That page holds the algorithm and none of the measurements -- they are handed to it. Three
 * callers were each assembling this list by hand (the app, and two test harnesses), so a constant
 * added here reached the app but not the tests: the parity test went green while the two
 * rasterisers disagreed, and one harness had been missing the tick glyph entirely without anyone
 * noticing. One list, built once, cannot drift from itself.
 */
export function rasterNumbers() {
  return {
    pad: RASTER.pad,
    itemSize: RASTER.itemSize,
    qtyCol: RASTER.qtyCol,
    threshold: RASTER.threshold,
    inkRowAdvance: INK_ROW_ADVANCE,
    inkStrokeDots: INK_STROKE_DOTS,
    inkGutter: INK_GUTTER,
    inkBleed: INK_BLEED,
    givenMark: GIVEN_MARK,
    inkTextDy: INK_TEXT_DY,
  };
}

/**
 * How far right of the item column the word naming it prints.
 *
 * Flush with the names it sat over the given tick rather than over the words, because a ticked
 * line begins with one. A little to the right at the shop's asking, and only the heading moves:
 * indenting the column itself would cost writing room on a 58mm roll.
 */
export const ITEM_HEAD_INDENT = 24;

export type Row =
  | { t: 'center'; text: string; size?: number; bold?: boolean }
  | { t: 'kv'; left: string; right: string; size?: number; bold?: boolean }
  | { t: 'item'; no: string; name: string; amount: string; note?: string; indent?: number }
  /** A handwritten description in the item column, with the price beside it. */
  | {
      t: 'ink'; no: string; ink: Ink; amount: string; note?: string; scale: number; originY: number;
      /** Marked as handed over. Drawn before the writing, where the typed rows carry it in text. */
      given?: boolean;
    }
  | { t: 'sep' }
  | { t: 'space'; h: number };

export type ReceiptDoc = { width: number; rows: Row[] };

/** "03/09/26" -- day-first, and short enough to sit beside a label inside the item column. */
export function dateStamp(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
}

/** "03/09/26 9:06 am" -- day-first, the way it is written everywhere else in India. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'am' : 'pm';
  return dateStamp(iso) + ' ' + h12 + ':' + p2(d.getMinutes()) + ' ' + ampm;
}

/**
 * The one description of what a receipt looks like. The screen preview, the browser print sheet
 * and the Bluetooth raster all render from this, so what the shopkeeper sees is what comes out
 * of the paper.
 */
/**
 * What a bill carries in from the customer's old balance.
 *
 * Nothing unless the balance lines are being printed -- without the Paid and Balance lines under
 * it, a larger total has nothing to explain it -- and never a credit, which would make the total
 * smaller than the lines above it and read as a fault.
 *
 * Lives here, beside the receipt, because the bill screen has to show the same figure the paper
 * will. Two copies of this rule is exactly how the screen and the slip come to disagree about
 * what a customer owes.
 */
export function carriedBalance(showBalance: boolean, previousBalance?: number | null): number {
  return showBalance && previousBalance != null && previousBalance > 0 ? round2(previousBalance) : 0;
}

export function buildReceipt(
  bill: Bill,
  settings: Settings,
  labels: ReceiptLabels = EN_RECEIPT_LABELS,
): ReceiptDoc {
  /*
   * Which script the slip speaks. The shop's own language setting decides, and each name falls
   * through to the other when only one was filled in -- so a shop that has not typed a Kannada
   * name yet still gets its English one on the paper rather than a blank line.
   */
  const lang = settings.language === 'kn' ? 'kn' : 'en';
  const shopName = pickLang(settings.shopName, settings.shopNameKn, lang);

  const rows: Row[] = [
    { t: 'center', text: shopName, size: 30, bold: true },
  ];

  // Under the shop name, where a customer and an inspector both look for it. Only when the shop
  // has entered one -- a slip for a shop with no GST number should not carry an empty label.
  // Both: a number to print, and the shopkeeper wanting it printed. `showGstin` is absent on
  // settings saved before the switch existed, and undefined there means yes -- a shop that had
  // entered its number was already printing it.
  if (settings.gstin && settings.gstin.trim() && settings.showGstin !== false) {
    rows.push({ t: 'center', text: labels.gstin + ' ' + settings.gstin.trim(), size: 20 });
  }

  rows.push(
    { t: 'space', h: 6 },
    { t: 'kv', left: labels.bill + bill.no, right: stamp(bill.at), size: 20 },
  );

  // Customer details sit at the top of the slip, above the item table.
  const customerName = bill.customer
    ? pickLang(bill.customer.name, bill.customer.nameKn, lang)
    : '';
  if (bill.customer && (customerName || bill.customer.phone)) {
    rows.push({ t: 'sep' });
    if (customerName) rows.push({ t: 'kv', left: labels.name, right: customerName, size: 20 });
    if (bill.customer.phone) rows.push({ t: 'kv', left: labels.phone, right: bill.customer.phone, size: 20 });
  }

  rows.push(
    { t: 'sep' },
    // The columns, named. An `item` row rather than a type of its own: all four renderers
    // already draw one, so the headings cost nothing and cannot fall out of step between the
    // counter PC and the phone.
    { t: 'item', no: labels.no, name: labels.item, amount: labels.price, indent: ITEM_HEAD_INDENT },
  );

  // Each hand-written line is fitted to its own row, so the slip reads as even lines rather
  // than as writing of several different sizes drifting up and down. See inkRowFit.
  const inkRoom = inkMaxWidth(paperProfile(settings.paper).dots);
  // One enlargement for the whole slip, so every line of one hand stays one size.
  const inkK = inkSlipScale(
    bill.lines.filter((l) => l.ink && l.ink.strokes.length > 0).map((l) => l.ink as Ink),
    inkRoom,
    INK_ROW_HEIGHT,
  );

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
    if (line.ink && line.ink.strokes.length > 0) {
      const fit = inkRowFit(line.ink, inkRoom, INK_ROW_HEIGHT, inkK);
      rows.push({
        t: 'ink', ink: line.ink, scale: fit.scale, originY: fit.originY,
        given: line.given === true, ...shared,
      });
    }
    else {
      const name = line.nameKn || line.nameEn;
      rows.push({ t: 'item', name: line.given ? GIVEN_MARK + name : name, ...shared });
    }
  });

  /*
   * What they already owed, printed as the last line of the table rather than as a footnote.
   * It is part of what is being asked for, so it is added up with everything else -- which is
   * what makes TOTAL - Paid = Balance true on the paper. Before this, a slip could read
   * "TOTAL 150, Paid 100, Balance 500" and a customer had no way to see where 500 came from.
   *
   * Gated on showBalance: without the Paid and Balance lines under it, a larger TOTAL has
   * nothing to explain it, and a cash customer would be handed a slip demanding more than they
   * just bought. Never printed when it is negative -- a customer in credit would make TOTAL
   * smaller than the lines above it, which reads as a fault.
   */
  const carried = carriedBalance(bill.showBalance, bill.previousBalance);

  if (carried > 0) {
    rows.push({
      t: 'item',
      // Carries on from the written lines: the column is a line's place on the paper, and a gap
      // or a dash there reads as a printing fault.
      no: String(bill.lines.length + 1),
      name: bill.previousBalanceAt
        ? labels.oldBalance + ' ' + dateStamp(bill.previousBalanceAt)
        : labels.oldBalance,
      amount: money(carried),
    });
  }

  rows.push(
    { t: 'sep' },
    // bill.total is the shop's own figure and is left alone; only what the paper says changes.
    { t: 'kv', left: labels.total, right: money(round2(bill.total + carried)), size: 30, bold: true },
  );

  if (bill.showBalance) {
    rows.push(
      { t: 'kv', left: labels.paid, right: money(bill.paid), size: 22 },
      { t: 'kv', left: labels.balance, right: money(bill.balance), size: 24, bold: true },
    );
  }

  /**
   * The bill's own note, under the totals and above the shop's footer line.
   *
   * A plain `center` row rather than a row kind of its own, on purpose: four renderers draw a
   * slip and none of them handles an unknown kind, so a fifth kind is a fifth chance for one of
   * them to draw nothing. `center` is also the only row the rasterisers already word-wrap by
   * measurement, which is what a free-text note on a 58mm roll needs.
   */
  const note = (bill.note ?? '').trim();
  if (note !== '') {
    rows.push(
      { t: 'space', h: 6 },
      { t: 'center', text: labels.note + ': ' + note, size: 22 },
    );
  }

  rows.push(
    { t: 'sep' },
    { t: 'space', h: 8 },
    { t: 'center', text: pickLang(settings.footer, settings.footerKn, lang), size: 22 },
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
