import { normalisePhone } from './phone';
import { searchKey } from './kannada';
import { pickLang } from './i18n';
import type { Lang } from './types';
import { round2 } from './money';
import { evaluateAmount } from './calc';

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

/**
 * The word that has to be typed out to erase the shop's books.
 *
 * Not a translated string: the server compares it exactly, so a Kannada rendering would be a
 * word that does not work. It is deliberately the same in both languages for that reason, and
 * lives here so the two halves cannot drift apart.
 */
export const ERASE_WORD = 'ERASE';

const MAX_MONEY = 1_000_000;
const MAX_QTY = 100_000;
const MAX_PAID = 10_000_000;

function money(raw: string, what: string, example: string): Parsed {
  // A plain number first, and a typed sum second: two kilos at 44 can be entered as 44*2 rather
  // than worked out in the shopkeeper's head. Every rule below still applies to the answer.
  const n = parseDecimal(raw) ?? evaluateAmount(raw);
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
  // Cash is counted out in notes, so it is natural to type it as one: 100+50+20.
  const n = parseDecimal(raw) ?? evaluateAmount(raw);
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
  | { ok: true; name: string; nameKn: string; phone: string }
  | { ok: false; error: string };

export { normalisePhone };

/**
 * Does this customer answer to what was typed?
 *
 * The one place the question is asked, because it used to be asked in three -- the two stores'
 * `searchCustomers` and the Customers page's own filter -- and three copies of a matching rule
 * are three chances to disagree about who exists.
 *
 * Three ways to match, any of which will do:
 *
 * - the name as written, which is what a shopkeeper typing Kannada expects;
 * - the phone, on digits only. Guarded, because `startsWith('')` is true of every string, and a
 *   name search that found nothing used to list the whole book;
 * - the phonetic key, which is what lets `ramesh` reach a customer stored as ರಮೇಶ್. Their name is
 *   untouched by this -- it is only how they are found, never how they are shown.
 *
 * A prefix rather than a substring, matching what the suggestions under the bill screen have
 * always done: typing `rame` reaches `ramesh`, but `mesh` does not.
 */
/** How a customer's name should read, in the language the shop is set to. */
export function customerName(c: { name: string; nameKn?: string }, lang: Lang): string {
  return pickLang(c.name, c.nameKn, lang);
}

export function customerMatches(
  c: { name: string; nameKn?: string; phone: string },
  query: string,
): boolean {
  const typed = String(query ?? '').trim();
  if (!typed) return false;

  const digits = normalisePhone(typed);
  if (digits.length > 0 && c.phone.startsWith(digits)) return true;

  /*
   * Any word of the name, not just the first.
   *
   * A shop knows a customer as "Gowda" as readily as "Ramesh", and a plain prefix on the whole
   * string finds neither surname nor second name. Matching each word separately gets both while
   * still refusing a fragment from the middle of one -- `gowda` reaches ರಮೇಶ್ ಗೌಡ, `owda`
   * does not. The whole string is tried too, so a two-word query still works.
   */
  const lower = typed.toLowerCase();
  const key = searchKey(typed);

  // Both names, if there are two. A customer entered in Kannada and searched for in English has
  // to be found by either, or the second box would make people harder to find rather than easier.
  for (const name of [c.name, c.nameKn ?? '']) {
    if (!name) continue;
    const words = name.split(/\s+/).filter(Boolean);
    if (name.toLowerCase().startsWith(lower)) return true;
    if (words.some((w) => w.toLowerCase().startsWith(lower))) return true;
    if (key.length === 0) continue;
    if (searchKey(name).startsWith(key)) return true;
    if (words.some((w) => searchKey(w).startsWith(key))) return true;
  }
  return false;
}

/**
 * A GST number, and what looks wrong with it.
 *
 * A real GSTIN is fifteen characters in a fixed shape: two digits of state code, the ten
 * characters of a PAN, an entity digit, a letter that is nearly always Z, and a check character.
 * This checks that shape and says so when it does not fit -- but it never refuses to save.
 * A shop with a provisional or unusual number still has to be able to bill, and a settings
 * screen that will not close is worse than a warning nobody needed.
 */
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function checkGstin(raw: string): { value: string; warning: string | null } {
  // Upper-cased and stripped of the spaces and dashes people put in it: the number is one token
  // and it prints on paper, so it should look the same however it was typed.
  const value = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!value) return { value: '', warning: null };
  if (value.length !== 15) {
    return { value, warning: 'A GST number is 15 characters -- this one has ' + value.length + '.' };
  }
  if (!GSTIN.test(value)) {
    return { value, warning: 'That does not look like a GST number -- check it before printing.' };
  }
  return { value, warning: null };
}

export function checkCustomer(rawName: string, rawPhone: string, rawNameKn = ''): CustomerFields {
  const name = String(rawName ?? '').trim();
  // The same person's name on a Kannada keypad. Either box will do -- requiring both would mean
  // every customer already in the book had to be reopened and retyped.
  const nameKn = String(rawNameKn ?? '').trim();
  const typedPhone = String(rawPhone ?? '').trim();
  const phone = normalisePhone(typedPhone);

  // Something was typed in the phone field and none of it was a digit. Treating that as "no
  // phone given" loses it silently, and the operator only finds out when the customer cannot be
  // found again.
  if (typedPhone.length > 0 && phone.length === 0) {
    return { ok: false, error: 'That phone number has no digits in it.' };
  }
  if (!name && !nameKn && !phone) {
    return { ok: false, error: 'Give the customer a name or a phone number.' };
  }
  if (name.length > 80 || nameKn.length > 80) {
    return { ok: false, error: 'That name is too long (80 characters).' };
  }
  /*
   * Only an upper bound.
   *
   * There used to be a floor of six digits, on the reasoning that anything shorter cannot be
   * dialled. At the counter it meant a half-typed number was refused while the customer stood
   * there, and the shop asked for it to go: a short number is theirs to judge, not the till's.
   * What is still refused is a number too long to be one, and a number that is one digit over
   * and over, which is what a leaning finger produces.
   */
  if (phone.length > 15) {
    return { ok: false, error: 'That phone number does not look right — check the digits.' };
  }
  if (phone.length >= 6 && new Set(phone).size === 1) {
    return { ok: false, error: 'That phone number is the same digit repeated — check it.' };
  }
  return { ok: true, name, nameKn, phone };
}

export function checkUnit(raw: string): TextCheck {
  const value = raw.trim();
  if (value.length > 16) return { ok: false, error: 'The unit is too long — try kg, pc or ltr.' };
  return { ok: true, value: value || 'pc' };
}
