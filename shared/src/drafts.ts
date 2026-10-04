import { billTotal } from './doc';
import type { BillLine, Customer, StockTicks } from './types';

/**
 * A bill being written, whole enough to put down and pick up again.
 *
 * A second customer arriving while the first bill is half-written used to mean either making them
 * wait or throwing away what was on the slip. So the app holds several of these and the shopkeeper
 * moves between them.
 *
 * Every field is one the bill screen used to keep on its own. Nothing here is derived: the total
 * is worked out from the lines, and the payment and the print-balance flags travel with the bill
 * because a part payment typed against one customer must not follow the shopkeeper to another.
 */
export type Draft = {
  id: string;
  lines: BillLine[];
  customer: Customer | null;
  /** When the attached customer's balance was last added to, for the dated line on the slip. */
  customerBalanceAt: string | null;
  /** What has been typed into the customer boxes but not yet attached to anybody. */
  typed: { name: string; nameKn: string; phone: string };
  paidInput: string;
  printBalance: boolean;
  /** Whether the shopkeeper has set the print-balance switch themselves, so it stops suggesting. */
  printBalanceTouched: boolean;
  /** The bill's own note, which prints under the totals. Travels with the bill like the payment. */
  note: string;
  /**
   * What the stock app knows this bill by while it is being written.
   *
   * Not `id`: that names the tab, and a tab that is cleared or printed keeps its id and starts a
   * new bill. Stock has to see a new bill then, or the next customer's lines would land under
   * the last one's draft on the worker screen. So every emptyDraft draws a fresh one, and the
   * saved bill carries it so stock can swap the draft for the bill.
   */
  draftId: string;
  /**
   * When each line's given tick last changed on this device, by the line's itemId, in epoch
   * milliseconds. Stock's workers tick lines too; when the two disagree the later one wins, and
   * this is billing's half of that comparison.
   */
  givenAt: Record<string, number>;
};

/**
 * How many bills may be waiting at once.
 *
 * A guess at a kirana counter, not a technical limit -- two or three is the realistic case. The
 * cost of a large number is handwriting: a written line is a few kilobytes of stroke coordinates,
 * so a stack of long bills is real storage. If the shop wants more, this is the only line to
 * change.
 */
export const MAX_PARKED = 6;

export function emptyDraft(id: string): Draft {
  return {
    id,
    lines: [],
    customer: null,
    customerBalanceAt: null,
    typed: { name: '', nameKn: '', phone: '' },
    paidInput: '',
    printBalance: false,
    printBalanceTouched: false,
    note: '',
    draftId: newDraftId(),
    givenAt: {},
  };
}

