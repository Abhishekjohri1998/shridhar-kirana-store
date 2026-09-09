/**
 * Checks the receipt pipeline without a phone or a printer: totals, the canvas layout that runs
 * inside the WebView, the 1-bit packing, and the ESC/POS framing.
 *
 * The canvas is faked -- measureText and fillText are approximated -- so this proves the layout
 * code runs and produces well-formed dots, not that the Kannada glyphs look right. Only paper can
 * tell you that; use Settings > Test print.
 *
 *   node scripts/selftest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.selftest-build');

let failures = 0;
function check(name, ok, detail) {
  if (ok) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}

// ---------------------------------------------------------------- compile the plain TS modules
const { execFileSync } = require('child_process');
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc,
  'src/types.ts', 'src/lib/money.ts', 'src/lib/base64.ts',
  'src/receipt/doc.ts', 'src/receipt/raster.ts', 'src/printer/escpos.ts',
  '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019', '--skipLibCheck', '--strict',
], { cwd: ROOT, stdio: 'inherit' });

const money = require(path.join(BUILD, 'lib/money.js'));
const b64 = require(path.join(BUILD, 'lib/base64.js'));
const doc = require(path.join(BUILD, 'receipt/doc.js'));
const escpos = require(path.join(BUILD, 'printer/escpos.js'));

// ---------------------------------------------------------------- the bill from the paper slip
const BILL = {
  no: 42,
  at: '2026-09-03T09:06:00',
  lines: [
    { itemId: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil', qty: 5, rate: 110 },
    { itemId: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', qty: 5, rate: 123 },
    { itemId: 'ot', nameKn: 'OT', nameEn: 'OT', qty: 1, rate: 50 },
    { itemId: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', qty: 1, rate: 155 },
  ],
  total: 0,
};
BILL.total = doc.billTotal(BILL.lines);

const SETTINGS = {
  shopName: 'Shridhar Kirani Stores',
  footer: 'Thank you, Visit again!',
  printerAddress: 'AA:BB:CC:DD:EE:FF',
  printerName: 'Test',
  showRate: false,
};

console.log('\nMoney and totals');
eq('line amount 5 x 110', money.lineAmount(5, 110), 550);
eq('line amount 5 x 123', money.lineAmount(5, 123), 615);
eq('bill total matches the paper slip', BILL.total, 1370);
eq('whole rupees print without decimals', money.money(1370), '1370');
eq('paise print with two decimals', money.money(1370.5), '1370.50');
eq('weighed quantity survives', money.lineAmount(1.5, 62), 93);
// 0.1 + 0.2 style drift is what makes a printed total disagree with the sum of its lines.
eq('rounding does not drift', money.money(money.lineAmount(3, 0.1) + money.lineAmount(3, 0.2)), '0.90');

console.log('\nBase64 round trip');
const probe = Uint8Array.from([0, 1, 27, 64, 127, 128, 200, 255, 254, 3]);
const round = b64.base64ToBytes(b64.bytesToBase64(probe));
check('bytes survive the bridge encoding', Buffer.from(round).equals(Buffer.from(probe)),
  Buffer.from(round).toString('hex') + ' vs ' + Buffer.from(probe).toString('hex'));
eq('high bytes are not mangled', round[7], 255);

console.log('\nReceipt document');
const receipt = doc.buildReceipt(BILL, SETTINGS);
eq('paper is 384 dots wide', receipt.width, 384);
const itemRows = receipt.rows.filter((r) => r.t === 'item');
eq('one row per line', itemRows.length, 4);
eq('first row prints the Kannada name', itemRows[0].name, 'ಗಾಣದ ಎಣ್ಣೆ');
eq('first row amount is the line total', itemRows[0].amount, '550');
check('no rate note when showRate is off', itemRows.every((r) => r.note === undefined));
const totalRow = receipt.rows.find((r) => r.t === 'kv' && r.left === 'TOTAL');
eq('total row reads 1370', totalRow && totalRow.right, '1370');
eq('date is day-first', doc.stamp('2026-09-03T09:06:00'), '03/09/26 9:06 am');
eq('noon does not print as 0:00', doc.stamp('2026-09-03T12:30:00'), '03/09/26 12:30 pm');
eq('midnight prints as 12 am', doc.stamp('2026-09-03T00:05:00'), '03/09/26 12:05 am');
const withRate = doc.buildReceipt(BILL, { ...SETTINGS, showRate: true });
eq('showRate adds the per-unit note', withRate.rows.filter((r) => r.t === 'item')[0].note, '@ 110');

// ---------------------------------------------------------------- run the WebView renderer
console.log('\nCanvas renderer (fake canvas)');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'src/receipt/rasterHtml.ts'), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(htmlSrc);
check('the page has a script block', script != null);

function fakeCanvas() {
  const c = { width: 0, height: 0 };
  c.getContext = function () {
    let fb = null;
    const ctx = {
      font: '10px sans-serif',
      fillStyle: '#000',
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
          fb = new Uint8ClampedArray(c.width * c.height * 4).fill(255);
        }
        return fb;
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
      getImageData(x, y, w, h) {
        return { data: ctx._ensure(), width: w, height: h };
      },
    };
    return ctx;
  };
  return c;
}

const messages = [];
const sandbox = {
  document: { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  String, Math, JSON, Uint8Array, Number, parseInt, isNaN, console,
  window: { ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) } },
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(script[1], sandbox, { filename: 'rasterHtml.js' });

check('the page reports ready', messages.some((m) => m.ready === true));
check('the page exposes __render', typeof sandbox.window.__render === 'function');

messages.length = 0;
sandbox.window.__render(JSON.stringify(receipt));
const result = messages[messages.length - 1];
check('render succeeded', result && result.ok === true, result && result.error);
eq('raster is 384 dots wide', result.width, 384);
check('raster is a plausible height', result.height > 200 && result.height < 1200, 'height ' + result.height);
const dots = b64.base64ToBytes(result.data);
const bpr = Math.ceil(result.width / 8);
eq('one bit per dot, packed by row', dots.length, bpr * result.height);
let black = 0;
for (let i = 0; i < dots.length; i++) {
  for (let b = 0; b < 8; b++) if (dots[i] & (1 << b)) black++;
}
check('the receipt is not blank', black > 500, black + ' black dots');
check('the receipt is not all black', black < dots.length * 8 * 0.6, black + ' black dots');

// A long name has to wrap instead of running under the amount column.
messages.length = 0;
sandbox.window.__render(JSON.stringify({
  width: 384,
  rows: [{ t: 'item', qty: '1', name: 'Extra long product name that cannot possibly fit on one line', amount: '12345' }],
}));
const wrapped = messages[messages.length - 1];
check('a long item name wraps to more rows', wrapped.ok && wrapped.height > 60, 'height ' + (wrapped && wrapped.height));

// An empty document must not produce a zero-height raster: the printer rejects height 0.
messages.length = 0;
sandbox.window.__render(JSON.stringify({ width: 384, rows: [] }));
const blank = messages[messages.length - 1];
check('an empty receipt still has height', blank.ok && blank.height >= 1, JSON.stringify(blank));

console.log('\nESC/POS framing');
const bytes = escpos.rasterToEscPos(result);
eq('starts with ESC @ (initialise)', bytes[0] + ',' + bytes[1], '27,64');
const bands = Math.ceil(result.height / 64);
let found = 0;
for (let i = 0; i < bytes.length - 3; i++) {
  if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) found++;
}
eq('one GS v 0 command per 64-row band', found, bands);
eq('total length is header + bands + dots', bytes.length, 2 + 3 + bands * 8 + dots.length + 3);
eq('ends by feeding the paper out', bytes[bytes.length - 3] + ',' + bytes[bytes.length - 2], '27,100');

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All checks passed.');
