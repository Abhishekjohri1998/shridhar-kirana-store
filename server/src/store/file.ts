import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS, billTotal, round2,
  type Bill, type Customer, type Item, type Settings, type TodaySummary,
} from '@shridhar/shared';
import {
  customerBalance, dayBounds, inactiveCutoff, makeCustomerId, normalisePhone,
  type NewBill, type Repo,
} from './types';

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  since: string;
  totalBilled: number;
  totalPaid: number;
  billCount: number;
  lastVisit: string | null;
};

type Db = {
  items: Item[];
  bills: Bill[];
  customers: CustomerRow[];
  settings: Settings;
  billNo: number;
};

const EMPTY: Db = { items: [], bills: [], customers: [], settings: { ...DEFAULT_SETTINGS }, billNo: 0 };

/**
 * Stand-in for MongoDB until the connection string arrives. One JSON file, writes serialised
 * through a single promise chain and committed by rename so a crash mid-write cannot leave a
 * half-written file. Good enough to build and demo against; not something to run a shop on.
 */
export async function createFileRepo(dir: string): Promise<Repo> {
  const file = path.join(dir, 'db.json');
  await fs.mkdir(dir, { recursive: true });

  let db: Db = EMPTY;
  try {
    db = { ...EMPTY, ...(JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Db>) };
  } catch {
    // No file yet, or it is unreadable -- start empty and write on the first change.
  }

  let queue: Promise<unknown> = Promise.resolve();
  /** Runs mutations one at a time, so two requests cannot both read-modify-write the same file. */
  function serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  async function flush(): Promise<void> {
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, file);
  }

  const toCustomer = (row: CustomerRow): Customer => ({ ...row, balance: customerBalance(row) });

  return {
    kind: 'file',

    async listItems() {
      return [...db.items].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
    },

    seedItems(items) {
      return serial(async () => {
        if (db.items.length > 0) return 0;
        db.items = [...items];
        // A single flush: the file on disk goes from empty to complete with nothing in between.
        await flush();
        return db.items.length;
      });
    },

    upsertItem(item) {
      return serial(async () => {
        const at = db.items.findIndex((i) => i.id === item.id);
        if (at >= 0) db.items[at] = item;
        else db.items.push(item);
        await flush();
        return item;
      });
    },

    deleteItem(id) {
      return serial(async () => {
        const before = db.items.length;
        db.items = db.items.filter((i) => i.id !== id);
        if (db.items.length === before) return false;
        await flush();
        return true;
      });
    },

    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...db.settings };
    },

    updateSettings(patch) {
      return serial(async () => {
        db.settings = { ...DEFAULT_SETTINGS, ...db.settings, ...patch };
        await flush();
        return { ...db.settings };
      });
    },

    async listBills(limit, customerId) {
      return [...db.bills]
        .filter((b) => (customerId ? b.customer?.id === customerId : true))
        .sort((a, b) => b.no - a.no)
        .slice(0, limit);
    },

    async getBill(no) {
      return db.bills.find((b) => b.no === no) ?? null;
    },

    createBill({ lines, customerId, paid, showBalance }: NewBill) {
      return serial(async () => {
        const total = billTotal(lines);
        const takings = round2(paid ?? total);

        let row: CustomerRow | undefined;
        if (customerId) {
          row = db.customers.find((c) => c.id === customerId);
          if (row) {
            // Roll the running figures forward first, so the balance on the slip is the balance
            // after this bill.
            row.totalBilled = round2(row.totalBilled + total);
            row.totalPaid = round2(row.totalPaid + takings);
            row.billCount += 1;
            row.lastVisit = new Date().toISOString();
          }
        }

        db.billNo += 1;
        const bill: Bill = {
          no: db.billNo,
          at: new Date().toISOString(),
          ...(row ? { customer: { id: row.id, name: row.name, phone: row.phone } } : {}),
          lines,
          total,
          paid: takings,
          balance: row ? customerBalance(row) : round2(total - takings),
          showBalance: showBalance ?? false,
        };
        db.bills.push(bill);
        await flush();
        return bill;
      });
    },

    async todaySummary(): Promise<TodaySummary> {
      const { start, end } = dayBounds();
      const today = db.bills.filter((b) => {
        const t = new Date(b.at).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      return { count: today.length, total: round2(today.reduce((s, b) => s + b.total, 0)) };
    },

    async listCustomers() {
      return [...db.customers].sort((a, b) => a.name.localeCompare(b.name)).map(toCustomer);
    },

    async searchCustomers(query, limit) {
      const trimmed = query.trim().toLowerCase();
      if (!trimmed) return [];
      const digits = normalisePhone(trimmed);
      return db.customers
        .filter((c) =>
          c.name.toLowerCase().startsWith(trimmed) || (digits.length > 0 && c.phone.startsWith(digits)),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(toCustomer);
    },

    async getCustomer(id) {
      const row = db.customers.find((c) => c.id === id);
      return row ? toCustomer(row) : null;
    },

    upsertCustomer({ id, name, phone }) {
      return serial(async () => {
        const digits = normalisePhone(phone);
        // Found by id, or by phone when one is given -- which is what stops the same person
        // being saved twice as they get re-entered at the counter.
        const existing = id
          ? db.customers.find((c) => c.id === id)
          : digits
            ? db.customers.find((c) => c.phone === digits)
            : undefined;

        if (existing) {
          existing.name = name;
          existing.phone = digits;
          await flush();
          return toCustomer(existing);
        }

        const fresh: CustomerRow = {
          id: id ?? makeCustomerId(name, digits),
          name,
          phone: digits,
          since: new Date().toISOString(),
          totalBilled: 0,
          totalPaid: 0,
          billCount: 0,
          lastVisit: null,
        };
        db.customers.push(fresh);
        await flush();
        return toCustomer(fresh);
      });
    },

    deleteCustomer(id) {
      return serial(async () => {
        const before = db.customers.length;
        db.customers = db.customers.filter((c) => c.id !== id);
        if (db.customers.length === before) return false;
        await flush();
        return true;
      });
    },

    async inactiveCustomers(days) {
      const cutoff = inactiveCutoff(days).getTime();
      return db.customers
        .filter((c) => c.billCount > 0 && c.lastVisit != null && new Date(c.lastVisit).getTime() < cutoff)
        .sort((a, b) => String(a.lastVisit).localeCompare(String(b.lastVisit)))
        .map(toCustomer);
    },
  };
}
