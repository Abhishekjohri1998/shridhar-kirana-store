import { Router } from 'express';
import { z } from 'zod';
import { ERASE_WORD, INK_LIMITS, checkGstin, customerPhones, inkPointCount } from '@shridhar/shared';
import { issueToken, pinMatches, requireAuth, secretMatches } from './auth';
import { env } from './env';
import { HttpError, handler } from './http';
import { checkSignInBrake, noteSignInFailure } from './rateLimit';
import { getRepo } from './store';
import { stockAuth, stockDraft, stockItems, stockLinkOn, stockQuote, stockRoundTo } from './stockLink';


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
  /** Handed over, as against merely listed. Reaches the saved bill so a reprint shows it. */
  given: z.boolean().default(false),
  // A two-line item. Only 1 or 2; anything else is a client bug, not a third size.
  inkRows: z.union([z.literal(1), z.literal(2)]).optional(),
  // Lines of writing continued on strips added under the first. Two at most.
  moreInk: z.array(inkBody).max(2).optional(),
  // Which way the line was last written, when it is both written and typed.
  lastMode: z.enum(['ink', 'text']).optional(),
  // Picked from the stock app's suggestions: the unit prints beside the quantity, and the id
  // lets stock match the line exactly. Short and bounded, like every other field here.
  unit: z.string().trim().max(24).optional(),
  stockItemId: z.string().trim().max(80).optional(),
});

/**
 * The bill being written, as the worker screen in the stock app sees it.
 *
 * Validated here although billing only passes it on: this is still billing's API, and an
 * unbounded body would be a way to fill stock's memory through billing's door. No handwriting
 * travels -- the workers need to know a line is written by hand, not what it says.
 */
const draftBody = z.object({
  draftId: z.string().trim().min(1).max(80),
  // Cut to length rather than refused: a long typed name must never stop the draft reaching
  // the worker screen, and a shortened name on a rack screen loses nothing that matters.
  customerName: z.string().max(10_000).transform((v) => v.trim().slice(0, 80)).optional(),
  closed: z.boolean().optional(),
  lines: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    nameEn: z.string().max(10_000).default('').transform((v) => v.trim().slice(0, 120)),
    nameKn: z.string().max(10_000).default('').transform((v) => v.trim().slice(0, 120)),
    qty: z.coerce.number().finite().nonnegative().max(100_000),
    unit: z.string().trim().max(24).optional(),
    rate: z.coerce.number().finite().nonnegative().max(1_000_000),
    stockItemId: z.string().trim().max(80).optional(),
    given: z.boolean().default(false),
    givenAt: z.coerce.number().finite().nonnegative().optional(),
    ink: z.boolean().default(false),
  })).max(200),
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
  // More numbers, the first being `phone`. Optional, so an older app that sends only `phone`
  // saves exactly as before.
  phones: z.array(z.string().trim().max(24)).max(8).optional(),
  whatsapp: z.string().trim().max(24).optional(),
  address: z.string().trim().max(400).default(''),
  notes: z.string().trim().max(1000).default(''),
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
  phones: z.array(z.string().trim().max(24)).max(8).optional(),
  whatsapp: z.string().trim().max(24).optional(),
  address: z.string().trim().max(400).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Money received with no bill. */
const paymentBody = z.object({
  amount: z.coerce.number().finite().positive().max(10_000_000),
  // When it was received; now when absent. Anything parseable, stored as ISO.
  at: z.string().trim().max(40).optional()
    .refine((v) => v == null || v === '' || Number.isFinite(Date.parse(v)), { message: 'not a date' }),
  note: z.string().trim().max(200).optional(),
});

/** Phones listed with `phone` first: what the store takes. */
function phoneList(phone: string, phones: string[] | undefined): string[] {
  return customerPhones({ phones: [phone, ...(phones ?? [])] });
}

/** Readable ids, so the data stays legible if anyone ever looks at the collection directly. */

export const api = Router();

api.get('/health', handler(async (_req, res) => {
  res.json({ ok: true, storage: getRepo().kind });
}));

api.post('/auth/login', handler(async (req, res) => {
  checkSignInBrake(req);
  const { pin } = z.object({ pin: z.string().min(1).max(64) }).parse(req.body);
  if (!pinMatches(pin)) {
    noteSignInFailure(req);
    throw new HttpError(401, 'That PIN is not right');
  }
  res.json({ token: issueToken() });
}));

