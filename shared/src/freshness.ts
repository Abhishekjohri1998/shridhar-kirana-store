/**
 * Keeping the bill list and "Today" fresh while the app sits open all day.
 *
 * The client's History went to "Today 0 · No bills yet" after the tablet was left open for hours
 * and never came back: the data was fetched at startup only, a failed reload left an empty list,
 * and "Today" did not roll over at midnight. These are the pure rules both apps schedule by.
 */

/** Where the last load of bills / today / settings stands. */
export type LoadState = 'loading' | 'ok' | 'failed';

/** How long to wait before retrying after a failed load: 5 s, 15 s, 30 s, then every 60 s. */
export const RELOAD_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

/** How often History and the Bill screen reload while they are on screen. */
export const SCREEN_REFRESH_MS = 60_000;

/** The wait before retry number `failures` (1 = after the first failure). */
export function retryDelay(failures: number): number {
  if (failures <= 0) return 0;
  const i = Math.min(failures, RELOAD_BACKOFF_MS.length) - 1;
  return RELOAD_BACKOFF_MS[i]!;
}

/** Milliseconds from `now` until the next local midnight, plus a small grace so "today" has turned. */
export function msUntilMidnight(now: Date, graceMs = 2_000): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime()) + graceMs;
}

/** Whether two instants fall on different local days (the device slept through midnight). */
export function dayChanged(a: Date, b: Date): boolean {
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate();
}

/**
 * What History shows.
 *  - `banner` -- "Couldn't load bills -- Retry", only when the last load failed.
 *  - `body`   -- the list (kept from the last good load, even after a failure), a spinner while
 *                the very first load runs, or "No bills yet" ONLY after a load that worked.
 */
export function historyView(state: LoadState, billCount: number): {
  banner: 'failed' | null;
  body: 'list' | 'empty' | 'loading' | 'none';
} {
  const banner = state === 'failed' ? 'failed' : null;
  if (billCount > 0) return { banner, body: 'list' };
  if (state === 'ok') return { banner, body: 'empty' };
  if (state === 'loading') return { banner, body: 'loading' };
  return { banner, body: 'none' };
}
