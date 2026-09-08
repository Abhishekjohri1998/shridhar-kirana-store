import mongoose, { Schema, type Model } from 'mongoose';
import {
  DEFAULT_SETTINGS, billTotal, customerMatches, round2,
  type Bill, type BillLine, type Customer, type Ink, type Settings, type TodaySummary,
} from '@shridhar/shared';
import {
  customerBalance, dayBounds, inactiveCutoff, makeCustomerId, normalisePhone, upsertDoc,
  type CustomerInput, type NewBill, type Repo,
} from './types';

/** What is actually stored for a customer: the running figures, without the derived balance. */
type CustomerDoc = {
  id: string;
  name: string;
  nameKn?: string;
  phone: string;
  since: string;
  totalBilled: number;
  totalPaid: number;
  billCount: number;
  lastVisit: string | null;
};

type SettingsDoc = Settings & { key: string };
type CounterDoc = { key: string; value: number };

const inkSchema = new Schema<Ink>(
  {
    w: { type: Number, required: true },
    h: { type: Number, required: true },
    strokes: { type: [[Number]], required: true },
  },
  { _id: false, versionKey: false },
);

const lineSchema = new Schema<BillLine>(
  {
    itemId: { type: String, required: true },
    // Blank on a handwritten line, and blank on a bare price with no description at all.
    // Not required. Every line of the slip is handwriting now, and handwriting has no typed name
    // -- `required` rejects an empty string, so this schema refused to save any bill at all.
    nameKn: { type: String, default: '' },
    nameEn: { type: String, default: '' },
    ink: { type: inkSchema, required: false },
    qty: { type: Number, required: true },
    rate: { type: Number, required: true },
  },
  { _id: false, versionKey: false },
);

const billCustomerSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, default: '' },
    // Optional with a plain default -- never `required: true` beside one, the pairing that made
    // every print return 500 once.
    nameKn: { type: String, required: false, default: '' },
    phone: { type: String, required: true, default: '' },
  },
  { _id: false, versionKey: false },
);

const billSchema = new Schema<Bill>(
  {
    no: { type: Number, required: true, unique: true, index: true },
    at: { type: String, required: true },
    customer: { type: billCustomerSchema, required: false },
    lines: { type: [lineSchema], required: true },
    total: { type: Number, required: true },
    paid: { type: Number, required: true },
    balance: { type: Number, required: true },
    // Optional, and no `required: true` with a default -- that pairing on the line names is what
    // made every print return 500, and schematest exists because of it.
    previousBalance: { type: Number, required: false, default: 0 },
    previousBalanceAt: { type: String, required: false, default: null },
    cancelled: { type: Boolean, required: false, default: false },
    cancelledAt: { type: String, required: false, default: null },
    showBalance: { type: Boolean, required: true, default: false },
  },
  { versionKey: false },
);
// Bills are read newest first, the day summary scans one day, and a customer's history filters by id.
billSchema.index({ at: -1 });
billSchema.index({ 'customer.id': 1, no: -1 });

const customerSchema = new Schema<CustomerDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, default: '' },
    // Optional with a plain default -- see the note on the bill's copy above.
    nameKn: { type: String, required: false, default: '' },
    phone: { type: String, required: true, default: '' },
    since: { type: String, required: true },
    totalBilled: { type: Number, required: true, default: 0 },
    totalPaid: { type: Number, required: true, default: 0 },
    billCount: { type: Number, required: true, default: 0 },
    lastVisit: { type: String, required: false, default: null },
  },
  { versionKey: false },
);
customerSchema.index({ lastVisit: 1 });

