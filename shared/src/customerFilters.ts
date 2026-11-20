import { customerName } from './fields';
import type { Customer, Lang } from './types';

/**
 * The Customers screen's filters and sorts, worked out on the device from the full list it
 * already has (web and tablet alike), so the server does not change and both apps agree.
 */

/** Which customers show. */
export const CUSTOMER_SHOWS = ['all', 'owes', 'advance', 'notCome', 'never', 'new'] as const;
export type CustomerShow = (typeof CUSTOMER_SHOWS)[number];

/** How they are ordered. */
export const CUSTOMER_SORTS = ['name', 'town', 'balance', 'lastVisit', 'billed', 'bills'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export type SortDir = 'asc' | 'desc';

export type CustomerView = {
  show: CustomerShow;
  /** For `notCome`: billed before, but not in this many days. */
  days: number;
  sort: CustomerSort;
  dir: SortDir;
};

/** "New" is a customer first seen within this many days. */
export const NEW_CUSTOMER_DAYS = 30;

/** The way each sort starts: names A to Z, every figure biggest (or most recent) first. */
export function defaultDir(sort: CustomerSort): SortDir {
  return sort === 'name' || sort === 'town' ? 'asc' : 'desc';
}

/** A customer's town as typed, tidied, or '' when none. */
export function townOf(c: { town?: string }): string {
  return String(c.town ?? '').replace(/\s+/g, ' ').trim();
}

/** Every town the shop's customers live in, A to Z, each once (by lower case), for suggestions. */
export function knownTowns(list: readonly { town?: string }[]): string[] {
  const seen = new Map<string, string>();
  for (const c of list) {
    const t = townOf(c);
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export const DEFAULT_CUSTOMER_VIEW: CustomerView = { show: 'all', days: 30, sort: 'name', dir: 'asc' };

/** A view read back from the device's storage, or the default for anything it does not know. */
export function readCustomerView(raw: unknown): CustomerView {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CustomerView, unknown>>;
  const show = (CUSTOMER_SHOWS as readonly unknown[]).includes(v.show) ? (v.show as CustomerShow) : DEFAULT_CUSTOMER_VIEW.show;
  const sort = (CUSTOMER_SORTS as readonly unknown[]).includes(v.sort) ? (v.sort as CustomerSort) : DEFAULT_CUSTOMER_VIEW.sort;
  const days = Number(v.days);
  return {
    show,
    days: Number.isInteger(days) && days >= 1 && days <= 9999 ? days : DEFAULT_CUSTOMER_VIEW.days,
    sort,
    dir: v.dir === 'asc' || v.dir === 'desc' ? v.dir : defaultDir(sort),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};

/** Whether one customer belongs under `show`. */
export function customerShows(
  c: Pick<Customer, 'balance' | 'billCount' | 'lastVisit' | 'since'>,
  view: Pick<CustomerView, 'show' | 'days'>,
  now = new Date(),
): boolean {
  switch (view.show) {
    case 'owes':
      return c.balance > 0;
    case 'advance':
      return c.balance < 0;
    case 'notCome':
      // Customers who have been billed, just not lately. Never-billed ones have their own chip.
      return c.billCount > 0 && time(c.lastVisit) < now.getTime() - view.days * DAY_MS;
    case 'never':
      return c.billCount === 0;
    case 'new':
      return time(c.since) >= now.getTime() - NEW_CUSTOMER_DAYS * DAY_MS;
    default:
      return true;
  }
}

/** The list under `view`, in its order. A new array; `list` is left as it was. */
export function filterCustomers<T extends Customer>(list: readonly T[], view: CustomerView, lang: Lang, now = new Date()): T[] {
  const name = (c: T) => (customerName(c, lang) || c.phone || '').toLocaleLowerCase();
  const key = (c: T): number => {
    switch (view.sort) {
      case 'balance': return c.balance;
      case 'lastVisit': return time(c.lastVisit);
      case 'billed': return c.totalBilled;
      case 'bills': return c.billCount;
      default: return 0;
    }
  };
  const sign = view.dir === 'asc' ? 1 : -1;
  if (view.sort === 'town') {
    // By town, A to Z (or back), each town's people by name; those with no town come last.
    return list
      .filter((c) => customerShows(c, view, now))
      .sort((a, b) => {
        const ta = townOf(a).toLocaleLowerCase();
        const tb = townOf(b).toLocaleLowerCase();
        if (ta !== tb) {
          if (!ta) return 1;
          if (!tb) return -1;
          return sign * ta.localeCompare(tb);
        }
        return name(a).localeCompare(name(b));
      });
  }
  return list
    .filter((c) => customerShows(c, view, now))
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (view.sort !== 'name' && ka !== kb) return sign * (ka < kb ? -1 : 1);
      // Equal figures (and the name sort itself) fall back to the name, A to Z.
      const byName = name(a).localeCompare(name(b));
      return view.sort === 'name' ? sign * byName : byName;
    });
}

/** How many of each `show` there are in `list`, for the counts on the chips. */
export function customerShowCounts(list: readonly Customer[], days: number, now = new Date()): Record<CustomerShow, number> {
  const out = { all: 0, owes: 0, advance: 0, notCome: 0, never: 0, new: 0 } as Record<CustomerShow, number>;
  for (const c of list) for (const show of CUSTOMER_SHOWS) if (customerShows(c, { show, days }, now)) out[show] += 1;
  return out;
}
