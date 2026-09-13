import { Router } from 'express';
import { z } from 'zod';
import { ERASE_WORD, INK_LIMITS, checkGstin, inkPointCount } from '@shridhar/shared';
import { issueToken, pinMatches, requireAuth, secretMatches } from './auth';
import { env } from './env';
import { HttpError, handler } from './http';
import { getRepo } from './store';


/** Handwriting arrives as pen paths. Capped so one bill cannot carry a megabyte of scribble. */
const inkBody = z
  .object({
    w: z.coerce.number().finite().positive().max(10_000),
    h: z.coerce.number().finite().positive().max(10_000),
    strokes: z
      .array(z.array(z.coerce.number().finite()).max(INK_LIMITS.maxPointsPerStroke * 2))
      .max(INK_LIMITS.maxStrokes),
  })
  .refine((ink) => ink.strokes.every((s) => s.length % 2 === 0), {
    message: 'each stroke must hold an even number of coordinates',
  })
  .refine((ink) => inkPointCount(ink) <= INK_LIMITS.maxTotalPoints, {
    message: 'too much handwriting on one line',
  });

const lineBody = z.object({
  itemId: z.string().trim().min(1).max(80),
  // All three descriptions are optional: a line can be a catalogue item, handwriting, or a bare
  // price with no description at all -- the shop bills all three ways.
  nameKn: z.string().trim().max(120).default(''),
  nameEn: z.string().trim().max(120).default(''),
  ink: inkBody.optional(),
  qty: z.coerce.number().finite().positive().max(100_000),
  rate: z.coerce.number().finite().nonnegative().max(1_000_000),
});

const settingsBody = z.object({
  shopName: z.string().trim().min(1).max(80).optional(),
  footer: z.string().trim().max(120).optional(),
  paper: z.enum(['58mm', '80mm']).optional(),
  language: z.enum(['en', 'kn']).optional(),
  // Accepted as typed and normalised by checkGstin on the way in: a number the shop insists on
  // is the shop's business, and a settings screen that refuses to save is not a validator.
  gstin: z.string().trim().max(24).optional(),
  shopNameKn: z.string().trim().max(80).optional(),
  footerKn: z.string().trim().max(120).optional(),
  showRate: z.boolean().optional(),
  showGstin: z.boolean().optional(),
  inactiveAfterDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const customerBody = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().max(80).default(''),
  nameKn: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(24).default(''),
});

/**
 * The same fields, but nothing defaulted.
 *
 * An edit must not be able to erase a field it never mentioned. With `.default('')` an older app
 * -- or one with a bug, which is how this was found -- that sends only a name and a phone has the
 * schema hand the route an empty `nameKn`, and the customer's Kannada name is written away. Left
 * `undefined`, the route can tell "not mentioned" from "cleared on purpose" and keep what is
 * stored.
 */
const customerPatch = z.object({
  name: z.string().trim().max(80).optional(),
  nameKn: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
});

/** Readable ids, so the data stays legible if anyone ever looks at the collection directly. */

export const api = Router();

api.get('/health', handler(async (_req, res) => {
  res.json({ ok: true, storage: getRepo().kind });
}));

api.post('/auth/login', handler(async (req, res) => {
  const { pin } = z.object({ pin: z.string().min(1).max(64) }).parse(req.body);
  if (!pinMatches(pin)) throw new HttpError(401, 'That PIN is not right');
  res.json({ token: issueToken() });
}));

api.use(requireAuth);

// ---------------------------------------------------------------------------- settings

api.get('/settings', handler(async (_req, res) => {
  res.json(await getRepo().getSettings());
}));

api.put('/settings', handler(async (req, res) => {
  const patch = settingsBody.parse(req.body);
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change');
  // Normalised here rather than trusted from the browser, like every other figure: the number
  // prints on paper, so it should read the same whichever app typed it and however it was spaced.
  if (patch.gstin != null) patch.gstin = checkGstin(patch.gstin).value;
  res.json(await getRepo().updateSettings(patch));
}));

