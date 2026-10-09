/**
 * The link to the stock app, against a fake stock server that speaks the link contract.
 *
 * Billing only asks stock and passes the answers on, so what is worth proving here is the
 * asking: that the switch really is off unless both settings are given, that a stock server
 * which refuses, hangs or is not there never breaks a bill, that answers come through intact,
 * and the three things billing does with them itself -- the round-off on a saved bill, the
 * draft id carried onto it, and a worker's tick landing on a saved line.
 *
 * Everything runs on the JSON file store in a temporary folder; no MongoDB is touched.
 *
 *   node scripts/stocklinktest.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PIN = '9137';
const KEY = 'stocklinktest-key-' + Math.random().toString(36).slice(2);
const BASE_PORT = 5100 + Math.floor(Math.random() * 400);

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the fake stock server
/** What the fake was last sent, and what it is set to answer. */
const fake = { drafts: [], roundTo: 0, ticks: {}, keyMisses: 0 };

const PARLE = {
  id: 'it_parle', nameEn: 'Parle-G', nameKn: 'ಪಾರ್ಲೆ-ಜಿ',
  sellUnit: 'pack',
  units: [
    { code: 'pack', label: 'pack', labelKn: 'ಪ್ಯಾಕ್', price: 110 },
    { code: 'pc', label: 'pc', labelKn: 'ಪೀಸ್', price: 5, min: 4, max: 6 },
  ],
};

/** Stock's accounts, as the fake knows them. */
const PEOPLE = {
  '9000000001': { pin: '1111', role: 'admin', name: 'Owner' },
  '9000000002': { pin: '2222', role: 'worker', name: 'Ravi' },
  '9000000004': { pin: '4444', role: 'godown', name: 'Godown' },
  '9000000003': { pin: '3333', role: 'worker', name: 'Old', retired: true },
};

