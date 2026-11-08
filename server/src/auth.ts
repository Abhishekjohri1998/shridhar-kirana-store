import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './env';
import { HttpError } from './http';

const TOKEN_TTL = '30d'; // The counter tablet should not be asked to log in every morning.

/**
 * Who a billing token was issued to. `shop` is the shop PIN, `admin` a stock admin signing in
 * with their own phone and PIN. Both run the shop. A shop worker or the godown is never issued a
 * billing token at all (see /auth/person); any other role a token might carry is refused by
 * requireAdmin rather than trusted.
 */
export type BillingRole = 'shop' | 'admin';

export function issueToken(role: string = 'shop'): string {
  return jwt.sign({ role }, env.jwtSecret, { expiresIn: TOKEN_TTL });
}

/**
 * Constant-time-ish comparison, so a wrong secret cannot be found one character at a time.
 *
 * The length is compared first and gives itself away, which is the usual trade: the alternative
 * leaks more. What matters is that two secrets of the same length take the same time to refuse.
 */
export function secretMatches(candidate: string, secret: string): boolean {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The PIN the counter signs in with. */
export function pinMatches(candidate: string): boolean {
  return secretMatches(candidate, env.authPin);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    next(new HttpError(401, 'Sign in first'));
    return;
  }
  try {
    const said = jwt.verify(token, env.jwtSecret);
    // Every token issued before roles were read carries `shop`, so nothing already signed in moves.
    res.locals.role = typeof said === 'object' && said && typeof said.role === 'string' ? said.role : '';
    next();
  } catch {
    next(new HttpError(401, 'Your session has expired. Sign in again.'));
  }
}

/** The role requireAuth read off the token. */
export function roleOf(res: Response): string {
  return typeof res.locals.role === 'string' ? res.locals.role : '';
}

/**
 * The shop's owner only: the shop PIN or a stock admin. For the routes that take the whole book
 * out or put a whole one back -- backup, erase, restore.
 */
export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const role = roleOf(res);
  if (role === 'shop' || role === 'admin') {
    next();
    return;
  }
  next(new HttpError(403, 'Only the shop owner can do this'));
}
