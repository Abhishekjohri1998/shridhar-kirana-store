/** Round to paise. Everything that touches money goes through here, so line totals and the
 *  grand total can never disagree by a stray fraction. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A total moved to the nearest multiple of `step` rupees, half up: 152.50 to 155 on a step of
 * five, 152.49 to 150. A step of 0 leaves it alone. Which step the shop uses is billing's own
 * `roundTo` setting; this is only the arithmetic, so both stores and the tests agree on it.
 */
export function roundToStep(total: number, step: number): number {
  if (!(step > 0)) return round2(total);
  return round2(Math.floor(total / step + 0.5 + 1e-9) * step);
}

export function lineAmount(qty: number, rate: number): number {
  return round2(qty * rate);
}

/**
 * The rate that makes a line come to exactly `total`: 500 for 3 is 166.666..., kept unrounded so
 * lineAmount(3, rate) is 500 again and not 500.01. The price box shows the line total and the
 * shopkeeper may type a different one; this is how that becomes a rate. A quantity of 0 or less
 * counts as 1, which is what a handwritten line without a quantity is.
 */
export function rateForTotal(total: number, qty: number): number {
  const q = qty > 0 ? qty : 1;
  const t = round2(total);
  const r = t / q;
  // round2 absorbs any last-bit error, but check rather than trust it. A rate is never cut to
  // paise (build 64): 0.056 a gram must not become 0.06. If the exact quotient misses by a last
  // bit, the shortest rate (4 to 8 decimals) that still comes to the total is used instead.
  if (lineAmount(q, r) === t) return r;
  for (let d = 4; d <= 8; d++) {
    const f = 10 ** d;
    const c = Math.round(r * f) / f;
    if (lineAmount(q, c) === t) return c;
  }
  return r;
}

/**
 * A rate as the bill shows it: whole rupees bare, else at least 2 and at most 3 decimals --
 * "170", "12.50", "0.056". Rates are kept exact; only the display is cut, at 3 places.
 */
export function rateText(rate: number): string {
  const r3 = Math.round((rate + Number.EPSILON) * 1000) / 1000;
  if (Number.isInteger(r3)) return String(r3);
  const s = r3.toFixed(3);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** Whether a rate is a whole number of paise; 166.666... is not, and prints as "@ 166.67". */
export function rateIsRound(rate: number): boolean {
  return Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-6;
}

/** 1370 -> "1370",  1370.5 -> "1370.50". The paper slip shows whole rupees, so we don't
 *  force decimals where there are none. */
export function money(n: number): string {
  const r = round2(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** Quantities print as 5, or 1.5 for weighed goods. */
export function qtyText(q: number): string {
  return String(Math.round(q * 1000) / 1000);
}

/**
 * One line's amount on the shop's rounding step: 110.04 to 110 on a step of 1, 112.50 to 115 on
 * a step of 5. Every line is rounded on its own and the bill's total is just their sum, so no
 * "Round off" line is needed under it. A step of 0 leaves the amount alone (to the paisa).
 */
export function roundLine(amount: number, step: number): number {
  return roundToStep(amount, step);
}

/** A line's amount as the bill shows and saves it: quantity times rate, rounded on the step. */
export function roundedLineAmount(qty: number, rate: number, step: number): number {
  return roundLine(lineAmount(qty, rate), step);
}

/**
 * Only the AMOUNT is rounded; the rate is never cut to 2 decimals. When the amount is already
 * on the step (500 g at 0.056 = 28) the rate is returned untouched; otherwise it is the exact
 * total / qty (see rateForTotal), so qty x rate reproduces the rounded amount.
 *
 * The rate to store so a line comes to its rounded amount: what the server saves, so the receipt
 * code -- which works the amount out as qty x rate -- prints 110 and not 110.04. The cart keeps
 * stock's own rate until then, so changing the quantity still starts from the real price.
 * A line without a positive quantity and rate is left as it is.
 */
export function roundedRate(qty: number, rate: number, step: number): number {
  if (!(qty > 0) || !(rate > 0) || !(step > 0)) return rate;
  const amount = roundedLineAmount(qty, rate, step);
  if (amount === lineAmount(qty, rate)) return rate;
  return rateForTotal(amount, qty);
}