function startFakeStock(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-link-key'] !== KEY) {
      fake.keyMisses += 1;
      send(401, { error: 'Wrong link key' });
      return;
    }
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/billing-link/items') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      // A stock server that has stopped answering: billing must give up, not wait with it.
      if (q === 'slow') {
        setTimeout(() => send(200, { items: [PARLE] }), 6000);
        return;
      }
      send(200, { items: 'parle-g ಪಾರ್ಲೆ'.includes(q) || q.startsWith('par') ? [PARLE] : [] });
      return;
    }
    if (req.method === 'GET' && p === '/api/billing-link/quote') {
      const item = url.searchParams.get('item');
      const unit = url.searchParams.get('unit');
      const qty = Number(url.searchParams.get('qty'));
      const u = item === PARLE.id ? PARLE.units.find((x) => x.code === unit) : null;
      if (!u) {
        send(404, { error: 'unknown' });
        return;
      }
      // A slab: three packs or more at 100 each.
      const slab = unit === 'pack' && qty >= 3;
      const rate = slab ? 100 : u.price;
      send(200, { rate, amount: rate * qty, unit, slab, warn: null });
      return;
    }
    if (req.method === 'GET' && p === '/api/billing-link/settings') {
      send(200, { roundTo: fake.roundTo });
      return;
    }
    if (req.method === 'POST' && p === '/api/billing-link/auth') {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        let b = {};
        try { b = JSON.parse(raw); } catch { /* empty */ }
        const who = PEOPLE[b.phone];
        if (who && who.pin === b.pin) {
          if (who.retired) send(403, { error: 'This role is no longer used' });
          else send(200, { role: who.role, name: who.name, token: 'stock-jwt-' + who.role });
        } else send(401, { error: 'wrong' });
      });
      return;
    }
    if (req.method === 'POST' && p === '/api/billing-link/draft') {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        try { fake.drafts.push(JSON.parse(raw)); } catch { fake.drafts.push(null); }
        send(200, { ticks: fake.ticks });
      });
      return;
    }
    send(404, { error: 'no route' });
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
        MONGO_URI: '', JWT_SECRET: 'stocklinktest-secret', NODE_ENV: 'test',
        STOCK_URL: '', LINK_KEY: '',
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
  api.call = async (p, init = {}) => {
    const res = await fetch(base + '/api' + p, {
      ...init,
      headers: {
        ...(api.token ? { authorization: 'Bearer ' + api.token } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  };
  api.post = (p, body) => api.call(p, { method: 'POST', body: JSON.stringify(body) });
  api.patch = (p, body) => api.call(p, { method: 'PATCH', body: JSON.stringify(body) });
  api.ready = async () => {
    for (let i = 0; i < 180; i++) {
      await sleep(500);
      try {
        const res = await fetch(base + '/api/health');
        if (res.status === 200) {
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
  const tmp = path.join(os.tmpdir(), 'shridhar-stocklinktest-' + Date.now().toString(36));
  const stockPort = BASE_PORT;
  const stockUrl = 'http://127.0.0.1:' + stockPort;
  const stock = await startFakeStock(stockPort);

  // Three billing servers, one per configuration worth proving: a stock address but no key
  // (off), the right key (on), and the wrong key (on, but refused by stock).
  const off = startBilling(BASE_PORT + 1, path.join(tmp, 'off'), { STOCK_URL: stockUrl });
  const on = startBilling(BASE_PORT + 2, path.join(tmp, 'on'), { STOCK_URL: stockUrl, LINK_KEY: KEY });
  const wrong = startBilling(BASE_PORT + 3, path.join(tmp, 'wrong'), { STOCK_URL: stockUrl, LINK_KEY: 'not-the-key' });

  const LINES = [
    { itemId: 'l1', nameKn: 'ಪಾರ್ಲೆ-ಜಿ', nameEn: 'Parle-G', qty: 2, rate: 110, unit: 'pack', stockItemId: 'it_parle' },
    { itemId: 'l2', nameKn: 'Salt', nameEn: 'Salt', qty: 1, rate: 33 },
  ];

  try {
    const up = await Promise.all([off.ready(), on.ready(), wrong.ready()]);
    check('the three billing servers started', up.every(Boolean),
      up.map((u, i) => (u ? '' : ['off', 'on', 'wrong'][i] + ': ' + [off, on, wrong][i].log().slice(-300))).join(' '));
    if (!up.every(Boolean)) return;

    console.log('\nThe switch: a stock address with no key is off');
    eq('status says off', (await off.call('/stock/status')).body.on, false);
    eq('item search answers empty', JSON.stringify((await off.call('/stock/items?q=parle')).body.items), '[]');
    eq('a quote is quietly unavailable', (await off.call('/stock/quote?item=it_parle&unit=pack&qty=2')).status, 503);
    const offDraft = await off.post('/stock/draft', { draftId: 'd_off', lines: [] });
    eq('a draft goes nowhere and answers no ticks', JSON.stringify(offDraft.body), '{"ticks":{}}');
    fake.roundTo = 5;
    const offBill = await off.post('/bills', { lines: LINES });
    eq('a bill saves', offBill.status, 201);
    eq('unrounded, with the link off', offBill.body.total, 253);
    eq('and carries no round-off', offBill.body.roundOff, undefined);
    eq('stock was never asked', fake.keyMisses, 0);
    check('nor sent anything', fake.drafts.length === 0);
    eq('the stock routes still need a login', (await fetch('http://127.0.0.1:' + (BASE_PORT + 1) + '/api/stock/status')).status, 401);

    console.log('\nStock refusing the key is as quiet as off');
    eq('status says on -- the switch is set', (await wrong.call('/stock/status')).body.on, true);
    eq('but search answers empty', JSON.stringify((await wrong.call('/stock/items?q=parle')).body.items), '[]');
    const wrongBill = await wrong.post('/bills', { lines: LINES });
    eq('and a bill still saves, unrounded', wrongBill.body.total, 253);
    check('stock saw the wrong key', fake.keyMisses > 0);

    console.log('\nOn: answers come through');
    eq('status says on', (await on.call('/stock/status')).body.on, true);
    const found = (await on.call('/stock/items?q=parle')).body.items;
    eq('a search finds the item', found.length, 1);
    eq('with both its names', found[0].nameKn, 'ಪಾರ್ಲೆ-ಜಿ');
    eq('and its units and prices', found[0].units.map((u) => u.code + '@' + u.price).join(','), 'pack@110,pc@5');
    eq('and the range stock gave', found[0].units[1].min + '-' + found[0].units[1].max, '4-6');
    eq('and its selling unit', found[0].sellUnit, 'pack');
    {
      const { sellUnitOf } = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));
      eq('a tap on the item takes its selling unit', sellUnitOf(found[0]).code, 'pack');
      const pcFirst = { units: [{ code: 'pc', price: 5 }, { code: 'pack', price: 110 }] };
      eq('no selling unit: the first unit', sellUnitOf(pcFirst).code, 'pc');
      eq('an unknown selling unit: the first unit', sellUnitOf({ ...pcFirst, sellUnit: 'box' }).code, 'pc');
      eq('no units: nothing', sellUnitOf({ units: [] }), undefined);
    }
    eq('an empty search does not bother stock', JSON.stringify((await on.call('/stock/items?q=')).body.items), '[]');
    eq('nor does nothing matching', JSON.stringify((await on.call('/stock/items?q=zzz')).body.items), '[]');

    const two = await on.call('/stock/quote?item=it_parle&unit=pack&qty=2');
    eq('two packs quote at the pack price', two.body.rate, 110);
    const three = await on.call('/stock/quote?item=it_parle&unit=pack&qty=3');
    eq('three reach the slab', three.body.rate, 100);
    eq('and say so', three.body.slab, true);
    eq('an unknown unit is quietly unavailable', (await on.call('/stock/quote?item=it_parle&unit=box&qty=1')).status, 503);
    eq('a quote with no quantity is refused', (await on.call('/stock/quote?item=it_parle&unit=pack')).status, 400);

    console.log('\nA stock server that hangs');
    const startedAt = Date.now();
    const slow = await on.call('/stock/items?q=slow');
    const took = Date.now() - startedAt;
    eq('the search still answers', slow.status, 200);
    eq('with nothing', JSON.stringify(slow.body.items), '[]');
    check('within the timeout, not stock\'s six seconds', took < 4500, took + 'ms');

    console.log('\nThe live draft');
    fake.ticks = { l1: { fetched: true, at: 1730000000000 } };
    const sent = await on.post('/stock/draft', {
      draftId: 'd_live', customerName: 'Ramesh',
      lines: [{ key: 'l1', nameEn: 'Parle-G', nameKn: 'ಪಾರ್ಲೆ-ಜಿ', qty: 2, unit: 'pack', rate: 110,
        stockItemId: 'it_parle', given: false, ink: false }],
    });
    eq('the draft is passed on', sent.status, 200);
    eq('and stock\'s ticks come back', sent.body.ticks.l1 && sent.body.ticks.l1.fetched, true);
    const got = fake.drafts[fake.drafts.length - 1];
    eq('stock received the draft id', got && got.draftId, 'd_live');
    eq('and the line, keyed', got && got.lines[0].key, 'l1');
    eq('with its unit', got && got.lines[0].unit, 'pack');
    const long = await on.post('/stock/draft', {
      draftId: 'd_long', customerName: 'C'.repeat(300),
      lines: [{ key: 'l9', nameEn: 'N'.repeat(300), nameKn: 'ಕ'.repeat(300), qty: 1, rate: 5 }],
    });
    eq('a draft with a 300-character name still goes through', long.status, 200);
    const longGot = fake.drafts[fake.drafts.length - 1];
    eq('the customer name cut to 80', longGot && longGot.customerName.length, 80);
    eq('the line names cut to 120', longGot && longGot.lines[0].nameEn.length + '/' + longGot.lines[0].nameKn.length, '120/120');
    const inked = await on.post('/stock/draft', {
      draftId: 'd_ink', lines: [{ key: 'l2', qty: 1, rate: 0,
        ink: { w: 300, h: 120, strokes: [[20, 40, 20, 80]] },
        moreInk: [{ w: 300, h: 120, strokes: [[5, 5, 9, 9]] }] }],
    });
    eq('a draft with handwriting goes through', inked.status, 200);
    const inkGot = fake.drafts[fake.drafts.length - 1];
    eq('stock receives the strokes', inkGot && JSON.stringify(inkGot.lines[0].ink.strokes), '[[20,40,20,80]]');
    eq('and the added strips', inkGot && inkGot.lines[0].moreInk.length, 1);
    eq('an older app\'s ink: true still goes through',
      (await on.post('/stock/draft', { draftId: 'd_old', lines: [{ key: 'l3', qty: 1, rate: 1, ink: true }] })).status, 200);
    eq('ink with too many strokes is refused',
      (await on.post('/stock/draft', { draftId: 'd_fat', lines: [{ key: 'l4', qty: 1, rate: 1,
        ink: { w: 10, h: 10, strokes: Array.from({ length: 201 }, () => [1, 1]) } }] })).status, 400);
    eq('a draft with no id is refused', (await on.post('/stock/draft', { lines: [] })).status, 400);
    eq('as is one with a thousand lines',
      (await on.post('/stock/draft', { draftId: 'd_big', lines: Array.from({ length: 201 }, (_, i) => ({ key: 'k' + i, qty: 1, rate: 1 })) })).status, 400);
    const closed = await on.post('/stock/draft', { draftId: 'd_live', closed: true, lines: [] });
    eq('a discarded draft is closed', closed.status, 200);
    eq('and stock is told so', fake.drafts[fake.drafts.length - 1].closed, true);
    fake.ticks = {};

    console.log('\nSaving: round-off, units and the draft id');
    fake.roundTo = 5;
    const saved = await on.post('/bills', { lines: LINES, draftId: 'd_live' });
    eq('a bill saves', saved.status, 201);
    eq('the total lands on the step of five', saved.body.total, 255);
    eq('and records what it moved by', saved.body.roundOff, 2);
    eq('the draft id is kept', saved.body.draftId, 'd_live');
    eq('the unit is kept on the line', saved.body.lines[0].unit, 'pack');
    eq('with stock\'s id', saved.body.lines[0].stockItemId, 'it_parle');
    eq('a line with no unit has none', saved.body.lines[1].unit, undefined);
    const reread = (await on.call('/bills/' + saved.body.no)).body;
    eq('and all of it reads back', reread.roundOff + '/' + reread.draftId + '/' + reread.lines[0].unit, '2/d_live/pack');
    eq('an over-long unit is refused',
      (await on.post('/bills', { lines: [{ ...LINES[0], unit: 'x'.repeat(25) }] })).status, 400);

    fake.roundTo = 10;
    const down = await on.post('/bills', { lines: [{ itemId: 'd1', qty: 1, rate: 1364 }] });
    eq('to ten, 1364 rounds down', down.body.total, 1360);
    eq('and records a negative round-off', down.body.roundOff, -4);
    fake.roundTo = 0;
    const none = await on.post('/bills', { lines: [{ itemId: 'n1', qty: 1, rate: 1364 }] });
    eq('no step, no rounding', none.body.total, 1364);
    eq('and no round-off recorded', none.body.roundOff, undefined);

    fake.roundTo = 5;
    const cust = await on.post('/customers', { name: 'Rounded Customer', phone: '9000000777' });
    const credit = await on.post('/bills', { lines: LINES, customerId: cust.body.id, paid: 0, showBalance: true });
    eq('the customer owes the rounded total', credit.body.balance, 255);
    eq('and their record says the same', (await on.call('/customers/' + cust.body.id)).body.customer.balance, 255);
    fake.roundTo = 0;

    console.log('\nA worker\'s tick on a saved bill');
    const no = saved.body.no;
    const ticked = await on.patch('/bills/' + no + '/lines/1/given', { given: true });
    eq('a line is marked given', ticked.status, 200);
    eq('and answers ok', ticked.body.ok, true);
    const after = (await on.call('/bills/' + no)).body;
    eq('the line reads back given', after.lines[1].given, true);
    eq('the other line is untouched', after.lines[0].given, false);
    eq('and no money moved', after.total, 255);
    eq('it can be taken back', (await on.patch('/bills/' + no + '/lines/1/given', { given: false })).status, 200);
    eq('and reads back so', (await on.call('/bills/' + no)).body.lines[1].given, false);
    eq('a missing bill is 404', (await on.patch('/bills/99999/lines/0/given', { given: true })).status, 404);
    eq('a missing line is 404', (await on.patch('/bills/' + no + '/lines/7/given', { given: true })).status, 404);
    eq('a body without given is refused', (await on.patch('/bills/' + no + '/lines/0/given', {})).status, 400);
    await on.post('/bills/' + no + '/cancel', {});
    eq('a cancelled bill is refused', (await on.patch('/bills/' + no + '/lines/0/given', { given: true })).status, 400);
    eq('the route needs a login', (await fetch('http://127.0.0.1:' + (BASE_PORT + 2) + '/api/bills/' + no + '/lines/0/given', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ given: true }),
    })).status, 401);

    console.log('\nSigning in by person');
    const person = (srv, phone, pin) => srv.call('/auth/person', {
      method: 'POST', body: JSON.stringify({ phone, pin }), headers: {},
    });
    const admin = await person(on, '9000000001', '1111');
    eq('an admin signs in', admin.status, 200);
    eq('as admin', admin.body.role, 'admin');
    eq('with their name', admin.body.name, 'Owner');
    eq('and a stock session', admin.body.stockToken, 'stock-jwt-admin');
    check('and a billing token', typeof admin.body.token === 'string' && admin.body.token.length > 20);
    const viaAdmin = await fetch('http://127.0.0.1:' + (BASE_PORT + 2) + '/api/settings', {
      headers: { authorization: 'Bearer ' + admin.body.token },
    });
    eq('which opens billing', viaAdmin.status, 200);
    const worker = await person(on, '9000000002', '2222');
    eq('a worker signs in', worker.status, 200);
    eq('as worker', worker.body.role, 'worker');
    eq('with a stock session', worker.body.stockToken, 'stock-jwt-worker');
    eq('and no billing token', worker.body.token, undefined);
    const godown = await person(on, '9000000004', '4444');
    eq('godown signs in with no billing token', godown.body.role + '/' + godown.body.token, 'godown/undefined');
    const bad = await person(on, '9000000001', '9999');
    eq('a wrong PIN is 401', bad.status, 401);
    check('with a message', /not right/.test(bad.body.error || ''), bad.body.error);
    const retired = await person(on, '9000000003', '3333');
    eq('a retired role is 403', retired.status, 403);
    eq('with stock\'s reason', retired.body.error, 'This role is no longer used');
    const offPerson = await person(off, '9000000001', '1111');
    eq('with the link off it is 503', offPerson.status, 503);
    check('telling them to use the shop PIN', /shop PIN/.test(offPerson.body.error || ''), offPerson.body.error);
    const refused = await person(wrong, '9000000001', '1111');
    eq('a refused link key is 503 too', refused.status, 503);
    check('also pointing at the shop PIN', /shop PIN/.test(refused.body.error || ''), refused.body.error);
    eq('no phone is 400', (await on.call('/auth/person', { method: 'POST', body: JSON.stringify({ pin: '1' }) })).status, 400);
    eq('the shop PIN still works', (await on.post('/auth/login', { pin: PIN })).status, 200);

    console.log('\nLast price for a typed line');
    const lpA = await on.post('/customers', { name: 'Last Price A', phone: '9000000881' });
    const lpB = await on.post('/customers', { name: 'Last Price B', phone: '9000000882' });
    await on.post('/bills', { customerId: lpA.body.id, lines: [{ itemId: 'lp1', nameKn: 'Kesari Rava', qty: 1, rate: 52 }] });
    await on.post('/bills', { customerId: lpB.body.id, lines: [{ itemId: 'lp2', nameKn: 'kesari  rava ', qty: 2, rate: 55 }] });
    const lpGone = await on.post('/bills', { lines: [{ itemId: 'lp3', nameKn: 'Kesari Rava', qty: 1, rate: 99 }] });
    await on.post('/bills/' + lpGone.body.no + '/cancel', {});
    await on.post('/bills', { lines: [{ itemId: 'lp4', nameEn: 'Parle-G', nameKn: '', qty: 1, rate: 108, unit: 'pack', stockItemId: 'it_parle' }] });
    const lpUrl = (q) => '/items/last-price?' + new URLSearchParams(q).toString();
    eq('the same customer\'s own last price', (await on.call(lpUrl({ name: 'kesari rava', customer: lpA.body.id }))).body.rate, 52);
    eq('marked as theirs', (await on.call(lpUrl({ name: 'kesari rava', customer: lpA.body.id }))).body.sameCustomer, true);
    eq('anyone\'s latest for a new customer, cancelled skipped', (await on.call(lpUrl({ name: 'Kesari Rava', customer: 'nobody' }))).body.rate, 55);
    eq('anyone\'s latest with no customer', (await on.call(lpUrl({ name: 'KESARI RAVA' }))).body.rate, 55);
    eq('by stock\'s id', (await on.call(lpUrl({ name: 'Parle', stockId: 'it_parle' }))).body.rate, 108);
    eq('never sold is a null rate, not an error', (await on.call(lpUrl({ name: 'Never Sold' }))).body.rate, null);
    eq('nothing asked is 400', (await on.call(lpUrl({ name: ' ' }))).status, 400);

    console.log('\nStock gone altogether');
    // Billing's fetch keeps its connection open; drop it, or close() waits on it for ever.
    stock.closeAllConnections();
    await new Promise((r) => stock.close(r));
    eq('search answers empty', JSON.stringify((await on.call('/stock/items?q=parle')).body.items), '[]');
    const alone = await on.post('/bills', { lines: LINES });
    eq('and a bill still saves, unrounded', alone.body.total, 253);
    const gone = await on.call('/auth/person', { method: 'POST', body: JSON.stringify({ phone: '9000000001', pin: '1111' }) });
    eq('signing in by person is 503', gone.status, 503);
    check('and points at the shop PIN', /shop PIN/.test(gone.body.error || ''), gone.body.error);
  } finally {
    for (const s of [off, on, wrong]) s.child.kill();
    try { stock.closeAllConnections(); stock.close(); } catch { /* already closed */ }
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('All stock link checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
