import type { PaperKey } from './paper';

/** Which language the interface and the receipt labels are shown in. */
export type Lang = 'en' | 'kn';
export const LANGS: Lang[] = ['en', 'kn'];

/** One sellable good. `nameKn` is what gets printed, `nameEn` is what the shopkeeper types to search. */
export type Item = {
  id: string;
  nameKn: string;
  nameEn: string;
  /** Price per unit, in rupees. */
  rate: number;
  /** Free text shown next to the rate: pc, kg, ltr, pkt ... */
  unit: string;
};

/**
 * A handwritten item description, kept as strokes rather than as a picture.
 *
 * The shop writes item names with a stylus today (Galaxy Tab + Samsung Notes), and Kannada is
 * quicker to write than to type. Storing the pen path instead of a bitmap means the same ink can
 * be redrawn crisply at screen resolution, at 384 dots for the print head, and at whatever a
 * future printer wants -- a flattened image could only ever be scaled.
 */
export type Ink = {
  /** The box the strokes were drawn in. Everything else scales against this. */
  w: number;
  h: number;
  /** One entry per pen-down..pen-up, flattened to [x0,y0,x1,y1,...] to keep the payload small. */
  strokes: number[][];
};

export const INK_LIMITS = {
  maxStrokes: 200,
  /** Points per stroke, after thinning. A written word needs a few dozen. */
  maxPointsPerStroke: 600,
  maxTotalPoints: 6000,
};

/**
 * A line on the bill. Names, ink and rate are copied in, so editing an item later never rewrites
 * a bill that has already been printed.
 *
 * A line carries an item description as typed text, as handwriting, or as neither -- the shop
 * sometimes rings up a bare price with no description at all.
 */
export type BillLine = {
  itemId: string;
  nameKn: string;
  nameEn: string;
  /** Handwritten description. When present it is what prints, in place of the names. */
  ink?: Ink;
  qty: number;
  rate: number;
};

export type BillCustomer = {
  id: string;
  name: string;
  phone: string;
};

export type Bill = {
  no: number;
  /** ISO timestamp. */
  at: string;
  /** Copied in, so a renamed customer does not change an old receipt. */
  customer?: BillCustomer;
  lines: BillLine[];
  total: number;
  /** Cash taken for this bill. Equal to the total on a fully paid bill. */
  paid: number;
  /** What the customer still owes across every bill, as of this one. */
  balance: number;
  /**
   * What they owed before this bill, and the date that figure was last added to.
   *
   * Stored rather than worked out again at print time, for the same reason the customer's name
   * is copied in: a reprint months later has to match the paper the customer is holding, even
   * though their balance has moved on since.
   */
  previousBalance?: number;
  previousBalanceAt?: string | null;
  /** Whether the paid and balance lines print. The shop wants this optional per bill. */
  showBalance: boolean;
};

/** A customer, plus the running figures the shop asked to see for each of them. */
export type Customer = {
  id: string;
  name: string;
  phone: string;
  /** ISO timestamp of the first bill, or of when the record was created. */
  since: string;
  /** Everything ever billed to them -- the "customer total transaction" figure. */
  totalBilled: number;
  totalPaid: number;
  /** totalBilled - totalPaid. Positive means they owe the shop. */
  balance: number;
  billCount: number;
  /** ISO timestamp of their most recent bill, or null if they have none yet. */
  lastVisit: string | null;
};

export type Settings = {
  shopName: string;
  footer: string;
  /** Which roll the shop's printer takes. Decides how wide the receipt is laid out. */
  paper: PaperKey;
  /** Interface and receipt language. */
  language: Lang;
  /** Print the per-unit rate under each item name. The shop's paper slip does not, so this is off by default. */
  showRate: boolean;
  /** A customer quiet for this many days is flagged as needing a nudge. */
  inactiveAfterDays: number;
};

export const DEFAULT_SETTINGS: Settings = {
  shopName: 'Shridhar Kirani Stores',
  footer: 'Thank you, Visit again!',
  paper: '58mm',
  language: 'en',
  showRate: false,
  inactiveAfterDays: 30,
};

export type TodaySummary = { count: number; total: number };
