import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { env } from './env';
import { HttpError } from './http';
import { customerBalance, type BookSnapshot } from './store/types';

/**
 * The backup file: what "Download a backup" saves and "Restore from backup" takes back.
 *
 * Version 1 was `{ at, settings, customers, bills, payments }` with no marker, the settings as
 * the app reads them, customers with their balance, and at most 5000 bills and payments. It is
 * still accepted. Version 2 says what it is, which shop it came from, carries every bill and
 * payment, the stored settings, and the last bill number handed out.
 *
 * The top-level fields of version 1 keep their names, so anything that read the old file reads
 * the new one.
 */
export const BACKUP_FORMAT = 'shridhar-billing-backup';
export const BACKUP_VERSION = 2;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  at: string;
  shop: { name: string; nameKn: string; gstin: string };
  settings: Record<string, unknown>;
  customers: Record<string, unknown>[];
  bills: unknown[];
  payments: unknown[];
  counters: { billNo: number };
};

export function buildBackup(book: BookSnapshot, at = new Date()): BackupFile {
  const s = book.settings;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    at: at.toISOString(),
    shop: { name: str(s.shopName), nameKn: str(s.shopNameKn), gstin: str(s.gstin) },
    settings: book.settings,
    // The balance is derived, and dropped again on the way back in; it is here for a person
    // opening the file to read what each customer owed.
    customers: book.customers.map((c) => ({
      ...c,
      balance: customerBalance({ totalBilled: num(c.totalBilled), totalPaid: num(c.totalPaid) }),
    })),
    bills: book.bills,
    payments: book.payments,
    counters: { billNo: book.billNo },
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/* ------------------------------------------------------------------ reading one back */

const money = z.number().finite();
const MAX_ROWS = 1_000_000;

const billRow = z.object({
  no: z.number().int().positive(),
  at: z.string().min(1).max(40),
  lines: z.array(z.object({ itemId: z.string(), qty: money, rate: money }).passthrough()).max(1000),
  total: money,
  paid: money,
  balance: money,
  customer: z.object({ id: z.string().min(1) }).passthrough().nullish(),
  clientId: z.string().nullish(),
}).passthrough();

const customerRow = z.object({
  id: z.string().min(1).max(200),
  name: z.string().default(''),
  phone: z.string().default(''),
  since: z.string().default(() => new Date().toISOString()),
  totalBilled: money.default(0),
  totalPaid: money.default(0),
  billCount: z.number().int().nonnegative().default(0),
  lastVisit: z.string().nullable().default(null),
}).passthrough();

const paymentRow = z.object({
  id: z.string().min(1).max(200),
  customerId: z.string().min(1).max(200),
  amount: money,
  at: z.string().min(1).max(40),
  createdAt: z.string().optional(),
}).passthrough();

const fileShape = z.object({
  format: z.string().optional(),
  version: z.number().int().positive().optional(),
  at: z.string().optional(),
  settings: z.object({ shopName: z.string().min(1) }).passthrough(),
  customers: z.array(customerRow).max(MAX_ROWS),
  bills: z.array(billRow).max(MAX_ROWS),
  payments: z.array(paymentRow).max(MAX_ROWS).default([]),
  counters: z.object({ billNo: z.number().int().nonnegative() }).passthrough().optional(),
}).passthrough();

/** Mongo's own fields, never carried from a file into a store. */
function clean<T extends Record<string, unknown>>(row: T): T {
  const { _id, __v, ...rest } = row as Record<string, unknown>;
  return rest as T;
}

function duplicate(values: (string | number)[]): string | number | null {
  const seen = new Set<string | number>();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}

const NOT_A_BACKUP = 'This file is not a backup from this billing app';

/**
 * A backup file, checked and turned back into a book. Refuses anything that is not one of ours,
 * from a newer app, or damaged, with a message that says which.
 */
export function readBackup(raw: unknown): { book: BookSnapshot; version: number; at: string | null } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, NOT_A_BACKUP);
  const marked = raw as Record<string, unknown>;
  if (marked.format != null && marked.format !== BACKUP_FORMAT) throw new HttpError(400, NOT_A_BACKUP);
  // Version 1 had no marker; it is recognised by its shape below.
  const version = marked.format == null ? 1 : Number(marked.version);
  if (!Number.isInteger(version) || version < 1) throw new HttpError(400, NOT_A_BACKUP);
  if (version > BACKUP_VERSION) {
    throw new HttpError(400, 'This backup was made by a newer version of the app. Update the server first.');
  }

  const parsed = fileShape.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    // An unmarked file that is not even shaped like a version 1 backup is simply not ours.
    if (marked.format == null) throw new HttpError(400, NOT_A_BACKUP);
    throw new HttpError(400, 'The backup file is damaged (' + (first ? first.path.join('.') + ': ' + first.message : 'unreadable') + ')');
  }
  const file = parsed.data;
  const given = raw as { customers: Record<string, unknown>[]; bills: Record<string, unknown>[]; payments?: Record<string, unknown>[]; settings: Record<string, unknown> };
  // The rows as the file has them, fields in their own order; only a field the checks filled in
  // because an older file lacked it is added. "Exactly as it was" includes the order.
  const asGiven = <T extends Record<string, unknown>>(rows: Record<string, unknown>[] | undefined, checked: T[]): Record<string, unknown>[] =>
    checked.map((c, i) => {
      const out: Record<string, unknown> = { ...(rows?.[i] ?? {}) };
      for (const [k, v] of Object.entries(c)) if (!(k in out)) out[k] = v;
      return out;
    });

  const dupBill = duplicate(file.bills.map((b) => b.no));
  if (dupBill != null) throw new HttpError(400, 'The backup file is damaged: bill ' + dupBill + ' appears twice');
  const dupCustomer = duplicate(file.customers.map((c) => c.id));
  if (dupCustomer != null) throw new HttpError(400, 'The backup file is damaged: customer ' + dupCustomer + ' appears twice');
  const dupPayment = duplicate(file.payments.map((p) => p.id));
  if (dupPayment != null) throw new HttpError(400, 'The backup file is damaged: payment ' + dupPayment + ' appears twice');
  const dupClient = duplicate(file.bills.map((b) => b.clientId).filter((c): c is string => typeof c === 'string' && c !== ''));
  if (dupClient != null) throw new HttpError(400, 'The backup file is damaged: one save appears as two bills');

  const highest = file.bills.reduce((m, b) => Math.max(m, b.no), 0);
  const customers = asGiven(given.customers, file.customers).map((c) => {
    // The balance is worked out from the running figures; it is never stored.
    const { balance: _balance, ...row } = clean(c);
    return row;
  });
  const payments = asGiven(given.payments, file.payments).map((p) => {
    const row = clean(p);
    if (typeof row.createdAt !== 'string') row.createdAt = String(row.at);
    return row;
  });

  return {
    version,
    at: file.at ?? null,
    book: {
      settings: clean({ ...given.settings }),
      customers,
      bills: asGiven(given.bills, file.bills).map((b) => clean(b)) as unknown as BookSnapshot['bills'],
      payments: payments as unknown as BookSnapshot['payments'],
      // Never below the highest bill in the file, or the next bill would take a number in use.
      billNo: Math.max(file.counters?.billNo ?? 0, highest),
    },
  };
}

