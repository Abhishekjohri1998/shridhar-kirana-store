/**
 * One app over two programs: the whole-shop backup, restore and erase, and stock sessions renewed
 * without a second sign-in.
 *
 * Billing's server asks stock over the link (/api/billing-link/backup, /restore, /erase, /session)
 * with the shared key; the device never sees the key. Proved here against a fake stock server
 * that speaks that contract, and scratch billing servers on the JSON file store. No database.
 *
 *   node scripts/wholeshoptest.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const jwt = require(path.join(ROOT, 'node_modules', 'jsonwebtoken'));
const PIN = '9137';
const SECRET = 'wholeshoptest-secret';
const KEY = 'wholeshoptest-key-' + Math.random().toString(36).slice(2);
const BASE_PORT = 6300 + Math.floor(Math.random() * 400);
const ADMIN_PHONE = '9000000001';
const ADMIN_PIN = '4821';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + String(detail).slice(0, 400) : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the fake stock server
const stockFile = (items) => ({
  format: 'shridhar-stock-backup', version: 1, exportedAt: new Date().toISOString(),
  counts: { items: items.length },
  collections: { people: [{ id: 'p_a' }], locations: [{ id: 'l1' }, { id: 'l2' }], items },
});
const fake = {
  data: stockFile([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }]),
  restores: 0, checks: 0, erases: [], failRestore: false, sessions: [],
};

function startFakeStock(port) {
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-link-key'] !== KEY) return send(401, { error: 'Wrong link key' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'not json' }); }
      const p = req.url.replace(/^\/api\/billing-link/, '').split('?')[0];
      if (p === '/settings') return send(200, { roundTo: 0 });
      if (p === '/auth') {
        if (body.phone === ADMIN_PHONE && body.pin === ADMIN_PIN) return send(200, { role: 'admin', name: 'Owner', token: 'stock-admin-1' });
        return send(401, { error: 'Wrong phone number or PIN' });
      }
      if (p === '/shop-auth') return send(200, { token: 'stock-shop', person: { id: 'p_a', role: 'admin' } });
      if (p === '/session') {
        fake.sessions.push(body);
        if (body.token === 'stock-worker-old') return send(200, { role: 'worker', name: 'W', token: 'stock-worker-new' });
        if (body.token === 'stock-admin-1') return send(200, { role: 'admin', name: 'Owner', token: 'stock-admin-2' });
        if (body.phone === ADMIN_PHONE) return send(200, { role: 'admin', name: 'Owner', token: 'stock-admin-by-phone' });
        return send(401, { error: 'No session to renew. Sign in again.' });
      }
      if (p === '/backup') return send(200, fake.data);
      if (p === '/restore') {
        const b = body.backup;
        if (!b || b.format !== 'shridhar-stock-backup' || !b.collections) return send(400, { error: 'This is not a stock backup.' });
        const counts = Object.fromEntries(Object.entries(b.collections).map(([k, v]) => [k, v.length]));
        if (body.check === true) { fake.checks++; return send(200, { ok: true, checked: true, counts }); }
        if (fake.failRestore) return send(409, { error: 'A restore or erase is already running.' });
        fake.restores++;
        fake.data = b;
        return send(200, { ok: true, safety: 'safety-test-' + fake.restores + '.json', counts });
      }
      if (p === '/erase') {
        if (body.mode !== 'everything' && body.mode !== 'stock') return send(400, { error: 'bad mode' });
        fake.erases.push(body.mode);
        fake.data = stockFile(body.mode === 'stock' ? fake.data.collections.items : []);
        return send(200, { ok: true, mode: body.mode, safety: 'safety-erase.json', counts: { items: fake.data.collections.items.length } });
      }
      send(404, { error: 'No such address' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// ---------------------------------------------------------------- billing servers
function startBilling(port, dataDir, extraEnv) {
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env,
        PORT: String(port), DATA_DIR: dataDir, AUTH_PIN: PIN,
        MONGO_URI: '', JWT_SECRET: SECRET, NODE_ENV: 'test', RESET_PASSWORD: '',
        STOCK_URL: '', LINK_KEY: '', WHOLE_TEST_FAIL_BILLING: '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  const api = { child, log: () => log, token: '' };
  api.call = async (p, init = {}, token = api.token) => {
    const res = await fetch(base + '/api' + p, {
      ...init,
      headers: {
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  };
  api.post = (p, body, token) => api.call(p, { method: 'POST', body: JSON.stringify(body) }, token);
  api.ready = async () => {
    for (let i = 0; i < 180; i++) {
      await sleep(500);
      try {
        if ((await fetch(base + '/api/health')).status === 200) {
          api.token = (await api.post('/auth/login', { pin: PIN })).body.token;
          return true;
        }
      } catch { /* not listening yet */ }
    }
    return false;
  };
  return api;
}

