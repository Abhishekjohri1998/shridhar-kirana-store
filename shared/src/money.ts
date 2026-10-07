/** Round to paise. Everything that touches money goes through here, so line totals and the
 *  grand total can never disagree by a stray fraction. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A total moved to the nearest multiple of `step` rupees, half up: 152.50 to 155 on a step of
 * five, 152.49 to 150. A step of 0 leaves it alone. Which step the shop uses is the stock app's
 * setting; this is only the arithmetic, so both stores and the tests agree on it.
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
  // round2 absorbs any last-bit error, but check rather than trust it.
  return lineAmount(q, r) === t ? r : round2(r);
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
