import type { Request } from 'express';
import { HttpError } from './http';

/**
 * A small brake on guessing PINs: after too many wrong tries from one address, that address
 * waits. Kept in memory -- a restart forgets it, which is fine for a brake on a four-digit PIN
 * typed at one shop counter. Only failures count, so a busy counter is never locked out.
 */
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, number[]>();

function keyOf(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function recent(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (kept.length) failures.set(key, kept);
  else failures.delete(key);
  return kept;
}

/** Throws 429 when this address has failed too often lately. */
export function checkSignInBrake(req: Request): void {
  if (recent(keyOf(req), Date.now()).length >= MAX_FAILURES) {
    throw new HttpError(429, 'Too many wrong tries. Wait a few minutes and try again.');
  }
}

export function noteSignInFailure(req: Request): void {
  const now = Date.now();
  const key = keyOf(req);
  failures.set(key, [...recent(key, now), now]);
}
