import { round2 } from './money';
import { searchKey } from './kannada';
import type { Item, ItemUnit } from './types';

/**
 * Prices for goods sold several ways, and the rounding of a bill.
 *
 * All pure, so the tablet, the counter PC and the server agree on every figure without asking
 * one another.
 */

/** The unit stock is counted in: the first one, which is always one base unit. */
export function baseUnit(item: Item): ItemUnit | undefined {
  return item.units[0];
}

export function unitOf(item: Item, code: string): ItemUnit | undefined {
  return item.units.find((u) => u.code === code);
}

/** How many base units `qty` of this unit is. A box of Parle-G is 6 packs is 144 pieces. */
export function toBase(unit: ItemUnit, qty: number): number {
  return round2(qty * unit.perBase);
}

export type Price = {
  /** Rate for one of the unit, in rupees. */
  rate: number;
  /** Rate times quantity. */
  amount: number;
  /** Which slab applied, if any, so the screen can say why the rate dropped. */
  slab: number | null;
};

/**
 * What `qty` of `unit` costs.
 *
 * The highest slab reached applies to the whole quantity: ten pieces at the "10 and up" rate,
 * not nine at one rate and one at another. That is how a counter prices a bulk buy, and it is
 * what a customer can check in their head.
 */
export function priceFor(unit: ItemUnit, qty: number): Price {
  let rate = unit.price;
  let slab: number | null = null;
  const sorted = [...unit.slabs].sort((a, b) => a.minQty - b.minQty);
  sorted.forEach((s, i) => {
    if (qty >= s.minQty) {
      rate = s.rate;
      slab = i;
    }
  });
  return { rate, amount: round2(rate * qty), slab };
}

/**
 * Whether a rate is inside the item's allowed range.
 *
 * Outside is allowed -- the shopkeeper knows the customer -- but it is said, so a slip of the
 * finger that sells a ₹110 pack for ₹11 is caught before it prints.
 */
export function rateInRange(unit: ItemUnit, rate: number): 'ok' | 'low' | 'high' {
  if (unit.min != null && rate < unit.min) return 'low';
  if (unit.max != null && rate > unit.max) return 'high';
  return 'ok';
}

/**
 * Round a bill to the nearest `step` rupees; 0 leaves it alone.
 *
 * Returns the adjustment as its own figure, printed as a "Round off" line, so the lines on the
 * slip still add up to the total at the bottom. A total that quietly differs from its lines is
 * exactly what makes a customer stop trusting a bill.
 */
export function roundOff(total: number, step: number): number {
  if (!step || step <= 0) return 0;
  return round2(Math.round(total / step) * step - total);
}

/** Whether an item answers to what was typed, in English or Kannada. */
export function itemMatches(item: Item, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const key = searchKey(q);
  for (const name of [item.nameEn, item.nameKn]) {
    // Hyphens and brackets split words too: "Parle-G" is found by "g", "Rin (big)" by "big".
    for (const word of name.toLowerCase().split(/[\s\-_/().,]+/)) {
      if (!word) continue;
      if (word.startsWith(q)) return true;
      if (key && searchKey(word).startsWith(key)) return true;
    }
    if (name.toLowerCase().startsWith(q)) return true;
  }
  return false;
}

/**
 * What is wrong with an item, or null.
 *
 * Kept here rather than only in the server's schema, so the items screen says it before sending.
 */
export function checkItem(item: Omit<Item, 'id'>): string | null {
  if (!item.nameEn.trim() && !item.nameKn.trim()) return 'Give the item a name.';
  if (item.units.length === 0) return 'An item needs at least one unit.';
  const codes = new Set<string>();
  for (const [i, u] of item.units.entries()) {
    if (!u.code.trim()) return 'Every unit needs a short name.';
    if (codes.has(u.code)) return 'Two units are both called "' + u.code + '".';
    codes.add(u.code);
    if (i === 0 && u.perBase !== 1) return 'The first unit is the one stock is counted in, so it is 1.';
    if (!(u.perBase > 0)) return '"' + u.code + '" must hold at least one ' + item.units[0]!.code + '.';
    if (!(u.price >= 0)) return '"' + u.code + '" needs a price.';
    if (u.min != null && u.max != null && u.min > u.max) return '"' + u.code + '": the lowest price is above the highest.';
    for (const s of u.slabs) {
      if (!(s.minQty > 0) || !(s.rate >= 0)) return '"' + u.code + '": each quantity price needs a quantity and a rate.';
    }
  }
  return null;
}
