import mongoose, { Schema, type Model } from 'mongoose';
import {
  DEFAULT_SETTINGS, billTotal, round2,
  type Bill, type BillLine, type Customer, type Ink, type Item, type Settings, type TodaySummary,
} from '@shridhar/shared';
import {
  customerBalance, dayBounds, inactiveCutoff, makeCustomerId, normalisePhone,
  type CustomerInput, type NewBill, type Repo,
} from './types';

/** What is actually stored for a customer: the running figures, without the derived balance. */
type CustomerDoc = {
  id: string;
  name: string;
  phone: string;
  since: string;
  totalBilled: number;
  totalPaid: number;
  billCount: number;
  lastVisit: string | null;
};

type SettingsDoc = Settings & { key: string };
type CounterDoc = { key: string; value: number };

const itemSchema = new Schema<Item>(
  {
    id: { type: String, required: true, unique: true, index: true },
    nameKn: { type: String, required: true },
    nameEn: { type: String, required: true },
    rate: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, default: 'pc' },
  },
  { versionKey: false },
);

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
    nameKn: { type: String, required: true, default: '' },
    nameEn: { type: String, required: true, default: '' },
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
    showRate: { type: Boolean, required: true },
    inactiveAfterDays: { type: Number, required: true, default: DEFAULT_SETTINGS.inactiveAfterDays },
  },
  { versionKey: false },
);

const counterSchema = new Schema<CounterDoc>(
  { key: { type: String, required: true, unique: true }, value: { type: Number, required: true } },
  { versionKey: false },
);

export async function createMongoRepo(uri: string): Promise<Repo> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const Items: Model<Item> =
    (mongoose.models.Item as Model<Item> | undefined) ?? mongoose.model<Item>('Item', itemSchema);
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

    async listItems() {
      const docs = await Items.find().sort({ nameEn: 1 }).lean();
      return docs.map((d) => strip(d as unknown as Item));
    },

    async seedItems(items) {
      if ((await Items.countDocuments()) > 0) return 0;
      // One insertMany command rather than a loop of upserts. `ordered: false` means a retry
      // after a partial insert fills the gaps instead of stopping on the first duplicate id.
      const res = await Items.insertMany(items, { ordered: false }).catch((err: unknown) => {
        const duplicateKey = (err as { code?: number })?.code === 11000;
        if (!duplicateKey) throw err;
        return [];
      });
      return Array.isArray(res) ? res.length : 0;
    },

    async upsertItem(item) {
      const doc = await Items.findOneAndUpdate({ id: item.id }, item, { upsert: true, new: true }).lean();
      return strip(doc as unknown as Item);
    },

    async deleteItem(id) {
      const res = await Items.deleteOne({ id });
      return res.deletedCount > 0;
    },

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
        { $set: patch, $setOnInsert: { ...DEFAULT_SETTINGS, key: 'shop' } },
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

      const bill: Bill = {
        no,
        at: new Date().toISOString(),
        ...(customerDoc
          ? { customer: { id: customerDoc.id, name: customerDoc.name, phone: customerDoc.phone } }
          : {}),
        lines,
        total,
        paid: takings,
        balance: customerDoc ? customerBalance(customerDoc) : round2(total - takings),
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
        throw err;
      }

      return bill;
    },

    async todaySummary(): Promise<TodaySummary> {
      const { start, end } = dayBounds();
      const docs = await Bills.find({ at: { $gte: start.toISOString(), $lt: end.toISOString() } })
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
      const trimmed = query.trim();
      if (!trimmed) return [];
      // Escaped, because a customer called "R." must not be read as a regex.
      const safe = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const digits = normalisePhone(trimmed);
      const or: Record<string, unknown>[] = [{ name: { $regex: '^' + safe, $options: 'i' } }];
      if (digits) or.push({ phone: { $regex: '^' + digits } });
      const docs = await Customers.find({ $or: or }).sort({ name: 1 }).limit(limit).lean();
      return docs.map((d) => toCustomer(d as unknown as CustomerDoc));
    },

    async getCustomer(id) {
      const doc = await Customers.findOne({ id }).lean();
      return doc ? toCustomer(doc as unknown as CustomerDoc) : null;
    },

    async upsertCustomer({ id, name, phone }) {
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
          { $set: { name, phone: digits } },
          { new: true },
        ).lean();
        return toCustomer(doc as unknown as CustomerDoc);
      }

      const fresh: CustomerDoc = {
        id: id ?? makeCustomerId(name, digits),
        name,
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
