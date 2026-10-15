/**
 * The client feedback rounds on APK 59 and 61: a bill list that is fast, an honest offline flag,
 * saves that cannot be recorded twice, lines hidden from the printout, rounding as billing's own
 * setting -- each item rounded, not the total -- the whole-bill hide printing number and price
 * only, no per-line eye, and Enter in an item name going to its quantity.
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
  {
    const nb = { ...bill, hideNames: true, lines: [{ ...bill.lines[0], qty: 2, rate: 50, unit: 'kg', ink: INK }, bill.lines[1], bill.lines[2]] };
    const nd = shared.buildReceipt(nb, settings);
    const s = JSON.stringify(nd);
    check('hideNames: no names on the slip', !s.includes('Rice') && !s.includes('Salt') && !s.includes('Secret'), s);
    check('hideNames: no handwriting on the slip', !nd.rows.some((r) => r.t === 'ink'));
    const its = nd.rows.filter((r) => r.t === 'item' && r.no !== shared.EN_RECEIPT_LABELS.no);
    eq('hideNames: each line is its number and price only', its.map((r) => [r.no, r.name, r.note, r.amount]),
      [['1', '', undefined, shared.money(100)], ['2', '', undefined, shared.money(10)]]);
    check('hideNames: no quantity, unit or rate anywhere on the slip', !s.includes('kg') && !s.includes('@ '), s);
    check('hideNames: not even with the shop\'s show-rate on',
      !JSON.stringify(shared.buildReceipt(nb, { ...settings, showRate: true })).includes('@ '));
    const totalRow2 = nd.rows.find((r) => r.t === 'kv' && r.left === shared.EN_RECEIPT_LABELS.total);
    eq('hideNames: TOTAL unchanged', totalRow2 && totalRow2.right, shared.money(150));
    const t2 = shared.billAsText(nb, 'Shop', { bill: 'Bill ', total: 'Total', paid: 'Paid', balance: 'Balance' });
    check('hideNames: WhatsApp text is number and price only',
      t2.includes('1. ₹100') && t2.includes('2. ₹10') && !t2.includes('Rice') && !t2.includes('kg') && !t2.includes('×'), t2);
    check('hideNames off: names still print', JSON.stringify(shared.buildReceipt({ ...nb, hideNames: false }, settings)).includes('Salt'));
  }
  {
    console.log('\nShow item rate under each item');
    const rb = { ...bill, lines: [{ itemId: 'a', nameKn: 'Rice', nameEn: 'Rice', qty: 3, rate: 500 / 3, unit: 'kg' }, bill.lines[2]] };
    const its = (st) => shared.buildReceipt(rb, { ...settings, showRate: st }).rows.filter((r) => r.t === 'item' && r.no !== shared.EN_RECEIPT_LABELS.no);
    eq('off: nothing under any item, not even a rate typed over a total', its(false).map((r) => r.note), [undefined, undefined]);
    check('on: "@ rate" under each item', its(true).every((r) => typeof r.note === 'string' && r.note.startsWith('@ ')));
    const L = { bill: 'Bill ', total: 'Total', paid: 'Paid', balance: 'Balance' };
    const off = shared.billAsText(rb, 'Shop', L);
    check('WhatsApp off: no rate, just the amount', off.includes('3 kg Rice = ₹500') && !off.includes('×'), off);
    const on = shared.billAsText({ ...rb, showRate: true }, 'Shop', L);
    check('WhatsApp on: qty × rate as before', on.includes('×'), on);
  }
  {
    console.log('\nCompact hidden-items receipt (Settings.receiptStyle)');
    const L = { bill: 'Bill ', total: 'Total', paid: 'Paid', balance: 'Balance' };
    const b79 = {
      no: 79, at: '2026-10-11T10:00:00.000Z', total: 830, paid: 830, balance: 0, showBalance: false, hideNames: true,
      customer: { id: 'k', name: 'Ravi', phone: '9876543210' },
      lines: [
        { itemId: 'a', nameKn: 'Rice', nameEn: 'Rice', qty: 1, rate: 110 },
        { itemId: 'b', nameKn: 'Dal', nameEn: 'Dal', qty: 1, rate: 170 },
        { itemId: 'c', nameKn: 'Oil', nameEn: 'Oil', qty: 1, rate: 550 },
      ],
    };
    const cs = { ...settings, receiptStyle: 'compact' };
    const cd = shared.buildReceipt(b79, cs);
    const strip = (d) => d.rows.filter((r) => r.t !== 'space');
    const seps = cd.rows.map((r, i) => (r.t === 'sep' ? i : -1)).filter((i) => i >= 0);
    check('compact: no item rows and no table header', !cd.rows.some((r) => r.t === 'item'), JSON.stringify(cd.rows));
    const runs = cd.rows.filter((r) => r.t === 'center' && /^\d+\)/.test(r.text)).map((r) => r.text);
    eq('compact: one block "1)110, 2)170, 3)550"', runs, ['1)110, 2)170, 3)550']);
    const at = cd.rows.findIndex((r) => r.t === 'center' && r.text === runs[0]);
    const totalAt = cd.rows.findIndex((r) => r.t === 'kv' && r.left === shared.EN_RECEIPT_LABELS.total);
    check('compact: dashed rule between the block and TOTAL', seps.some((i) => i > at && i < totalAt));
    eq('compact: TOTAL 830', cd.rows[totalAt] && cd.rows[totalAt].right, shared.money(830));
    check('compact: customer block and bill number kept',
      cd.rows.some((r) => r.t === 'kv' && r.left === 'Ravi' && r.right === '9876543210') && cd.rows.some((r) => r.t === 'kv' && r.left === shared.EN_RECEIPT_LABELS.bill + 79),
      JSON.stringify(cd.rows));
    check('compact: thank-you last', strip(cd).slice(-1)[0].text === settings.footer);
    check('compact: no names', !JSON.stringify(cd).match(/Rice|Dal|Oil/));
    // 58 mm: many entries wrap, never inside one, each line within the paper.
    const many = { ...b79, lines: Array.from({ length: 14 }, (_, i) => ({ itemId: 'x' + i, nameKn: 'N', nameEn: 'N', qty: 1, rate: 1000 + i * 11 })) };
    const md = shared.buildReceipt(many, { ...cs, paper: '58mm' });
    const mruns = md.rows.filter((r) => r.t === 'center' && /^\d+\)/.test(r.text)).map((r) => r.text);
    check('58mm: wraps onto several lines', mruns.length > 1, JSON.stringify(mruns));
    const entries = mruns.join(' ').split(' ').map((e) => e.replace(/,$/, ''));
    eq('58mm: every entry whole, in order', entries, many.lines.map((l, i) => (i + 1) + ')' + shared.money(l.rate)));
    const room = md.width - 2 * shared.RASTER.pad;
    check('58mm: every line fits the paper', mruns.every((t) => t.length * shared.RASTER.itemSize * 0.6 <= room), JSON.stringify(mruns));
    const wide = shared.buildReceipt(many, { ...cs, paper: '80mm' }).rows.filter((r) => r.t === 'center' && /^\d+\)/.test(r.text));
    check('80mm: fewer lines than 58mm', wide.length < mruns.length);
    // List mode and hideNames off are untouched.
    eq('normal style unchanged', JSON.stringify(shared.buildReceipt(b79, { ...settings, receiptStyle: 'normal' })), JSON.stringify(shared.buildReceipt(b79, settings)));
    check('list mode still has its rows', shared.buildReceipt(b79, settings).rows.filter((r) => r.t === 'item').length === 4);
    const shown = { ...b79, hideNames: false };
    eq('compact with hideNames off: no change', JSON.stringify(shared.buildReceipt(shown, cs)), JSON.stringify(shared.buildReceipt(shown, settings)));
    const wt = shared.billAsText({ ...b79, hiddenReceipt: 'compact' }, 'Shop', L);
    check('WhatsApp compact: "1)110, 2)170, 3)550 · Total 830"', wt.includes('1)110, 2)170, 3)550 · Total 830'), wt);
    eq('WhatsApp list unchanged', shared.billAsText({ ...b79, hiddenReceipt: 'list' }, 'Shop', L), shared.billAsText(b79, 'Shop', L));
    eq('WhatsApp compact with hideNames off unchanged',
      shared.billAsText({ ...shown, hiddenReceipt: 'compact' }, 'Shop', L), shared.billAsText(shown, 'Shop', L));
  }
  eq('printedLines drops only hidden ones', shared.printedLines(bill.lines).map((l) => l.itemId), ['a', 'c']);
}

/*
 * Receipt style (APK 69): the client's six cases. Compact applies when the style is Compact AND
 * (hide is on OR the bill is price-only). Print, reprint and WhatsApp all follow receiptLayout;
 * History's on-screen view is always normal.
 */