const settingsSchema = new Schema<SettingsDoc>(
  {
    key: { type: String, required: true, unique: true, default: 'shop' },
    shopName: { type: String, required: true },
    footer: { type: String, required: true },
    paper: { type: String, required: true, default: DEFAULT_SETTINGS.paper },
    language: { type: String, required: true, default: DEFAULT_SETTINGS.language },
    // Optional with a plain default, never `required: true` alongside one -- that pairing is
    // what made every print return 500 once, and schematest exists because of it.
    gstin: { type: String, required: false, default: '' },
    shopNameKn: { type: String, required: false, default: '' },
    footerKn: { type: String, required: false, default: '' },
    showRate: { type: Boolean, required: true },
    inactiveAfterDays: { type: Number, required: true, default: DEFAULT_SETTINGS.inactiveAfterDays },
  },
  { versionKey: false },
);

const counterSchema = new Schema<CounterDoc>(
  { key: { type: String, required: true, unique: true }, value: { type: Number, required: true } },
  { versionKey: false },
);

/**
 * Registered when this module loads, not when a connection is made.
 *
 * Registration needs no database, and putting it here means the schemas can be validated in a
 * test that never connects -- which is what `npm run schematest` does. That test exists because a
 * schema saying `required` on a field the app always leaves empty made every bill unsaveable, and
 * nothing caught it: the pipeline test drives the JSON file store, which validates nothing.
 *
 * The explicit annotations matter. Without them the `??` yields a union TypeScript will not call.
 */
const Bills: Model<Bill> =
  (mongoose.models.Bill as Model<Bill> | undefined) ?? mongoose.model<Bill>('Bill', billSchema);
const Customers: Model<CustomerDoc> =
  (mongoose.models.Customer as Model<CustomerDoc> | undefined) ??
  mongoose.model<CustomerDoc>('Customer', customerSchema);
const SettingsModel: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc> | undefined) ??
  mongoose.model<SettingsDoc>('Settings', settingsSchema);
const Counters: Model<CounterDoc> =
  (mongoose.models.Counter as Model<CounterDoc> | undefined) ??
  mongoose.model<CounterDoc>('Counter', counterSchema);

