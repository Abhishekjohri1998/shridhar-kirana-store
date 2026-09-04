import { normalisePhone } from './phone';
import { round2 } from './money';

/**
 * Every rule about what may be typed into a field, in one place.
 *
 * Used by the web app and the phone app alike. These were scattered inline across four pages, which made them impossible to test exhaustively
 * and easy to let drift apart -- the price field on the bill and the rate field on the items page
 * should not disagree about whether "1,5" is a number. They also all went through `Number()`,
 * which quietly accepts things a shopkeeper never means: `Number('0x1f')` is 31, `Number('1e3')`
 * is 1000, `Number('')` and `Number(' ')` are both 0.
 */

/** A plain decimal and nothing else: no hex, no exponents, no thousands separators. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export type Parsed = { ok: true; value: number } | { ok: false; error: string };

/** null for anything that is not a plain decimal number. */
export function parseDecimal(raw: string): number | null {
  const text = raw.trim();
  if (!DECIMAL.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const MAX_MONEY = 1_000_000;
const MAX_QTY = 100_000;
const MAX_PAID = 10_000_000;

function money(raw: string, what: string, example: string): Parsed {
  const n = parseDecimal(raw);
  if (n == null) return { ok: false, error: 'Enter the ' + what + ' in digits, for example ' + example + '.' };
  if (n <= 0) return { ok: false, error: 'The ' + what + ' has to be more than zero.' };
  if (n > MAX_MONEY) return { ok: false, error: 'That ' + what + ' looks too large — check it.' };
  return { ok: true, value: round2(n) };
}

/** The price on a bill line. */
export function parsePrice(raw: string): Parsed {
  return money(raw, 'price', '45 or 12.50');
}

/** The rate on a catalogue item. Same rules, wording the item form uses. */
export function parseRate(raw: string): Parsed {
  return money(raw, 'rate', '45 or 12.50');
}

export function parseQty(raw: string): Parsed {
  const n = parseDecimal(raw);
  if (n == null) return { ok: false, error: 'Enter the quantity in digits, for example 2 or 1.5.' };
  if (n <= 0) return { ok: false, error: 'The quantity has to be more than zero.' };
  if (n > MAX_QTY) return { ok: false, error: 'That quantity looks too large — check it.' };
  // Three decimals covers grams on a kilo scale and stops 1/3 turning into a recurring number.
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

/**
 * Cash taken. Blank means the whole total, which is the ordinary case at a kirana counter, so it
 * is a valid entry rather than a missing one. Zero is allowed: it means the bill goes on credit.
 */
export function parsePaid(raw: string, total: number): Parsed {
  if (raw.trim() === '') return { ok: true, value: round2(total) };
  const n = parseDecimal(raw);
  if (n == null) {
    return { ok: false, error: 'Enter the amount paid in digits, or leave it blank for paid in full.' };
  }
  if (n < 0) return { ok: false, error: 'The amount paid cannot be negative.' };
  if (n > MAX_PAID) return { ok: false, error: 'That amount looks too large — check it.' };
  return { ok: true, value: round2(n) };
}

export function parseQuietDays(raw: string): Parsed {
  const n = parseDecimal(raw);
  if (n == null || !Number.isInteger(n)) {
    return { ok: false, error: 'Quiet days has to be a whole number of days, for example 30.' };
  }
  if (n < 1 || n > 3650) return { ok: false, error: 'Quiet days has to be between 1 and 3650.' };
  return { ok: true, value: n };
}

export type TextCheck = { ok: true; value: string } | { ok: false; error: string };

/** The shop name prints at the top of every slip, so it cannot be blank. */
export function checkShopName(raw: string): TextCheck {
  const value = raw.trim();
  if (!value) return { ok: false, error: 'The shop name cannot be empty — it prints on every slip.' };
  if (value.length > 80) return { ok: false, error: 'The shop name is too long for the paper (80 characters).' };
  return { ok: true, value };
}

/** The footer may be empty; some shops want nothing under the total. */
export function checkFooter(raw: string): TextCheck {
  const value = raw.trim();
  if (value.length > 120) return { ok: false, error: 'The footer line is too long (120 characters).' };
  return { ok: true, value };
}

export type ItemNames = { ok: true; nameKn: string; nameEn: string } | { ok: false; error: string };

/** An item needs one name; either falls back to the other so a half-filled item still prints. */
export function checkItemNames(rawKn: string, rawEn: string): ItemNames {
  const nameKn = rawKn.trim();
  const nameEn = rawEn.trim();
  if (!nameKn && !nameEn) return { ok: false, error: 'Fill at least one of the two names.' };
  if (nameKn.length > 120 || nameEn.length > 120) {
    return { ok: false, error: 'That name is too long (120 characters).' };
  }
  return { ok: true, nameKn: nameKn || nameEn, nameEn: nameEn || nameKn };
}

export type CustomerFields =
  | { ok: true; name: string; phone: string }
  | { ok: false; error: string };

export { normalisePhone };

export function checkCustomer(rawName: string, rawPhone: string): CustomerFields {
  const name = rawName.trim();
  const phone = normalisePhone(rawPhone);
  if (!name && !phone) return { ok: false, error: 'Give the customer a name or a phone number.' };
  if (name.length > 80) return { ok: false, error: 'That name is too long (80 characters).' };
  if (phone.length > 0 && (phone.length < 6 || phone.length > 15)) {
    return { ok: false, error: 'That phone number does not look right — check the digits.' };
  }
  return { ok: true, name, phone };
}

export function checkUnit(raw: string): TextCheck {
  const value = raw.trim();
  if (value.length > 16) return { ok: false, error: 'The unit is too long — try kg, pc or ltr.' };
  return { ok: true, value: value || 'pc' };
}
