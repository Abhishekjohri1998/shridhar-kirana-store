/**
 * One canonical form for a phone number, used by the browser and the server alike.
 *
 * A shop enters the same regular as "9886012345" one week and "+91 98860 12345" the next. Keeping
 * only the digits is not enough: those two differ by the country code, so they became two
 * customers with the khata split between them. Folding the Indian country code and the old trunk
 * zero away makes them one person.
 *
 * The trade-off is deliberate: a 12-digit foreign number that happens to start 91 would be folded
 * too. For a kirana shop in Karnataka that is the right way round.
 */
export function normalisePhone(raw: string): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  // "00" is the international prefix, and only when something follows it that looks like a
  // country code. Stripping it unconditionally turned ten zeros into eight and called the result
  // a phone number.
  if (digits.startsWith('00') && digits.length >= 12) digits = digits.slice(2); // 0091 98860 12345
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // 0 98860 12345
  return digits;
}

/**
 * Every number a customer has, primary first, normalised and without repeats.
 *
 * Customers saved before the list existed carry only `phone`; this reads them as a list of one,
 * so nothing has to be migrated.
 */
export function customerPhones(c: { phone?: string; phones?: string[] }): string[] {
  const out: string[] = [];
  for (const raw of [...(c.phones ?? []), c.phone ?? '']) {
    const d = normalisePhone(raw);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * The number WhatsApp knows a customer by, with the country code: their WhatsApp number if one
 * is saved, else their first phone. A ten-digit Indian number gets 91 in front. Empty when there
 * is none.
 */
export function whatsappNumber(c: { phone?: string; phones?: string[]; whatsapp?: string }): string {
  const d = normalisePhone(c.whatsapp || customerPhones(c)[0] || '');
  if (!d) return '';
  return d.length === 10 ? '91' + d : d;
}
