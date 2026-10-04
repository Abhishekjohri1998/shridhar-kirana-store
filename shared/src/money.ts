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
