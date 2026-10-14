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
 * The unit a typed line carries when stock does not know the item: "numbers", the shop's own
 * word for a count of anything. Shown on every typed row that has not been matched to stock.
 */
export const FALLBACK_UNIT = 'NOS';

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