/** A draft id no other device will draw: the clock, and randomness after it. */
export function newDraftId(): string {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * A draft read back from storage, with anything it predates filled in.
 *
 * A parked bill is written to the device as JSON and read back on the next start, which means a
 * bill parked by yesterday's app is read by today's. Casting it and trusting the shape is how a
 * field added here becomes `undefined` on somebody's tablet -- and `isDraftEmpty` would then call
 * `.trim()` on it and take the bill screen down on launch, with the shopkeeper's half-written
 * bill inside. Everything added after the first release belongs in here.
 */
export function reviveDraft(raw: Draft): Draft {
  return {
    ...raw,
    note: typeof raw.note === 'string' ? raw.note : '',
    draftId: typeof raw.draftId === 'string' && raw.draftId ? raw.draftId : newDraftId(),
    givenAt: raw.givenAt && typeof raw.givenAt === 'object' ? raw.givenAt : {},
  };
}

/**
 * The bill being written, as the stock app's worker screen is sent it.
 *
 * Names, quantities, units and ticks -- no handwriting. The workers need to know a line is
 * written by hand so they can look at the counter; the strokes themselves are kilobytes they
 * could not read on a rack screen anyway. Blank scaffolding lines are left out like on paper.
 */
export function draftForStock(d: Draft, closed = false) {
  const lines = closed ? [] : d.lines.filter(lineHasSomething).map((l) => ({
    key: l.itemId,
    nameEn: l.nameEn,
    nameKn: l.nameKn,
    qty: l.qty,
    ...(l.unit ? { unit: l.unit } : {}),
    rate: l.rate,
    ...(l.stockItemId ? { stockItemId: l.stockItemId } : {}),
    given: l.given === true,
    ...(d.givenAt[l.itemId] ? { givenAt: d.givenAt[l.itemId] } : {}),
    ink: lineHasInk(l),
  }));
  const customerName = (d.customer?.name || d.customer?.nameKn || d.typed.name || d.typed.nameKn).trim();
  return {
    draftId: d.draftId,
    ...(customerName ? { customerName: customerName.slice(0, 80) } : {}),
    ...(closed ? { closed: true } : {}),
    lines,
  };
}

/**
 * Stock's ticks folded into a draft: per line, whichever side changed it last wins.
 *
 * A worker ticking an item fetched turns on `given` here, unless the counter changed that line's
 * tick after the worker did. Returns the draft untouched when nothing moved, so React can bail
 * out the way patchActive needs it to.
 */
export function mergeStockTicks(d: Draft, ticks: StockTicks): Draft {
  let lines = d.lines;
  let givenAt = d.givenAt;
  d.lines.forEach((l, i) => {
    const tick = ticks[l.itemId];
    if (!tick || typeof tick.at !== 'number') return;
    if (tick.at <= (givenAt[l.itemId] ?? 0)) return;
    if ((l.given === true) === (tick.fetched === true)) return;
    if (lines === d.lines) lines = [...d.lines];
    lines[i] = { ...l, given: tick.fetched === true };
    givenAt = { ...givenAt, [l.itemId]: tick.at };
  });
  return lines === d.lines ? d : { ...d, lines, givenAt };
}

/**
 * Whether a line carries anything at all.
 *
 * Written, priced, or typed -- any one of the three. The slip always keeps a spare line at the
 * foot, so "is there anything here" is asked constantly: to decide what prints, what to keep when
 * a bill is parked, when to add the next blank line, and whether a line can be cleared.
 *
 * It lives here because it was being written out by hand in nine places, and two of them still
 * said `!ink && rate === 0` -- the rule from before items could be typed. On those two the cross
 * that clears a line was greyed out for every typed item that had not been priced yet, so the
 * shopkeeper could cancel a hand-written line but not a typed one.
 */
/** Whether anything is written by hand on a line, on its first strip or an added one. */
export function lineHasInk(l: BillLine): boolean {
  return (l.ink != null && l.ink.strokes.length > 0) || (l.moreInk ?? []).some((i) => i.strokes.length > 0);
}

/**
 * Where the action key on a typed item goes: the next line with no handwriting on it.
 *
 * Written lines in between are stepped over, never turned into typing lines -- which is what
 * happened, and it hid the writing the shopkeeper had just done. -1 when there is none below,
 * and the caller goes to the fresh blank line the slip always keeps.
 */
export function nextTypingLine(lines: readonly BillLine[], from: number): number {
  for (let i = from + 1; i < lines.length; i += 1) if (!lineHasInk(lines[i]!)) return i;
  return -1;
}

export function lineHasSomething(l: BillLine): boolean {
  return (l.ink != null && l.ink.strokes.length > 0)
    || (l.moreInk ?? []).some((i) => i.strokes.length > 0)
    || l.rate > 0 || l.nameKn.trim() !== '';
}

/**
 * Nothing on it worth keeping.
 *
 * The slip always carries one blank line so there is somewhere to write next, so "empty" cannot
 * mean "no lines". It means nothing written, nothing priced, nobody attached and nothing typed --
 * which is what lets a spare bill be closed without asking, and lets the tab row hide a bill the
 * shopkeeper only opened by accident.
 */
export function isDraftEmpty(d: Draft): boolean {
  if (d.customer) return false;
  if (d.typed.name.trim() || d.typed.nameKn.trim() || d.typed.phone.trim()) return false;
  // A bill carrying nothing but a note is still something the shopkeeper wrote down on purpose.
  if (d.note.trim()) return false;
  return !d.lines.some(lineHasSomething);
}

/** What the bill comes to so far, for the tab that names it. */
export function draftTotal(d: Draft): number {
  return billTotal(d.lines);
}

/**
 * Take one out of the stack.
 *
 * Never returns an empty stack: closing the last bill leaves a fresh blank one, because the bill
 * screen has to have something to write on. The caller supplies the id for that replacement so
 * this stays pure and testable.
 */
export function closeDraft(list: Draft[], id: string, freshId: string): Draft[] {
  const left = list.filter((d) => d.id !== id);
  return left.length > 0 ? left : [emptyDraft(freshId)];
}

/** Which bill should be showing once `id` has gone -- the one before it, or the first one left. */
export function afterClosing(list: Draft[], id: string, activeId: string): string {
  if (id !== activeId) return activeId;
  const at = list.findIndex((d) => d.id === id);
  const left = list.filter((d) => d.id !== id);
  if (left.length === 0) return '';
  return (left[Math.max(0, at - 1)] ?? left[0])!.id;
}

let counter = 0;

/**
 * An id no other line will share.
 *
 * The old form was `'line-' + Date.now() + '-' + cart.length`, which is unique only while there
 * is one bill: two bills whose lines are made in the same millisecond at the same length collide.
 * The writing strips are keyed by this id, so a collision makes React reuse a mounted pad and one
 * bill's handwriting appears on another's line -- and undo then commits it there. The counter is
 * what makes that impossible.
 */
export function nextLineId(prefix = 'line'): string {
  counter += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + counter.toString(36);
}
