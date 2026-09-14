/**
 * Checks the parts that a browser click-through would not catch, without needing MongoDB or a
 * printer: money and totals, the receipt document, handwriting geometry, the canvas layout that
 * feeds a Bluetooth printer, the ESC/POS framing, and the live API -- auth, validation,
 * server-side totals, customer balances and the quiet-customer list.
 *
 * The canvas is faked -- measureText and fillText are approximated -- so this proves the layout
 * code runs and produces well-formed dots, not that the Kannada glyphs look right. Only paper can
 * tell you that; use Settings > Test print.
 *
 *   npm run selftest
 */
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.selftest-build');
const DATA = path.join(os.tmpdir(), 'shridhar-selftest-data-' + Date.now().toString(36));
const PORT = 4600 + Math.floor(Math.random() * 400);
const PIN = '9137';

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

// ---------------------------------------------------------------- fake canvas
function fakeCanvas() {
  const c = { width: 0, height: 0 };
  c.getContext = function () {
    let fb = null;
    let tx = { a: 1, e: 0, f: 0 };
    const ctx = {
      font: '10px sans-serif',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      _size() {
        const m = /(\d+)px/.exec(ctx.font);
        return m ? Number(m[1]) : 10;
      },
      measureText(t) {
        // Rough but monotonic in length, which is all the wrapping logic needs.
        return { width: String(t).length * ctx._size() * 0.55 };
      },
      _ensure() {
        if (!fb || fb.length !== c.width * c.height * 4) {
          fb = new Uint8ClampedArray(Math.max(0, c.width * c.height * 4)).fill(255);
        }
        return fb;
      },
      _dot(x, y) {
        const buf = ctx._ensure();
        const px = Math.round(x * tx.a + tx.e);
        const py = Math.round(y * tx.a + tx.f);
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) return;
        const p = (py * c.width + px) * 4;
        buf[p] = 0; buf[p + 1] = 0; buf[p + 2] = 0; buf[p + 3] = 255;
      },
      fillRect(x, y, w, h) {
        const buf = ctx._ensure();
        const black = ctx.fillStyle !== '#fff';
        for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(c.height, Math.ceil(y + h)); yy++) {
          for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(c.width, Math.ceil(x + w)); xx++) {
            const p = (yy * c.width + xx) * 4;
            const v = black ? 0 : 255;
            buf[p] = v; buf[p + 1] = v; buf[p + 2] = v; buf[p + 3] = 255;
          }
        }
      },
      fillText(t, x, y) {
        const w = ctx.measureText(t).width;
        const size = ctx._size();
        const left = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x;
        ctx.fillRect(left, y, w, size * 0.75);
      },
      // Enough of the path API for the ink renderer: transforms plus straight segments.
      save() { ctx._saved = { ...tx }; },
      restore() { if (ctx._saved) tx = ctx._saved; },
      translate(x, y) { tx = { a: tx.a, e: tx.e + x * tx.a, f: tx.f + y * tx.a }; },
      scale(s) { tx = { a: tx.a * s, e: tx.e, f: tx.f }; },
      beginPath() { ctx._at = null; },
      moveTo(x, y) { ctx._at = [x, y]; ctx._dot(x, y); },
      lineTo(x, y) {
        const from = ctx._at ?? [x, y];
        const steps = Math.max(1, Math.ceil(Math.hypot(x - from[0], y - from[1]) * Math.max(1, tx.a)));
        for (let i = 0; i <= steps; i++) {
          ctx._dot(from[0] + ((x - from[0]) * i) / steps, from[1] + ((y - from[1]) * i) / steps);
        }
        ctx._at = [x, y];
      },
      quadraticCurveTo(cx, cy, x, y) {
        const from = ctx._at ?? [cx, cy];
        const steps = Math.max(
          2,
          Math.ceil((Math.hypot(cx - from[0], cy - from[1]) + Math.hypot(x - cx, y - cy)) * Math.max(1, tx.a)),
        );
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          ctx._dot(
            u * u * from[0] + 2 * u * t * cx + t * t * x,
            u * u * from[1] + 2 * u * t * cy + t * t * y,
          );
        }
        ctx._at = [x, y];
      },
      stroke() { /* points were already committed by lineTo */ },
      getImageData(x, y, w, h) {
        return { data: ctx._ensure(), width: w, height: h };
      },
    };
    return ctx;
  };
  return c;
}

// A short handwritten squiggle, as the ink pad would record it.
const SAMPLE_INK = {
  w: 300,
  h: 120,
  strokes: [
    [10, 60, 30, 20, 50, 80, 70, 25, 90, 70],
    [110, 30, 140, 30, 140, 80, 110, 80],
  ],
};

