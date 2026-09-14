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
      inkRowAdvance: shared.INK_ROW_ADVANCE,
      inkStrokeDots: shared.INK_STROKE_DOTS,
      inkGutter: shared.INK_GUTTER,
      inkBleed: shared.INK_BLEED,
      givenMark: shared.GIVEN_MARK,
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

/**
 * A small, low scrawl and a tall one, so a slip can carry writing of two very different sizes.
 * The two rasterisers each get one scale for the whole slip; if only one of them were updated
 * to read it, these are the cases where they would part company.
 */
const TINY_INK = {
  w: 300,
  h: 120,
  strokes: [[10, 62, 24, 54, 38, 66, 52, 56]],
};

const TALL_INK = {
  w: 300,
  h: 120,
  strokes: [
    [12, 8, 12, 112],
    [12, 8, 60, 60, 12, 112],
    [90, 20, 90, 100, 150, 100],
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
  ['with big and small handwriting on one slip', bill({
    lines: [
      { itemId: 'ink-tall', nameKn: '', nameEn: '', ink: TALL_INK, qty: 1, rate: 40 },
      { itemId: 'ink-tiny', nameKn: '', nameEn: '', ink: TINY_INK, qty: 1, rate: 15 },
      { itemId: 'ink-mid', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 60 },
    ],
    total: 115,
    paid: 115,
  }), { paper: '58mm' }],
  ['big and small handwriting on 80mm', bill({
    lines: [
      { itemId: 'ink-tiny', nameKn: '', nameEn: '', ink: TINY_INK, qty: 1, rate: 15 },
      { itemId: 'ink-tall', nameKn: '', nameEn: '', ink: TALL_INK, qty: 1, rate: 40 },
    ],
    total: 55,
    paid: 55,
  }), { paper: '80mm' }],
  ['carrying a balance forward', bill({
    customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
    paid: 1000, balance: 870, showBalance: true,
    previousBalance: 500, previousBalanceAt: '2026-08-02T10:00:00',
  }), { paper: '58mm' }],
  ['carrying a balance forward, in Kannada', bill({
    customer: { id: 'p1', name: 'ರಮೇಶ್', phone: '9886012345' },
    paid: 1000, balance: 870, showBalance: true,
    previousBalance: 500, previousBalanceAt: '2026-08-02T10:00:00',
  }), { paper: '58mm', language: 'kn' }],
  ['with a GST number on it', bill(), { paper: '58mm', gstin: '29ABCDE1234F1Z5' }],
  ['and on 80mm', bill(), { paper: '80mm', gstin: '29ABCDE1234F1Z5' }],
  ['with a bare price and no description', bill({
    lines: [...LINES, { itemId: 'bare', nameKn: '', nameEn: '', qty: 1, rate: 12 }],
  }), { paper: '58mm' }],
  ['with rates printed under each line', bill(), { paper: '58mm', showRate: true }],
  ['with a long Kannada word that has to break', bill({
    lines: [{ itemId: 'long', nameKn: 'ಇಪ್ಪತ್ತೈದುಕಿಲೋಅಕ್ಕಿಚೀಲ', nameEn: '', qty: 1, rate: 1450 }],
  }), { paper: '58mm' }],
  // A free-text note is the one row on the slip whose length nobody controls, so the wrap the
  // two rasterisers each work out for themselves has to come to the same dots.
  ['with a short note', bill({ note: 'Delivery Tuesday' }), { paper: '58mm' }],
  ['with a note long enough to wrap', bill({
    note: 'Delivery Tuesday morning, two empty bags to be returned with the driver',
  }), { paper: '58mm' }],
  ['with a Kannada note', bill({ note: 'ಮಂಗಳವಾರ ಡೆಲಿವರಿ' }), { paper: '58mm', language: 'kn' }],
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

/*
 * Where the ink actually lands.
 *
 * Everything above is differential: it proves the two rasterisers agree, not that either is
 * right. Shift the writing in both and every check still passes. So this rasterises a document
 * built by hand -- one ink row, nothing else -- whose strokes start at x = 0 in their own
 * coordinates. That is the stroke that used to be drawn hard against the column edge and shaved.
 *
 * The fake canvas plots one-pixel centrelines and ignores lineWidth, so this measures the pen's
 * path rather than its painted edge: the path should sit a bleed inside the gutter.
 */
console.log('');
console.log('The writing starts clear of the column');

const EDGE_INK = { w: 200, h: 100, strokes: [[0, 0, 40, 50, 0, 100], [70, 0, 70, 100]] };
const NAME_X = shared.RASTER.pad + shared.RASTER.qtyCol;

for (const paper of ['58mm', '80mm']) {
  const width = shared.paperProfile(paper).dots;
  const plan = shared.planInk([EDGE_INK], shared.inkMaxWidth(width), shared.INK_ROW_HEIGHT);
  const inkDoc = {
    width,
    rows: [{ t: 'ink', no: '1', ink: EDGE_INK, amount: '5', scale: plan.scale, originY: plan.originY }],
  };

  for (const [who, rasterise] of [['web', webRasterize], ['phone', phoneRasterize]]) {
    const img = rasterise(inkDoc);
    const bpr = Math.ceil(img.width / 8);
    const on = (row, col) => ((img.bits[row * bpr + (col >> 3)] >> (7 - (col & 7))) & 1) === 1;

    // Only the description column: the serial number is drawn at `pad` and would always win.
    let leftmost = Infinity;
    for (let row = 0; row < img.height; row++) {
      for (let col = NAME_X; col < img.width; col++) {
        if (on(row, col)) { if (col < leftmost) leftmost = col; break; }
      }
    }
    /*
     * Deliberately measured against literal dots rather than against INK_GUTTER. Asserting
     * `leftmost >= NAME_X + INK_GUTTER` reads well and proves nothing: set the gutter to zero
     * and the expectation moves with it, so the check passes on exactly the layout it exists to
     * forbid. Tried it -- it passed. These are the numbers a person would hold a ruler to.
     */
    check(
      paper + ' ' + who + ': the writing starts clear of the column, not on its edge',
      leftmost >= NAME_X + 4,
      'leftmost stroke at ' + leftmost + ', wanted at least half a millimetre in, ' + (NAME_X + 4),
    );
    check(
      paper + ' ' + who + ': and is not shoved halfway across the column',
      leftmost <= NAME_X + 16,
      'leftmost stroke at ' + leftmost + ', more than two millimetres in',
    );
  }
}


fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All rasteriser checks passed.');