// ---------------------------------------------------------------------------- customers

api.get('/customers', handler(async (_req, res) => {
  res.json(await getRepo().listCustomers());
}));

/** Feeds the suggestions under the name and phone fields at the top of the bill. */
api.get('/customers/search', handler(async (req, res) => {
  const q = z.string().trim().max(80).default('').parse(req.query.q ?? '');
  const limit = z.coerce.number().int().min(1).max(20).default(8).parse(req.query.limit ?? 8);
  res.json(await getRepo().searchCustomers(q, limit));
}));

api.get('/customers/inactive', handler(async (req, res) => {
  const settings = await getRepo().getSettings();
  const days = z.coerce.number().int().min(1).max(3650).default(settings.inactiveAfterDays)
    .parse(req.query.days ?? settings.inactiveAfterDays);
  res.json({ days, customers: await getRepo().inactiveCustomers(days) });
}));

api.get('/customers/:id', handler(async (req, res) => {
  const customer = await getRepo().getCustomer(String(req.params.id));
  if (!customer) throw new HttpError(404, 'No such customer');
  // Their bills come with them: this is the "customer total transaction" view.
  const bills = await getRepo().listBills(100, customer.id);
  /*
   * When their balance was last added to. Free here -- these bills are already sorted newest
   * first -- which is why it is answered by this one endpoint rather than put on the customer
   * record: a date on a field that four other endpoints could not fill honestly is a trap.
   * The bill screen asks for it when it attaches a customer who owes something, so the preview
   * shows the same date the paper will.
   */
  const owing = bills.find((b) => !b.cancelled && b.paid < b.total);
  res.json({ customer, bills, balanceAt: owing ? owing.at : null });
}));

api.post('/customers', handler(async (req, res) => {
  const body = customerBody.parse(req.body);
  if (!body.name && !body.nameKn && !body.phone) {
    throw new HttpError(400, 'Give the customer a name or a phone number');
  }
  res.status(201).json(await getRepo().upsertCustomer(body));
}));

api.put('/customers/:id', handler(async (req, res) => {
  const id = z.string().trim().min(1).parse(req.params.id);
  const patch = customerPatch.parse(req.body);
  const existing = await getRepo().getCustomer(id);
  if (!existing) throw new HttpError(404, 'No such customer');

  // Whatever the request did not mention keeps the value it already had.
  const body = {
    name: patch.name ?? existing.name,
    nameKn: patch.nameKn ?? existing.nameKn ?? '',
    phone: patch.phone ?? existing.phone,
  };
  if (!body.name && !body.nameKn && !body.phone) {
    throw new HttpError(400, 'Give the customer a name or a phone number');
  }
  res.json(await getRepo().upsertCustomer({ ...body, id }));
}));

api.delete('/customers/:id', handler(async (req, res) => {
  const removed = await getRepo().deleteCustomer(String(req.params.id));
  if (!removed) throw new HttpError(404, 'No such customer');
  res.status(204).end();
}));

// ---------------------------------------------------------------------------- bills

api.get('/bills', handler(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? 100);
  const customerId = z.string().trim().min(1).max(80).optional().parse(req.query.customerId || undefined);
  res.json(await getRepo().listBills(limit, customerId));
}));

api.get('/bills/:no', handler(async (req, res) => {
  const no = z.coerce.number().int().positive().parse(req.params.no);
  const bill = await getRepo().getBill(no);
  if (!bill) throw new HttpError(404, 'No such bill');
  res.json(bill);
}));

/* Cancelled, not deleted: see Repo.cancelBill. A POST rather than a DELETE because the bill is
   still there afterwards -- it is a state change, not a removal. */
api.post('/bills/:no/cancel', handler(async (req, res) => {
  const no = z.coerce.number().int().positive().parse(req.params.no);
  const bill = await getRepo().cancelBill(no);
  if (!bill) throw new HttpError(404, 'No such bill');
  res.json(bill);
}));