/* ------------------------------------------------------------------ which shop */

function norm(v: unknown): string {
  return str(v).trim().toLowerCase().replace(/\s+/g, ' ');
}
function gstOf(v: unknown): string {
  return str(v).replace(/\s+/g, '').toUpperCase();
}

/**
 * Whether a backup belongs to this shop. A GST number on both sides decides it; otherwise the
 * shop name, in English or in Kannada. There is no shop id older than these, and they are what
 * the slip says, so they are what the shopkeeper would check by eye.
 */
export function sameShop(current: Record<string, unknown>, backup: Record<string, unknown>): boolean {
  const a = gstOf(current.gstin);
  const b = gstOf(backup.gstin);
  if (a && b) return a === b;
  if (norm(current.shopName) && norm(current.shopName) === norm(backup.shopName)) return true;
  return norm(current.shopNameKn) !== '' && norm(current.shopNameKn) === norm(backup.shopNameKn);
}

/* ------------------------------------------------------------------ the safety copy */

/** Where the copy taken before every restore is kept: beside the JSON store, whichever store runs. */
export function safetyDir(): string {
  return path.join(env.dataDir || path.join(__dirname, '..', '.data'), 'safety-backups');
}

const KEEP = 10;
export const SAFETY_NAME = /^before-restore-[0-9TZ-]+\.json$/;

/** Written whole and renamed into place; the oldest beyond the last ten are cleared away. */
export async function writeSafetyBackup(file: BackupFile): Promise<string> {
  const dir = safetyDir();
  await fs.mkdir(dir, { recursive: true });
  const stamp = file.at.replace(/[:.]/g, '-');
  const name = 'before-restore-' + stamp + '.json';
  const full = path.join(dir, name);
  await fs.writeFile(full + '.tmp', JSON.stringify(file), 'utf8');
  await fs.rename(full + '.tmp', full);
  const all = (await fs.readdir(dir)).filter((n) => SAFETY_NAME.test(n)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    await fs.unlink(path.join(dir, old)).catch(() => undefined);
  }
  return name;
}
