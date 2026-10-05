/**
 * Money received with no bill, and customers with more than one number.
 *
 * Against a scratch server on the JSON file store in a temporary folder; no MongoDB is touched.
 * Also seeds an old-style customer row (one `phone`, no `phones`) to prove older records read
 * back as a list of one and keep working.
 *
 *   node scripts/ledgertest.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PIN = '9137';
const PORT = 5600 + Math.floor(Math.random() * 300);
const DATA = path.join(os.tmpdir(), 'shridhar-ledgertest-' + Date.now().toString(36));

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  // An older record: one phone, no list, no WhatsApp field.
  fs.writeFileSync(path.join(DATA, 'db.json'), JSON.stringify({
    items: [], bills: [], settings: {}, billNo: 0,
    customers: [{
      id: 'p9000000010', name: 'Old Style', phone: '9000000010', since: '2025-01-01T00:00:00.000Z',
      totalBilled: 500, totalPaid: 100, billCount: 1, lastVisit: '2025-01-01T00:00:00.000Z',
    }],
  }));

  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env, PORT: String(PORT), DATA_DIR: DATA, AUTH_PIN: PIN, MONGO_URI: '',
        JWT_SECRET: 'ledgertest-secret', NODE_ENV: 'test', STOCK_URL: '', LINK_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const base = 'http://127.0.0.1:' + PORT + '/api';
  let token = '';
  const call = async (p, method = 'GET', body) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };

  try {
    let up = false;
    for (let i = 0; i < 180 && !up; i++) {
      await sleep(500);
      try { up = (await fetch(base + '/health')).status === 200; } catch { /* not yet */ }
    }
    check('the server started', up, log.slice(-300));
    if (!up) return;
    token = (await call('/auth/login', 'POST', { pin: PIN })).body.token;

    console.log('\nContacts: older records');
    const old = (await call('/customers/p9000000010')).body.customer;
    eq('an old record reads its phone as a list of one', old.phones, ['9000000010']);
    eq('and has no WhatsApp number', old.whatsapp, '');
    eq('its balance is untouched', old.balance, 400);
    const renamed = (await call('/customers/p9000000010', 'PUT', { name: 'Old Style Two' })).body;
    eq('an edit naming no phone keeps it', renamed.phones, ['9000000010']);
    const oldApp = (await call('/customers/p9000000010', 'PUT', { name: 'Old Style', phone: '9000000011' })).body;
    eq('an older app sending only phone changes the first number', oldApp.phone, '9000000011');
    eq('and the list follows', oldApp.phones, ['9000000011']);

    console.log('\nContacts: several numbers and WhatsApp');
    const made = await call('/customers', 'POST', {
      name: 'Many Numbers', phone: '+91 98860 12345', phones: ['98860 12345', '080-2222 3333', '9886012345'],
      whatsapp: '+91 99000 11111',
    });
    eq('a customer with several numbers saves', made.status, 201);
    eq('phone is the first number, normalised', made.body.phone, '9886012345');
    eq('the list is normalised, in order, without repeats', made.body.phones, ['9886012345', '8022223333']);
    eq('the WhatsApp number is kept', made.body.whatsapp, '9900011111');
    const id = made.body.id;
    const added = (await call('/customers/' + id, 'PUT', { phones: ['9886012345', '8022223333', '9111111111'] })).body;
    eq('a number is added', added.phones, ['9886012345', '8022223333', '9111111111']);
    eq('phone stays the first', added.phone, '9886012345');
    eq('the WhatsApp number survives an edit that does not name it', added.whatsapp, '9900011111');
    const firstChanged = (await call('/customers/' + id, 'PUT', { phone: '9222222222' })).body;
    eq('changing only phone swaps the first and keeps the rest',
      firstChanged.phones, ['9222222222', '8022223333', '9111111111']);
    const found = (await call('/customers/search?q=91111')).body;
    check('a second number finds the customer', found.some((c) => c.id === id), JSON.stringify(found.map((c) => c.id)));
    eq('too many numbers are refused',
      (await call('/customers', 'POST', { name: 'X', phones: Array.from({ length: 9 }, (_, i) => '90000000' + (10 + i)) })).status, 400);
    const plain = await call('/customers', 'POST', { name: 'Plain', phone: '9333333333' });
    eq('a customer saved the old way still gets a list', plain.body.phones, ['9333333333']);

    console.log('\nPayments without a bill');
    const owing = await call('/bills', 'POST', {
      lines: [{ itemId: 'a', nameEn: 'Rice', qty: 1, rate: 1000 }], customerId: id, paid: 0, showBalance: true,
    });
    eq('a credit bill puts them 1000 in debt', owing.body.balance, 1000);
    const paid = await call('/customers/' + id + '/payments', 'POST', { amount: 300, note: 'cash at the door' });
    eq('a payment is recorded', paid.status, 201);
    eq('with its amount', paid.body.payment.amount, 300);
    eq('and its remark', paid.body.payment.note, 'cash at the door');
    check('and a time', Number.isFinite(Date.parse(paid.body.payment.at)));
    eq('the balance falls', paid.body.customer.balance, 700);
    eq('total paid rises', paid.body.customer.totalPaid, 300);
    eq('the bill count does not move', paid.body.customer.billCount, 1);
    const earlier = await call('/customers/' + id + '/payments', 'POST', { amount: 100, at: '2026-01-02T10:30:00+05:30' });
    eq('a payment can be dated earlier', earlier.body.payment.at, '2026-01-02T05:00:00.000Z');
    eq('and lowers the balance again', earlier.body.customer.balance, 600);
    const detail = (await call('/customers/' + id)).body;
    eq('the customer view lists the payments, newest first',
      detail.payments.map((p) => p.amount), [300, 100]);
    eq('the payments list filters by customer',
      (await call('/payments?customerId=' + id)).body.length, 2);

    const cancelled = await call('/payments/' + paid.body.payment.id + '/cancel', 'POST', {});
    eq('a payment is cancelled', cancelled.status, 200);
    eq('and marked so', cancelled.body.cancelled, true);
    eq('the balance goes back up', (await call('/customers/' + id)).body.customer.balance, 900);
    await call('/payments/' + paid.body.payment.id + '/cancel', 'POST', {});
    eq('cancelling twice does not reverse twice', (await call('/customers/' + id)).body.customer.balance, 900);
    eq('it stays in the list', (await call('/customers/' + id)).body.payments.length, 2);

    eq('a zero payment is refused', (await call('/customers/' + id + '/payments', 'POST', { amount: 0 })).status, 400);
    eq('a negative one too', (await call('/customers/' + id + '/payments', 'POST', { amount: -5 })).status, 400);
    eq('a nonsense date too', (await call('/customers/' + id + '/payments', 'POST', { amount: 5, at: 'soon' })).status, 400);
    eq('an unknown customer is 404', (await call('/customers/nobody/payments', 'POST', { amount: 5 })).status, 404);
    eq('an unknown payment is 404', (await call('/payments/nope/cancel', 'POST', {})).status, 404);
    const overpaid = await call('/customers/' + id + '/payments', 'POST', { amount: 1000 });
    eq('paying more than owed leaves them in credit', overpaid.body.customer.balance, -100);
    const backup = (await call('/backup')).body;
    eq('the backup carries the payments', backup.payments.length, 3);
    token = '';
    eq('payments need a login', (await call('/customers/' + id + '/payments', 'POST', { amount: 5 })).status, 401);
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('All ledger checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
