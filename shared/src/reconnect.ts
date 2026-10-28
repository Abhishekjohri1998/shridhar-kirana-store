/**
 * When the Stock window tries again after a failed load (APK 80): 1 s, 2 s, 4 s, then every 5 s.
 * `attempt` is how many retries have already been made since the last good load (0-based).
 */
export const RECONNECT_STEPS_MS = [1000, 2000, 4000];
export const RECONNECT_EVERY_MS = 5000;
/** The health probe while reconnecting: how often, and how long one may take. */
export const HEALTH_PROBE_EVERY_MS = 3000;
export const HEALTH_PROBE_TIMEOUT_MS = 3000;

export function reconnectDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return RECONNECT_STEPS_MS[n] ?? RECONNECT_EVERY_MS;
}

/** The URL to return to after a drop: the last stock page seen, else the base address. */
export function reloadTarget(lastUrl: string | null | undefined, base: string): string {
  const b = base.replace(/\/+$/, '');
  if (lastUrl && /^https?:\/\//i.test(lastUrl) && lastUrl.toLowerCase().startsWith(b.toLowerCase())) {
    return lastUrl.replace(/#token=[^&]*/, '');
  }
  return b;
}

export function healthUrl(base: string): string {
  return base.replace(/\/+$/, '') + '/api/health';
}
