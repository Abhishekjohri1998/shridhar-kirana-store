import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SETTINGS, billTotal, customerMatches, round2,
  type Bill, type Customer, type Item, type Settings, type TodaySummary,
} from '@shridhar/shared';
import {
  customerBalance, dayBounds, inactiveCutoff, makeCustomerId, normalisePhone,
  type NewBill, type Repo,
} from './types';

type CustomerRow = {
  id: string;
  name: string;
  /** Their name on a Kannada keypad. Absent on every row written before the field existed. */
  nameKn?: string;
  phone: string;
  /** Where to deliver, and anything worth remembering. Absent on rows written before they
   *  existed, which reads as empty. */
  address?: string;
  notes?: string;
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
        let previousBalance = 0;
        let previousBalanceAt: string | null = null;
        if (customerId) {
          row = db.customers.find((c) => c.id === customerId);
          if (row) {
            // Both read before the figures move: this store mutates the row in place, so there
            // is no "before" to go back to afterwards. The mongo store reaches the same number
            // by subtracting this bill back out of the after state.
            previousBalance = customerBalance(row);
            const owing = db.bills
              .filter((b) => b.customer?.id === customerId && !b.cancelled && b.paid < b.total)
              .sort((a, b) => b.no - a.no)[0];
            previousBalanceAt = owing ? owing.at : null;

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
          ...(row
            ? {
                customer: {
                  id: row.id, name: row.name, nameKn: row.nameKn ?? '', phone: row.phone,
                },
              }
            : {}),
          lines,
          total,
          paid: takings,
          balance: row ? customerBalance(row) : round2(total - takings),
          previousBalance,
          previousBalanceAt: previousBalance === 0 ? null : previousBalanceAt,
          showBalance: showBalance ?? false,
        };
        db.bills.push(bill);
        await flush();
        return bill;
      });
    },

    cancelBill(no) {
      // Serialised, so the read-then-write cannot interleave and subtract twice.
      return serial(async () => {
        const bill = db.bills.find((b) => b.no === no);
        if (!bill) return null;
        // Already cancelled is not an error, and must not subtract a second time.
        if (bill.cancelled) return { ...bill };

        bill.cancelled = true;
        bill.cancelledAt = new Date().toISOString();
        if (bill.customer) {
          const row = db.customers.find((c) => c.id === bill.customer?.id);
          if (row) {
            row.totalBilled = round2(row.totalBilled - bill.total);
            row.totalPaid = round2(row.totalPaid - bill.paid);
            row.billCount = Math.max(0, row.billCount - 1);
          }
        }
        await flush();
        return { ...bill };
      });
    },

    deleteBill(no, force) {
      return serial(async () => {
        const bill = db.bills.find((b) => b.no === no);
        if (!bill) return 'missing' as const;

        // A live bill's money is still in the customer's totals. Cancelling is what takes it
        // out, so a forced delete does that first -- the same arithmetic cancelBill runs, not a
        // second copy of it sitting here waiting to disagree.
        if (!bill.cancelled) {
          if (!force) return 'live' as const;
          bill.cancelled = true;
          bill.cancelledAt = new Date().toISOString();
          if (bill.customer) {
            const row = db.customers.find((c) => c.id === bill.customer?.id);
            if (row) {
              row.totalBilled = round2(row.totalBilled - bill.total);
              row.totalPaid = round2(row.totalPaid - bill.paid);
              row.billCount = Math.max(0, row.billCount - 1);
            }
          }
        }

        db.bills = db.bills.filter((b) => b.no !== no);
        // db.billNo is left where it is: the number is spent, not returned to the pile.
        await flush();
        return 'deleted' as const;
      });
    },

    eraseAll(keepCustomers) {
      return serial(async () => {
        db.bills = [];
        if (keepCustomers) {
          // The four fields createBill adds to and cancelBill takes from. Zeroing them is what
          // "no bills" means for a customer; the name and the phone number are left alone.
          db.customers = db.customers.map((c) => ({
            ...c, totalBilled: 0, totalPaid: 0, billCount: 0, lastVisit: null,
          }));
        } else {
          db.customers = [];
        }
        db.billNo = 0;
        // db.settings survives: a shop that clears its test bills should not be asked its name.
        await flush();
      });
    },

    async todaySummary(): Promise<TodaySummary> {
      const { start, end } = dayBounds();
      // A cancelled bill is not a sale, though it keeps its own date.
      const today = db.bills.filter((b) => {
        if (b.cancelled) return false;
        const t = new Date(b.at).getTime();
        return t >= start.getTime() && t < end.getTime();
      });
      return { count: today.length, total: round2(today.reduce((s, b) => s + b.total, 0)) };
    },

    async listCustomers() {
      return [...db.customers].sort((a, b) => a.name.localeCompare(b.name)).map(toCustomer);
    },

    async searchCustomers(query, limit) {
      if (!query.trim()) return [];
      return db.customers
        .filter((c) => customerMatches(c, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(toCustomer);
    },

    async getCustomer(id) {
      const row = db.customers.find((c) => c.id === id);
      return row ? toCustomer(row) : null;
    },

    upsertCustomer({ id, name, nameKn, phone, address, notes }) {
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
          existing.nameKn = nameKn ?? '';
          existing.phone = digits;
          existing.address = address ?? '';
          existing.notes = notes ?? '';
          await flush();
          return toCustomer(existing);
        }

        const fresh: CustomerRow = {
          id: id ?? makeCustomerId(name || (nameKn ?? ''), digits),
          name,
          nameKn: nameKn ?? '',
          phone: digits,
          address: address ?? '',
          notes: notes ?? '',
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
