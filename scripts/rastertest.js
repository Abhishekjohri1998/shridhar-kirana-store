/**
 * The two rasterisers must agree, dot for dot.
 *
 * There are two because there have to be: the web app draws on a real canvas, and the phone app
 * has no canvas outside a WebView, so its copy is a script string injected into one. Duplicated
 * layout logic is exactly the drift this project keeps trying to avoid, so instead of trusting
 * them to stay in step, this runs both against the same fake canvas and compares the packed bits.
 *
 * A failure here means a receipt would print differently from a phone than from the counter PC.
 *
 *   node scripts/rastertest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.rastertest-build');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}

/**
 * A canvas that measures text by character count and draws it as a filled block. Crude, but both
 * rasterisers see exactly the same crudeness, which is the point: any difference in the output is
 * a difference in their logic, not in the font.
 */
function fakeCanvas() {
  const c = { width: 0, height: 0 };
  c.getContext = function () {
    let fb = null;
    let tx = { a: 1, e: 0, f: 0 };
    const stack = [];
    const ctx = {
      font: '10px sans-serif',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      _size() {
        const m = /(\d+)px/.exec(ctx.font);
        return m ? Number(m[1]) : 10;
      },
      measureText(t) {
        return { width: [...String(t)].length * ctx._size() * 0.55 };
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
      save() { stack.push({ ...tx }); },
      restore() { const prev = stack.pop(); if (prev) tx = prev; },
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
        // Sampled densely enough that the dot pattern matches a real canvas at print scale.
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
      stroke() { /* points already committed by lineTo */ },
      getImageData(x, y, w, h) { return { data: ctx._ensure(), width: w, height: h }; },
    };
    return ctx;
  };
  return c;
}

const fakeDocument = { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc,
  'client/src/print/raster.ts',
  'mobile/src/print/rasterHtml.ts',
  '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019',
  '--strict', '--skipLibCheck', '--lib', 'es2019,dom',
], { cwd: ROOT, stdio: 'inherit' });

const shared = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));

global.document = fakeDocument;
const { rasterize: webRasterize } = require(path.join(BUILD, 'client', 'src', 'print', 'raster.js'));
const { RASTER_SCRIPT } = require(path.join(BUILD, 'mobile', 'src', 'print', 'rasterHtml.js'));

/** Run the phone's injected script in a sandbox and rasterise one document with it. */
function phoneRasterize(doc) {
  const messages = [];
  const sandbox = {
    document: fakeDocument,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Intl,
    String, Math, JSON, Uint8Array, Number, isFinite, parseInt, console,
    window: { ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) } },
  };
  sandbox.window.document = fakeDocument;
  vm.createContext(sandbox);
  vm.runInContext(RASTER_SCRIPT, sandbox, { filename: 'rasterHtml.js' });

  messages.length = 0;
  sandbox.window.__render(
    JSON.stringify({
      doc,
      pad: shared.RASTER.pad,
      itemSize: shared.RASTER.itemSize,
      qtyCol: shared.RASTER.qtyCol,
      threshold: shared.RASTER.threshold,
      inkRowHeight: shared.INK_ROW_HEIGHT,
      inkStrokeDots: shared.INK_STROKE_DOTS,
      inkMaxWidth: shared.inkMaxWidth(doc.width),
    }),
  );
  const result = messages[messages.length - 1];
  if (!result || !result.ok) throw new Error('phone rasteriser failed: ' + (result && result.error));
  return { width: result.width, height: result.height, bits: Buffer.from(result.data, 'base64') };
}

const SAMPLE_INK = {
  w: 300,
  h: 120,
  strokes: [
    [10, 60, 30, 20, 50, 80, 70, 25, 90, 70],
    [110, 30, 140, 30, 140, 80, 110, 80],
  ],
};

const LINES = [
  { itemId: 'gana-enne', nameKn: 'ಗಾಣದ ಎಣ್ಣೆ', nameEn: 'Gana oil', qty: 5, rate: 110 },
  { itemId: 'menasinakayi', nameKn: 'ಮೆಣಸಿನಕಾಯಿ', nameEn: 'Chilli', qty: 5, rate: 123 },
  { itemId: 'ot', nameKn: 'OT', nameEn: 'OT', qty: 1, rate: 50 },
  { itemId: 'j-pulse', nameKn: 'J Pulse', nameEn: 'J Pulse', qty: 1, rate: 155 },
];

function bill(extra) {
  return {
    no: 42, at: '2026-09-05T09:06:00', lines: LINES, total: 1370,
    paid: 1370, balance: 0, showBalance: false, ...extra,
  };
}

const CASES = [
  ['the shop’s own four-line slip, 58mm', bill(), { paper: '58mm' }],
  ['the same slip on 80mm', bill(), { paper: '80mm' }],
  ['with a customer and a part payment', bill({
    customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
    paid: 1000, balance: 370, showBalance: true,
  }), { paper: '58mm' }],
  ['with handwriting', bill({
    lines: [...LINES, { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 }],
  }), { paper: '58mm' }],
  ['with handwriting on 80mm', bill({
    lines: [...LINES, { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 }],
  }), { paper: '80mm' }],
  ['with a bare price and no description', bill({
    lines: [...LINES, { itemId: 'bare', nameKn: '', nameEn: '', qty: 1, rate: 12 }],
  }), { paper: '58mm' }],
  ['with rates printed under each line', bill(), { paper: '58mm', showRate: true }],
  ['with a long Kannada word that has to break', bill({
    lines: [{ itemId: 'long', nameKn: 'ಇಪ್ಪತ್ತೈದುಕಿಲೋಅಕ್ಕಿಚೀಲ', nameEn: '', qty: 1, rate: 1450 }],
  }), { paper: '58mm' }],
  ['in Kannada, with Kannada slip labels', bill({
    customer: { id: 'p1', name: 'ರಮೇಶ್', phone: '9886012345' },
    paid: 1000, balance: 370, showBalance: true,
  }), { paper: '58mm', language: 'kn' }],
];

console.log('');
console.log('Web canvas and phone WebView, same receipt, same dots');

for (const [label, theBill, settingsPatch] of CASES) {
  const settings = {
    shopName: 'Shridhar Kirani Stores',
    footer: 'Thank you, Visit again!',
    paper: '58mm',
    language: 'en',
    showRate: false,
    inactiveAfterDays: 30,
    ...settingsPatch,
  };
  const labels = shared.receiptLabelsFor(settings.language);
  const doc = shared.buildReceipt(theBill, settings, labels);

  let web;
  let phone;
  try {
    web = webRasterize(doc);
    phone = phoneRasterize(doc);
  } catch (e) {
    check(label, false, String(e && e.message));
    continue;
  }

  const sameSize = web.width === phone.width && web.height === phone.height;
  check(label + ': same size', sameSize, web.width + 'x' + web.height + ' vs ' + phone.width + 'x' + phone.height);
  if (!sameSize) continue;

  const a = Buffer.from(web.bits);
  const b = Buffer.from(phone.bits);
  let firstDiff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) { firstDiff = i; break; }
  }
  const bpr = Math.ceil(web.width / 8);
  check(
    label + ': same dots',
    firstDiff === -1,
    firstDiff === -1 ? '' : 'first difference at byte ' + firstDiff + ' (row ' + Math.floor(firstDiff / bpr) + ')',
  );

  // A receipt of nothing but white would compare equal and prove nothing.
  let black = 0;
  for (const byte of a) for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) black++;
  check(label + ': actually drew something', black > 200, black + ' black dots');
}

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All rasteriser checks passed.');
