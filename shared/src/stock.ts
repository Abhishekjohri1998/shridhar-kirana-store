import type { StockItem, StockUnit } from './types';

/**
 * The unit a picked stock item fills the line with: the one stock marks as its selling unit,
 * else its first unit. Stock decides which unit that is; billing only follows it.
 */
export function sellUnitOf(item: Pick<StockItem, 'units' | 'sellUnit'>): StockUnit | undefined {
  const units = Array.isArray(item.units) ? item.units : [];
  return (item.sellUnit && units.find((u) => u.code === item.sellUnit)) || units[0];
}

/**
 * The unit a pick from a search fills the line with: the unit of the alias the search matched
 * through ("HG box" -> box), else the selling unit.
 */
export function pickUnitOf(item: Pick<StockItem, 'units' | 'sellUnit' | 'matchedUnit'>): StockUnit | undefined {
  const units = Array.isArray(item.units) ? item.units : [];
  return (item.matchedUnit && units.find((u) => u.code === item.matchedUnit)) || sellUnitOf(item);
}

/**
 * The unit a typed line carries when stock does not know the item: "numbers", the shop's own
 * word for a count of anything. Shown on every typed row that has not been matched to stock.
 */
export const FALLBACK_UNIT = 'NOS';

/**
 * The unit a line prints its quantity with: its own (stock's, or one picked from the menu), else
 * NOS when it counts more than one. A typed line with Qty 20 and a rate used to print just its name
 * and the total -- "Rice Flakes 2kg 2200" -- with nothing saying it was twenty. One of one, with no
 * unit, prints as it always did: the name and its price.
 */
export function printedUnit(line: { unit?: string; qty: number }): string {
  return (line.unit ?? '').trim() || (line.qty !== 1 ? FALLBACK_UNIT : '');
}

/**
 * Which of stock's suggestions Enter takes: an exact name (in either language), else the first
 * name that starts with what was typed, else the first suggestion. Stock already ordered the
 * list; this only lifts the obvious one to the top. Undefined when there is nothing to take.
 */
export function bestMatch<T extends Pick<StockItem, 'nameEn' | 'nameKn'>>(items: T[], typed: string): T | undefined {
  const list = Array.isArray(items) ? items : [];
  const q = typed.trim().toLowerCase();
  if (!q) return list[0];
  const names = (x: T) => [x.nameEn, x.nameKn].map((n) => (n ?? '').trim().toLowerCase());
  return list.find((x) => names(x).includes(q))
    ?? list.find((x) => names(x).some((n) => n.startsWith(q)))
    ?? list[0];
}

/**
 * The rate a picked line starts at for `qty` of `unit`, before stock's quote comes back: the
 * slab with the highest start the quantity has reached, else the unit's own price. The same
 * rule as stock's priceFor; stock's quote (asked for straight after every pick) still has the
 * last word. Without slabs from stock this is simply `unit.price`.
 */
export function pickRate(unit: Pick<StockUnit, 'price' | 'basePrice' | 'slabs'>, qty = 1): number {
  const q = qty > 0 ? qty : 1;
  let best: { minQty: number; rate: number } | undefined;
  for (const s of Array.isArray(unit.slabs) ? unit.slabs : []) {
    if (!s || !(typeof s.rate === 'number') || !(s.rate >= 0)) continue;
    if (q >= s.minQty && (!best || s.minQty > best.minQty)) best = s;
  }
  if (best) return best.rate;
  return typeof unit.basePrice === 'number' && unit.slabs?.length ? unit.basePrice : unit.price;
}

/**
 * Whether the price an item last went at may fill a line, once the billing server answers
 * (build 67). Only for a line stock does not know (NOS or an unmatched name): a stock-matched
 * line is priced by stock's quote for its quantity and unit -- the range price wins, so 1 pc of
 * an item once sold 12 at a time at 9.17 is 10 again. Never over the shopkeeper's own price, and
 * never when anything has priced the line since it was asked (`askedSeq` against `nowSeq`), so a
 * late answer cannot replace a quote.
 */
export function lastPriceApplies(
  line: { stockItemId?: string | null; unit?: string } | undefined,
  asked: { unit: string; seq: number },
  nowSeq: number,
  handTyped: boolean,
): boolean {
  if (!line || handTyped) return false;
  if (line.stockItemId) return false;
  if (line.unit !== asked.unit) return false;
  return asked.seq === nowSeq;
}

/** The label of the unit the search matched through ("HG box" -> "Box"), for the suggestion row. */
export function matchedLabel(item: Pick<StockItem, 'units' | 'matchedUnit'>, lang: string): string {
  if (!item.matchedUnit) return '';
  const u = (Array.isArray(item.units) ? item.units : []).find((x) => x.code === item.matchedUnit);
  if (!u) return '';
  return (lang === 'kn' && u.labelKn) || u.label || u.code;
}

/** Short unit words a shopkeeper types after a quantity: "2 kg sugar", "3 pkt parle". */
const TYPED_UNITS = new Set([
  'kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'l', 'lt', 'ltr', 'ltrs', 'litre', 'ml',
  'pc', 'pcs', 'pkt', 'pkts', 'pack', 'nos', 'no', 'dz', 'doz', 'dozen', 'bag', 'bags', 'box',
  'bottle', 'btl', 'tin', 'bundle', 'roll', 'x',
]);

/**
 * What to ask stock for when a line's item box is typed in, and the quantity typed in front of
 * the name. The box says "Quantity and item", and stock's search knows names, not "2 sugar" --
 * which found nothing at all, so no suggestions came up. A leading number (and a unit word after
 * it) is split off: "2 sugar", "2kg sugar", "1.5 kg toor dal" ask for "sugar" / "toor dal" with
 * the quantity kept for the pick. A name that is all number, or nothing after the number, is
 * asked for as typed.
 */
export function stockQueryOf(typed: string): { q: string; qty?: number } {
  const text = typed.replace(/\s+/g, ' ').trim();
  const m = /^(\d+(?:[.,]\d+)?|\d+\/\d+)\s*([a-zA-Z]+)?\.?\s+(.+)$/.exec(text)
    ?? /^(\d+(?:[.,]\d+)?)([a-zA-Z]+)\s+(.+)$/.exec(text);
  if (!m) return { q: text };
  const [, num, unit, rest] = m;
  // "5 star": a number and a word that is not a unit is part of the name, not a quantity.
  if (unit && !TYPED_UNITS.has(unit.toLowerCase())) {
    return /^\d+(?:[.,]\d+)?\s+\S/.test(text) && !/^\d/.test(rest!)
      ? { q: unit + ' ' + rest, qty: qtyOf(num!) }
      : { q: text };
  }
  const qty = qtyOf(num!);
  return rest!.trim() ? { q: rest!.trim(), ...(qty ? { qty } : {}) } : { q: text };
}

function qtyOf(num: string): number | undefined {
  if (num.includes('/')) {
    const [a, b] = num.split('/').map(Number);
    return a! > 0 && b! > 0 ? a! / b! : undefined;
  }
  const n = Number(num.replace(',', '.'));
  return n > 0 && n < 100000 ? n : undefined;
}