/**
 * A person signing in with their own phone and PIN, checked against the stock app's accounts.
 *
 * Every person gets a stock session, so the Stock side of the tablet opens already signed in.
 * Only an admin also gets a billing token: a shop worker or the godown sees stock's screens and
 * nothing of billing. When stock cannot be asked, the answer says to use the shop PIN, which
 * still works exactly as before.
 */
api.post('/auth/person', handler(async (req, res) => {
  checkSignInBrake(req);
  const { phone, pin } = z.object({
    phone: z.string().trim().min(1).max(24),
    pin: z.string().min(1).max(64),
  }).parse(req.body);
  const said = await stockAuth(phone, pin);
  if (said.kind === 'off' || said.kind === 'down') {
    res.status(503).json({
      off: true,
      error: said.kind === 'off'
        ? 'Personal sign-in is not set up on this server. Use "Sign in with shop PIN".'
        : 'The stock server cannot be reached just now. Use "Sign in with shop PIN".',
    });
    return;
  }
  if (said.kind === 'denied') {
    if (said.status === 401) {
      noteSignInFailure(req);
      throw new HttpError(401, 'That phone number or PIN is not right');
    }
    if (said.status === 429) throw new HttpError(429, said.error || 'Too many wrong tries. Wait a few minutes.');
    throw new HttpError(403, said.error || 'This account can no longer sign in');
  }
  res.json({
    role: said.role,
    name: said.name,
    stockToken: said.token,
    ...(said.role === 'admin' ? { token: issueToken() } : {}),
  });
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
  const payments = await getRepo().listPayments(100, customer.id);
  res.json({ customer, bills, payments, balanceAt: owing ? owing.at : null });
}));

/* Money received with no bill: the khata settled, or part of it, in cash. */
api.post('/customers/:id/payments', handler(async (req, res) => {
  const id = z.string().trim().min(1).max(80).parse(req.params.id);
  const body = paymentBody.parse(req.body);
  const payment = await getRepo().createPayment(id, {
    amount: body.amount,
    ...(body.at ? { at: new Date(body.at).toISOString() } : {}),
    ...(body.note ? { note: body.note } : {}),
  });
  if (!payment) throw new HttpError(404, 'No such customer');
  const customer = await getRepo().getCustomer(id);
  res.status(201).json({ payment, customer });
}));

api.post('/customers', handler(async (req, res) => {
  const body = customerBody.parse(req.body);
  if (!body.name && !body.nameKn && !body.phone) {
    throw new HttpError(400, 'Give the customer a name or a phone number');
  }
  res.status(201).json(await getRepo().upsertCustomer({
    ...body,
    phones: phoneList(body.phone, body.phones),
    ...(body.whatsapp != null ? { whatsapp: body.whatsapp } : {}),
  }));
}));

api.put('/customers/:id', handler(async (req, res) => {
  const id = z.string().trim().min(1).parse(req.params.id);
  const patch = customerPatch.parse(req.body);
  const existing = await getRepo().getCustomer(id);
  if (!existing) throw new HttpError(404, 'No such customer');

  // Whatever the request did not mention keeps the value it already had. An older app that
  // sends only `phone` changes the first number and keeps the rest.
  const had = customerPhones(existing);
  const phones = patch.phones != null
    ? phoneList(patch.phone ?? '', patch.phones)
    : patch.phone != null ? phoneList(patch.phone, had.slice(1)) : had;
  const body = {
    name: patch.name ?? existing.name,
    nameKn: patch.nameKn ?? existing.nameKn ?? '',
    phone: phones[0] ?? '',
    phones,
    whatsapp: patch.whatsapp ?? existing.whatsapp ?? '',
    address: patch.address ?? existing.address ?? '',
    notes: patch.notes ?? existing.notes ?? '',
  };
  if (!body.name && !body.nameKn && !body.phone) {
    throw new HttpError(400, 'Give the customer a name or a phone number');
  }
  res.json(await getRepo().upsertCustomer({ ...body, id }));
}));

/* Taken back out of the customer's figures. Kept, marked cancelled, like a bill. */
api.post('/payments/:id/cancel', handler(async (req, res) => {
  const id = z.string().trim().min(1).max(80).parse(req.params.id);
  const payment = await getRepo().cancelPayment(id);
  if (!payment) throw new HttpError(404, 'No such payment');
  res.json(payment);
}));

