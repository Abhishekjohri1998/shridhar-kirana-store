import type { StockItem, StockUnit } from './types';

/**
 * The unit a picked stock item fills the line with: the one stock marks as its selling unit,
 * else its first unit. Stock decides which unit that is; billing only follows it.
 */
export function sellUnitOf(item: Pick<StockItem, 'units' | 'sellUnit'>): StockUnit | undefined {
  const units = Array.isArray(item.units) ? item.units : [];
  return (item.sellUnit && units.find((u) => u.code === item.sellUnit)) || units[0];
}