const L6 = { bill: 'Bill ', total: 'Total', paid: 'Paid', balance: 'Balance' };
const PRICE_ONLY = [
  { itemId: 'p1', nameKn: '', nameEn: '', qty: 1, rate: 110 },
  { itemId: 'p2', nameKn: '', nameEn: '', qty: 1, rate: 170 },
];
const WITH_DESC = [
  { itemId: 'd1', nameKn: 'Rice', nameEn: 'Rice', qty: 1, rate: 110 },
  { itemId: 'd2', nameKn: '', nameEn: '', qty: 1, rate: 170 },
];
const SIX = [
  // [label, style, lines, hideNames, expected layout]
  ['1 Normal, price-only', 'normal', PRICE_ONLY, false, 'normal'],
  ['2 Normal, description, hide on', 'normal', WITH_DESC, true, 'normal-hidden'],
  ['3 Normal, description, hide off', 'normal', WITH_DESC, false, 'normal'],
  ['4 Compact, price-only (auto on)', 'compact', PRICE_ONLY, true, 'compact'],
  ['5 Compact, description, hide on', 'compact', WITH_DESC, true, 'compact'],
  ['6 Compact, description, hide off', 'compact', WITH_DESC, false, 'normal'],
];
function sixBill(lines, hideNames) {
  return {
    no: 90, at: '2026-10-15T10:00:00.000Z', total: 280, paid: 280, balance: 0, showBalance: false,
    ...(hideNames ? { hideNames: true } : {}), lines,
  };
}
/** What a built slip shows: 'compact', 'numbered' (number and price, no names) or 'named'. */
function slipShape(doc) {
  const items = doc.rows.filter((r) => r.t === 'item');
  if (items.length === 0 && doc.rows.some((r) => r.t === 'center' && /^\d+\)/.test(r.text))) return 'compact';
  const body = items.slice(1); // past the column heads
  if (body.some((r) => /Rice/.test(r.name))) return 'named';
  return body.length === 2 && body.every((r) => r.name === '') ? 'numbered' : '?';
}
function textShape(text) {
  if (/1\)110, 2\)170 · Total 280/.test(text)) return 'compact';
  if (/Rice/.test(text)) return 'normal';
  if (/^1\. ₹110$/m.test(text)) return 'normal-hidden';
  if (/— = ₹110/.test(text)) return 'normal';
  return '?';
}
/** The slip expected for a layout: a price-only bill has no names to show either way. */
function slipFor(want, lines) {
  if (want === 'compact') return 'compact';
  if (want === 'normal-hidden' || lines === PRICE_ONLY) return 'numbered';
  return 'named';
}
function receiptStyleRules() {
  console.log('\nReceipt style: the six cases (receiptLayout)');
  const base = shared.DEFAULT_SETTINGS;
  check('isPriceOnly: prices only', shared.isPriceOnly({ lines: PRICE_ONLY }));
  check('isPriceOnly: a name is a description', !shared.isPriceOnly({ lines: WITH_DESC }));
  check('isPriceOnly: handwriting is a description',
    !shared.isPriceOnly({ lines: [{ ...PRICE_ONLY[0], ink: INK }] }));
  check('isPriceOnly: a zero price is not', !shared.isPriceOnly({ lines: [{ ...PRICE_ONLY[0], rate: 0 }] }));
  check('isPriceOnly: an empty bill is not', !shared.isPriceOnly({ lines: [] }));
  check('isPriceOnly: still answers for one line', shared.isPriceOnly(PRICE_ONLY[0]));
  for (const [label, style, lines, hide, want] of SIX) {
    const settings = { ...base, receiptStyle: style };
    const bill = sixBill(lines, hide);
    eq(label + ': receiptLayout', shared.receiptLayout(bill, settings), want);
    eq(label + ': print', slipShape(shared.buildReceipt(bill, settings)), slipFor(want, lines));
    // A reprint is the saved bill through the same builder, with the shop's settings of today.
    const saved = JSON.parse(JSON.stringify(bill));
    eq(label + ': print again', slipShape(shared.buildReceipt(saved, settings)), slipFor(want, lines));
    const wa = shared.billAsText({ ...saved, receiptStyle: style }, 'Shop', L6);
    eq(label + ': WhatsApp', textShape(wa), want, wa);
    // History's on-screen view: always the normal layout, whatever the style.
    const view = slipShape(shared.buildReceipt(saved, shared.historyViewSettings(settings)));
    eq(label + ': History screen is normal', view, slipFor(hide && lines !== PRICE_ONLY ? 'normal-hidden' : 'normal', lines));
  }
  eq('Normal, price-only, hide on: still normal', shared.receiptLayout(sixBill(PRICE_ONLY, true), { receiptStyle: 'normal' }), 'normal');
  eq('Compact, price-only, hide off (an old bill): compact', shared.receiptLayout(sixBill(PRICE_ONLY, false), { receiptStyle: 'compact' }), 'compact');

  console.log('\nAuto hide on the bill screen (shouldAutoHide)');
  const blank = { itemId: 'z', nameKn: '', nameEn: '', qty: 1, rate: 0 };
  check('Compact + price-only: turns on', shared.shouldAutoHide([...PRICE_ONLY, blank], { receiptStyle: 'compact' }));
  check('Compact + a description: does not', !shared.shouldAutoHide(WITH_DESC, { receiptStyle: 'compact' }));
  check('Normal + price-only: does not', !shared.shouldAutoHide(PRICE_ONLY, { receiptStyle: 'normal' }));
  check('an empty bill: does not', !shared.shouldAutoHide([blank], { receiptStyle: 'compact' }));

  console.log('\nThe old hiddenReceipt setting migrates');
  eq('list -> normal', shared.migrateSettings({ hiddenReceipt: 'list' }).receiptStyle, 'normal');
  eq('compact -> compact', shared.migrateSettings({ hiddenReceipt: 'compact' }).receiptStyle, 'compact');
  eq('absent -> normal', shared.migrateSettings({}).receiptStyle, 'normal');
  eq('the new field wins', shared.migrateSettings({ hiddenReceipt: 'compact', receiptStyle: 'normal' }).receiptStyle, 'normal');
  check('the old field is dropped', !('hiddenReceipt' in shared.migrateSettings({ hiddenReceipt: 'compact' })));
  eq('receiptLayout reads the old field too',
    shared.receiptLayout(sixBill(WITH_DESC, true), { hiddenReceipt: 'compact' }), 'compact');
  eq('billAsText accepts the old field',
    textShape(shared.billAsText({ ...sixBill(WITH_DESC, true), hiddenReceipt: 'compact' }, 'Shop', L6)), 'compact');
}

