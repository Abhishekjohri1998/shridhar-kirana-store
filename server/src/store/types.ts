import { normalisePhone } from '@shridhar/shared';
import type { Bill, BillLine, Customer, Item, Settings, TodaySummary } from '@shridhar/shared';

export { normalisePhone };

export type NewBill = {
  lines: BillLine[];
  customerId?: string;
  /** Cash taken. Defaults to the whole total, i.e. a fully paid bill. */
  paid?: number;
  showBalance?: boolean;
};

export type CustomerInput = {
  id?: string; name: string; nameKn?: string; phone: string; address?: string; notes?: string;
};

/**
 * Everything the API needs from storage. Two implementations exist -- MongoDB, and a JSON file
 * for when MONGO_URI has not been handed over yet -- and the routes cannot tell them apart.
 */
export type Repo = {
  kind: 'mongo' | 'file';

  /**
   * Fill an empty shop with its starter catalogue, in one write.
   *
   * One write matters: this used to be a loop of single upserts, and a restart part-way through
   * (tsx watch reloading, or a crash) left four of the twenty-four items on disk. The next boot
   * then saw a non-empty shop, skipped seeding, and the other twenty were gone for good. Doing it
   * as one operation means the outcome is all of them or none, and none is retried next boot.
   *
   * Returns how many were inserted -- zero when the shop already had items.
   */

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  listBills(limit: number, customerId?: string): Promise<Bill[]>;
  getBill(no: number): Promise<Bill | null>;
  /**
   * Assigns the bill number, recomputes the total, and rolls the customer's running balance
   * forward. Never trusts a total from the browser.
   */
  createBill(input: NewBill): Promise<Bill>;
  /**
   * Marks a bill cancelled and takes it back out of the customer's running figures.
   *
   * Not a delete: the customer may hold the printed slip, and later bills of theirs carry this
   * one's balance as a snapshot, so removing it would leave those quietly wrong. Idempotent --
   * cancelling twice must not subtract twice. Returns null when there is no such bill.
   */
  cancelBill(no: number): Promise<Bill | null>;
  /**
   * Removes a cancelled bill for good.
   *
   * Only a cancelled one, unless `force` is given -- then it cancels first and deletes second,
   * which is the same two steps in one ask. Either way the money goes back out through
   * `cancelBill`: that is the only code that knows how, and a second copy of the arithmetic is a
   * second copy to get wrong. Three answers rather than a boolean because "no such bill" and "that one is still
   * live" are different things to tell the shopkeeper.
   *
   * The number is not freed. A numbered book with a gap at 14 is honest; a second bill 14 is not.
   */
  deleteBill(no: number, force?: boolean): Promise<'deleted' | 'live' | 'missing'>;
  /**
   * Empties the book: every bill, the numbering back to the start, and the customers too unless
   * they are spared.
   *
   * `keepCustomers` keeps each customer's name, Kannada name and phone and zeroes what they are
   * owed -- a balance is worked out from bills, so with the bills gone there is nothing behind
   * it and leaving a figure there would be a debt nobody could account for.
   *
   * Settings are left alone either way, so a shop that erases its test bills is ready to trade
   * again rather than being asked for its own name.
   */
  eraseAll(keepCustomers?: boolean): Promise<void>;
  todaySummary(): Promise<TodaySummary>;

  listCustomers(): Promise<Customer[]>;
  /** Prefix match on name or phone, for the suggestions under the customer fields. */
  searchCustomers(query: string, limit: number): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer | null>;
  /** Matches on phone when one is given, so the same person is not stored twice. */
  upsertCustomer(input: CustomerInput): Promise<Customer>;
  deleteCustomer(id: string): Promise<boolean>;
  /** Customers whose last bill is older than `days`, oldest visit first. */
  inactiveCustomers(days: number): Promise<Customer[]>;
};

/** Midnight-to-midnight in the server's own timezone, which is the shop's day. */
export function dayBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}



/** Readable ids, so the data stays legible if anyone looks at the collection directly. */
export function makeCustomerId(name: string, phone: string): string {
  const digits = normalisePhone(phone);
  if (digits) return 'p' + digits;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (slug || 'customer') + '-' + Date.now().toString(36).slice(-4);
}

export function customerBalance(c: { totalBilled: number; totalPaid: number }): number {
  return Math.round((c.totalBilled - c.totalPaid) * 100) / 100;
}

/**
 * The update document for "set these fields, and seed the rest if the row is new".
 *
 * MongoDB rejects an update whose operators touch the same path twice -- error 40,
 * ConflictingUpdateOperators -- so a field in `$set` must not also appear in `$setOnInsert`. It
 * did: settings were saved with `{ $set: patch, $setOnInsert: { ...DEFAULT_SETTINGS } }`, and
 * every settings field is in the defaults, so *every* save failed against Atlas with a 500 while
 * passing against the JSON file store the tests drive. The shop found it by trying to rename
 * itself.
 *
 * Empty operators are left out entirely: Mongo rejects `$set: {}` as well.
 */
export function upsertDoc(
  patch: Record<string, unknown>,
  seed: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const onInsert: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(seed)) {
    if (!(k in patch)) onInsert[k] = v;
  }
  const doc: Record<string, Record<string, unknown>> = {};
  if (Object.keys(patch).length > 0) doc.$set = patch;
  if (Object.keys(onInsert).length > 0) doc.$setOnInsert = onInsert;
  return doc;
}

/** The cutoff a customer must have been seen after to count as active. */
export function inactiveCutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
