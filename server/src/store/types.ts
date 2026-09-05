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

export type CustomerInput = { id?: string; name: string; phone: string };

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

/** The cutoff a customer must have been seen after to count as active. */
export function inactiveCutoff(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