function perItemRounding() {
  console.log('\nRounding each item, not the total (roundLine)');
  eq('110.04 to 110 on a step of 1', shared.roundLine(110.04, 1), 110);
  eq('110.5 up to 111', shared.roundLine(110.5, 1), 111);
  eq('112.5 to 115 on a step of 5', shared.roundLine(112.5, 5), 115);
  eq('112.49 to 110 on a step of 5', shared.roundLine(112.49, 5), 110);
  eq('115 to 120 on a step of 10', shared.roundLine(115, 10), 120);
  eq('114.99 to 110 on a step of 10', shared.roundLine(114.99, 10), 110);
  eq('step 0 leaves it to the paisa', shared.roundLine(110.04, 0), 110.04);
  eq('a slab line, 12 at 9.17, shows 110', shared.roundedLineAmount(12, 9.17, 1), 110);
  const rate = shared.roundedRate(12, 9.17, 1);
  eq('and the rate saved makes qty x rate come to 110', shared.lineAmount(12, rate), 110);
  eq('a round line keeps its rate', shared.roundedRate(2, 50, 5), 50);
  eq('step 0 keeps the rate', shared.roundedRate(12, 9.17, 0), 9.17);
  const lines = [{ itemId: 'a', nameKn: '', nameEn: '', qty: 12, rate: 9.17 }, { itemId: 'b', nameKn: '', nameEn: '', qty: 1, rate: 33.4 }];
  eq('the bill total is the sum of the rounded lines', shared.billTotal(shared.roundLines(lines, 1)), 143);
  eq('roundLines with step 0 changes nothing', shared.roundLines(lines, 0), lines);

  console.log('\nThe Round off line');
  const settings = { ...shared.DEFAULT_SETTINGS };
  const base = { no: 1, at: '2026-10-11T10:00:00.000Z', paid: 110, balance: 0, showBalance: false,
    lines: [{ itemId: 'a', nameKn: 'Soap', nameEn: 'Soap', qty: 1, rate: 110 }] };
  const isRound = (r) => r.t === 'kv' && r.left === shared.EN_RECEIPT_LABELS.roundOff;
  check('a new bill (no roundOff) prints no Round off line',
    !shared.buildReceipt({ ...base, total: 110, roundTo: 1 }, settings).rows.some(isRound));
  check('an old bill with a roundOff still prints it',
    shared.buildReceipt({ ...base, total: 110, roundOff: -0.04 }, settings).rows.some(isRound));
}

