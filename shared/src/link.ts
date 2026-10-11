import { lineAmount, money } from './money';
import { lineHasInk } from './drafts';
import type { Bill, BillLine } from './types';

/*
 * The connection to the billing server, as both apps judge it, and the slimmed-down bill list.
 *
 * The tablet used to call itself offline after one slow answer and never take it back until a
 * full reload worked, so a shop on a working connection read "cannot reach the server" all day.
 * The rule now lives here, once, where a test can hold it to account: any answer at all from the
 * server clears the flag, and it is only raised after FAILS_BEFORE_OFFLINE misses in a row.
 */

/** How long a read may take before it counts as a miss. Shop wifi and 4G are slow, not absent. */
export const LOAD_TIMEOUT_MS = 15_000;
/** Saving a bill is worth waiting longer for: the alternative is the shopkeeper tapping again. */
export const SAVE_TIMEOUT_MS = 20_000;
/** While offline, how often to knock again. */
export const LINK_RETRY_MS = 15_000;
/** Misses in a row before the banner shows. One slow answer is not an outage. */
export const FAILS_BEFORE_OFFLINE = 2;

export type LinkWatch = {
  /** The server answered -- with anything, an error status included. */
  ok(): void;
  /** No answer: unreachable, or timed out. */
  fail(): void;
  readonly offline: boolean;
  readonly failures: number;
};

export function createLinkWatch(
  onChange: (offline: boolean) => void = () => undefined,
  threshold = FAILS_BEFORE_OFFLINE,
): LinkWatch {
  let failures = 0;
  let offline = false;
  const set = (next: boolean) => {
    if (next === offline) return;
    offline = next;
    onChange(next);
  };
  return {
    ok() {
      failures = 0;
      set(false);
    },
    fail() {
      failures += 1;
      if (failures >= threshold) set(true);
    },
    get offline() { return offline; },
    get failures() { return failures; },
  };
}

/**
 * A bill without its handwriting, for lists. Pen strokes are nearly all of a bill's weight, and a
 * list only needs to know they are there: each written line keeps `hasInk`, and the bill says
 * `hasInk` too, so a reader knows to ask `GET /bills/:no` for the strokes.
 */
export function liteBill(bill: Bill): Bill {
  let any = false;
  const lines = bill.lines.map((l) => {
    const { ink: _ink, moreInk: _more, ...rest } = l;
    if (!lineHasInk(l)) return rest;
    any = true;
    return { ...rest, hasInk: true };
  });
  return { ...bill, lines, hasInk: any };
}

/** The lines that go on paper and into the WhatsApp text: everything not hidden. */
export function printedLines<L extends { hidden?: boolean }>(lines: L[]): L[] {
  return lines.filter((l) => l.hidden !== true);
}

/**
 * The lines as the customer's copy shows them when the bill hides item descriptions
 * (Bill.hideNames): no typed name, no handwriting, no stock name -- quantity, unit, rate and
 * everything else kept. Unchanged when the bill shows names.
 */
export function namelessLines<L extends BillLine>(bill: { hideNames?: boolean }, lines: L[]): L[] {
  if (bill.hideNames !== true) return lines;
  return lines.map((l) => {
    const { ink: _ink, moreInk: _more, stockItemId: _stock, hasInk: _has, ...rest } = l as L & { hasInk?: boolean };
    return { ...rest, nameKn: '', nameEn: '' } as L;
  });
}

/**
 * The lines left off the paper, for History to say so under the receipt: "2. Bread ₹40 · 5. ₹120".
 * Numbered by their place on the bill, which is what the shopkeeper saw while writing it. Empty
 * when nothing was hidden.
 */
export function hiddenLinesText(bill: Pick<Bill, 'lines'>): string {
  return bill.lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.hidden === true)
    .map(({ l, i }) => {
      const name = (l.nameKn || l.nameEn || '').trim();
      return (i + 1) + '. ' + (name ? name + ' ' : '') + money(lineAmount(l.qty, l.rate));
    })
    .join(' · ');
}