export async function createMongoRepo(uri: string): Promise<Repo> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const strip = <T extends object>(doc: T): T => {
    const { _id, __v, ...rest } = doc as Record<string, unknown>;
    return rest as T;
  };

  const toCustomer = (doc: CustomerDoc): Customer => {
    const c = strip(doc);
    return { ...c, balance: customerBalance(c) };
  };

  return {
    kind: 'mongo',

    async getSettings() {
      const doc = await SettingsModel.findOneAndUpdate(
        { key: 'shop' },
        { $setOnInsert: { ...DEFAULT_SETTINGS, key: 'shop' } },
        { upsert: true, new: true },
      ).lean();
      const { key, ...rest } = strip(doc as unknown as SettingsDoc);
      return { ...DEFAULT_SETTINGS, ...rest };
    },

    async updateSettings(patch) {
      const doc = await SettingsModel.findOneAndUpdate(
        { key: 'shop' },
        upsertDoc(patch as Record<string, unknown>, { ...DEFAULT_SETTINGS, key: 'shop' }),
        { upsert: true, new: true },
      ).lean();
      const { key, ...rest } = strip(doc as unknown as SettingsDoc);
      return { ...DEFAULT_SETTINGS, ...rest };
    },

    async listBills(limit, customerId) {
      const filter = customerId ? { 'customer.id': customerId } : {};
      const docs = await Bills.find(filter).sort({ no: -1 }).limit(limit).lean();
      return docs.map((d) => strip(d as unknown as Bill));
    },

    async getBill(no) {
      const doc = await Bills.findOne({ no }).lean();
      return doc ? strip(doc as unknown as Bill) : null;
    },

    async createBill({ lines, customerId, paid, showBalance }) {
      const total = billTotal(lines);
      const takings = round2(paid ?? total);

      /*
       * When the balance was last added to: the newest earlier bill of theirs that was not
       * settled in full.
       *
       * Read here, before the customer's running figures move. Anything that throws between the
       * $inc below and the try/catch that compensates it would leave the ledger claiming money
       * for a bill that does not exist, so a lookup this incidental has no business living
       * inside that window. Served by the { 'customer.id': 1, no: -1 } index and stops at the
       * first match.
       *
       * The honest limit of this date: a customer can only reduce their balance by overpaying on
       * a later bill, so one who settles up in cash keeps the old date until they buy again.
       */
      let previousBalanceAt: string | null = null;
      if (customerId) {
        const owing = await Bills.findOne(
          {
            'customer.id': customerId,
            cancelled: { $ne: true },
            $expr: { $lt: ['$paid', '$total'] },
          },
          { at: 1 },
        )
          .sort({ no: -1 })
          .lean();
        previousBalanceAt = owing ? (owing as unknown as Bill).at : null;
      }

      let customerDoc: CustomerDoc | null = null;
      if (customerId) {
        // Roll the running figures forward first, so the balance printed on the slip is the
        // balance after this bill.
        const updated = await Customers.findOneAndUpdate(
          { id: customerId },
          {
            $inc: { totalBilled: total, totalPaid: takings, billCount: 1 },
            $set: { lastVisit: new Date().toISOString() },
          },
          { new: true },
        ).lean();
        customerDoc = updated ? strip(updated as unknown as CustomerDoc) : null;
      }

      // $inc on a single counter document is atomic, so two tills cannot take the same number.
      const counter = await Counters.findOneAndUpdate(
        { key: 'billNo' },
        { $inc: { value: 1 } },
        { upsert: true, new: true },
      ).lean();
      const no = (counter as unknown as CounterDoc).value;

      // The customer doc above is the state *after* this bill, so what they owed before is that
      // figure with this bill's own movement taken back out. No second read, and it cannot
      // disagree with `balance` by a paisa because it is derived from it.
      const balance = customerDoc ? customerBalance(customerDoc) : round2(total - takings);
      const previousBalance = customerDoc ? round2(balance - total + takings) : 0;

      const bill: Bill = {
        no,
        at: new Date().toISOString(),
        ...(customerDoc
          ? {
              customer: {
                id: customerDoc.id,
                name: customerDoc.name,
                nameKn: customerDoc.nameKn ?? '',
                phone: customerDoc.phone,
              },
            }
          : {}),
        lines,
        total,
        paid: takings,
        balance,
        previousBalance,
        previousBalanceAt: previousBalance === 0 ? null : previousBalanceAt,
        showBalance: showBalance ?? false,
      };

      try {
        await Bills.create(bill);
      } catch (err) {
        // The customer's totals were already moved. Put them back rather than leave the ledger
        // claiming money for a bill that does not exist.
        if (customerId) {
          await Customers.updateOne(
            { id: customerId },
            { $inc: { totalBilled: -total, totalPaid: -takings, billCount: -1 } },
          ).catch(() => undefined);
        }

        // Give the number back, but only if nobody has taken one since. A shopkeeper reads a gap
        // in the bill book as a missing bill, and a run of failures burned six numbers before
        // anyone noticed. The guard on `value: no` is what keeps two tills from ever sharing a
        // number: if another bill has already advanced the counter, the gap stays and that is the
        // safe outcome.
        await Counters.updateOne({ key: 'billNo', value: no }, { $inc: { value: -1 } })
          .catch(() => undefined);
        throw err;
      }

      return bill;
    },

    async cancelBill(no) {
      /*
       * The mark is claimed first, with a guard on it not already being set, so two tills cannot
       * both subtract for the same bill. Only once that claim succeeds are the customer's figures
       * moved -- and if that fails, the mark comes back off, the same compensation createBill
       * does when the insert fails. The bill staying live is the safe end of a half-done cancel;
       * a ledger short of money is not.
       */
      const claimed = await Bills.findOneAndUpdate(
        { no, cancelled: { $ne: true } },
        { $set: { cancelled: true, cancelledAt: new Date().toISOString() } },
        { new: true },
      ).lean();

      if (!claimed) {
        // Either there is no such bill, or it was already cancelled -- which is not an error.
        const existing = await Bills.findOne({ no }).lean();
        return existing ? strip(existing as unknown as Bill) : null;
      }

      const bill = strip(claimed as unknown as Bill);
      if (bill.customer) {
        try {
          await Customers.updateOne(
            { id: bill.customer.id },
            { $inc: { totalBilled: -bill.total, totalPaid: -bill.paid, billCount: -1 } },
          );
        } catch (err) {
          await Bills.updateOne({ no }, { $set: { cancelled: false, cancelledAt: null } })
            .catch(() => undefined);
          throw err;
        }
      }
      return bill;
    },

    async todaySummary(): Promise<TodaySummary> {
      const { start, end } = dayBounds();
      // A cancelled bill is not a sale. `at` is still its own date, so it would otherwise keep
      // counting towards the day it was written.
      const docs = await Bills.find({
        at: { $gte: start.toISOString(), $lt: end.toISOString() },
        cancelled: { $ne: true },
      })
        .select({ total: 1 })
        .lean();
      return {
        count: docs.length,
        total: round2(docs.reduce((s, d) => s + (d as unknown as Bill).total, 0)),
      };
    },

    async listCustomers() {
      const docs = await Customers.find().sort({ name: 1 }).lean();
      return docs.map((d) => toCustomer(d as unknown as CustomerDoc));
    },

    async searchCustomers(query, limit) {
      if (!query.trim()) return [];
      /*
       * Matched here rather than in the query.
       *
       * A phonetic key cannot be compared by a regex against a name the database has never
       * reduced, and the point of the key is that every customer already in the book becomes
       * findable by typing English -- nothing re-entered, no backfill. So the names come back and
       * the matching happens in the one place both stores and both apps share.
       *
       * listCustomers() already returns every customer to the Customers page, so this is not a
       * new order of magnitude. If the shop ever has thousands rather than dozens, the answer is
       * to store searchKey(name) on the document and index it -- and then to backfill it.
       */
      const docs = await Customers.find().sort({ name: 1 }).lean();
      return docs
        .map((d) => toCustomer(d as unknown as CustomerDoc))
        .filter((c) => customerMatches(c, query))
        .slice(0, limit);
    },

    async getCustomer(id) {
      const doc = await Customers.findOne({ id }).lean();
      return doc ? toCustomer(doc as unknown as CustomerDoc) : null;
    },

    async upsertCustomer({ id, name, nameKn, phone }) {
      const digits = normalisePhone(phone);
      // An existing record is found by id, or by phone when one is given -- which is what stops
      // the same person being saved twice as they get re-entered at the counter.
      const existing = id
        ? await Customers.findOne({ id }).lean()
        : digits
          ? await Customers.findOne({ phone: digits }).lean()
          : null;

      if (existing) {
        const doc = await Customers.findOneAndUpdate(
          { id: (existing as unknown as CustomerDoc).id },
          { $set: { name, nameKn: nameKn ?? '', phone: digits } },
          { new: true },
        ).lean();
        return toCustomer(doc as unknown as CustomerDoc);
      }

      const fresh: CustomerDoc = {
        id: id ?? makeCustomerId(name || (nameKn ?? ''), digits),
        name,
        nameKn: nameKn ?? '',
        phone: digits,
        since: new Date().toISOString(),
        totalBilled: 0,
        totalPaid: 0,
        billCount: 0,
        lastVisit: null,
      };
      await Customers.create(fresh);
      return toCustomer(fresh);
    },

    async deleteCustomer(id) {
      const res = await Customers.deleteOne({ id });
      return res.deletedCount > 0;
    },

    async inactiveCustomers(days) {
      const cutoff = inactiveCutoff(days).toISOString();
      const docs = await Customers.find({
        billCount: { $gt: 0 },
        lastVisit: { $ne: null, $lt: cutoff },
      })
        .sort({ lastVisit: 1 })
        .lean();
      return docs.map((d) => toCustomer(d as unknown as CustomerDoc));
    },
  };
}