/*
 * The bill screens, read as source: the per-line eye is gone, and Enter in an item name goes
 * to that line's quantity through a focus wish that waits for the box, never to the price.
 */
function screens() {
  console.log('\nThe bill screens');
  const mobile = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'screens', 'BillScreen.tsx'), 'utf8');
  const web = fs.readFileSync(path.join(ROOT, 'client', 'src', 'pages', 'BillPage.tsx'), 'utf8');
  for (const [name, src] of [['tablet', mobile], ['web', web]]) {
    check(name + ': no per-line eye', !src.includes('👁') && !src.includes('setLineHidden') && !src.includes('bill.hideLine'));
    check(name + ': Enter on a picked name goes to the next line\'s name', /pickBest\(index, line, typed\)\.then\(\(\) => goToNextName\(index\)\)/.test(src));
    check(name + ': an already matched name too', /stock\.close\(\); goToNextName\(index\); return; \}\s*clearTyped/.test(src));
    {
      const at = src.indexOf('const submitName');
      check(name + ': Enter no longer goes to the quantity', !src.slice(at, at + 700).includes('goToQty'));
    }
    check(name + ': an unpriced line shows an empty quantity, "1" as its hint',
      src.includes("value={qtyText[line.itemId] ?? (line.rate > 0 ? String(line.qty) : '')}") && src.includes('placeholder="1"'));
    check(name + ': F4 goes to the top typed line showing', /nameShortcutLine\(rowBoxes\(\)/.test(src) && /lineHasInk\(cart\[i\]!\)/.test(src));
    check(name + ': F5-F8 ignore the cursor\'s line', /shortcutLine\(rowBoxes\(\), /.test(src) && !/shortcutLine\(\s*cursorAt/.test(src));
    check(name + ': no straight jump to the price from a name', !/submitName[\s\S]{0,600}prices\.current/.test((() => { const lf = src.replace(/\r\n/g, '\n'); const at = lf.indexOf('const submitName'); return lf.slice(at, lf.indexOf('\n  };', at)); })()));
  }
  check('tablet: the quantity focus waits for the box', /kind === 'qty' \? qtys\.current\[target\]/.test(mobile));
  check('web: the quantity focus waits for the box', /wantQty\.current = id/.test(web) && /const field = qtys\.current\[id\]/.test(web));
  check('tablet: a hardware Enter is handled once, by the focused box', /hwEnter\.current\(\)/.test(mobile) && /firstSubmit\('name:'/.test(mobile));
  check('tablet: the bill boxes claim Enter natively', (mobile.match(/setTakeEnter\(true\)/g) || []).length === 3
    && (mobile.match(/setTakeEnter\(false\)/g) || []).length >= 3);
  check('web: a held Enter does not repeat the pick', /e\.repeat/.test(web));
  const plugin = fs.readFileSync(path.join(ROOT, 'mobile', 'plugins', 'withStylus.js'), 'utf8');
  check('native: Enter is used up while a bill box owns it', /fun setTakeEnter/.test(plugin) && /if \(!takeEnter \|\| multiLine\)/.test(plugin));
  check('native: Enter reaches JavaScript once per press', /ev\.repeatCount == 0\) instance\?\.emitKey\(key\)\r?\n        return true/.test(plugin));
}

async function main() {
  offlineFlag();
  receipt();
  perItemRounding();
  receiptStyleRules();
  screens();

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
    const r5 = (await call('/bills', 'POST', { lines: [{ itemId: 'x', qty: 1, rate: 152 }, { itemId: 'y', qty: 1, rate: 152 }] })).body;
    eq('each line is rounded by billing\'s setting', r5.lines.map((l) => shared.lineAmount(l.qty, l.rate)), [150, 150]);
    eq('the total is their sum (not 304 rounded to 305)', r5.total, 300);
    eq('no roundOff on a new bill', r5.roundOff, undefined);
    eq('and roundTo which step', r5.roundTo, 5);
    await call('/settings', 'PUT', { roundTo: 1 });
    const slab = (await call('/bills', 'POST', { lines: [{ itemId: 'w', qty: 12, rate: 9.17 }] })).body;
    eq('a slab line, 12 at 9.17, saves as 110', shared.lineAmount(slab.lines[0].qty, slab.lines[0].rate) + '/' + slab.total, '110/110');
    eq('keeping its quantity', slab.lines[0].qty, 12);
    await call('/settings', 'PUT', { roundTo: 10 });
    const r10 = (await call('/bills', 'POST', { lines: [{ itemId: 'x', qty: 1, rate: 155 }] })).body;
    eq('to ten, 155 goes up', r10.total + '/' + r10.roundOff + '/' + r10.roundTo, '160/undefined/10');
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

    console.log('\nItem descriptions hidden on the customer copy (hideNames)');
    const hn = (await call('/bills', 'POST', { lines: [{ itemId: 'x', nameEn: 'Rice', qty: 2, rate: 50 }], hideNames: true })).body;
    eq('a new bill keeps hideNames', hn.hideNames, true);
    const plain = (await call('/bills', 'POST', { lines: [{ itemId: 'x', nameEn: 'Rice', qty: 2, rate: 50 }] })).body;
    eq('and leaves it off when not asked', plain.hideNames, undefined);
    const on = await call('/bills/' + plain.no, 'PATCH', { hideNames: true });
    eq('PATCH turns it on', on.body.hideNames, true);
    eq('and moves nothing else', [on.body.total, on.body.paid, on.body.lines[0].nameEn], [plain.total, plain.paid, 'Rice']);
    eq('it is saved', (await call('/bills/' + plain.no)).body.hideNames, true);
    eq('PATCH turns it off', (await call('/bills/' + plain.no, 'PATCH', { hideNames: false })).body.hideNames, undefined);
    eq('other fields are refused', (await call('/bills/' + plain.no, 'PATCH', { hideNames: true, total: 1 })).status, 400);
    eq('a missing bill is 404', (await call('/bills/999999', 'PATCH', { hideNames: true })).status, 404);

    console.log('\nReceipt style on the server (migration and reprint)');
    eq('a fresh shop reads normal', (await call('/settings')).body.receiptStyle, 'normal');
    const old = (await call('/settings', 'PUT', { hiddenReceipt: 'compact' })).body;
    eq('an old app sending hiddenReceipt compact: compact', old.receiptStyle, 'compact');
    check('and the old field is not echoed back', !('hiddenReceipt' in old), JSON.stringify(old));
    eq('it survives a reread', (await call('/settings')).body.receiptStyle, 'compact');
    eq('list from an old app -> normal', (await call('/settings', 'PUT', { hiddenReceipt: 'list' })).body.receiptStyle, 'normal');
    eq('the switch: compact', (await call('/settings', 'PUT', { receiptStyle: 'compact' })).body.receiptStyle, 'compact');
    eq('a bad style is refused', (await call('/settings', 'PUT', { receiptStyle: 'tiny' })).status, 400);
    const st = (await call('/settings')).body;
    for (const [label, style, lines, hide, want] of SIX) {
      const made = (await call('/bills', 'POST', { lines, ...(hide ? { hideNames: true } : {}) })).body;
      const again = (await call('/bills/' + made.no)).body;
      eq(label + ': reprint of the saved bill', shared.receiptLayout(again, { ...st, receiptStyle: style }), want);
      eq(label + ': reprint slip', slipShape(shared.buildReceipt(again, { ...st, receiptStyle: style })), slipFor(want, lines));
    }
    await call('/settings', 'PUT', { receiptStyle: 'normal' });
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
