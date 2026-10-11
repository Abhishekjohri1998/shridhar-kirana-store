import { stockLinkOn, stockRoundTo } from './stockLink';
import { getRepo } from './store';

/**
 * Billing's rounding step, and the one-time copy of stock's old one.
 *
 * Rounding used to be a stock setting that billing asked for on every save. It is billing's own
 * now (`settings.roundTo`). A server that predates that has nothing stored, so the first time it
 * is needed -- at start, else at the first bill -- the shop's old choice is copied across from
 * stock's `/billing-link/settings`, once, and what the shop sees does not change:
 *
 *  - link off: 0, stored, the same as every bill was then;
 *  - stock answers: its step, stored;
 *  - stock does not answer: nothing is stored and the bill is not rounded; the next bill tries
 *    again. Settling on 0 for ever because stock was restarting at that moment would quietly
 *    switch rounding off at a shop that had it on.
 *
 * Once a value is stored this never asks stock again, and Settings is where it changes.
 */
let pending: Promise<number> | null = null;

export async function ensureRoundTo(): Promise<number> {
  const stored = (await getRepo().getSettings()).roundTo;
  if (stored != null) return stored;
  // One copy at a time: two bills at once must not both ask and both write.
  pending ??= (async () => {
    try {
      const step = stockLinkOn() ? await stockRoundTo() : 0;
      if (step == null) return 0;
      await getRepo().updateSettings({ roundTo: step });
      console.log('[settings] rounding set to ' + step + (stockLinkOn() ? ', copied from stock' : ''));
      return step;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
