import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from './env';
import { HttpError } from './http';

const TOKEN_TTL = '30d'; // The counter tablet should not be asked to log in every morning.

export function issueToken(): string {
  return jwt.sign({ role: 'shop' }, env.jwtSecret, { expiresIn: TOKEN_TTL });
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

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    next(new HttpError(401, 'Sign in first'));
    return;
  }
  try {
    jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    next(new HttpError(401, 'Your session has expired. Sign in again.'));
  }
}
