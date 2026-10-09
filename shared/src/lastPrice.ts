import type { Bill, BillLine } from './types';

/** A name as compared for "the same item": case, ends and runs of spaces do not count. */
export function itemNameKey(name: string | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export type LastPriceAsk = {
  /** What was typed, or the picked item's name. */
  name: string;
  /** Stock's id for the item, when it was picked from stock: matched before any name. */
  stockItemId?: string;
  /** The customer on the bill being written: their own last price wins over anyone's. */
  customerId?: string;
};

export type LastPrice = { rate: number; billNo: number; sameCustomer: boolean };

function lineMatches(line: BillLine, ask: LastPriceAsk, key: string): boolean {
  if (!(line.rate > 0)) return false;
  if (ask.stockItemId && line.stockItemId === ask.stockItemId) return true;
  return !!key && (itemNameKey(line.nameEn) === key || itemNameKey(line.nameKn) === key);
}

/**
 * The rate this item last sold at, from the shop's own saved bills: the same customer's last bill
 * with it when there is one, else the last sale to anyone, else null. Cancelled bills are not
 * sales and are skipped. Order of `bills` does not matter -- newest is by bill number.
 */
export function lastPriceOf(ask: LastPriceAsk, bills: Bill[]): LastPrice | null {
  const key = itemNameKey(ask.name);
  if (!key && !ask.stockItemId) return null;
  const sorted = [...bills].filter((b) => !b.cancelled).sort((a, b) => b.no - a.no);
  const find = (mine: boolean): LastPrice | null => {
    for (const bill of sorted) {
      if (mine && bill.customer?.id !== ask.customerId) continue;
      const lines = Array.isArray(bill.lines) ? bill.lines : [];
      // A stock id is the surer match, so it is looked for across the bill before a name is.
      const line = (ask.stockItemId && lines.find((l) => l.rate > 0 && l.stockItemId === ask.stockItemId))
        || lines.find((l) => lineMatches(l, ask, key));
      if (line) return { rate: line.rate, billNo: bill.no, sameCustomer: mine };
    }
    return null;
  };
  return (ask.customerId ? find(true) : null) ?? find(false);
}