api.get('/payments', handler(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? 100);
  const customerId = z.string().trim().min(1).max(80).optional().parse(req.query.customerId || undefined);
  res.json(await getRepo().listPayments(limit, customerId));
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

/*
 * One line of a saved bill handed over, or taken back. The stock app calls this when a worker
 * ticks an item fetched after the bill was printed; nothing else moves, money least of all.
 */
api.patch('/bills/:no/lines/:i/given', handler(async (req, res) => {
  const no = z.coerce.number().int().positive().parse(req.params.no);
  const index = z.coerce.number().int().nonnegative().max(1000).parse(req.params.i);
  const { given } = z.object({ given: z.boolean() }).parse(req.body);
  const outcome = await getRepo().setLineGiven(no, index, given);
  if (outcome === 'missing') throw new HttpError(404, 'No such bill or line');
  if (outcome === 'cancelled') throw new HttpError(400, 'That bill is cancelled');
  res.json({ ok: true });
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
  const [settings, customers, bills, payments] = await Promise.all([
    repo.getSettings(),
    repo.listCustomers(),
    repo.listBills(5000),
    repo.listPayments(5000),
  ]);
  res.json({ at: new Date().toISOString(), settings, customers, bills, payments });
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
      // Capped because a note is a line or two. Unbounded, it is a way to fill the database and
      // a way to print a hundred lines of paper by one leaning tablet.
      note: z.string().trim().max(200).optional(),
      // The id the stock app knew this bill by while it was being written.
      draftId: z.string().trim().min(1).max(80).optional(),
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
      // Named here like every field -- a copy that forgets one drops it silently.
      ...(l.moreInk && l.moreInk.some((i) => i.strokes.length > 0)
        ? { moreInk: l.moreInk.filter((i) => i.strokes.length > 0) } : {}),
      ...(l.lastMode ? { lastMode: l.lastMode } : {}),
      qty: l.qty,
      rate: l.rate,
      given: l.given,
      // Copied field by field, so every new field has to be named here -- `given` was once lost
      // exactly this way.
      ...(l.inkRows === 2 ? { inkRows: 2 } : {}),
      ...(l.unit ? { unit: l.unit } : {}),
      ...(l.stockItemId ? { stockItemId: l.stockItemId } : {}),
    })),
    ...(body.customerId ? { customerId: body.customerId } : {}),
    ...(body.paid == null ? {} : { paid: body.paid }),
    showBalance: body.showBalance ?? false,
    ...(body.note ? { note: body.note } : {}),
    ...(body.draftId ? { draftId: body.draftId } : {}),
    // Stock's rounding step, asked for at the moment of saving. 0 when the link is off or stock
    // does not answer in time, so a bill is never held up -- it is simply not rounded.
    roundTo: await stockRoundTo(),
  });

  res.status(201).json(bill);
}));

// ---------------------------------------------------------------------------- stock link
/*
 * The stock app, asked on the device's behalf. The tablet and the website only ever talk to this
 * server; this server talks to stock on the same box. Every answer is stock's, passed through --
 * see stockLink.ts -- and every failure is a quiet empty answer, never an error on the bill.
 */

api.get('/stock/status', handler(async (_req, res) => {
  res.json({ on: stockLinkOn() });
}));

api.get('/stock/items', handler(async (req, res) => {
  const q = z.string().trim().max(80).default('').parse(req.query.q ?? '');
  const limit = z.coerce.number().int().min(1).max(20).default(8).parse(req.query.limit ?? 8);
  res.json({ items: q ? await stockItems(q, limit) : [] });
}));

api.get('/stock/quote', handler(async (req, res) => {
  const item = z.string().trim().min(1).max(80).parse(req.query.item);
  const unit = z.string().trim().min(1).max(24).parse(req.query.unit);
  const qty = z.coerce.number().finite().positive().max(100_000).parse(req.query.qty);
  const quote = await stockQuote(item, unit, qty);
  if (!quote) {
    // 503 rather than 404: the device keeps the rate it has, whether stock is off, down or
    // simply does not know the item.
    res.status(503).json({ off: true, error: 'Stock has no rate for that just now' });
    return;
  }
  res.json(quote);
}));

api.post('/stock/draft', handler(async (req, res) => {
  const body = draftBody.parse(req.body);
  res.json({ ticks: await stockDraft(body) });
}));

api.get('/summary/today', handler(async (_req, res) => {
  res.json(await getRepo().todaySummary());
}));