async function main() {
  const tmp = path.join(os.tmpdir(), 'shridhar-wholeshoptest-' + Date.now().toString(36));
  const stockUrl = 'http://127.0.0.1:' + BASE_PORT;
  const stock = await startFakeStock(BASE_PORT);
  const on = startBilling(BASE_PORT + 1, path.join(tmp, 'on'), { STOCK_URL: stockUrl, LINK_KEY: KEY });
  const off = startBilling(BASE_PORT + 2, path.join(tmp, 'off'), {});
  const wrong = startBilling(BASE_PORT + 3, path.join(tmp, 'wrong'), { STOCK_URL: stockUrl, LINK_KEY: 'not-the-key' });
  const half = startBilling(BASE_PORT + 4, path.join(tmp, 'half'), { STOCK_URL: stockUrl, LINK_KEY: KEY, WHOLE_TEST_FAIL_BILLING: '1' });
  const servers = [on, off, wrong, half];
  try {
    const up = await Promise.all(servers.map((s) => s.ready()));
    check('the scratch servers start', up.every(Boolean), servers.map((s) => s.log()).join('\n---\n').slice(-2000));

    const bill = (srv) => srv.post('/bills', { lines: [{ itemId: 'x', nameKn: 'ಅಕ್ಕಿ', nameEn: 'Rice', qty: 1, rate: 50 }], paid: 50 });
    for (const srv of [on, off, half]) { await bill(srv); await bill(srv); }
    const billsOn = async (srv = on) => (await srv.call('/bills?limit=500')).body.length;
    eq('two bills on the book', await billsOn(), 2);

    console.log('\nOne backup');
    const whole = await on.call('/backup/whole');
    check('one file with both halves', whole.status === 200 && whole.body.format === 'shridhar-backup' && whole.body.version === 1
      && whole.body.billing.format === 'shridhar-billing-backup' && whole.body.billing.bills.length === 2
      && whole.body.stock.format === 'shridhar-stock-backup' && whole.body.stock.collections.items.length === 3, JSON.stringify(whole.body).slice(0, 300));
    const offWhole = await off.call('/backup/whole');
    check('stock not linked: billing only, and the file says so', offWhole.status === 200 && offWhole.body.stock === null && offWhole.body.billing.bills.length === 2);
    const wrongWhole = await wrong.call('/backup/whole');
    check('stock refusing the key: no file at all, said plainly', wrongWhole.status === 503 && /stock half/i.test(wrongWhole.body.error), JSON.stringify(wrongWhole));
    eq('signed out: refused', (await on.call('/backup/whole', {}, '')).status, 401);
    const notOwner = jwt.sign({ role: 'worker' }, SECRET);
    eq('not the owner: refused', (await on.call('/backup/whole', {}, notOwner)).status, 403);
    check('the old billing-only backup still answers as before', (await on.call('/backup')).body.format === 'shridhar-billing-backup');

    console.log('\nOne erase');
    const pre = fake.erases.length;
    const wrongPin = await on.post('/reset', { password: '0000', confirm: 'ERASE', stock: 'everything' });
    check('a wrong PIN erases nothing anywhere', wrongPin.status === 401 && fake.erases.length === pre && (await billsOn()) === 2, JSON.stringify(wrongPin));
    eq('no word, no erase', (await on.post('/reset', { password: PIN, confirm: 'erase', stock: 'everything' })).status, 400);
    eq('a mode stock does not have is refused', (await on.post('/reset', { password: PIN, confirm: 'ERASE', stock: 'all' })).status, 400);
    const er = await on.post('/reset', { password: PIN, confirm: 'ERASE', stock: 'stock' });
    check('both halves erased, stock keeping its items', er.status === 200 && er.body.halves.billing && er.body.halves.stock
      && fake.erases[fake.erases.length - 1] === 'stock' && fake.data.collections.items.length === 3 && (await billsOn()) === 0, JSON.stringify(er.body));
    const offErase = await off.post('/reset', { password: PIN, confirm: 'ERASE', stock: 'everything' });
    check('stock not linked: nothing erased, said plainly', offErase.status === 502 && /Nothing was erased/.test(offErase.body.error) && (await billsOn(off)) === 2, JSON.stringify(offErase));
    eq('billing alone, as the website asks, is still 204', (await off.post('/reset', { password: PIN, confirm: 'ERASE' })).status, 204);

    console.log('\nOne restore');
    const file = whole.body;
    eq('a wrong PIN restores nothing', (await on.post('/restore', { password: '0000', confirm: 'RESTORE', backup: file })).status, 401);
    eq('no word, no restore', (await on.post('/restore', { password: PIN, confirm: 'restore', backup: file })).status, 400);
    check('and nothing was sent to stock', fake.restores === 0 && fake.checks === 0);
    fake.data = stockFile([]);
    const rs = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file });
    check('the whole file restores both halves', rs.status === 200 && rs.body.halves.billing && rs.body.halves.stock
      && rs.body.restored.bills === 2 && rs.body.stock.counts.items === 3 && /^safety-/.test(rs.body.stock.safety) && rs.body.safety.file, JSON.stringify(rs.body));
    check('billing has its bills back, stock its items', (await billsOn()) === 2 && fake.data.collections.items.length === 3);

    const nRestores = fake.restores;
    await bill(on);
    const oldBilling = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file.billing });
    check('an old billing-only file restores billing alone', oldBilling.status === 200 && oldBilling.body.halves.billing && !oldBilling.body.halves.stock
      && oldBilling.body.stock === null && fake.restores === nRestores && (await billsOn()) === 2, JSON.stringify(oldBilling.body));
    await bill(on);
    fake.data = stockFile([]);
    const oldStock = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file.stock });
    check('an old stock-only file restores stock alone', oldStock.status === 200 && !oldStock.body.halves.billing && oldStock.body.halves.stock
      && oldStock.body.restored === null && fake.data.collections.items.length === 3 && (await billsOn()) === 3, JSON.stringify(oldStock.body));

    const badStock = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: { ...file, stock: { format: 'shridhar-stock-backup' } } });
    check('a damaged stock half: nothing restored, billing untouched', badStock.status === 400 && /Nothing was restored/.test(badStock.body.error) && (await billsOn()) === 3, JSON.stringify(badStock));
    const neither = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: { format: 'shridhar-backup', version: 1, billing: null, stock: null } });
    eq('a whole file with neither half is refused', neither.status, 400);
    fake.failRestore = true;
    const stockFails = await on.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file });
    fake.failRestore = false;
    check('stock failing: nothing restored, and billing left as it was', stockFails.status === 502 && /Nothing was restored: the stock half failed/.test(stockFails.body.error)
      && /Billing was left as it was/.test(stockFails.body.error) && (await billsOn()) === 3, JSON.stringify(stockFails));
    const offRestore = await off.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file });
    check('stock not linked: a whole file restores nothing', offRestore.status === 503 && /Nothing was restored/.test(offRestore.body.error), JSON.stringify(offRestore));

    const before = fake.restores;
    const partial = await half.post('/restore', { password: PIN, confirm: 'RESTORE', backup: file });
    check('billing failing after stock: says which half is back and which is not', partial.status === 500 && partial.body.partial === true
      && /STOCK WAS RESTORED/.test(partial.body.error) && /BILLING WAS NOT RESTORED/.test(partial.body.error)
      && partial.body.halves.stock === true && partial.body.halves.billing === false && fake.restores === before + 1, JSON.stringify(partial.body));
    eq('and billing really is as it was', await billsOn(half), 2);
    const partialErase = await half.post('/reset', { password: PIN, confirm: 'ERASE', stock: 'everything' });
    check('the same for an erase', partialErase.status === 500 && /STOCK WAS ERASED/.test(partialErase.body.error) && /BILLING WAS NOT ERASED/.test(partialErase.body.error), JSON.stringify(partialErase.body));

    console.log('\nOne sign-in');
    const person = await on.post('/auth/person', { phone: ADMIN_PHONE, pin: ADMIN_PIN });
    check('an admin signs in by phone', person.status === 200 && person.body.token && person.body.stockToken === 'stock-admin-1');
    const adminToken = person.body.token;
    const s1 = await on.post('/stock/session', { stockToken: 'stock-admin-1' }, adminToken);
    check('the admin\'s stock session renews from the one they held', s1.status === 200 && s1.body.stockToken === 'stock-admin-2', JSON.stringify(s1));
    const s2 = await on.post('/stock/session', { stockToken: 'expired-and-unknown' }, adminToken);
    check('and from their phone when that one is refused', s2.status === 200 && s2.body.stockToken === 'stock-admin-by-phone', JSON.stringify(s2));
    const s3 = await on.post('/stock/session', {}, on.token);
    check('the shop PIN gets the shop admin', s3.status === 200 && s3.body.stockToken === 'stock-shop');
    eq('not signed in to billing: no session this way', (await on.post('/stock/session', {}, '')).status, 401);
    const r1 = await on.post('/stock/renew', { stockToken: 'stock-worker-old' }, '');
    check('a worker renews with the session they held, no billing token', r1.status === 200 && r1.body.stockToken === 'stock-worker-new' && r1.body.role === 'worker', JSON.stringify(r1));
    eq('one stock refuses is 401', (await on.post('/stock/renew', { stockToken: 'reset-pin' }, '')).status, 401);
    eq('stock not linked is 503', (await off.post('/stock/renew', { stockToken: 'stock-worker-old' }, '')).status, 503);
    check('no session was ever asked without the key', !fake.sessions.some((b) => b == null));
    const refreshed = await on.post('/auth/refresh', {}, adminToken);
    check('a refreshed admin token keeps the phone', jwt.decode(refreshed.body.token).phone === ADMIN_PHONE && jwt.decode(refreshed.body.token).role === 'admin');
    const pinCheck = await on.post('/restore', { password: ADMIN_PIN, confirm: 'RESTORE', backup: file.billing }, refreshed.body.token);
    eq('so their own PIN still restores after a refresh', pinCheck.status, 200);
  } catch (e) {
    failures++;
    console.log('  FAIL threw: ' + (e && e.stack));
  } finally {
    for (const s of servers) {
      const gone = new Promise((r) => s.child.once('exit', r));
      s.child.kill();
      await gone;
    }
    await new Promise((r) => stock.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('\nwholeshoptest: ' + (failures ? failures + ' failed' : 'all passed'));
  process.exitCode = failures ? 1 : 0;
}

main();
