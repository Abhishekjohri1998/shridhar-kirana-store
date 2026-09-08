import { billTotal } from './doc';
import type { BillLine, Customer } from './types';

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
  };
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
  return !d.lines.some(
    (l) => (l.ink && l.ink.strokes.length > 0) || l.rate > 0 || l.nameKn.trim().length > 0,
  );
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
