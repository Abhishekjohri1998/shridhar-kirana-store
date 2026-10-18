import type { Customer } from './types';

/** Customer id -> when the "haven't come back" notice for them was dismissed (ISO). */
export type DismissedInactive = Record<string, string>;

/**
 * The quiet customers still worth a nudge: those never dismissed, or whose last bill is newer
 * than the dismissal -- they came back after it and have gone quiet again.
 */
export function visibleInactive<T extends Pick<Customer, 'id' | 'lastVisit'>>(
  list: T[], dismissed: DismissedInactive | undefined,
): T[] {
  const d = dismissed ?? {};
  return list.filter((c) => {
    const at = d[c.id];
    if (!at) return true;
    return c.lastVisit != null && new Date(c.lastVisit).getTime() > new Date(at).getTime();
  });
}

/**
 * The dismissals after dismissing `ids` now. Entries for customers no longer quiet are dropped,
 * so the map never grows past the quiet list.
 */
export function dismissInactive(
  dismissed: DismissedInactive | undefined, ids: string[], quietIds: string[], now = new Date(),
): DismissedInactive {
  const keep = new Set(quietIds);
  const out: DismissedInactive = {};
  for (const [id, at] of Object.entries(dismissed ?? {})) if (keep.has(id)) out[id] = at;
  for (const id of ids) out[id] = now.toISOString();
  return out;
}

/**
 * Customers not in for `days`: last bill before the cutoff, or no bill at all; longest gone
 * first (never-billed at the top).
 */
export function notSeenFor<T extends Pick<Customer, 'lastVisit'>>(list: T[], days: number, now = new Date()): T[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const t = (c: T) => (c.lastVisit ? new Date(c.lastVisit).getTime() : -Infinity);
  return list.filter((c) => t(c) < cutoff).sort((a, b) => t(a) - t(b));
}
