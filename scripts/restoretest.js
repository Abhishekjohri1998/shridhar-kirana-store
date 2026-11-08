/**
 * Backup, erase, restore: the book comes back exactly as it was.
 *
 * Against a scratch server on the JSON file store in a temporary folder; no MongoDB is touched.
 * Checks that the backup holds everything (every bill, the payments, the stored settings and the
 * last bill number), that a restore after an erase gives back identical data with the numbering
 * carrying on, that a safety copy of the book is taken first, and that wrong, damaged, foreign
 * or unauthorised restores are refused without changing anything.
 *
 *   node scripts/restoretest.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
const PIN = '9137';
const RESET_PW = 'restore-me-9137';
const SECRET = 'restoretest-secret';
const PORT = 5900 + Math.floor(Math.random() * 300);
const DATA = path.join(os.tmpdir(), 'shridhar-restoretest-' + Date.now().toString(36));

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
    'got ' + JSON.stringify(actual).slice(0, 300) + ', wanted ' + JSON.stringify(expected).slice(0, 300));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The parts of the stored file a restore must give back, `items` aside (not part of a backup). */
function stored() {
  const db = JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
  return { settings: db.settings, customers: db.customers, bills: db.bills, payments: db.payments, billNo: db.billNo };
}
const sortBy = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
function canonical(s) {
  return {
    settings: s.settings,
    customers: [...s.customers].sort(sortBy('id')),
    bills: [...s.bills].sort((a, b) => a.no - b.no),
    payments: [...s.payments].sort(sortBy('id')),
    billNo: s.billNo,
  };
}
const safetyFiles = () => {
  try { return fs.readdirSync(path.join(DATA, 'safety-backups')).filter((n) => n.endsWith('.json')); } catch { return []; }
};

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env, PORT: String(PORT), DATA_DIR: DATA, AUTH_PIN: PIN, MONGO_URI: '',
        RESET_PASSWORD: RESET_PW, JWT_SECRET: SECRET, NODE_ENV: 'test', STOCK_URL: '', LINK_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const base = 'http://127.0.0.1:' + PORT + '/api';
  let token = '';
  const raw = async (p, method, bodyText, tok = token) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(tok ? { authorization: 'Bearer ' + tok } : {}),
        ...(bodyText !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  const call = (p, method = 'GET', body, tok) => raw(p, method, body === undefined ? undefined : JSON.stringify(body), tok);
  const restore = (backup, extra = {}, tok) =>
    call('/restore', 'POST', { password: RESET_PW, confirm: 'RESTORE', backup, ...extra }, tok);

  try {
    let up = false;
    for (let i = 0; i < 180 && !up; i++) {
      await sleep(500);
      try { up = (await fetch(base + '/health')).status === 200; } catch { /* not yet */ }
    }
    check('the server started', up, log.slice(-300));
    if (!up) return;
    token = (await call('/auth/login', 'POST', { pin: PIN })).body.token;

    console.log('\nA book worth keeping');
    await call('/settings', 'PUT', {
      shopName: 'Restore Test Stores', shopNameKn: 'ಪರೀಕ್ಷೆ', footer: 'Come again', roundTo: 5,
      paper: '80mm', showRate: true, dismissedInactive: { someone: '2026-01-01T00:00:00.000Z' },
    });
    const a = (await call('/customers', 'POST', { name: 'Asha', phone: '9000000101', phones: ['9000000101', '9000000102'], whatsapp: '9000000103', address: 'Main road', notes: 'Prefers Kannada' })).body;
    const b = (await call('/customers', 'POST', { name: 'Bharath', nameKn: 'ಭರತ', phone: '9000000201' })).body;
    const ink = { w: 300, h: 60, strokes: [[1, 2, 3, 4, 5, 6], [10, 10, 20, 20]] };
    await call('/bills', 'POST', { lines: [{ itemId: 'r1', nameEn: 'Rice', qty: 2, rate: 51 }], customerId: a.id, paid: 50, showBalance: true, note: 'credit' });
    await call('/bills', 'POST', { lines: [{ itemId: 'w1', ink, qty: 1, rate: 120, given: true }], customerId: b.id, clientId: 'dev-1' });
    const third = (await call('/bills', 'POST', { lines: [{ itemId: 'o1', nameKn: 'ಎಣ್ಣೆ', qty: 1, rate: 99 }], customerId: a.id })).body;
    await call('/bills/' + third.no + '/cancel', 'POST', {});
    await call('/bills', 'POST', { lines: [{ itemId: 'h1', nameEn: 'Soap', qty: 3, rate: 10, hidden: true }], hideNames: true });
    const fifth = (await call('/bills', 'POST', { lines: [{ itemId: 'x1', qty: 1, rate: 5 }] })).body;
    // The newest bill deleted: the counter now stands above every bill in the book.
    eq('the newest bill is deleted', (await call('/bills/' + fifth.no + '?force=1', 'DELETE')).status, 204);
    const pay = (await call('/customers/' + a.id + '/payments', 'POST', { amount: 20, note: 'cash' })).body.payment;
    const pay2 = (await call('/customers/' + a.id + '/payments', 'POST', { amount: 7 })).body.payment;
    await call('/payments/' + pay2.id + '/cancel', 'POST', {});
    check('a payment was recorded', !!pay && !!pay.id);

    const before = canonical(stored());
    const beforeApi = {
      bills: (await call('/bills?limit=500')).body,
      customers: (await call('/customers')).body,
      settings: (await call('/settings')).body,
      asha: (await call('/customers/' + a.id)).body,
    };
    eq('the counter is past the last bill', before.billNo, 5);

    console.log('\nThe backup holds everything');
    const backup = (await call('/backup')).body;
    eq('it says what it is', backup.format, 'shridhar-billing-backup');
    eq('and its version', backup.version, 2);
    eq('and which shop', backup.shop.name, 'Restore Test Stores');
    eq('every bill', backup.bills.length, 4);
    eq('the cancelled bill with them', backup.bills.some((x) => x.cancelled), true);
    eq('the handwriting with them', backup.bills.find((x) => x.clientId === 'dev-1').lines[0].ink, ink);
    eq('every payment, the cancelled one too', backup.payments.length, 2);
    eq('the last bill number handed out', backup.counters.billNo, 5);
    eq('the stored settings, rounding included', backup.settings.roundTo, 5);
    eq('customers say what they owe', backup.customers.find((c) => c.id === a.id).balance, beforeApi.customers.find((c) => c.id === a.id).balance);

    console.log('\nErase');
    eq('everything erased', (await call('/reset', 'POST', { password: RESET_PW, confirm: 'ERASE' })).status, 204);
    eq('no bills left', (await call('/bills')).body.length, 0);

    console.log('\nRefused restores change nothing');
    const workerToken = jwt.sign({ role: 'worker' }, SECRET, { expiresIn: '1h' });
    const worker = await restore(backup, {}, workerToken);
    eq('a worker is refused with 403', worker.status, 403);
    eq('a worker cannot take a backup either', (await call('/backup', 'GET', undefined, workerToken)).status, 403);
    eq('nor read a safety copy', (await call('/restore/safety/before-restore-2026-01-01T00-00-00-000Z.json', 'GET', undefined, workerToken)).status, 403);
    eq('no session is refused with 401', (await restore(backup, {}, '')).status, 401);
    eq('a wrong password is refused', (await restore(backup, { password: 'nope' })).status, 401);
    eq('without RESTORE typed it is refused', (await restore(backup, { confirm: '' })).status, 400);
    eq('the word has to be exact', (await restore(backup, { confirm: 'restore' })).status, 400);
    const junk = await restore({ hello: 'world' });
    eq('a file that is not a backup is refused', junk.status, 400);
    check('with a clear message', /not a backup/i.test(String(junk.body && junk.body.error)), JSON.stringify(junk.body));
    eq('an array is refused', (await restore([1, 2, 3])).status, 400);
    eq('a missing file is refused', (await restore(undefined)).status, 400);
    const otherFormat = await restore({ ...backup, format: 'someone-elses-backup' });
    eq('another app\'s file is refused', otherFormat.status, 400);
    const newer = await restore({ ...backup, version: 99 });
    eq('a file from a newer app is refused', newer.status, 400);
    check('saying so', /newer/i.test(String(newer.body && newer.body.error)), JSON.stringify(newer.body));
    const twice = await restore({ ...backup, bills: [...backup.bills, backup.bills[0]] });
    eq('a damaged file (a bill twice) is refused', twice.status, 400);
    check('saying it is damaged', /damaged/i.test(String(twice.body && twice.body.error)), JSON.stringify(twice.body));
    const broken = await restore({ ...backup, bills: [{ ...backup.bills[0], total: 'lots' }] });
    eq('a damaged bill is refused', broken.status, 400);
    const cut = await raw('/restore', 'POST', JSON.stringify({ password: RESET_PW, confirm: 'RESTORE', backup }).slice(0, 500));
    eq('a cut-off file is refused, not a server error', cut.status, 400);
    const foreign = await restore({ ...backup, shop: { name: 'Other Shop', nameKn: '', gstin: '' }, settings: { ...backup.settings, shopName: 'Other Shop', shopNameKn: '' } });
    eq('another shop\'s backup is refused', foreign.status, 409);
    check('naming both shops', /Other Shop/.test(String(foreign.body && foreign.body.error)), JSON.stringify(foreign.body));
    eq('still no bills', (await call('/bills')).body.length, 0);
    eq('and no safety copy taken for a refusal', safetyFiles().length, 0);

    console.log('\nRestore');
    const done = await restore(backup);
    eq('the backup is restored', done.status, 200);
    eq('it says how many bills', done.body && done.body.restored.bills, 4);
    eq('and the next number', done.body && done.body.restored.nextBillNo, 6);
    eq('the stored book is identical to before the erase', canonical(stored()), before);
    eq('the bills read back identical', (await call('/bills?limit=500')).body, beforeApi.bills);
    eq('the customers read back identical', (await call('/customers')).body, beforeApi.customers);
    eq('the settings read back identical', (await call('/settings')).body, beforeApi.settings);
    eq('a customer\'s ledger reads back identical', (await call('/customers/' + a.id)).body, beforeApi.asha);
    const next = (await call('/bills', 'POST', { lines: [{ itemId: 'n1', qty: 1, rate: 10 }] })).body;
    eq('the numbering carries on after the deleted bill', next.no, 6);
    const again = await call('/bills', 'POST', { lines: [{ itemId: 'dup', qty: 1, rate: 1 }], clientId: 'dev-1' });
    eq('a restored device save is still recognised', again.status, 200);

    console.log('\nThe safety copy');
    eq('one safety copy was taken', safetyFiles().length, 1);
    const url = done.body.safety.url;
    check('its download link names it', url.endsWith(encodeURIComponent(done.body.safety.file)), url);
    const safety = await call(url.replace(/^\/api/, ''));
    eq('it downloads', safety.status, 200);
    eq('it holds the book as it was before the restore (erased)', safety.body && safety.body.bills.length, 0);
    eq('and is itself a backup', safety.body && safety.body.format, 'shridhar-billing-backup');
    eq('an odd name is not served', (await call('/restore/safety/..%2Fdb.json')).status, 404);
    // And it can be put back, which is the point of it.
    eq('the safety copy restores', (await restore(safety.body)).status, 200);
    eq('back to the erased book', (await call('/bills')).body.length, 0);
    eq('which took a second safety copy', safetyFiles().length, 2);

    console.log('\nAn older backup still restores');
    const v1 = {
      at: '2026-10-01T00:00:00.000Z',
      settings: beforeApi.settings,
      customers: beforeApi.customers,
      bills: (await (async () => backup.bills)()),
      payments: backup.payments,
    };
    const old = await restore(v1);
    eq('a version 1 backup restores', old.status, 200);
    eq('its bills', (await call('/bills?limit=500')).body.length, 4);
    eq('its customers, their balance worked out again', (await call('/customers')).body, beforeApi.customers);
    eq('numbering from its highest bill', (await call('/bills', 'POST', { lines: [{ itemId: 'v1', qty: 1, rate: 1 }] })).body.no, 5);

    console.log('\nA big book');
    const bills = [];
    for (let i = 1; i <= 2500; i++) {
      bills.push({ no: i, at: '2026-10-01T10:00:00.000Z', lines: [{ itemId: 'big' + i, nameEn: 'Item ' + i, nameKn: '', qty: 1, rate: i, ink }], total: i, paid: i, balance: 0, showBalance: false });
    }
    const big = { ...backup, bills, payments: [], customers: [], counters: { billNo: 2500 } };
    const size = JSON.stringify(big).length;
    check('the file is well past the usual 256 KB', size > 300 * 1024, String(size));
    const bigDone = await restore(big);
    eq('and restores', bigDone.status, 200);
    eq('every bill of it', stored().bills.length, 2500);
    const bloated = await call('/bills', 'POST', { lines: [{ itemId: 'z', qty: 1, rate: 1 }], note: 'x'.repeat(300 * 1024) });
    eq('other routes keep their 256 KB limit', bloated.status, 413);
    eq('only the last ten safety copies are kept', safetyFiles().length <= 10, true);
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
  console.log('All restore checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
