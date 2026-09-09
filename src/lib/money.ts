/** Round to paise. Everything that touches money goes through here, so line totals and the
 *  grand total can never disagree by a stray fraction. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
  const r = Math.round(q * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
}
