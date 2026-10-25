/*
 * One sign-in for the whole app (build 77).
 *
 * The shop asked for a single sign-in that stays until somebody presses Sign out: closing the app
 * from recents must not ask for billing's PIN again, nor for stock's sign-in. The app keeps the
 * billing token and the stock token on the device; these pure helpers decide, from what is saved,
 * whether to go straight in, whether a token wants a quiet refresh, and what the Stock window's
 * first load does.
 */

/** Refresh a token quietly once it has less than this left (both servers issue 30-day tokens). */
export const TOKEN_REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64urlDecode(s: string): string | null {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** When a JWT stops working, in ms since 1970; null when it is not a JWT or says nothing. */
export function tokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const json = b64urlDecode(parts[1]);
  if (json == null) return null;
  try {
    const body = JSON.parse(json) as { exp?: unknown };
    return typeof body.exp === 'number' && Number.isFinite(body.exp) ? body.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type TokenState = 'none' | 'fresh' | 'refresh' | 'expired';

/**
 * What a saved token is good for now. A token with no readable expiry is trusted as fresh: the
 * server will still say 401 if it is not, and the app falls back to the sign-in screen then.
 */
export function tokenState(token: string | null | undefined, now: number): TokenState {
  if (!token) return 'none';
  const exp = tokenExpiry(token);
  if (exp == null) return 'fresh';
  if (exp <= now) return 'expired';
  return exp - now < TOKEN_REFRESH_BEFORE_MS ? 'refresh' : 'fresh';
}

export type SavedSession = {
  /** Billing's token (shop PIN, or an admin's phone sign-in). */
  token: string | null;
  /** Whoever signed in by phone and PIN; null for the shop PIN. */
  personRole: 'admin' | 'worker' | 'godown' | null;
  stockToken: string | null;
};

export type ColdStart = {
  /** Billing is open without any sign-in screen. */
  signedIn: boolean;
  /** A worker or the godown: the Stock window only. */
  stockOnly: boolean;
  /** The stock token still worth handing to the Stock window; null when none or expired. */
  stockToken: string | null;
  /** Ask billing's server for a new token, quietly, in the background. */
  refreshBilling: boolean;
  /** Nothing usable is saved: one trip to the sign-in screen, and the saved session is dropped. */
  needSignIn: boolean;
  /** Never: a cold start is not a sign-in screen and never forgets stock's session. */
  locked: false;
  forgetStock: false;
};

/** What the app does when it is opened fresh, from what the device kept. */
export function coldStart(saved: SavedSession, now: number): ColdStart {
  const billing = tokenState(saved.token, now);
  const stock = tokenState(saved.stockToken, now);
  const stockToken = stock === 'none' || stock === 'expired' ? null : saved.stockToken;
  const billingOk = billing === 'fresh' || billing === 'refresh';
  const base = { locked: false as const, forgetStock: false as const };
  if (saved.personRole && saved.personRole !== 'admin') {
    // A worker or the godown lives in stock alone; an expired stock session is a sign-in.
    const ok = stockToken != null;
    return { ...base, signedIn: false, stockOnly: ok, stockToken, refreshBilling: false, needSignIn: !ok };
  }
  if (saved.personRole === 'admin' && !stockToken) {
    // The admin's stock session lapsed and stock cannot be asked without the PIN: sign in once.
    return { ...base, signedIn: false, stockOnly: false, stockToken: null, refreshBilling: false, needSignIn: true };
  }
  return {
    ...base,
    signedIn: billingOk,
    stockOnly: false,
    stockToken,
    refreshBilling: billing === 'refresh',
    needSignIn: !billingOk,
  };
}

export type StockFirstLoad = {
  /** `#token=...` for the stock site, or ''. */
  hash: string;
  /** Wipe the stock site's own saved session first: only after Sign out or Switch user. */
  forget: boolean;
  /** No stock session at all (the shop PIN): show the note to sign in by phone. */
  needPhone: boolean;
};

/** The Stock window's first load, decided once when it opens. */
export function stockFirstLoad(stockToken: string | null, signOutPending: boolean, now: number): StockFirstLoad {
  const state = tokenState(stockToken, now);
  const usable = state === 'fresh' || state === 'refresh';
  return {
    hash: usable && stockToken ? '#token=' + encodeURIComponent(stockToken) : '',
    forget: !usable && signOutPending,
    needPhone: !usable,
  };
}

/** A token the stock site holds, read back from its window: kept only when it looks like a live JWT. */
export function acceptStockToken(candidate: unknown, now: number): string | null {
  if (typeof candidate !== 'string') return null;
  const t = candidate.trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(t)) return null;
  const state = tokenState(t, now);
  return state === 'fresh' || state === 'refresh' ? t : null;
}
