/**
 * Turning what someone typed into an address the phone can actually call.
 *
 * The phone app asks for this once, and people type the shortest thing that identifies the
 * machine: "192.168.1.5:4000" on the shop wifi, or a hostname for a hosted server. Both need a
 * scheme added, but not the same one.
 *
 * Guessing http for everything was wrong in a way that hid itself: Android has blocked cleartext
 * by default since API 28, so a public hostname given without a scheme became an http request
 * the operating system refused, and the app reported it as "check the address and the wifi" --
 * pointing at the network when the fault was the scheme.
 *
 * So: private addresses get http, because nothing on a shop LAN has a certificate. Everything
 * else gets https, because anything reachable from outside the shop had better have one.
 */

/** localhost, loopback, link-local, .local, and the three private IPv4 ranges. */
function isLocalHost(host: string): boolean {
  const bare = host.replace(/:\d+$/, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.local')) return true;
  if (bare === '::1' || bare === '[::1]') return true;

  const parts = bare.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Accepts "192.168.1.5:4000" as readily as a full URL, and drops a trailing slash. */
export function normaliseServerUrl(raw: string): string {
  const typed = String(raw ?? '').trim();
  if (!typed) return '';

  const withScheme = /^https?:\/\//i.test(typed)
    ? typed
    : (isLocalHost(typed.split('/')[0] ?? '') ? 'http://' : 'https://') + typed;

  return withScheme.replace(/\/+$/, '');
}
