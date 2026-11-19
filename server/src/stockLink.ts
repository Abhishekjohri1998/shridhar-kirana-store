import type { StockItem, StockQuote, StockTicks } from '@shridhar/shared';
import { env } from './env';

/**
 * The billing server's one door to the stock app.
 *
 * Billing asks, stock answers, and billing passes the answer on untouched. Nothing here knows
 * what an item is, how a slab changes a rate or how a search matches Kannada typed in Latin
 * letters -- that is all stock's, and the shop asked for the two codebases to stay apart.
 *
 * Three promises every caller relies on:
 *
 *  - **Off is quiet.** With `STOCK_URL` or `LINK_KEY` unset, every call answers "nothing" at
 *    once without touching the network, and billing behaves exactly as it did before stock.
 *  - **Slow is quiet.** Each call gives up after a couple of seconds. The counter is writing a
 *    bill while this runs; a stock server that hangs must not hang the till.
 *  - **Nothing throws.** A failure comes back as `null`, never as an exception, so no route can
 *    turn a broken link into a broken bill.
 */

/** How long one call to stock may take before billing stops waiting. */
export const STOCK_TIMEOUT_MS = 2500;

export function stockLinkOn(): boolean {
  return env.stockUrl !== '' && env.linkKey !== '';
}

/** One request to stock, or null for "off, slow, refused or nonsense". */
async function ask<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
  if (!stockLinkOn()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STOCK_TIMEOUT_MS);
  try {
    const res = await fetch(env.stockUrl + '/api/billing-link' + path, {
      method: init.method ?? 'GET',
      headers: {
        'x-link-key': env.linkKey,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Unreachable, timed out or not JSON. Said once per kind of trouble would be nicer; said
    // never is what matters, because a log line per keystroke would bury everything else.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Items matching what is being typed. Empty when off or failed, so the box is a plain box. */
export async function stockItems(q: string, limit: number): Promise<StockItem[]> {
  const got = await ask<{ items?: unknown }>(
    '/items?q=' + encodeURIComponent(q) + '&limit=' + limit);
  return isObj(got) && Array.isArray(got.items) ? (got.items as StockItem[]) : [];
}

/** Stock's rate for this many of this unit, slabs applied. Null when stock has no answer. */
export async function stockQuote(item: string, unit: string, qty: number): Promise<StockQuote | null> {
  const got = await ask<StockQuote>(
    '/quote?item=' + encodeURIComponent(item) + '&unit=' + encodeURIComponent(unit) + '&qty=' + qty);
  return isObj(got) && typeof got.rate === 'number' && Number.isFinite(got.rate) ? got : null;
}

/**
 * What a scanned barcode is. Unlike `ask`, this tells "stock has no item with that code" (404)
 * from "stock is off or did not answer", because the counter says different things for each.
 */
export async function stockBarcode(code: string): Promise<{ kind: 'found'; item: StockItem } | { kind: 'unknown' } | { kind: 'off' }> {
  if (!stockLinkOn()) return { kind: 'off' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STOCK_TIMEOUT_MS);
  try {
    const res = await fetch(env.stockUrl + '/api/billing-link/barcode?code=' + encodeURIComponent(code), {
      headers: { 'x-link-key': env.linkKey },
      signal: controller.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 404 && isObj(body) && body.unknown === true) return { kind: 'unknown' };
    if (res.ok && isObj(body) && isObj(body.item) && typeof body.item.id === 'string' && Array.isArray(body.item.units)) {
      return { kind: 'found', item: body.item as unknown as StockItem };
    }
    return { kind: 'off' };
  } catch {
    return { kind: 'off' };
  } finally {
    clearTimeout(timer);
  }
}

/** The bill being written, sent to the worker screen. Answers with stock's ticks, or none. */
export async function stockDraft(body: unknown): Promise<StockTicks> {
  const got = await ask<{ ticks?: unknown }>('/draft', { method: 'POST', body });
  return isObj(got) && isObj(got.ticks) ? (got.ticks as StockTicks) : {};
}

/**
 * The rounding step stock's settings used to hold: 0 (none), 1, 5 or 10 rupees.
 *
 * Rounding is billing's own setting now. This is asked once, by the migration in roundTo.ts, to
 * carry the shop's old choice across; `null` means stock did not answer, so the copy is tried
 * again later rather than settling on 0 for good.
 */
export async function stockRoundTo(): Promise<number | null> {
  const got = await ask<{ roundTo?: unknown }>('/settings');
  if (!isObj(got)) return null;
  const step = Number(got.roundTo);
  return step === 1 || step === 5 || step === 10 ? step : 0;
}

/** What stock said about a phone and PIN. */
export type StockAuthAnswer =
  | { kind: 'ok'; role: 'admin' | 'worker' | 'godown'; name: string; token: string }
  | { kind: 'denied'; status: 401 | 403 | 429; error: string }
  /** The link is switched off, or stock did not answer sensibly in time. */
  | { kind: 'off' }
  | { kind: 'down' };

/**
 * A person signing in with their own phone and PIN, checked against stock's accounts.
 *
 * Unlike the calls above, this one has to tell "wrong PIN" from "stock is not there": the first
 * is the person's to fix, the second is a reason to fall back to the shop PIN. Still never
 * throws, and still gives up after the same timeout.
 */
export async function stockAuth(phone: string, pin: string): Promise<StockAuthAnswer> {
  if (!stockLinkOn()) return { kind: 'off' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STOCK_TIMEOUT_MS);
  try {
    const res = await fetch(env.stockUrl + '/api/billing-link/auth', {
      method: 'POST',
      headers: { 'x-link-key': env.linkKey, 'content-type': 'application/json' },
      body: JSON.stringify({ phone, pin }),
      signal: controller.signal,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    const said = isObj(body) && typeof body.error === 'string' ? body.error : '';
    // Stock refusing billing's own key is a broken link, not a wrong PIN.
    if (res.status === 401 && /link key/i.test(said)) return { kind: 'down' };
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { kind: 'denied', status: res.status, error: said };
    }
    if (!res.ok || !isObj(body)) return { kind: 'down' };
    const role = body.role;
    if ((role !== 'admin' && role !== 'worker' && role !== 'godown')
      || typeof body.token !== 'string' || !body.token) {
      return { kind: 'down' };
    }
    return { kind: 'ok', role, name: typeof body.name === 'string' ? body.name : '', token: body.token };
  } catch {
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A stock session for the shop's admin, asked after the shop PIN is checked here, so the Stock
 * tab opens signed in without a second sign-in. Null when off, down, slow or refused.
 */
export async function stockShopAuth(): Promise<string | null> {
  const got = await ask<{ token?: unknown }>('/shop-auth', { method: 'POST', body: {} });
  return isObj(got) && typeof got.token === 'string' && got.token ? got.token : null;
}

/* ------------------------------------------------------------ one app: sessions and the whole shop */

/**
 * A fresh stock session without a PIN, for someone already signed in to the app: from the stock
 * session the device held (even expired; stock refuses it after a PIN reset or a switch-off), or
 * from the phone of an admin billing signed in. Same answers as stockAuth.
 */
export async function stockSession(proof: { token?: string; phone?: string }): Promise<StockAuthAnswer> {
  const got = await bigAsk('POST', '/session', proof, STOCK_TIMEOUT_MS);
  if (got.kind !== 'answer') return got;
  if (got.status === 401 || got.status === 403 || got.status === 429) {
    return { kind: 'denied', status: got.status, error: errorOf(got.body) };
  }
  const b = got.body;
  if (got.status !== 200 || !isObj(b) || typeof b.token !== 'string' || !b.token
    || (b.role !== 'admin' && b.role !== 'worker' && b.role !== 'godown')) return { kind: 'down' };
  return { kind: 'ok', role: b.role, name: typeof b.name === 'string' ? b.name : '', token: b.token };
}

/** A backup, restore or erase moves the whole store: minutes, not the till's 2.5 seconds. */
export const STOCK_BIG_TIMEOUT_MS = 180_000;

export type BigAnswer = { kind: 'answer'; status: number; body: unknown } | { kind: 'off' } | { kind: 'down' };

function errorOf(body: unknown): string {
  return isObj(body) && typeof body.error === 'string' ? body.error : '';
}

/**
 * One call to stock that answers whatever stock said, status and all, for the whole-shop backup,
 * restore and erase: those must tell "stock refused this file" from "stock is not there". `raw`
 * is a request body already written as JSON (a restore's file is passed on as it came).
 */
export async function bigAsk(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = STOCK_BIG_TIMEOUT_MS, raw?: string): Promise<BigAnswer> {
  if (!stockLinkOn()) return { kind: 'off' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(env.stockUrl + '/api/billing-link' + path, {
      method,
      headers: {
        'x-link-key': env.linkKey,
        ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    let out: unknown = null;
    try { out = await res.json(); } catch { out = null; }
    // Stock refusing billing's own key is a broken link, not an answer about the file.
    if (res.status === 401 && /link key/i.test(errorOf(out))) return { kind: 'down' };
    if (res.status === 404 && /no such address/i.test(errorOf(out))) return { kind: 'down' };
    return { kind: 'answer', status: res.status, body: out };
  } catch {
    return { kind: 'down' };
  } finally {
    clearTimeout(timer);
  }
}

export { errorOf as stockErrorOf };
