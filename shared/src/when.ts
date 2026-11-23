/** "2026-10-05 14:30" in the device's own time, for a box the shopkeeper can edit. */
export function localInput(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** Reads what localInput writes (seconds optional, "T" allowed). ISO string, or null. */
export function parseLocalInput(s: string): string | null {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return null;
  return d.toISOString();
}

/** "23/11/2026 16:51" in the device's own time: an edited bill's date box. */
export function dayInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/**
 * Reads a date as a shopkeeper writes it -- 21/11/2026, 21-11-26, with or without 16:30 -- or
 * what localInput writes. ISO string, or null. With no time, `keepTime` (an ISO date) lends its own.
 */
export function parseDayInput(s: string, keepTime?: string): string | null {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?\s*$/.exec(s);
  if (!m) return parseLocalInput(s);
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const keep = keepTime ? new Date(keepTime) : null;
  const hh = m[4] != null ? Number(m[4]) : keep ? keep.getHours() : 0;
  const mm = m[5] != null ? Number(m[5]) : keep ? keep.getMinutes() : 0;
  if (hh > 23 || mm > 59) return null;
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), hh, mm);
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) return null;
  return d.toISOString();
}

/**
 * The date an edited bill saves with, from its date box: unchanged (no `at`), a new date, or not
 * valid -- not a date, or later than now (a bill cannot be from tomorrow).
 */
export function editedBillDate(original: string, text: string | undefined, now = Date.now()): { ok: boolean; at?: string } {
  if (text == null || text.trim() === '' || text.trim() === dayInput(new Date(original))) return { ok: true };
  const at = parseDayInput(text, original);
  if (!at || Date.parse(at) > now + 5 * 60_000 || Date.parse(at) < Date.parse('2020-01-01')) return { ok: false };
  return { ok: true, at };
}
