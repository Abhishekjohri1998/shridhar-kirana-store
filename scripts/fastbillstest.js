/**
 * The client feedback round on APK 59: a bill list that is fast, an honest offline flag, saves
 * that cannot be recorded twice, lines hidden from the printout, and rounding as billing's own
 * setting.
 *
 * Against a scratch server on the JSON file store in a temporary folder; no MongoDB is touched.
 * The offline flag and the receipt are pure functions and are checked directly.
 *
 *   node scripts/fastbillstest.js
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PIN = '9137';
const PORT = 6100 + Math.floor(Math.random() * 300);
const DATA = path.join(os.tmpdir(), 'shridhar-fastbillstest-' + Date.now().toString(36));
const shared = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ok   ' + name); }
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

const INK = { w: 300, h: 60, strokes: [[10, 10, 20, 20, 30, 15], [40, 40, 50, 45]] };

function offlineFlag() {
  console.log('\nThe offline flag (createLinkWatch)');
  const seen = [];
  const watch = shared.createLinkWatch((v) => seen.push(v));
  eq('starts online', watch.offline, false);
  watch.fail();
  eq('one miss is not an outage', watch.offline, false);
  watch.ok();
  watch.fail();
  eq('an answer in between resets the count', watch.offline, false);
  watch.fail();
  eq('two misses in a row raise it', watch.offline, true);
  watch.fail();
  eq('and it is said once, not per miss', seen, [true]);
  watch.ok();
  eq('any answer clears it at once', watch.offline, false);
  eq('and that is said too', seen, [true, false]);
  eq('the miss count is back to zero', watch.failures, 0);
  eq('loads wait 15 s', shared.LOAD_TIMEOUT_MS, 15000);
  eq('saves wait 20 s', shared.SAVE_TIMEOUT_MS, 20000);
  eq('a missing server is knocked every 15 s', shared.LINK_RETRY_MS, 15000);
}

function receipt() {
  console.log('\nHidden lines: off the paper and the text, in the total');
  const bill = {
    no: 7, at: '2026-10-11T10:00:00.000Z', total: 150, paid: 150, balance: 0, showBalance: false,
    lines: [
      { itemId: 'a', nameKn: 'Rice', nameEn: 'Rice', qty: 1, rate: 100 },
      { itemId: 'b', nameKn: 'Secret', nameEn: 'Secret', qty: 1, rate: 40, hidden: true },
      { itemId: 'c', nameKn: 'Salt', nameEn: 'Salt', qty: 1, rate: 10 },
    ],
  };
  const settings = { ...shared.DEFAULT_SETTINGS };
  const doc = shared.buildReceipt(bill, settings);
  const items = doc.rows.filter((r) => r.t === 'item' && r.no !== shared.EN_RECEIPT_LABELS.no);
  eq('the receipt prints the two shown lines', items.length, 2);
  check('and not the hidden one', !JSON.stringify(doc).includes('Secret'));
  eq('numbered without a gap', items.map((r) => r.no), ['1', '2']);
  const totalRow = doc.rows.find((r) => r.t === 'kv' && r.left === shared.EN_RECEIPT_LABELS.total);
  eq('the TOTAL still counts it', totalRow && totalRow.right, shared.money(150));
  const text = shared.billAsText(bill, 'Shop', { bill: 'Bill ', total: 'Total', paid: 'Paid', balance: 'Balance' });
  check('the WhatsApp text leaves it out', !text.includes('Secret'), text);
  check('and keeps the others', text.includes('Rice') && text.includes('Salt'));
  check('and its total counts it', text.includes('₹150'), text);
  eq('History can say what was hidden', shared.hiddenLinesText(bill), '2. Secret ' + shared.money(40));
  eq('nothing hidden says nothing', shared.hiddenLinesText({ lines: [bill.lines[0]] }), '');
  eq('printedLines drops only hidden ones', shared.printedLines(bill.lines).map((l) => l.itemId), ['a', 'c']);
}

async function main() {
  offlineFlag();
  receipt();

  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env, PORT: String(PORT), DATA_DIR: DATA, AUTH_PIN: PIN, MONGO_URI: '',
        JWT_SECRET: 'fastbillstest-secret', NODE_ENV: 'test', STOCK_URL: '', LINK_KEY: '',
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

    console.log('\nRounding: billing\'s own setting');
    // The migration runs at start; give it a beat. With the stock link off it settles on 0.
    let s = (await call('/settings')).body;
    for (let i = 0; i < 20 && s.roundTo == null; i++) { await sleep(100); s = (await call('/settings')).body; }
    eq('with the link off, the first start stores 0', s.roundTo, 0);
    eq('an odd step is refused', (await call('/settings', 'PUT', { roundTo: 3 })).status, 400);
    eq('5 is accepted', (await call('/settings', 'PUT', { roundTo: 5 })).body.roundTo, 5);
    const r5 = (await call('/bills', 'POST', { lines: [{ itemId: 'x', qty: 1, rate: 152 }] })).body;
    eq('the bill is rounded by billing\'s setting', r5.total, 150);
    eq('roundOff says by how much', r5.roundOff, -2);
    eq('and roundTo which step', r5.roundTo, 5);
    await call('/settings', 'PUT', { roundTo: 10 });
    const r10 = (await call('/bills', 'POST', { lines: [{ itemId: 'x', qty: 1, rate: 155 }] })).body;
    eq('to ten, 155 goes up', r10.total + '/' + r10.roundOff + '/' + r10.roundTo, '160/5/10');
    await call('/settings', 'PUT', { roundTo: 0 });
    const r0 = (await call('/bills', 'POST', { lines: [{ itemId: 'x', qty: 1, rate: 152 }] })).body;
    eq('no step: exact, roundTo 0 and no roundOff', r0.total + '/' + r0.roundTo + '/' + r0.roundOff, '152/0/undefined');
    eq('the setting survives a reread', (await call('/settings')).body.roundTo, 0);

    console.log('\nSaving twice is one bill (clientId)');
    const cust = (await call('/customers', 'POST', { name: 'Twice', phone: '9000000555' })).body;
    const body = {
      lines: [{ itemId: 'a', qty: 2, rate: 50 }], customerId: cust.id, paid: 0, clientId: 'draft_abc',
    };
    const first = await call('/bills', 'POST', body);
    eq('the first save makes a bill', first.status, 201);
    const again = await call('/bills', 'POST', body);
    eq('the same clientId again answers 200', again.status, 200);
    eq('with the same bill', again.body.no, first.body.no);
    const racing = await Promise.all([1, 2, 3].map(() =>
      call('/bills', 'POST', { ...body, clientId: 'draft_race' })));
    eq('three at once: one made, two answered with it',
      racing.map((r) => r.status).sort(), [200, 200, 201]);
    eq('all the same number', new Set(racing.map((r) => r.body.no)).size, 1);
    const owed = (await call('/customers/' + cust.id)).body.customer;
    eq('the customer was charged twice, not five times', owed.balance, 200);
    eq('and has two bills', owed.billCount, 2);
    const other = await call('/bills', 'POST', { ...body, clientId: 'draft_other' });
    eq('a different clientId is a different bill', other.status === 201 && other.body.no !== first.body.no, true);
    const none = await call('/bills', 'POST', { lines: [{ itemId: 'a', qty: 1, rate: 1 }] });
    eq('no clientId saves as it always did', none.status, 201);
    eq('the clientId is kept on the bill', first.body.clientId, 'draft_abc');

    console.log('\nHidden lines reach the saved bill');
    const hid = (await call('/bills', 'POST', { lines: [
      { itemId: 'h1', nameEn: 'Shown', qty: 1, rate: 30 },
      { itemId: 'h2', nameEn: 'Hidden', qty: 1, rate: 70, hidden: true },
    ] })).body;
    eq('the line is marked hidden', hid.lines[1].hidden, true);
    eq('the other is not', hid.lines[0].hidden, undefined);
    eq('and the total counts both', hid.total, 100);

    console.log('\nThe bill list: lite and since');
    const written = (await call('/bills', 'POST', { lines: [
      { itemId: 'w1', ink: INK, qty: 1, rate: 10, lastMode: 'ink' },
      { itemId: 'w2', nameEn: 'Typed', qty: 1, rate: 5 },
      { itemId: 'w3', ink: INK, moreInk: [INK], qty: 1, rate: 1, inkRows: 2 },
    ] })).body;
    const full = (await call('/bills?limit=100')).body;
    check('the plain list still carries the ink', full[0].lines[0].ink && full[0].lines[0].ink.strokes.length === 2);
    eq('and has no hasInk fields (unchanged for old apps)', full[0].hasInk, undefined);
    const lite = (await call('/bills?lite=1&limit=100')).body;
    eq('lite has the same bills in the same order', lite.map((b) => b.no), full.map((b) => b.no));
    eq('newest first', lite[0].no, written.no);
    check('lite carries no ink anywhere', !JSON.stringify(lite).includes('strokes'));
    eq('a written bill says hasInk', lite[0].hasInk, true);
    eq('a typed one says it has none', lite.find((b) => b.no === hid.no).hasInk, false);
    eq('each written line says so', lite[0].lines.map((l) => l.hasInk === true), [true, false, true]);
    eq('and keeps how it was written', lite[0].lines[0].lastMode, 'ink');
    eq('and its rows', lite[0].lines[2].inkRows, 2);
    eq('the money is all there', lite[0].total, 16);
    const one = (await call('/bills/' + written.no)).body;
    eq('one bill by number still has its ink', one.lines[0].ink.strokes.length, 2);
    eq('and its extra strips', one.lines[2].moreInk.length, 1);
    const lastNo = full[0].no;
    const since = (await call('/bills?lite=1&since=' + (lastNo - 3) + '&limit=100')).body;
    eq('since: only the bills after it, newest first', since.map((b) => b.no), [lastNo, lastNo - 1, lastNo - 2]);
    const paged = (await call('/bills?lite=1&since=' + (lastNo - 3) + '&limit=2')).body;
    eq('since with a limit takes the oldest after it, so paging skips none', paged.map((b) => b.no), [lastNo - 1, lastNo - 2]);
    eq('since the newest: nothing new', (await call('/bills?lite=1&since=' + lastNo)).body, []);
    eq('since also works without lite', (await call('/bills?since=' + (lastNo - 1))).body[0].lines.length > 0, true);
    eq('a bad since is refused', (await call('/bills?since=abc')).status, 400);
  } finally {
    child.kill();
    await sleep(300);
    fs.rmSync(DATA, { recursive: true, force: true });
  }
}

main()
  .catch((e) => { failures++; console.error(e); })
  .finally(() => {
    console.log('\n' + passes + ' passed, ' + failures + ' failed');
    process.exit(failures ? 1 : 0);
  });
