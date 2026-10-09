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
