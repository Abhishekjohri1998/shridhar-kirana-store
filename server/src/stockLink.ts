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

/** The bill being written, sent to the worker screen. Answers with stock's ticks, or none. */
export async function stockDraft(body: unknown): Promise<StockTicks> {
  const got = await ask<{ ticks?: unknown }>('/draft', { method: 'POST', body });
  return isObj(got) && isObj(got.ticks) ? (got.ticks as StockTicks) : {};
}

/**
 * The rounding step stock's settings ask for: 0 (none), 1, 5 or 10 rupees.
 *
 * 0 for anything else, including off and failed -- a bill saved while stock is down is simply
 * not rounded, which is how every bill was before the link existed.
 */
export async function stockRoundTo(): Promise<number> {
  const got = await ask<{ roundTo?: unknown }>('/settings');
  const step = isObj(got) ? Number(got.roundTo) : 0;
  return step === 1 || step === 5 || step === 10 ? step : 0;
}