/* The removal the cancel above is not. Only ever of an already-cancelled bill: see
   Repo.deleteBill for why a live one may not go this way. */
api.delete('/bills/:no', handler(async (req, res) => {
  const no = z.coerce.number().int().positive().parse(req.params.no);
  // Without it, a live bill is refused and has to be cancelled first -- which keeps that path
  // honest for anything talking to the API directly. With it, the two steps are one ask.
  const force = req.query.force === '1' || req.query.force === 'true';
  const outcome = await getRepo().deleteBill(no, force);
  if (outcome === 'missing') throw new HttpError(404, 'No such bill');
  if (outcome === 'live') {
    throw new HttpError(409, 'Cancel the bill before deleting it, so the customer’s balance stays right');
  }
  res.status(204).end();
}));

/* ------------------------------------------------------------------ erasing everything */

/**
 * Everything in the book, as one file, for keeping before a reset.
 *
 * The free Atlas tier takes no backups of its own, so this is the only copy that will exist.
 */
api.get('/backup', handler(async (_req, res) => {
  const repo = getRepo();
  const [settings, customers, bills] = await Promise.all([
    repo.getSettings(),
    repo.listCustomers(),
    repo.listBills(5000),
  ]);
  res.json({ at: new Date().toISOString(), settings, customers, bills });
}));

/**
 * Erases every bill and customer. Settings survive.
 *
 * Two different proofs, because they answer two different questions: the password says you are
 * allowed to, and the word says you meant to. Switched off entirely when no password is
 * configured, so a server nobody has set one on cannot be wiped at all.
 */
api.post('/reset', handler(async (req, res) => {
  if (!env.resetPassword) {
    throw new HttpError(404, 'Erasing is switched off on this server');
  }
  const body = z.object({
    password: z.string().max(200).default(''),
    confirm: z.string().max(20).default(''),
    // Sparing the names makes it no less of an erase, so both proofs are still required.
    keepCustomers: z.boolean().default(false),
  }).parse(req.body);

  if (!secretMatches(body.password, env.resetPassword)) {
    throw new HttpError(401, 'That password is not right');
  }
  if (body.confirm !== ERASE_WORD) {
    throw new HttpError(400, 'Type ' + ERASE_WORD + ' to confirm');
  }

  await getRepo().eraseAll(body.keepCustomers);
  res.status(204).end();
}));

api.post('/bills', handler(async (req, res) => {
  const body = z
    .object({
      lines: z.array(lineBody).min(1).max(200),
      customerId: z.string().trim().min(1).max(80).optional(),
      paid: z.coerce.number().finite().nonnegative().max(10_000_000).optional(),
      showBalance: z.boolean().optional(),
    })
    .parse(req.body);

  if (body.customerId && !(await getRepo().getCustomer(body.customerId))) {
    throw new HttpError(400, 'That customer is not on file');
  }
  if (body.showBalance && !body.customerId) {
    throw new HttpError(400, 'A balance can only be printed for a named customer');
  }

  // The number, the total and the balance are the server's to decide. A browser that sends its
  // own figures, whether by bug or by hand, cannot change what gets recorded.
  const bill = await getRepo().createBill({
    lines: body.lines.map((l) => ({
      itemId: l.itemId,
      nameKn: l.nameKn || l.nameEn,
      nameEn: l.nameEn || l.nameKn,
      ...(l.ink && l.ink.strokes.length > 0 ? { ink: l.ink } : {}),
      qty: l.qty,
      rate: l.rate,
    })),
    ...(body.customerId ? { customerId: body.customerId } : {}),
    ...(body.paid == null ? {} : { paid: body.paid }),
    showBalance: body.showBalance ?? false,
  });

  res.status(201).json(bill);
}));

api.get('/summary/today', handler(async (_req, res) => {
  res.json(await getRepo().todaySummary());
}));