async function main() {
  // ------------------------------------------------------------ compile the browser print code
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  fs.rmSync(BUILD, { recursive: true, force: true });
  execFileSync(process.execPath, [
    tsc,
    'client/src/print/raster.ts', 'client/src/print/escpos.ts',
    '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019',
    '--strict', '--skipLibCheck', '--lib', 'es2019,dom',
  ], { cwd: ROOT, stdio: 'inherit' });

  const shared = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));

  // raster.ts reaches for `document` when called, so the fake only has to exist by then.
  global.document = { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };
  const { rasterize } = require(path.join(BUILD, 'raster.js'));
  const { rasterToEscPos } = require(path.join(BUILD, 'escpos.js'));

  // ------------------------------------------------------------ the bill from the paper slip
  const LINES = [
    { itemId: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil', qty: 5, rate: 110 },
    { itemId: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', qty: 5, rate: 123 },
    { itemId: 'ot', nameKn: 'OT', nameEn: 'OT', qty: 1, rate: 50 },
    { itemId: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', qty: 1, rate: 155 },
  ];
  const BILL = {
    no: 42, at: '2026-09-03T09:06:00', lines: LINES, total: shared.billTotal(LINES),
    paid: 1370, balance: 0, showBalance: false,
  };
  const SETTINGS = {
    shopName: 'Shridhar Kirani Stores', footer: 'Thank you, Visit again!',
    showRate: false, inactiveAfterDays: 30,
  };

  console.log('\nMoney and totals');
  eq('line amount 5 x 110', shared.lineAmount(5, 110), 550);
  eq('line amount 5 x 123', shared.lineAmount(5, 123), 615);
  eq('bill total matches the paper slip', BILL.total, 1370);
  eq('whole rupees print without decimals', shared.money(1370), '1370');
  eq('paise print with two decimals', shared.money(1370.5), '1370.50');
  eq('weighed quantity survives', shared.lineAmount(1.5, 62), 93);
  // 0.1 + 0.2 style drift is what makes a printed total disagree with the sum of its lines.
  eq('rounding does not drift', shared.money(shared.billTotal([
    { itemId: 'a', nameKn: 'a', nameEn: 'a', qty: 3, rate: 0.1 },
    { itemId: 'b', nameKn: 'b', nameEn: 'b', qty: 3, rate: 0.2 },
  ])), '0.90');

  console.log('\nReceipt document');
  const receipt = shared.buildReceipt(BILL, SETTINGS);
  eq('paper is 384 dots wide', receipt.width, 384);
  // The first `item` row is the column headings, which ride on the same row type so that all
  // four renderers draw them without a line of new code each. Everything below is about the
  // lines themselves, so it is dropped first.
  const headRow = receipt.rows.filter((r) => r.t === 'item')[0];
  eq('the columns are named', [headRow.no, headRow.name, headRow.amount].join('|'), 'No.|Item|Price');
  check('the headings sit above the first line',
    receipt.rows.indexOf(headRow) < receipt.rows.findIndex((r) => r.t === 'ink' || (r.t === 'item' && r !== headRow)));
  const itemRows = receipt.rows.filter((r) => r.t === 'item').slice(1);
  eq('one row per line', itemRows.length, 4);
  eq('first row prints the Kannada name', itemRows[0].name, 'ಗಾಣದ ಎಣ್ಣೆ');
  eq('first row amount is the line total', itemRows[0].amount, '550');
  // The left column is the line's place on the slip, not its quantity: quantity is part of what
  // the shopkeeper writes by hand, so a column of ones told nobody anything.
  eq('the first line is numbered 1', itemRows[0].no, '1');
  eq('the third line is numbered 3', itemRows[2].no, '3');
  check('the numbering runs 1..n in order',
    itemRows.every((r, i) => r.no === String(i + 1)), itemRows.map((r) => r.no).join(','));
  check('no rate note when showRate is off', itemRows.every((r) => r.note === undefined));
  const totalRow = receipt.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL');
  eq('total row reads 1370', totalRow && totalRow.right, '1370');
  eq('date is day-first', shared.stamp('2026-09-03T09:06:00'), '03/09/26 9:06 am');
  eq('and a bare date drops the clock', shared.dateStamp('2026-09-03T09:06:00'), '03/09/26');
  eq('noon does not print as 0:00', shared.stamp('2026-09-03T12:30:00'), '03/09/26 12:30 pm');
  eq('midnight prints as 12 am', shared.stamp('2026-09-03T00:05:00'), '03/09/26 12:05 am');
  eq('showRate adds the per-unit note',
    shared.buildReceipt(BILL, { ...SETTINGS, showRate: true }).rows.filter((r) => r.t === 'item')[1].note, '@ 110');
  check('no balance lines unless asked', !receipt.rows.some((r) => r.t === 'kv' && r.left === 'Balance'));
  check('no customer lines without a customer', !receipt.rows.some((r) => r.t === 'kv' && r.left === 'Name'));

  console.log('\nReceipt document: customer, balance, handwriting');
  const rich = shared.buildReceipt(
    {
      ...BILL,
      customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
      lines: [
        ...LINES,
        { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 },
        { itemId: 'bare-1', nameKn: '', nameEn: '', qty: 1, rate: 12 },
      ],
      total: 1422,
      paid: 1000,
      balance: 422,
      showBalance: true,
    },
    SETTINGS,
  );
  const nameRow = rich.rows.find((r) => r.t === 'kv' && r.left === 'Name');
  const phoneRow = rich.rows.find((r) => r.t === 'kv' && r.left === 'Phone');
  eq('customer name prints at the top', nameRow && nameRow.right, 'Ramesh');
  eq('customer contact number prints', phoneRow && phoneRow.right, '9886012345');
  check('the customer block sits above the items',
    rich.rows.indexOf(nameRow) < rich.rows.findIndex((r) => r.t === 'item'));
  eq('a handwritten line becomes an ink row', rich.rows.filter((r) => r.t === 'ink').length, 1);
  const inkRow = rich.rows.find((r) => r.t === 'ink');
  eq('the ink row carries the price', inkRow && inkRow.amount, '40');
  eq('a line with no description still prints its price',
    rich.rows.filter((r) => r.t === 'item' && r.name === '').length, 1);
  const paidRow = rich.rows.find((r) => r.t === 'kv' && r.left === 'Paid');
  const balanceRow = rich.rows.find((r) => r.t === 'kv' && r.left === 'Balance');
  eq('paid prints when the balance is shown', paidRow && paidRow.right, '1000');
  eq('balance prints when the balance is shown', balanceRow && balanceRow.right, '422');

  console.log('\nReceipt document: which script it speaks');
  const KN_SET = {
    ...SETTINGS,
    shopNameKn: 'ಶ್ರೀಧರ ಕಿರಾಣಿ',
    footerKn: 'ಧನ್ಯವಾದಗಳು',
  };
  const knBill = {
    ...BILL,
    customer: {
      id: 'p9886012345', name: 'Ramesh', nameKn: 'ರಮೇಶ್', phone: '9886012345',
    },
  };

  const inKn = shared.buildReceipt(knBill, { ...KN_SET, language: 'kn' }, shared.receiptLabelsFor('kn'));
  const knHead = inKn.rows.find((r) => r.t === 'center');
  eq('a Kannada slip carries the Kannada shop name', knHead && knHead.text, KN_SET.shopNameKn);
  const knName = inKn.rows.find((r) => r.t === 'kv' && r.left === 'ಹೆಸರು');
  eq('and the customer in Kannada', knName && knName.right, knBill.customer.nameKn);
  check('and the Kannada footer',
    inKn.rows.some((r) => r.t === 'center' && r.text === KN_SET.footerKn));

  // Switching back has to bring the English ones with it.
  const inEn = shared.buildReceipt(knBill, { ...KN_SET, language: 'en' });
  const enHead = inEn.rows.find((r) => r.t === 'center');
  eq('an English slip carries the English shop name', enHead && enHead.text, SETTINGS.shopName);
  const enName = inEn.rows.find((r) => r.t === 'kv' && r.left === 'Name');
  eq('and the customer in English', enName && enName.right, 'Ramesh');

  // A shop that has not typed the Kannada names yet must not get blank lines.
  const noKn = shared.buildReceipt(
    { ...BILL, customer: { id: 'p1', name: 'Ramesh', phone: '9886012345' } },
    { ...SETTINGS, language: 'kn' },
    shared.receiptLabelsFor('kn'),
  );
  const fellBack = noKn.rows.find((r) => r.t === 'center');
  eq('with no Kannada shop name the English one stands', fellBack && fellBack.text, SETTINGS.shopName);
  const fellBackName = noKn.rows.find((r) => r.t === 'kv' && r.left === 'ಹೆಸರು');
  eq('and so does the English customer name', fellBackName && fellBackName.right, 'Ramesh');

  // And a customer who only ever had the Kannada box shows in English mode too.
  const knOnly = shared.buildReceipt(
    { ...BILL, customer: { id: 'p1', name: '', nameKn: 'ರಮೇಶ್', phone: '9886012345' } },
    SETTINGS,
  );
  const knOnlyRow = knOnly.rows.find((r) => r.t === 'kv' && r.left === 'Name');
  eq('a Kannada-only customer is never blank', knOnlyRow && knOnlyRow.right, 'ರಮೇಶ್');

  console.log('\nReceipt document: the GST number');
  const withGst = shared.buildReceipt(BILL, { ...SETTINGS, gstin: '29ABCDE1234F1Z5' });
  const gstRow = withGst.rows.find((r) => r.t === 'center' && String(r.text).includes('GSTIN'));
  check('the GST number prints when the shop has one', gstRow != null,
    JSON.stringify(withGst.rows.slice(0, 4)));
  eq('labelled and spelled out', gstRow && gstRow.text, 'GSTIN 29ABCDE1234F1Z5');
  // Under the shop name, where a customer and an inspector both look.
  const shopRow = withGst.rows.findIndex((r) => r.t === 'center' && r.text === SETTINGS.shopName);
  check('directly under the shop name', withGst.rows.indexOf(gstRow) === shopRow + 1);
  check('and above the bill number',
    withGst.rows.indexOf(gstRow) < withGst.rows.findIndex((r) => r.t === 'kv' && String(r.left).startsWith('Bill')));
  check('a shop with no GST number gets no line',
    !shared.buildReceipt(BILL, { ...SETTINGS, gstin: '' }).rows
      .some((r) => r.t === 'center' && String(r.text).includes('GSTIN')));
  check('nor does one with only spaces in the box',
    !shared.buildReceipt(BILL, { ...SETTINGS, gstin: '   ' }).rows
      .some((r) => r.t === 'center' && String(r.text).includes('GSTIN')));
  check('an older settings record without the field still prints',
    shared.buildReceipt(BILL, SETTINGS).rows.length > 0);

  // The switch the shop asked for: a number held in the settings, but not on every slip.
  const hasGstRow = (settings) => shared.buildReceipt(BILL, { ...SETTINGS, ...settings }).rows
    .some((r) => r.t === 'center' && String(r.text).includes('GSTIN'));
  check('the switch off keeps the number off the slip',
    !hasGstRow({ gstin: '29ABCDE1234F1Z5', showGstin: false }));
  check('and the switch on puts it back',
    hasGstRow({ gstin: '29ABCDE1234F1Z5', showGstin: true }));
  // Absent means yes: a shop that had entered its number was already printing it, and an update
  // must not quietly stop.
  check('settings saved before the switch existed still print it',
    hasGstRow({ gstin: '29ABCDE1234F1Z5' }));
  check('the switch on with nothing to print prints nothing',
    !hasGstRow({ gstin: '', showGstin: true }));
  const knGst = shared.buildReceipt(
    BILL, { ...SETTINGS, language: 'kn', gstin: '29ABCDE1234F1Z5' }, shared.receiptLabelsFor('kn'),
  );
  check('the label is Kannada on a Kannada slip',
    knGst.rows.some((r) => r.t === 'center' && String(r.text).includes('29ABCDE1234F1Z5')
      && /[ಀ-೿]/.test(String(r.text))));

  console.log('\nReceipt document: what they already owed');
  const carriedBill = {
    ...BILL,
    customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
    paid: 1000,
    previousBalance: 500,
    previousBalanceAt: '2026-08-02T10:00:00',
    balance: 870,
    showBalance: true,
  };
  const carried = shared.buildReceipt(carriedBill, SETTINGS);
  const carriedRows = carried.rows.filter((r) => r.t === 'item').slice(1);
  eq('it prints as a line of the table', carriedRows.length, 5);
  const oldRow = carriedRows[carriedRows.length - 1];
  eq('numbered on from the written lines', oldRow.no, '5');
  eq('it carries the amount', oldRow.amount, '500');
  check('it says what it is and when', oldRow.name === 'Old bal. 02/08/26', oldRow.name);
  const cTotal = carried.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL');
  eq('the printed total counts it', cTotal && cTotal.right, '1870');
  // The whole point of the change. Before it, a slip could read TOTAL 1370, Paid 1000,
  // Balance 870 -- three numbers a customer had no way to reconcile on the page.
  const cPaid = carried.rows.find((r) => r.t === 'kv' && r.left === 'Paid');
  const cBal = carried.rows.find((r) => r.t === 'kv' && r.left === 'Balance');
  check('total less paid is the balance, on the paper',
    Number(cTotal.right) - Number(cPaid.right) === Number(cBal.right),
    cTotal.right + ' - ' + cPaid.right + ' != ' + cBal.right);
  eq("the shop's own figure for the bill is untouched", carriedBill.total, 1370);

  const undated = shared.buildReceipt({ ...carriedBill, previousBalanceAt: null }, SETTINGS);
  eq('with no date it prints the label alone',
    undated.rows.filter((r) => r.t === 'item').slice(-1)[0].name, 'Old bal.');
  const quiet = shared.buildReceipt({ ...carriedBill, showBalance: false }, SETTINGS);
  check('nothing is carried when the balance is not printed',
    !quiet.rows.some((r) => r.t === 'item' && String(r.name).startsWith('Old bal.')));
  eq("and the total is the day's lines again",
    quiet.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL').right, '1370');
  const credit = shared.buildReceipt({ ...carriedBill, previousBalance: -200 }, SETTINGS);
  check('a customer in credit gets no line',
    !credit.rows.some((r) => r.t === 'item' && String(r.name).startsWith('Old bal.')));
  eq('and no reduced total either',
    credit.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL').right, '1370');
  const none = shared.buildReceipt({ ...carriedBill, previousBalance: undefined }, SETTINGS);
  eq('an older bill with no such field still prints',
    none.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL').right, '1370');

  // The bill screen shows this same figure above its TOTAL, from this same function. Two copies
  // of the rule is exactly how the glass and the paper come to disagree about what is owed.
  eq('carried: the balance when it is being printed', shared.carriedBalance(true, 500), 500);
  eq('carried: nothing when it is not', shared.carriedBalance(false, 500), 0);
  eq('carried: nothing for a customer in credit', shared.carriedBalance(true, -200), 0);
  eq('carried: nothing when there is no figure', shared.carriedBalance(true, undefined), 0);
  eq('carried: nor when it is null', shared.carriedBalance(true, null), 0);
  eq('carried: rounded to paise', shared.carriedBalance(true, 12.345), 12.35);
  // The property that ties the two together: what the slip prints as TOTAL is exactly what the
  // footer computes as cartTotal + carriedBalance(...).
  const screenTotal = Math.round((carriedBill.total + shared.carriedBalance(true, 500)) * 100) / 100;
  eq('the screen and the slip reach the same total',
    carried.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL').right, shared.money(screenTotal));
  // And paying that figure settles the account exactly.
  eq('paying it in full leaves nothing owed',
    Math.round((500 + carriedBill.total - screenTotal) * 100) / 100, 0);

  console.log('\nHandwriting geometry');
  const bounds = shared.inkBounds(SAMPLE_INK);
  eq('bounds trim to what was written', bounds.minX + ',' + bounds.minY, '10,20');
  eq('bounds find the far corner', bounds.maxX + ',' + bounds.maxY, '140,80');
  const fit = shared.inkFit(SAMPLE_INK, shared.inkMaxWidth(384), shared.INK_ROW_HEIGHT);
  check('handwriting is scaled to the row height', Math.abs(fit.h - shared.INK_ROW_HEIGHT) < 0.001, 'h ' + fit.h);
  check('handwriting stays inside the column', fit.w <= shared.inkMaxWidth(384) + 0.001, 'w ' + fit.w);
  const wide = shared.inkFit({ w: 1000, h: 20, strokes: [[0, 0, 1000, 10]] }, shared.inkMaxWidth(384), shared.INK_ROW_HEIGHT);
  check('very wide handwriting is capped by width, not height', wide.w <= shared.inkMaxWidth(384) + 0.001, 'w ' + wide.w);
  eq('a single tap still yields a path', shared.inkToSvgPath({ w: 10, h: 10, strokes: [[5, 5]] }), 'M5 5 l0.01 0');
  eq('point count adds up', shared.inkPointCount(SAMPLE_INK), 9);
  check('a bare price counts as price-only',
    shared.isPriceOnly({ itemId: 'x', nameKn: '', nameEn: '', qty: 1, rate: 10 }));
  check('a handwritten line is not price-only',
    !shared.isPriceOnly({ itemId: 'x', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 10 }));

  console.log('');
  console.log('');
  console.log('Paper profiles (58mm and 80mm)');
  eq('58mm prints 384 dots', shared.PAPERS['58mm'].dots, 384);
  eq('80mm prints 576 dots', shared.PAPERS['80mm'].dots, 576);
  eq('a 58mm receipt is laid out at 384', shared.buildReceipt(BILL, SETTINGS).width, 384);
  eq('an 80mm receipt is laid out at 576',
    shared.buildReceipt(BILL, { ...SETTINGS, paper: '80mm' }).width, 576);
  eq('an unknown paper falls back to 58mm', shared.paperProfile('99mm').dots, 384);
  eq('a missing paper falls back to 58mm', shared.paperProfile(undefined).dots, 384);
  check('the wider roll gives handwriting more room',
    shared.inkMaxWidth(576) > shared.inkMaxWidth(384),
    shared.inkMaxWidth(576) + ' vs ' + shared.inkMaxWidth(384));
  check('the ink cap always leaves room for the price columns',
    shared.inkMaxWidth(384) < 384 && shared.inkMaxWidth(576) < 576);
  // The physical dot size is the same on both, which is why text is not rescaled.
  const mmPerDot58 = shared.PAPERS['58mm'].printableMm / shared.PAPERS['58mm'].dots;
  const mmPerDot80 = shared.PAPERS['80mm'].printableMm / shared.PAPERS['80mm'].dots;
  check('both rolls are the same dpi', Math.abs(mmPerDot58 - mmPerDot80) < 0.0001,
    mmPerDot58 + ' vs ' + mmPerDot80);

  console.log('Typing Kannada without a Kannada keyboard');
  eq('akki', shared.latinToKannada('akki'), 'ಅಕ್ಕಿ');
  eq('sakkare', shared.latinToKannada('sakkare'), 'ಸಕ್ಕರೆ');
  eq('eNNe (retroflex from a capital)', shared.latinToKannada('eNNe'), 'ಎಣ್ಣೆ');
  eq('uppu', shared.latinToKannada('uppu'), 'ಉಪ್ಪು');
  eq('bella', shared.latinToKannada('bella'), 'ಬೆಲ್ಲ');
  eq('haalu (long vowel from a doubled letter)', shared.latinToKannada('haalu'), 'ಹಾಲು');
  eq('hiTTu', shared.latinToKannada('hiTTu'), 'ಹಿಟ್ಟು');
  eq('beLe (the other l)', shared.latinToKannada('beLe'), 'ಬೆಳೆ');
  eq('anusvara from M', shared.latinToKannada('naMdi'), 'ನಂದಿ');
  eq('a long vowel needs the doubled form', shared.latinToKannada('gOdhi hiTTu'), 'ಗೋಧಿ ಹಿಟ್ಟು');
  eq('digits and spaces pass through', shared.latinToKannada('5 kg'), '5 ಕ್ಗ್');
  eq('text that is already Kannada is left alone', shared.latinToKannada('ಅಕ್ಕಿ'), 'ಅಕ್ಕಿ');
  eq('an empty string stays empty', shared.latinToKannada(''), '');
  check('Kannada is detected', shared.hasKannada('1kg ಅಕ್ಕಿ'));
  check('plain English is not', !shared.hasKannada('1kg rice'));

  console.log('\nCanvas renderer (fake canvas)');
  const raster = rasterize(receipt);
  eq('raster is 384 dots wide', raster.width, 384);
  check('raster is a plausible height', raster.height > 200 && raster.height < 1200, 'height ' + raster.height);
  const bytesPerRow = Math.ceil(raster.width / 8);
  eq('one bit per dot, packed by row', raster.bits.length, bytesPerRow * raster.height);
  const countDots = (bits) => {
    let n = 0;
    for (const byte of bits) for (let b = 0; b < 8; b++) if (byte & (1 << b)) n++;
    return n;
  };
  const black = countDots(raster.bits);
  check('the receipt is not blank', black > 500, black + ' black dots');
  check('the receipt is not all black', black < raster.bits.length * 8 * 0.6, black + ' black dots');

  const withInk = rasterize(rich);
  check('handwriting makes the slip longer', withInk.height > raster.height,
    withInk.height + ' vs ' + raster.height);
  const inkOnly = rasterize({ width: 384, rows: [{ t: 'ink', qty: '1', ink: SAMPLE_INK, amount: '40' }] });
  check('an ink row draws dots of its own', countDots(inkOnly.bits) > 40, countDots(inkOnly.bits) + ' dots');
  check('an ink row is about one row tall',
    inkOnly.height >= shared.INK_ROW_HEIGHT && inkOnly.height < shared.INK_ROW_HEIGHT * 2,
    'height ' + inkOnly.height);

  const wideRaster = rasterize(shared.buildReceipt(BILL, { ...SETTINGS, paper: '80mm' }));
  eq('an 80mm raster is 576 dots wide', wideRaster.width, 576);
  eq('and packs 72 bytes per row', wideRaster.bits.length / wideRaster.height, 72);
  const wideBytes = rasterToEscPos(wideRaster);
  eq('its ESC/POS header declares 72 bytes per row', wideBytes[9], 72);

  const wrapped = rasterize({
    width: 384,
    rows: [{ t: 'item', qty: '1', name: 'Extra long product name that cannot possibly fit on one line', amount: '12345' }],
  });
  check('a long item name wraps to more rows', wrapped.height > 60, 'height ' + wrapped.height);
  // A zero-height raster is rejected by the printer, so an empty document must still have one row.
  check('an empty receipt still has height', rasterize({ width: 384, rows: [] }).height >= 1);

  console.log('\nESC/POS framing');
  const bytes = rasterToEscPos(raster);
  eq('starts with ESC @ (initialise)', bytes[0] + ',' + bytes[1], '27,64');
  const bands = Math.ceil(raster.height / 64);
  let found = 0;
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) found++;
  }
  eq('one GS v 0 command per 64-row band', found, bands);
  eq('the 58mm header declares 48 bytes per row', bytes[9], 48);
  eq('total length is header + bands + dots', bytes.length, 2 + 3 + bands * 8 + raster.bits.length + 3);
  eq('ends by feeding the paper out', bytes[bytes.length - 3] + ',' + bytes[bytes.length - 2], '27,100');

  // ------------------------------------------------------------ the API, against the JSON store
  console.log('\nAPI (JSON store, no MongoDB needed)');
  fs.mkdirSync(DATA, { recursive: true });
  // Pre-seed one customer who last came in 90 days ago, so the quiet-customer list has something
  // real to find. Items are left empty so the normal seeding still runs.
  const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(DATA, 'db.json'), JSON.stringify({
    items: [], bills: [], billNo: 0,
    customers: [{
      id: 'p9000000001', name: 'Old Regular', phone: '9000000001',
      since: longAgo, totalBilled: 500, totalPaid: 500, billCount: 3, lastVisit: longAgo,
    }],
  }), 'utf8');

  const server = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env,
        PORT: String(PORT), DATA_DIR: DATA, AUTH_PIN: PIN,
        MONGO_URI: '', JWT_SECRET: 'selftest-secret', NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });

  const base = 'http://127.0.0.1:' + PORT;
  const call = async (p, init) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, body };
  };

  try {
    // 90 seconds, not 24: the first run after a clean `npm ci` has no tsx compile cache, and a
    // cold Windows box can spend most of a minute on it. Failing there says "server broken" when
    // the truth is "server slow", which is a worse lie than waiting.
    let up = false;
    const startedAt = Date.now();
    for (let i = 0; i < 180 && !up; i++) {
      await sleep(500);
      try {
        const res = await fetch(base + '/api/health');
        up = res.status === 200 || res.status === 401;
      } catch { /* not listening yet */ }
    }
    check('server started', up, up ? '' : 'gave up after ' + Math.round((Date.now() - startedAt) / 1000) + 's; last output: ' + serverLog.slice(-500));
    if (!up) return;

    eq('health needs no token', (await call('/api/health')).status, 200);
    eq('bills are behind auth', (await call('/api/bills')).status, 401);
    eq('customers are behind auth', (await call('/api/customers')).status, 401);
    const wrongPin = await call('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: 'nope' }),
    });
    eq('a wrong PIN is refused', wrongPin.status, 401);
    // The browser shows this message as-is, so it has to say the PIN is wrong rather than
    // anything about sessions.
    check('and the reason names the PIN', /pin/i.test(wrongPin.body.error), wrongPin.body.error);

    const login = await call('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }),
    });
    eq('the right PIN issues a token', login.status, 200);
    const auth = { authorization: 'Bearer ' + login.body.token, 'content-type': 'application/json' };
    const post = (p, body) => call(p, { method: 'POST', headers: auth, body: JSON.stringify(body) });

    console.log('\nAPI: bills, totals and validation');
    // The server owns the total. A browser that sends a wrong one must not be able to record it.
    const made = await post('/api/bills', { lines: LINES, total: 999999 });
    eq('a bill is created', made.status, 201);
    eq('the server recomputes the total, ignoring the one sent', made.body.total, 1370);
    eq('the first bill is number 1', made.body.no, 1);
    eq('a bill with no customer is fully paid', made.body.paid, 1370);
    eq('and carries no balance', made.body.balance, 0);
    eq('and does not print balance lines', made.body.showBalance, false);

    eq('bill numbers increment', (await post('/api/bills', { lines: LINES })).body.no, 2);
    eq('an empty bill is rejected', (await post('/api/bills', { lines: [] })).status, 400);
    eq('a negative quantity is rejected', (await post('/api/bills', { lines: [{ ...LINES[0], qty: -5 }] })).status, 400);
    eq('a non-numeric rate is rejected', (await post('/api/bills', { lines: [{ ...LINES[0], rate: 'free' }] })).status, 400);

    // "Sometimes it should calculate the total of price entered without items."
    const bare = await post('/api/bills', {
      lines: [{ itemId: 'bare-1', qty: 1, rate: 30 }, { itemId: 'bare-2', qty: 2, rate: 15 }],
    });
    eq('a bill of bare prices is accepted', bare.status, 201);
    eq('and totals correctly', bare.body.total, 60);
    check('and keeps its lines nameless', bare.body.lines.every((l) => l.nameKn === '' && l.nameEn === ''));

    console.log('\nAPI: handwriting');
    const inked = await post('/api/bills', {
      lines: [{ itemId: 'ink-1', qty: 1, rate: 40, ink: SAMPLE_INK }],
    });
    eq('a handwritten line is accepted', inked.status, 201);
    eq('the strokes come back intact', JSON.stringify(inked.body.lines[0].ink.strokes), JSON.stringify(SAMPLE_INK.strokes));
    eq('an odd number of coordinates is rejected', (await post('/api/bills', {
      lines: [{ itemId: 'ink-2', qty: 1, rate: 40, ink: { w: 10, h: 10, strokes: [[1, 2, 3]] } }],
    })).status, 400);
    eq('a stroke longer than the cap is rejected', (await post('/api/bills', {
      lines: [{ itemId: 'ink-3', qty: 1, rate: 40, ink: { w: 10, h: 10, strokes: [new Array(2000).fill(1)] } }],
    })).status, 400);
    eq('too many strokes on one line is rejected', (await post('/api/bills', {
      lines: [{
        itemId: 'ink-4', qty: 1, rate: 40,
        ink: { w: 10, h: 10, strokes: new Array(shared.INK_LIMITS.maxStrokes + 1).fill([1, 2]) },
      }],
    })).status, 400);

    console.log('\nAPI: customers');
    const created = await post('/api/customers', { name: 'Ramesh', phone: '98860 12345' });
    eq('a customer is created', created.status, 201);
    eq('the phone number is stored as digits', created.body.phone, '9886012345');
    eq('the id is derived from the number', created.body.id, 'p9886012345');
    eq('a new customer starts settled', created.body.balance, 0);

    const again = await post('/api/customers', { name: 'Ramesh Kumar', phone: '9886012345' });
    eq('the same number is the same person, not a second record', again.body.id, created.body.id);
    eq('and their name is updated', again.body.name, 'Ramesh Kumar');
    eq('a customer with neither name nor number is rejected', (await post('/api/customers', {})).status, 400);

    // The same person written with a country code must land on the existing record.
    const withCode = await post('/api/customers', { name: 'Ramesh Kumar', phone: '+91 98860 12345' });
    eq('a country-code form is the same customer, not a new one', withCode.body.id, created.body.id);
    eq('and their number stays canonical', withCode.body.phone, '9886012345');
    const trunkZero = await post('/api/customers', { name: 'Ramesh Kumar', phone: '09886012345' });
    eq('a trunk-zero form is the same customer too', trunkZero.body.id, created.body.id);
    const allCustomers = await call('/api/customers', { headers: auth });
    eq('so only one record exists for that number',
      allCustomers.body.filter((c) => c.phone === '9886012345').length, 1);

    const byName = await call('/api/customers/search?q=Rame', { headers: auth });
    check('suggestions match on a name prefix', byName.body.some((c) => c.id === created.body.id));
    const byPhone = await call('/api/customers/search?q=98860', { headers: auth });
    check('suggestions match on a number prefix', byPhone.body.some((c) => c.id === created.body.id));
    eq('an empty query suggests nothing', (await call('/api/customers/search?q=', { headers: auth })).body.length, 0);
    /*
     * Typed in English, found whatever script the name is in. The shop types at a counter and
     * the names already in the book are Kannada; the name itself is never rewritten, only
     * matched. Driven through the real endpoint because the matching moved into the store.
     */
    const knName = 'ರಮೇಶ್ ಗೌಡ';
    const knCust = await post('/api/customers', { name: knName, phone: '9000000123' });
    // A customer entered on a Kannada keypad, in the box of its own.
    const twoNames = await post('/api/customers', {
      name: 'Suresh Kumar', nameKn: 'ಸುರೇಶ್', phone: '9000000124',
    });
    eq('a customer keeps both names', twoNames.body.nameKn, 'ಸುರೇಶ್');
    eq('and the English one too', twoNames.body.name, 'Suresh Kumar');
    const knFound = await call('/api/customers/search?q=suresh', { headers: auth });
    check('and is found by either', knFound.body.some((c) => c.id === twoNames.body.id));
    const knBillSaved = await post('/api/bills', {
      lines: [{ itemId: 'k', qty: 1, rate: 20 }], customerId: twoNames.body.id,
    });
    eq('a bill freezes the Kannada name with the rest',
      knBillSaved.body.customer.nameKn, 'ಸುರೇಶ್');
    /*
     * An edit must not quietly erase a name it was not asked to touch.
     *
     * The apps were sending only {name, phone} when editing, and the body schema's
     * `nameKn: default('')` turned that omission into an empty string -- so changing a phone
     * number wiped the Kannada name the shopkeeper had typed on the keypad. It reached the shop.
     */
    /*
     * The tick that says an item was handed over, and the two new things about a customer.
     *
     * The tick has to reach the saved bill: a reprint months later should show what the customer
     * actually went home with, not just what was listed.
     */
    const ticked = await post('/api/bills', {
      lines: [
        { itemId: 't1', nameKn: 'Sugar 2kg', qty: 1, rate: 90, given: true },
        { itemId: 't2', nameKn: 'Rice 5kg', qty: 1, rate: 100 },
      ],
    });
    eq('a ticked line is saved as ticked', ticked.body.lines[0].given, true);
    eq('and an unticked one as not', ticked.body.lines[1].given, false);
    const reread = await call('/api/bills/' + ticked.body.no, { headers: auth });
    eq('which survives a reread', reread.body.lines[0].given, true);

    // The mark is composed into the name in buildReceipt, so all four renderers get it from one
    // string and cannot disagree about it.
    const tickedDoc = shared.buildReceipt(reread.body, { ...SETTINGS });
    const tickedRow = tickedDoc.rows.find((r) => r.t === 'item' && String(r.name).includes('Sugar'));
    const plainRow = tickedDoc.rows.find((r) => r.t === 'item' && String(r.name).includes('Rice'));
    check('the slip marks the item that was given',
      tickedRow && tickedRow.name.startsWith(shared.GIVEN_MARK), JSON.stringify(tickedRow));
    check('and leaves the one that was only listed alone',
      plainRow && !plainRow.name.startsWith(shared.GIVEN_MARK), JSON.stringify(plainRow));

    const withDetails = await post('/api/customers', {
      name: 'Delivery Person', phone: '9000000456',
      address: '2nd Cross, Gandhi Bazaar, Bengaluru 560004',
      notes: 'Rings the bell twice. Prefers evening delivery.',
    });
    eq('an address is kept', withDetails.body.address, '2nd Cross, Gandhi Bazaar, Bengaluru 560004');
    eq('and a note with it', withDetails.body.notes, 'Rings the bell twice. Prefers evening delivery.');
    // The bug that cost the shop its Kannada names: an edit must not clear what it never mentioned.
    const phoneOnly = await call('/api/customers/' + withDetails.body.id, {
      method: 'PUT', headers: auth, body: JSON.stringify({ phone: '9000000457' }),
    });
    eq('an edit elsewhere leaves the address alone', phoneOnly.body.address, '2nd Cross, Gandhi Bazaar, Bengaluru 560004');
    eq('and the note too', phoneOnly.body.notes, 'Rings the bell twice. Prefers evening delivery.');

    const editPhone = await call('/api/customers/' + twoNames.body.id, {
      method: 'PUT', headers: auth,
      body: JSON.stringify({ name: 'Suresh Kumar', phone: '9000000126' }),
    });
    eq('the phone number changes', editPhone.body.phone, '9000000126');
    eq('and a name the edit never mentioned survives it', editPhone.body.nameKn, 'ಸುರೇಶ್');
    const editKn = await call('/api/customers/' + twoNames.body.id, {
      method: 'PUT', headers: auth, body: JSON.stringify({ nameKn: 'ಸುರೇಶ ಕುಮಾರ' }),
    });
    eq('the Kannada name can be edited on its own', editKn.body.nameKn, 'ಸುರೇಶ ಕುಮಾರ');
    eq('and the English one is left where it was', editKn.body.name, 'Suresh Kumar');
    const clearKn = await call('/api/customers/' + twoNames.body.id, {
      method: 'PUT', headers: auth, body: JSON.stringify({ nameKn: '' }),
    });
    eq('an empty one sent on purpose does clear it', clearKn.body.nameKn, '');
    eq('but the English name still stands', clearKn.body.name, 'Suresh Kumar');
    const editedBill = await post('/api/bills', {
      lines: [{ itemId: 'k2', qty: 1, rate: 20 }], customerId: twoNames.body.id,
    });
    eq('and a later bill freezes what is stored now', editedBill.body.customer.nameKn, '');
    // Put back, so the checks below read the name they were written against.
    await call('/api/customers/' + twoNames.body.id, {
      method: 'PUT', headers: auth, body: JSON.stringify({ nameKn: 'ಸುರೇಶ್' }),
    });
    eq('a customer stripped of every name is refused',
      (await call('/api/customers/' + twoNames.body.id, {
        method: 'PUT', headers: auth, body: JSON.stringify({ name: '', nameKn: '', phone: '' }),
      })).status, 400);

    // Created, not updated: this endpoint answers 201.
    eq('a customer with only a Kannada name can be created',
      (await post('/api/customers', { nameKn: 'ಗೌಡ', phone: '9000000125' })).status, 201);
    eq('but nothing at all is still refused',
      (await post('/api/customers', { name: '', nameKn: '', phone: '' })).status, 400);
    eq('a Kannada name is stored as it was typed', knCust.body.name, knName);
    const byEnglish = await call('/api/customers/search?q=ramesh', { headers: auth });
    check('typing English finds a customer stored in Kannada',
      byEnglish.body.some((c) => c.id === knCust.body.id),
      JSON.stringify(byEnglish.body.map((c) => c.name)));
    check('and their name comes back in Kannada',
      byEnglish.body.every((c) => c.id !== knCust.body.id || c.name === knName));
    const byPrefix = await call('/api/customers/search?q=rame', { headers: auth });
    check('a prefix is enough', byPrefix.body.some((c) => c.id === knCust.body.id));
    const wrongName = await call('/api/customers/search?q=suresh', { headers: auth });
    check('a different name does not find them',
      !wrongName.body.some((c) => c.id === knCust.body.id));

    // A customer called "R." must not be read as a regular expression.
    eq('a regex-looking query is treated as text', (await call('/api/customers/search?q=' + encodeURIComponent('.*'), { headers: auth })).body.length, 0);

    console.log('\nAPI: balances');
    const partly = await post('/api/bills', {
      lines: LINES, customerId: created.body.id, paid: 1000, showBalance: true,
    });
    eq('a bill can be part paid', partly.body.paid, 1000);
    eq('the balance is what is still owed', partly.body.balance, 370);
    eq('the balance lines are switched on', partly.body.showBalance, true);
    eq('the customer is copied onto the bill', partly.body.customer.name, 'Ramesh Kumar');

    const second = await post('/api/bills', { lines: [{ itemId: 'x', qty: 1, rate: 200 }], customerId: created.body.id, paid: 0 });
    eq('an unpaid bill adds to the balance', second.body.balance, 570);

    const detail = await call('/api/customers/' + created.body.id, { headers: auth });
    eq('the customer total transaction figure adds up', detail.body.customer.totalBilled, 1570);
    eq('so does what they have paid', detail.body.customer.totalPaid, 1000);
    eq('and the outstanding balance', detail.body.customer.balance, 570);
    eq('their bill count is right', detail.body.customer.billCount, 2);
    check('their last visit is recorded', typeof detail.body.customer.lastVisit === 'string');
    eq('their bills come back with them', detail.body.bills.length, 2);
    check('and only their bills', detail.body.bills.every((b) => b.customer && b.customer.id === created.body.id));

    // What each bill carried in from the one before it. `previousBalance` is a copy of a figure
    // already recorded, never a new charge -- the totals asserted just above are what proves it
    // is not double-counted anywhere.
    eq('a first bill carries nothing forward', partly.body.previousBalance, 0);
    check('and has no date to carry either', partly.body.previousBalanceAt == null);
    eq("the next bill carries the first one's balance", second.body.previousBalance, 370);
    eq('dated from the bill that left it owing', second.body.previousBalanceAt, partly.body.at);
    eq("the shop's own figure for that bill is just its lines", second.body.total, 200);
    check('carried plus lines less paid is the balance',
      Math.round((second.body.previousBalance + second.body.total - second.body.paid) * 100) / 100
        === second.body.balance,
      JSON.stringify([second.body.previousBalance, second.body.total, second.body.paid, second.body.balance]));
    // The newest bill that left money owing, which by now is the second one -- so this is the
    // date a third bill would print, not the one the second bill printed.
    eq('the date offered beside the customer moves on with them', detail.body.balanceAt, second.body.at);

    // A number of its own: 9000000001 is the quiet-customer fixture, and selling to them here
    // would make them active and quietly gut the test below.
    const settled = await post('/api/customers', { name: 'Paid Up', phone: '9000000077' });
    const cash = await post('/api/bills', { lines: [{ itemId: 'y', qty: 1, rate: 50 }], customerId: settled.body.id });
    eq('a customer who pays in full carries nothing', cash.body.previousBalance, 0);
    check('and is offered no date', cash.body.previousBalanceAt == null);
    eq('nor does one appear beside them',
      (await call('/api/customers/' + settled.body.id, { headers: auth })).body.balanceAt, null);

    console.log('\nAPI: cancelling a bill');
    const takingsBefore = await call('/api/summary/today', { headers: auth });
    const doomed = await post('/api/bills', {
      lines: [{ itemId: 'z', qty: 1, rate: 300 }], customerId: created.body.id, paid: 100,
    });
    const owedAfter = (await call('/api/customers/' + created.body.id, { headers: auth }))
      .body.customer.balance;

    const cancelled = await post('/api/bills/' + doomed.body.no + '/cancel', {});
    eq('the bill comes back cancelled', cancelled.body.cancelled, true);
    check('and dated', typeof cancelled.body.cancelledAt === 'string');
    eq('its lines are still there', cancelled.body.lines.length, 1);
    eq('and its number is unchanged', cancelled.body.no, doomed.body.no);

    // The whole point: the money comes back out of the customer's running figures.
    const after = await call('/api/customers/' + created.body.id, { headers: auth });
    eq('what they owe drops by what was cancelled',
      after.body.customer.balance, Math.round((owedAfter - 200) * 100) / 100);
    eq('so does what they were billed',
      after.body.customer.totalBilled, detail.body.customer.totalBilled);
    eq('and what they had paid', after.body.customer.totalPaid, detail.body.customer.totalPaid);
    eq('and their bill count', after.body.customer.billCount, detail.body.customer.billCount);

    // Still in the book, which is the difference between cancelling and deleting.
    const stillThere = after.body.bills.find((b) => b.no === doomed.body.no);
    check('the bill is still in their history', stillThere != null);
    eq('marked cancelled', stillThere && stillThere.cancelled, true);
    eq('and it can still be fetched on its own',
      (await call('/api/bills/' + doomed.body.no, { headers: auth })).body.cancelled, true);

    const todayNow = await call('/api/summary/today', { headers: auth });
    eq("today's takings are back where they were", todayNow.body.total, takingsBefore.body.total);
    eq('and so is the count', todayNow.body.count, takingsBefore.body.count);

    // Twice must not subtract twice -- two tills, one slow tap, or a retried request.
    const twice = await post('/api/bills/' + doomed.body.no + '/cancel', {});
    eq('cancelling twice is not an error', twice.status, 200);
    const afterTwice = await call('/api/customers/' + created.body.id, { headers: auth });
    eq('and does not take the money out again',
      afterTwice.body.customer.balance, after.body.customer.balance);

    eq('cancelling a bill that does not exist is a 404',
      (await post('/api/bills/999999/cancel', {})).status, 404);

    // A cancelled bill must not date the next bill's carried balance either.
    const settledCust = await post('/api/customers', { name: 'Void Test', phone: '9000000088' });
    const onlyBill = await post('/api/bills', {
      lines: [{ itemId: 'q', qty: 1, rate: 90 }], customerId: settledCust.body.id, paid: 0,
    });
    await post('/api/bills/' + onlyBill.body.no + '/cancel', {});
    eq('a cancelled bill dates nothing',
      (await call('/api/customers/' + settledCust.body.id, { headers: auth })).body.balanceAt, null);
    eq('and leaves them owing nothing',
      (await call('/api/customers/' + settledCust.body.id, { headers: auth })).body.customer.balance, 0);

    eq('a balance cannot be printed without a customer',
      (await post('/api/bills', { lines: LINES, showBalance: true })).status, 400);
    eq('an unknown customer is rejected',
      (await post('/api/bills', { lines: LINES, customerId: 'nobody' })).status, 400);

    console.log('\nAPI: quiet customers');
    const inactive = await call('/api/customers/inactive', { headers: auth });
    eq('the window comes from settings', inactive.body.days, 30);
    check('a customer last seen 90 days ago is flagged',
      inactive.body.customers.some((c) => c.id === 'p9000000001'));
    check('a customer who just bought something is not',
      !inactive.body.customers.some((c) => c.id === created.body.id));
    eq('the window can be overridden',
      (await call('/api/customers/inactive?days=3650', { headers: auth })).body.customers.length, 0);
    eq('the window can be changed in settings', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ inactiveAfterDays: 7 }),
    })).body.inactiveAfterDays, 7);
    eq('and the list follows it',
      (await call('/api/customers/inactive', { headers: auth })).body.days, 7);
    eq('a nonsense window is rejected', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ inactiveAfterDays: 0 }),
    })).status, 400);

    console.log('\nAPI: settings');
    // The catalogue is gone: every line of a bill is written by hand now, so there is no item
    // endpoint left. What matters is that the routes that did exist are truly gone rather than
    // quietly still answering.
    eq('the item list is gone', (await call('/api/items', { headers: auth })).status, 404);
    eq('adding an item is gone', (await post('/api/items', { nameEn: 'Milk', rate: 28 })).status, 404);

    // Normalised on the way in, like every other figure the browser sends: the number goes on
    // paper, so it should read the same however it was typed.
    // Both Kannada boxes round-trip; the receipt tests above prove what they then do.
    eq('the Kannada shop name is saved', (await call('/api/settings', {
      method: 'PUT', headers: auth,
      body: JSON.stringify({ shopNameKn: 'ಶ್ರೀಧರ' }),
    })).body.shopNameKn, 'ಶ್ರೀಧರ');
    eq('and the Kannada footer', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ footerKn: 'ಧನ್ಯವಾದ' }),
    })).body.footerKn, 'ಧನ್ಯವಾದ');

    eq('a GST number is saved, upper-cased and stripped of spacing', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ gstin: '29 abcde 1234 f1z5' }),
    })).body.gstin, '29ABCDE1234F1Z5');
    eq('the GST switch can be turned off', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ showGstin: false }),
    })).body.showGstin, false);
    eq('and back on', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ showGstin: true }),
    })).body.showGstin, true);
    eq('a wrong-looking one is still saved -- warned about, never refused', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ gstin: 'NOTAGST' }),
    })).body.gstin, 'NOTAGST');
    eq('and it can be cleared again', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ gstin: '' }),
    })).body.gstin, '');

    eq('the paper size can be changed', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ paper: '80mm' }),
    })).body.paper, '80mm');
    eq('an unknown paper size is rejected', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ paper: '99mm' }),
    })).status, 400);
    eq('an empty shop name is rejected', (await call('/api/settings', {
      method: 'PUT', headers: auth, body: JSON.stringify({ shopName: '   ' }),
    })).status, 400);
    eq('a forged token is refused',
      (await call('/api/bills', { headers: { authorization: 'Bearer not.a.token' } })).status, 401);

    /*
     * Deleting a cancelled bill for good.
     *
     * The rail that matters is the refusal: a live bill's money is still in the customer's
     * totals, and cancelling is the only thing that takes it back out. Deleting one straight
     * would leave them owing for a bill nobody can produce.
     */
    const toDelete = await post('/api/bills', {
      lines: [{ itemId: 'd1', qty: 1, rate: 60 }], customerId: created.body.id,
    });
    eq('a bill to be deleted is created', toDelete.status, 201);
    const beforeDelete = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;

    const liveDelete = await call('/api/bills/' + toDelete.body.no, { method: 'DELETE', headers: auth });
    eq('a live bill cannot be deleted', liveDelete.status, 409);
    check('and the reason says to cancel it first', /cancel/i.test(liveDelete.body.error), liveDelete.body.error);
    eq('so it is still there', (await call('/api/bills/' + toDelete.body.no, { headers: auth })).status, 200);

    await post('/api/bills/' + toDelete.body.no + '/cancel', {});
    const afterCancel = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    const deleted = await call('/api/bills/' + toDelete.body.no, { method: 'DELETE', headers: auth });
    eq('a cancelled one can be deleted', deleted.status, 204);
    eq('and is gone', (await call('/api/bills/' + toDelete.body.no, { headers: auth })).status, 404);

    // The cancel did the arithmetic; the delete must not do it again.
    const afterDelete = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    eq('the delete moves no money', afterDelete.balance, afterCancel.balance);
    eq('nor the total billed', afterDelete.totalBilled, afterCancel.totalBilled);
    check('and the cancel had already taken it out', beforeDelete.totalBilled !== afterCancel.totalBilled);

    /*
     * The same delete asked for in one step.
     *
     * A live bill's money is still in the customer's totals, so the forced path has to cancel
     * before it deletes. These checks are about the money, not the HTTP: the figures after a
     * forced delete must match what a cancel would have left.
     */
    const oneStep = await post('/api/bills', {
      lines: [{ itemId: 'f1', qty: 1, rate: 250 }], customerId: created.body.id, paid: 100,
    });
    const beforeForce = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    const forced = await call('/api/bills/' + oneStep.body.no + '?force=1', { method: 'DELETE', headers: auth });
    eq('a live bill can be deleted in one step', forced.status, 204);
    eq('and is gone', (await call('/api/bills/' + oneStep.body.no, { headers: auth })).status, 404);

    const afterForce = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    eq('its charge comes off the customer', afterForce.totalBilled, shared.round2(beforeForce.totalBilled - 250));
    eq('and what they paid on it too', afterForce.totalPaid, shared.round2(beforeForce.totalPaid - 100));
    eq('leaving the balance where it was before the bill', afterForce.balance, shared.round2(beforeForce.balance - 150));
    eq('and one fewer bill against their name', afterForce.billCount, beforeForce.billCount - 1);

    // The unforced path is unchanged, which is what keeps the two-step route honest.
    const stillLive = await post('/api/bills', {
      lines: [{ itemId: 'f2', qty: 1, rate: 30 }], customerId: created.body.id,
    });
    eq('without force a live bill is still refused',
      (await call('/api/bills/' + stillLive.body.no, { method: 'DELETE', headers: auth })).status, 409);
    eq('and is still there', (await call('/api/bills/' + stillLive.body.no, { headers: auth })).status, 200);

    // Forcing one that is already cancelled must not subtract a second time.
    await post('/api/bills/' + stillLive.body.no + '/cancel', {});
    const afterCancelTwice = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    eq('forcing an already-cancelled bill still deletes it',
      (await call('/api/bills/' + stillLive.body.no + '?force=1', { method: 'DELETE', headers: auth })).status, 204);
    const afterForceTwice = (await call('/api/customers/' + created.body.id, { headers: auth })).body.customer;
    eq('and takes nothing out twice', afterForceTwice.balance, afterCancelTwice.balance);

    eq('deleting a bill that never existed is a 404',
      (await call('/api/bills/99999', { method: 'DELETE', headers: auth })).status, 404);

    // A numbered book with a gap is honest; a second bill 14 is not.
    const afterGap = await post('/api/bills', { lines: [{ itemId: 'g1', qty: 1, rate: 10 }] });
    check('the freed number is not handed out again', afterGap.body.no > toDelete.body.no,
      'got ' + afterGap.body.no + ' after deleting ' + toDelete.body.no);

    // Switched off unless a password is configured, which this server has not got.
    const resetOff = await post('/api/reset', { password: 'anything', confirm: 'ERASE' });
    eq('erasing is off when no password is set', resetOff.status, 404);
    check('and nothing was erased', (await call('/api/bills', { headers: auth })).body.length > 0);

    const backup = await call('/api/backup', { headers: auth });
    eq('a backup can be taken', backup.status, 200);
    check('and holds the bills', Array.isArray(backup.body.bills) && backup.body.bills.length > 0);
    check('and the customers', Array.isArray(backup.body.customers));
    check('and the shop settings', typeof backup.body.settings.shopName === 'string');
    check('and says when it was taken', typeof backup.body.at === 'string');

    const customerRemoved = await call('/api/customers/' + created.body.id, { method: 'DELETE', headers: auth });
    eq('a customer can be removed', customerRemoved.status, 204);
    eq('their past bills survive it', (await call('/api/bills/' + partly.body.no, { headers: auth })).body.customer.name, 'Ramesh Kumar');
  } finally {
    server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
    fs.rmSync(BUILD, { recursive: true, force: true });
  }

  /*
   * Erasing the book, on a server of its own.
   *
   * A second server because the password is read from the environment at startup, and the two
   * halves worth testing are exactly the two configurations: without one the endpoint is off,
   * with one it empties the book. Its own data directory too, since the point of the test is
   * that everything in it goes.
   */
  console.log('');
  console.log('Erasing everything');

  const RESET_PORT = PORT + 1;
  const RESET_DATA = DATA + '-reset';
  const RESET_PW = 'erase-me-9137';
  fs.mkdirSync(RESET_DATA, { recursive: true });

  const wiper = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(ROOT, 'server', 'src', 'index.ts')],
    {
      cwd: path.join(ROOT, 'server'),
      env: {
        ...process.env,
        PORT: String(RESET_PORT), DATA_DIR: RESET_DATA, AUTH_PIN: PIN,
        RESET_PASSWORD: RESET_PW,
        MONGO_URI: '', JWT_SECRET: 'selftest-secret', NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  try {
    const wbase = 'http://127.0.0.1:' + RESET_PORT;
    const wcall = async (p, init) => {
      const res = await fetch(wbase + p, init);
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    };

    let wup = false;
    for (let i = 0; i < 180 && !wup; i++) {
      await sleep(500);
      try {
        const res = await fetch(wbase + '/api/health');
        wup = res.status === 200 || res.status === 401;
      } catch { /* not listening yet */ }
    }
    check('the second server started', wup);
    if (wup) {
      const tok = (await wcall('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: PIN }),
      })).body.token;
      const wauth = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
      const wpost = (p, body) => wcall(p, { method: 'POST', headers: wauth, body: JSON.stringify(body) });

      await wcall('/api/settings', {
        method: 'PUT', headers: wauth, body: JSON.stringify({ shopName: 'Shop That Survives' }),
      });
      const cust = await wpost('/api/customers', { name: 'To Be Erased', phone: '9000000321' });
      await wpost('/api/bills', { lines: [{ itemId: 'e1', qty: 1, rate: 30 }], customerId: cust.body.id });
      await wpost('/api/bills', { lines: [{ itemId: 'e2', qty: 1, rate: 40 }] });
      check('there is something to erase', (await wcall('/api/bills', { headers: wauth })).body.length === 2);

      eq('a wrong password is refused',
        (await wpost('/api/reset', { password: 'not-it', confirm: 'ERASE' })).status, 401);
      eq('the right password without the word is refused',
        (await wpost('/api/reset', { password: RESET_PW, confirm: '' })).status, 400);
      eq('and the word has to be exact',
        (await wpost('/api/reset', { password: RESET_PW, confirm: 'erase' })).status, 400);
      check('none of which erased anything',
        (await wcall('/api/bills', { headers: wauth })).body.length === 2);

      /*
       * The other kind of erase: the bills go, the customers stay.
       *
       * Their figures have to go with the bills. A balance is worked out from bills, so leaving
       * one behind would be a debt with nothing to account for it.
       */
      eq('bills can be erased while the customers stay',
        (await wpost('/api/reset', { password: RESET_PW, confirm: 'ERASE', keepCustomers: true })).status, 204);
      eq('the bills are gone', (await wcall('/api/bills', { headers: wauth })).body.length, 0);
      const kept = (await wcall('/api/customers', { headers: wauth })).body;
      eq('the customer is still there', kept.length, 1);
      eq('with their name', kept[0].name, 'To Be Erased');
      eq('and their phone number', kept[0].phone, '9000000321');
      eq('but nothing owed', kept[0].balance, 0);
      eq('nor any billing behind it', kept[0].totalBilled, 0);
      eq('nor anything paid', kept[0].totalPaid, 0);
      eq('nor a count of bills', kept[0].billCount, 0);
      eq('and the numbering restarted',
        (await wpost('/api/bills', { lines: [{ itemId: 'k1', qty: 1, rate: 15 }] })).body.no, 1);

      // Put something back for the full erase below to take away.
      await wpost('/api/bills', { lines: [{ itemId: 'k2', qty: 1, rate: 25 }], customerId: kept[0].id });

      eq('both proofs together erase', (await wpost('/api/reset', { password: RESET_PW, confirm: 'ERASE' })).status, 204);
      eq('the bills are gone', (await wcall('/api/bills', { headers: wauth })).body.length, 0);
      eq('the customers with them', (await wcall('/api/customers', { headers: wauth })).body.length, 0);
      eq('the shop keeps its name',
        (await wcall('/api/settings', { headers: wauth })).body.shopName, 'Shop That Survives');
      // The whole point of a reset: the book starts again at one.
      eq('and the next bill is number 1',
        (await wpost('/api/bills', { lines: [{ itemId: 'f1', qty: 1, rate: 5 }] })).body.no, 1);
    }
  } finally {
    wiper.kill();
    fs.rmSync(RESET_DATA, { recursive: true, force: true });
  }

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('All checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
