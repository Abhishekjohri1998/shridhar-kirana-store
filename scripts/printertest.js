/**
 * The phone's printing path, end to end, against a fake printer.
 *
 * What this can prove without hardware: that the bytes leaving the phone are the same bytes the
 * counter PC sends, that they are well-formed ESC/POS, and that the Bluetooth transport delivers
 * every one of them in the right order however the printer behaves.
 *
 * What it cannot prove: that a Shreyans SRS583 likes them. Only paper can prove that.
 *
 *   node scripts/printertest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.printertest-build');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
async function throws(name, fn, match) {
  try {
    await fn();
    check(name, false, 'no error was thrown');
  } catch (e) {
    const msg = String((e && e.message) || e);
    check(name, match ? msg.includes(match) : true, 'message was: ' + msg);
  }
}

/* ------------------------------------------------------------------ *
 * A canvas that measures text by character count. Same one both       *
 * rasterisers see, so any difference in output is a difference in     *
 * logic rather than in the font.                                      *
 * ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ *
 * A fake printer, and a fake phone for it to hang off.                *
 * ------------------------------------------------------------------ */

/**
 * Stands in for react-native-bluetooth-classic. Records everything, and can be told to misbehave
 * in each of the ways a real printer does: already connected, refusing a write, dropping mid-slip.
 */
function fakePrinter(opts = {}) {
  const log = [];
  const chunks = [];
  let isConnected = opts.startConnected === true;
  return {
    log,
    chunks,
    /** Everything the printer received, reassembled in order. */
    received() {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { out.set(c, at); at += c.length; }
      return out;
    },
    get connected() { return isConnected; },
    api: {
      async isBluetoothEnabled() {
        log.push('isBluetoothEnabled');
        return opts.bluetoothOff ? false : true;
      },
      async getBondedDevices() {
        log.push('getBondedDevices');
        if (opts.bonded) return opts.bonded;
        return [
          { name: 'SRS583', address: '66:22:CC:11:AA:01' },
          { name: 'Galaxy Buds', address: '66:22:CC:11:AA:02' },
        ];
      },
      async isDeviceConnected(address) {
        log.push('isDeviceConnected:' + address);
        if (opts.connectionCheckThrows) throw new Error('bridge went away');
        return isConnected;
      },
      async connectToDevice(address, options) {
        log.push('connectToDevice:' + address + ':' + JSON.stringify(options));
        if (opts.connectFails) throw new Error('Device connection failed');
        isConnected = true;
        return true;
      },
      async writeToDevice(address, data, encoding) {
        log.push('write:' + encoding + ':' + data.length);
        if (opts.failWriteAt != null && chunks.length === opts.failWriteAt) return false;
        if (opts.throwWriteAt != null && chunks.length === opts.throwWriteAt) {
          throw new Error('Broken pipe');
        }
        chunks.push(Buffer.from(data, 'base64'));
        return true;
      },
      async disconnectFromDevice(address) {
        log.push('disconnect:' + address);
        isConnected = false;
        return true;
      },
    },
  };
}

/** The slice of react-native these modules touch. */
function fakeReactNative(state) {
  // Platform is read through getters: bluetooth.ts requires react-native once, at module load,
  // so a snapshot taken then could never be changed to test a different Android version.
  const Platform = {};
  Object.defineProperty(Platform, 'OS', { get: () => state.os ?? 'android' });
  Object.defineProperty(Platform, 'Version', { get: () => state.apiLevel ?? 33 });
  return {
    Platform,
    PermissionsAndroid: {
      PERMISSIONS: {
        BLUETOOTH_CONNECT: 'android.permission.BLUETOOTH_CONNECT',
        BLUETOOTH_SCAN: 'android.permission.BLUETOOTH_SCAN',
      },
      RESULTS: { GRANTED: 'granted', DENIED: 'denied', NEVER_ASK_AGAIN: 'never_ask_again' },
      async requestMultiple(list) {
        state.permissionsAsked = list.slice();
        const out = {};
        for (const p of list) out[p] = state.denyPermissions ? 'denied' : 'granted';
        return out;
      },
    },
  };
}

const store = new Map();
const fakeAsyncStorage = {
  default: {
    async getItem(k) { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, v); },
    async removeItem(k) { store.delete(k); },
    async multiGet(keys) { return keys.map((k) => [k, store.has(k) ? store.get(k) : null]); },
  },
};

/* ------------------------------------------------------------------ *
 * Compile the two print paths and load them with the fakes injected.  *
 * ------------------------------------------------------------------ */
const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc,
  'client/src/print/raster.ts',
  'client/src/print/escpos.ts',
  'mobile/src/print/rasterHtml.ts',
  'mobile/src/print/escpos.ts',
  'mobile/src/print/bluetooth.ts',
  '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019',
  '--strict', '--skipLibCheck', '--jsx', 'react-jsx',
  '--lib', 'es2019,dom', '--types', 'node',
], { cwd: ROOT, stdio: 'inherit' });

const rnState = {};
const nativeState = { module: null };

// The mobile modules import react-native and the Bluetooth library, neither of which exists off a
// phone. Intercept those specifiers only; everything else resolves normally.
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'react-native') return fakeReactNative(rnState);
  if (request === '@react-native-async-storage/async-storage') return fakeAsyncStorage;
  if (request === 'react-native-bluetooth-classic') {
    if (!nativeState.module) throw new Error("Cannot find module 'react-native-bluetooth-classic'");
    return { default: nativeState.module };
  }
  return realLoad.apply(this, arguments);
};

const shared = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));
global.document = fakeDocument;

const { rasterize: webRasterize } = require(path.join(BUILD, 'client', 'src', 'print', 'raster.js'));
const { rasterToEscPos: webEscPos } = require(path.join(BUILD, 'client', 'src', 'print', 'escpos.js'));
const { RASTER_SCRIPT } = require(path.join(BUILD, 'mobile', 'src', 'print', 'rasterHtml.js'));
const { rasterToEscPos: phoneEscPos } = require(path.join(BUILD, 'mobile', 'src', 'print', 'escpos.js'));
const bt = require(path.join(BUILD, 'mobile', 'src', 'print', 'bluetooth.js'));

/** Rasterise one document with the script the phone injects into its hidden WebView. */
function phoneRasterize(doc) {
  const messages = [];
  const sandbox = {
    document: fakeDocument,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    Intl, String, Math, JSON, Uint8Array, Number, isFinite, parseInt, console,
    window: { ReactNativeWebView: { postMessage: (m) => messages.push(JSON.parse(m)) } },
  };
  sandbox.window.document = fakeDocument;
  vm.createContext(sandbox);
  vm.runInContext(RASTER_SCRIPT, sandbox, { filename: 'rasterHtml.js' });
  messages.length = 0;
  sandbox.window.__render(
    JSON.stringify({
      doc,
      ...shared.rasterNumbers(),
    }),
  );
  const result = messages[messages.length - 1];
  if (!result || !result.ok) throw new Error('phone rasteriser failed: ' + (result && result.error));
  return { width: result.width, height: result.height, data: result.data };
}

/* ------------------------------------------------------------------ *
 * The receipts to try.                                                *
 * ------------------------------------------------------------------ */
const SAMPLE_INK = {
  w: 300, h: 120,
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
function settingsFor(patch) {
  return {
    shopName: 'Shridhar Kirani Stores',
    footer: 'Thank you, Visit again!',
    paper: '58mm', language: 'en', showRate: false, inactiveAfterDays: 30,
    ...patch,
  };
}
const CASES = [
  ['the shop’s own four-line slip, 58mm', bill(), {}],
  ['the same slip on 80mm', bill(), { paper: '80mm' }],
  ['a part payment with a customer', bill({
    customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
    paid: 1000, balance: 370, showBalance: true,
  }), {}],
  ['with a GST number on it', bill(), { gstin: '29ABCDE1234F1Z5' }],
  ['carrying a balance forward', bill({
    customer: { id: 'p9886012345', name: 'Ramesh', phone: '9886012345' },
    paid: 1000, balance: 870, showBalance: true,
    previousBalance: 500, previousBalanceAt: '2026-08-02T10:00:00',
  }), {}],
  ['carrying a balance forward, in Kannada', bill({
    customer: { id: 'p1', name: 'ರಮೇಶ್', phone: '9886012345' },
    paid: 1000, balance: 870, showBalance: true,
    previousBalance: 500, previousBalanceAt: '2026-08-02T10:00:00',
  }), { language: 'kn' }],
  ['a handwritten line', bill({
    lines: [...LINES, { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 }],
  }), {}],
  ['a handwritten line on 80mm', bill({
    lines: [...LINES, { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 }],
  }), { paper: '80mm' }],
  ['a Kannada slip', bill({
    customer: { id: 'p1', name: 'ರಮೇಶ್', phone: '9886012345' },
    paid: 1000, balance: 370, showBalance: true,
  }), { language: 'kn' }],
];

const ESC = 0x1b;
const GS = 0x1d;
const BAND = 24;

/**
 * Walk an ESC/POS stream and describe it, refusing to guess: an unexpected byte is an error, not
 * something to skip. If this parses, a printer's firmware will not be surprised either.
 */
function parseEscPos(bytes, maxBand = 24) {
  let at = 0;
  const expect = (label, ...want) => {
    for (const b of want) {
      if (bytes[at] !== b) {
        throw new Error(
          label + ': expected 0x' + b.toString(16) + ' at ' + at + ', found 0x' + (bytes[at] ?? -1).toString(16),
        );
      }
      at++;
    }
  };
  expect('initialise', ESC, 0x40);
  expect('align left', ESC, 0x61, 0x00);

  const bands = [];
  const feeds = [];
  // What the paper ends up carrying, row by row: band rows as sent, fed rows blank.
  const pieces = [];
  let bpr = 0;
  for (;;) {
    if (bytes[at] === GS) {
      expect('raster header', GS, 0x76, 0x30, 0x00);
      bpr = bytes[at] | (bytes[at + 1] << 8);
      at += 2;
      const rows = bytes[at] | (bytes[at + 1] << 8);
      at += 2;
      if (rows < 1 || rows > maxBand) throw new Error('band of ' + rows + ' rows at ' + at);
      const need = bpr * rows;
      if (at + need > bytes.length) throw new Error('band claims ' + need + ' bytes, only ' + (bytes.length - at) + ' left');
      bands.push({ bpr, rows, data: bytes.subarray(at, at + need) });
      pieces.push({ rows, data: bytes.subarray(at, at + need) });
      at += need;
    } else if (bytes[at] === ESC && bytes[at + 1] === 0x4a) {
      const n = bytes[at + 2];
      if (!(n >= 1)) throw new Error('empty feed at ' + at);
      if (bands.length === 0) throw new Error('a feed before any image at ' + at);
      feeds.push(n);
      pieces.push({ rows: n, data: null });
      at += 3;
    } else break;
  }

  expect('feed', ESC, 0x64, 0x04);
  if (at !== bytes.length) throw new Error(bytes.length - at + ' trailing byte(s) after the feed');
  const rows = pieces.reduce((n, p) => n + p.rows, 0);
  const image = new Uint8Array(rows * bpr);
  let y = 0;
  for (const p of pieces) {
    if (p.data) image.set(p.data, y * bpr);
    y += p.rows;
  }
  return { bands, feeds, rows, bpr: bands[0] ? bands[0].bpr : 0, image };
}

/** The rows of a raster from its first inked row to its last: what the printer must reproduce. */
function inkedPart(bits, width, height) {
  const bpr = Math.ceil(width / 8);
  const blank = (y) => { for (let i = y * bpr; i < (y + 1) * bpr; i++) if (bits[i]) return false; return true; };
  let top = 0;
  while (top < height && blank(top)) top++;
  let bottom = height - 1;
  while (bottom >= top && blank(bottom)) bottom--;
  return { top, bottom, rows: bottom - top + 1, bits: bits.subarray(top * bpr, (bottom + 1) * bpr) };
}

/* ================================================================== *
 * 1. The phone and the counter PC send the same bytes                 *
 * ================================================================== */
console.log('');
console.log('Same receipt, same bytes on the wire');

for (const [label, theBill, patch] of CASES) {
  const settings = settingsFor(patch);
  const doc = shared.buildReceipt(theBill, settings, shared.receiptLabelsFor(settings.language));

  let web;
  let phone;
  let height;
  let webBits;
  let webWidth;
  let webDotsKept;
  try {
    const webDots = webRasterize(doc);
    height = webDots.height;
    webBits = webDots.bits;
    webWidth = webDots.width;
    webDotsKept = webDots;
    web = webEscPos(webDots);
    phone = phoneEscPos(phoneRasterize(doc));
  } catch (e) {
    check(label, false, String(e && e.message));
    continue;
  }

  check(label + ': same length', web.length === phone.length, web.length + ' vs ' + phone.length + ' bytes');
  if (web.length !== phone.length) continue;

  let diff = -1;
  for (let i = 0; i < web.length; i++) if (web[i] !== phone[i]) { diff = i; break; }
  check(label + ': identical byte for byte', diff === -1, diff === -1 ? '' : 'first difference at byte ' + diff);

  let parsed;
  try {
    parsed = parseEscPos(phone);
  } catch (e) {
    check(label + ': well-formed ESC/POS', false, String(e && e.message));
    continue;
  }
  check(label + ': well-formed ESC/POS', true);

  const expectedBpr = Math.ceil(shared.paperProfile(settings.paper).dots / 8);
  check(
    label + ': ' + settings.paper + ' is ' + expectedBpr + ' bytes per row',
    parsed.bpr === expectedBpr,
    'header says ' + parsed.bpr,
  );
  // Every dot row the rasteriser produced has to appear in exactly one band. A band count that
  // comes up short prints a truncated slip, and one that runs over prints garbage after the total.
  const inked = inkedPart(webBits, webWidth, height);
  check(
    label + ': every row from the first dot to the last reaches the paper, in place',
    parsed.rows === inked.rows && same(parsed.image, inked.bits),
    parsed.rows + ' rows (' + parsed.bands.length + ' bands, ' + parsed.feeds.length + ' feeds), inked part is ' + inked.rows,
  );
  check(label + ': Fast bands are at most 24 rows', parsed.bands.every((b) => b.rows <= 24));
  check(label + ': blank margins are not sent', parsed.rows < height, parsed.rows + ' of ' + height);
  check(label + ': no ESC J feeds, blank gaps go as image rows', parsed.feeds.length === 0);
  check(label + ': (gaps of 8+ blank rows are present in the image)',
    !!(() => { let run = 0; for (const b of parsed.bands) for (let r = 0; r < b.rows; r++) {
      let empty = true; for (let i = r * b.bpr; i < (r + 1) * b.bpr; i++) if (b.data[i]) { empty = false; break; }
      run = empty ? run + 1 : 0; if (run >= 8) return true; } return false; })());
  {
    const normal = parseEscPos(webEscPos(webDotsKept, 'normal'), 24);
    check(label + ': Normal bands are at most 24 rows and print the same paper',
      normal.bands.every((b) => b.rows <= 24) && same(normal.image, parsed.image));
  }
}

/* ================================================================== *
 * 1b. Pacing: band by band, at the speed the head burns them           *
 * ================================================================== */
console.log('');
console.log('Paced to the printer');

function concat(plan) {
  const out = new Uint8Array(plan.reduce((n, w) => n + w.bytes.length, 0));
  let at = 0;
  for (const w of plan) { out.set(w.bytes, at); at += w.bytes.length; }
  return out;
}
function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** A fake raster, width dots by height rows, bytes patterned so a misplaced row shows. */
function fakeRaster(width, height) {
  const bpr = Math.ceil(width / 8);
  const bits = new Uint8Array(bpr * height);
  for (let i = 0; i < bits.length; i++) bits[i] = (i * 31 + 7) & 0xff;
  return { width, height, bits };
}

check('the band sizes are 24 rows at every speed (48 squashed lines on cheap 58mm heads)', shared.PRINT_BAND_ROWS === 24 && shared.FAST_BAND_ROWS === 24
  && shared.bandRowsFor('fast') === 24 && shared.bandRowsFor('normal') === 24 && shared.bandRowsFor('safe') === 24);
check('the default speed is Fast', shared.DEFAULT_SETTINGS.printSpeed === 'fast' && shared.printSpeedOf({}) === 'fast'
  && shared.printSpeedOf({ printSpeed: 'nonsense' }) === 'fast');
check('a stored Normal reads as Normal', shared.printSpeedOf({ printSpeed: 'normal' }) === 'normal');
check('Settings offers Fast, Normal, Safe in that order', JSON.stringify(shared.PRINT_SPEEDS) === '["fast","normal","safe"]');
check('a Safe saved before Fast existed moves to Fast, once',
  shared.migrateSettings({ printSpeed: 'safe' }).printSpeed === 'fast'
  && shared.migrateSettings({ printSpeed: 'safe' }).printSpeedV === 2);
check('a Safe chosen after that is kept', shared.migrateSettings({ printSpeed: 'safe', printSpeedV: 2 }).printSpeed === 'safe');
check('a saved Normal is kept', shared.migrateSettings({ printSpeed: 'normal' }).printSpeed === 'normal');
check('settings with no speed read as Fast', shared.migrateSettings({}).printSpeed === 'fast');

{
  // 1000 rows: on Normal/Safe 41 full bands of 24 and one of 16; on Fast the same.
  const r = fakeRaster(384, 1000);
  const bytes = webEscPos(r, 'normal');
  const parsed = parseEscPos(bytes, 24);
  check('every band is at most 24 rows', parsed.bands.every((b) => b.rows <= 24));
  check('42 bands for 1000 rows', parsed.bands.length === 42 && parsed.bands[41].rows === 16);
  let at = 5;
  let headersOk = true;
  for (let y = 0; y < 1000; y += 24) {
    const h = Math.min(24, 1000 - y);
    const want = [0x1d, 0x76, 0x30, 0x00, 48, 0, h & 0xff, h >> 8];
    for (let k = 0; k < 8; k++) if (bytes[at + k] !== want[k]) headersOk = false;
    if (!same(bytes.subarray(at + 8, at + 8 + h * 48), r.bits.subarray(y * 48, (y + h) * 48))) headersOk = false;
    at += 8 + h * 48;
  }
  check('each band is GS v 0 with xL=48 xH=0 yL/yH = its rows, carrying its own image rows', headersOk);
  check('total bytes = image + band headers + init/align/feed', bytes.length === r.bits.length + 42 * 8 + 5 + 3, bytes.length + ' bytes');
  check('mobile banding is byte-identical', same(bytes, phoneEscPos({ width: 384, height: 1000, data: Buffer.from(r.bits).toString('base64') }, 'normal')));
  const fast = parseEscPos(webEscPos(r, 'fast'), 24);
  check('Fast: 42 bands of up to 24 rows, the same image', fast.bands.length === 42 && fast.bands[41].rows === 16 && same(fast.image, r.bits));
  for (const sp of ['fast', 'normal', 'safe', undefined]) check('no band over 24 rows on ' + sp, parseEscPos(webEscPos(r, sp), 1000).bands.every((b) => b.rows <= 24));

  for (const speed of ['fast', 'normal', 'safe']) {
    const band = shared.bandRowsFor(speed);
    const sb = webEscPos(r, speed);
    const plan = shared.planPrintWrites(sb, speed);
    const prof = shared.paceProfile(speed);
    const nBands = Math.ceil(1000 / band);
    const lastRows = 1000 - (nBands - 1) * band;
    check(speed + ': plan reassembles to the exact stream', same(concat(plan), sb));
    check(speed + ': no write over ' + prof.chunk + ' bytes', plan.every((w) => w.bytes.length <= prof.chunk));
    check(speed + ': ESC @ goes first, then a 150 ms settle', plan[0].bytes[0] === 0x1b && plan[0].bytes[1] === 0x40 && plan[0].waitAfterMs === 150);
    const fullBand = Math.max(prof.minBandWaitMs, Math.ceil((band / prof.rowsPerSecond) * 1000));
    const lastBand = Math.max(prof.minBandWaitMs, Math.ceil((lastRows / prof.rowsPerSecond) * 1000));
    const waits = plan.map((w) => w.waitAfterMs);
    const bandWaits = waits.slice(1).filter((w) => w >= prof.minBandWaitMs);
    check(speed + ': one burn wait per band', bandWaits.length === nBands, bandWaits.length + ' band waits');
    check(speed + ': a ' + band + '-row band waits ' + fullBand + ' ms', bandWaits.slice(0, nBands - 1).every((w) => w === fullBand), JSON.stringify(bandWaits.slice(0, 3)));
    check(speed + ': the short last band waits ' + lastBand + ' ms', bandWaits[nBands - 1] === lastBand, String(bandWaits[nBands - 1]));
    check(speed + ': chunks inside a band pause ' + prof.chunkPauseMs + ' ms',
      waits.slice(1).filter((w) => w !== 0 && w < prof.minBandWaitMs).every((w) => w === prof.chunkPauseMs));
    check(speed + ': the feed goes last with no trailing wait', waits[waits.length - 1] === 0 && plan[plan.length - 1].bytes[0] === 0x1b);
  }
  const f = shared.paceProfile('fast');
  const n = shared.paceProfile('normal');
  const sf = shared.paceProfile('safe');
  check('Fast is 600 rows/s, 15 ms floor, 512-byte chunks, 5 ms pause', f.rowsPerSecond === 600 && f.minBandWaitMs === 15 && f.chunk === 512 && f.chunkPauseMs === 5);
  check('Normal is 250 rows/s, 60 ms floor, 20 ms chunk pause', n.rowsPerSecond === 250 && n.minBandWaitMs === 60 && n.chunkPauseMs === 20 && n.chunk === 256);
  check('Safe halves the rate and doubles the pauses', sf.rowsPerSecond === 125 && sf.minBandWaitMs === 120 && sf.chunkPauseMs === 40);
  const total = (sp) => shared.planPrintWrites(webEscPos(r, sp), sp).reduce((t, w) => t + w.waitAfterMs, 0);
  check('Fast is well below Normal and Safe in time (< 60% of Normal)', total('fast') < 0.6 * total('normal') && total('safe') > total('normal'),
    total('fast') + ' / ' + total('normal') + ' / ' + total('safe') + ' ms');
}

{
  // Blank rows: margins dropped, every inner gap kept in the image.
  const width = 384;
  const bpr = 48;
  const height = 300;
  const bits = new Uint8Array(bpr * height);
  const ink = (y) => { for (let i = 0; i < bpr; i++) bits[y * bpr + i] = ((y * 7 + i) & 0xff) | 1; };
  for (let y = 20; y < 60; y++) ink(y); // 0-19 blank: top margin, dropped
  for (let y = 65; y < 100; y++) ink(y); // 60-64 blank: 5 rows, kept in the image
  for (let y = 120; y < 130; y++) ink(y); // 100-119 blank: a 20-row feed
  for (let y = 135; y < 140; y++) ink(y); // 130-134 blank: kept
  // 140-299 blank: bottom margin, dropped
  const bytes = shared.encodeRasterEscPos(bits, width, height, 'fast');
  const parsed = parseEscPos(bytes, 24);
  const inked = inkedPart(bits, width, height);
  check('blank rows: top 20 and bottom 160 are not sent', inked.top === 20 && inked.bottom === 139 && parsed.rows === 120);
  check('blank rows: the paper carries exactly the inked part, gaps in place', same(parsed.image, inked.bits));
  check('blank rows: no ESC J feeds at all', parsed.feeds.length === 0, JSON.stringify(parsed.feeds));
  const imageRows = parsed.bands.reduce((k, b) => k + b.rows, 0);
  check('blank rows: every gap goes as image rows, exact height 120', imageRows === 120, imageRows + ' image rows');
  check('blank rows: bytes = init/align + bands + trailer',
    bytes.length === 5 + parsed.bands.length * 8 + imageRows * bpr + 3, bytes.length + ' bytes');
  const empty = shared.encodeRasterEscPos(new Uint8Array(0), 384, 0, 'fast');
  check('an empty raster is just init, align and feed', same(empty, Uint8Array.from([0x1b, 0x40, 0x1b, 0x61, 0, 0x1b, 0x64, 4])));
  // A 600-row gap goes as 602 image rows.
  const tall = new Uint8Array(bpr * 602);
  for (let i = 0; i < bpr; i++) { tall[i] = 0xff; tall[601 * bpr + i] = 0xff; }
  const tp = parseEscPos(shared.encodeRasterEscPos(tall, width, 602, 'normal'), 24);
  check('a 600-row gap is 602 image rows, no feeds', tp.feeds.length === 0 && tp.rows === 602
    && tp.bands.reduce((k, b) => k + b.rows, 0) === 602 && same(tp.image, tall));
  const plan = shared.planPrintWrites(bytes, 'fast');
  check('blank rows: the plan still reassembles exactly', same(concat(plan), bytes));
}

{
  const bytes = webEscPos(fakeRaster(384, 13000));
  const plan = shared.planPrintWrites(bytes, 'normal');
  const gaps = plan.filter((w) => w.waitAfterMs === 500).length;
  check('a 13000-row slip goes out in 3 parts (2 gaps of 500 ms)', gaps === 2, gaps + ' gaps');
  check('and still reassembles exactly', same(concat(plan), bytes));
  const one = shared.planPrintWrites(webEscPos(fakeRaster(384, 6000)), 'normal');
  check('6000 rows is a single part', one.every((w) => w.waitAfterMs !== 500));
}

{
  // The bill that broke: 16 handwritten lines.
  const lines = [];
  for (let i = 0; i < 16; i++) lines.push({ itemId: 'ink-' + i, nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 10 + i });
  let doc = null;
  try {
    doc = shared.buildReceipt(bill({ lines, total: 280, paid: 280 }), settingsFor({}), shared.receiptLabelsFor('en'));
  } catch (e) {
    check('16-line handwritten bill builds', false, String(e && e.message));
  }
  if (doc) {
    const dots = webRasterize(doc);
    const bytes = webEscPos(dots, 'safe');
    const parsed = parseEscPos(bytes, 24);
    const inked = inkedPart(dots.bits, dots.width, dots.height);
    check('16-line handwritten bill: every inked row reaches the paper in bands of <=24',
      parsed.rows === inked.rows && same(parsed.image, inked.bits) && parsed.bands.every((b) => b.rows <= 24));
    check('16-line handwritten bill keeps the image path', shared.receiptAsText(doc) === null);
    const plan = shared.planPrintWrites(bytes, 'safe');
    check('16-line handwritten bill: paced plan reassembles exactly', same(concat(plan), bytes));
    check('16-line handwritten bill: one burn wait per band and per feed',
      plan.slice(1).filter((w) => w.waitAfterMs >= 120).length === parsed.bands.length + parsed.feeds.length);
  }
}

/* ================================================================== *
 * 1c. A typed English bill prints as the printer's own text            *
 * ================================================================== */
console.log('');
console.log('Typed English bills as text');

{
  const EN_LINES = [
    { itemId: 'rice', nameKn: '', nameEn: 'Sona masoori rice', qty: 2, unit: 'kg', rate: 60, stockItemId: 's-rice' },
    { itemId: 'oil', nameKn: '', nameEn: 'Sunflower oil 1L', qty: 1, rate: 145 },
    { itemId: 'soap', nameKn: '', nameEn: 'Soap', qty: 3, rate: 30, given: false },
  ];
  const enBill = (extra) => bill({ lines: EN_LINES, total: 355, paid: 355, ...extra });
  const labels = shared.receiptLabelsFor('en');
  /** Every piece of text the slip carries, from the ReceiptDoc the image would be drawn from. */
  const docTexts = (doc) => doc.rows.flatMap((r) =>
    r.t === 'center' ? [r.text] : r.t === 'kv' ? [r.left, r.right] : r.t === 'item' ? [r.no, r.name, r.amount, r.note] : [])
    .filter((t) => t && t.trim());
  const flat = (lines) => lines.join('\n').replace(/\s+/g, ' ');
  const contentMatches = (doc, lines) => docTexts(doc).every((t) => flat(lines).includes(t.replace(/\s+/g, ' ')));

  for (const paper of ['58mm', '80mm']) {
    const cols = paper === '58mm' ? 32 : 48;
    const settings = settingsFor({ paper, gstin: '29ABCDE1234F1Z5' });
    const doc = shared.buildReceipt(enBill({ roundOff: -0.5, note: 'Deliver by 5 pm' }), settings, labels);
    const bytes = shared.receiptAsText(doc);
    check(paper + ': an all-English typed bill goes out as text', bytes instanceof Uint8Array);
    if (!bytes) continue;
    const lines = shared.receiptTextLines(doc);
    check(paper + ': ' + cols + ' columns', shared.textColumns(doc.width) === cols);
    check(paper + ': no line wider than the paper', lines.every((l) => l.length <= cols), lines.find((l) => l.length > cols));
    check(paper + ': carries everything buildReceipt put on the slip', contentMatches(doc, lines),
      docTexts(doc).find((t) => !flat(lines).includes(t.replace(/\s+/g, ' '))));
    check(paper + ': shop name, GSTIN, bill number, TOTAL, round off, note, footer',
      ['Shridhar Kirani Stores', '29ABCDE1234F1Z5', labels.bill + '42', labels.total, labels.roundOff, 'Deliver by 5 pm', 'Thank you, Visit again!']
        .every((t) => flat(lines).includes(t)));
    check(paper + ': quantity and unit with the name', flat(lines).includes('2 kg Sona masoori rice'));
    check(paper + ': each line\'s amount at the right edge',
      ['120', '145', '90'].every((a) => lines.some((l) => l.endsWith(a) && l.length === cols)));
    check(paper + ': rule lines across the paper', lines.filter((l) => l === '-'.repeat(cols)).length >= 3);
    check(paper + ': far smaller than the image', bytes.length < 1500, bytes.length + ' bytes');
    let printable = true;
    for (const b of bytes) if (b >= 0x7f) printable = false;
    check(paper + ': nothing but ASCII and control codes', printable);
    check(paper + ': starts ESC @, ends ESC d 4', bytes[0] === 0x1b && bytes[1] === 0x40
      && bytes[bytes.length - 3] === 0x1b && bytes[bytes.length - 2] === 0x64 && bytes[bytes.length - 1] === 4);
    check(paper + ': header sets line spacing ESC 3 30', bytes[5] === 0x1b && bytes[6] === 0x33 && bytes[7] === 30);
    check(paper + ': spacing reset with ESC 2 before the final feed', bytes[bytes.length - 5] === 0x1b && bytes[bytes.length - 4] === 0x32);
    const plan = shared.planPrintWrites(bytes, 'fast');
    check(paper + ': text plan reassembles exactly', same(concat(plan), bytes));
    const lfs = [...bytes].filter((b) => b === 0x0a).length;
    check(paper + ': one paced write per printed line', plan.filter((w) => w.bytes[w.bytes.length - 1] === 0x0a).length === lfs && lfs === lines.length);
  }

  {
    const settings = settingsFor({ showRate: true });
    const doc = shared.buildReceipt(enBill({
      customer: { id: 'p1', name: 'Ramesh', phone: '9886012345' },
      paid: 300, balance: 555, showBalance: true, previousBalance: 500, previousBalanceAt: '2026-08-02T10:00:00',
    }), settings, labels);
    const lines = shared.receiptTextLines(doc);
    check('show rate: "@ rate" under each item', lines.filter((l) => l.trim().startsWith('@ ')).length === 3);
    check('balance: old balance line, paid and balance', contentMatches(doc, lines)
      && flat(lines).includes(labels.oldBalance) && flat(lines).includes(labels.paid + ' 300') && flat(lines).includes(labels.balance + ' 555'));
    check('balance: TOTAL includes what was carried', flat(lines).includes('855'));
    check('customer name and phone on one line', lines.some((l) => l.startsWith('Ramesh') && l.endsWith('9886012345')));
  }

  {
    const doc = shared.buildReceipt(enBill({ hideNames: true }), settingsFor({}), labels);
    const lines = shared.receiptTextLines(doc);
    check('hidden names: number and price only', shared.receiptAsText(doc) !== null
      && !flat(lines).includes('Sona') && !flat(lines).includes('Soap') && contentMatches(doc, lines));
  }

  {
    const doc = shared.buildReceipt(enBill({ hideNames: true }), settingsFor({ receiptStyle: 'compact' }), labels);
    const lines = shared.receiptTextLines(doc);
    check('compact: "1)120, 2)145, 3)90" then TOTAL', flat(lines).includes('1)120, 2)145, 3)90') && contentMatches(doc, lines));
  }

  {
    const kn = shared.buildReceipt(bill(), settingsFor({}), labels);
    check('a bill with a Kannada item name keeps the image path', shared.receiptAsText(kn) === null);
    const knShop = shared.buildReceipt(enBill(), settingsFor({ language: 'kn', shopNameKn: 'ಶ್ರೀಧರ್' }), shared.receiptLabelsFor('kn'));
    check('a Kannada shop keeps the image path', shared.receiptAsText(knShop) === null);
    const knFooter = shared.buildReceipt(enBill(), settingsFor({ footer: 'ಧನ್ಯವಾದಗಳು' }), labels);
    check('a Kannada footer alone keeps the image path', shared.receiptAsText(knFooter) === null);
    const inked = shared.buildReceipt(enBill({
      lines: [...EN_LINES, { itemId: 'ink-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 40 }],
    }), settingsFor({}), labels);
    check('a bill with handwriting keeps the image path', shared.receiptAsText(inked) === null);
    const ticked = shared.buildReceipt(enBill({ lines: EN_LINES.map((l) => ({ ...l, given: true })) }), settingsFor({}), labels);
    check('a ticked (given) bill keeps the image path: the tick is not ASCII', shared.receiptAsText(ticked) === null);
  }
}

/* ================================================================== *
 * 2. The Bluetooth transport delivers all of it                       *
 * ================================================================== */
async function transportChecks() {
  console.log('');
  console.log('Bluetooth Classic transport');

  const slept = [];
  bt.setPrintSleepForTests(async (ms) => { slept.push(ms); });

  const settings = settingsFor({});
  const doc = shared.buildReceipt(bill(), settings, shared.receiptLabelsFor('en'));
  const slip = phoneEscPos(phoneRasterize(doc));
  const ADDR = '66:22:CC:11:AA:01';

  check('a 58mm slip is worth printing at all', slip.length > 4000, slip.length + ' bytes');

  // --- the ordinary case ---
  {
    rnState.denyPermissions = false;
    const p = fakePrinter();
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip);

    const got = p.received();
    check('every byte arrives', got.length === slip.length, got.length + ' of ' + slip.length);
    let diff = -1;
    for (let i = 0; i < slip.length; i++) if (got[i] !== slip[i]) { diff = i; break; }
    check('and in the right order', diff === -1, diff === -1 ? '' : 'first difference at byte ' + diff);
    check(
      'no chunk overruns the printer buffer',
      p.chunks.every((c) => c.length <= 512),
      'largest chunk ' + Math.max(...p.chunks.map((c) => c.length)) + ' bytes',
    );
    check('it really was split up', p.chunks.length > 5, p.chunks.length + ' chunks');
    check('connects before writing', p.log[p.log.findIndex((l) => l.startsWith('write:')) - 1].startsWith('connectToDevice'));
    check(
      'over RFCOMM, which is what Classic means',
      p.log.some((l) => l.startsWith('connectToDevice') && l.includes('rfcomm')),
    );
    check('connects once, not per chunk', p.log.filter((l) => l.startsWith('connectToDevice')).length === 1);
    check('sends base64 down the bridge', p.log.filter((l) => l.startsWith('write:base64:')).length === p.chunks.length);
    const plan = shared.planPrintWrites(slip, 'fast');
    check('writes follow the paced plan (Fast by default)', p.chunks.length === plan.length && p.chunks.every((c, i) => c.length === plan[i].bytes.length));
    check('and waits exactly as planned', JSON.stringify(slept) === JSON.stringify(plan.map((w) => w.waitAfterMs).filter((w) => w > 0)));
    check('no write over 512 bytes', p.chunks.every((c) => c.length <= 512));
    check(
      'reassembles to a slip the printer can parse',
      (() => { try { parseEscPos(got); return true; } catch { return false; } })(),
    );
  }

  {
    slept.length = 0;
    const p = fakePrinter();
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip, 'normal');
    const plan = shared.planPrintWrites(slip, 'normal');
    check('Normal speed follows the Normal plan', JSON.stringify(slept) === JSON.stringify(plan.map((w) => w.waitAfterMs).filter((w) => w > 0)));
    check('and still every byte', p.received().length === slip.length);
  }

  // --- a printer already connected from the last slip ---
  {
    const p = fakePrinter({ startConnected: true });
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip);
    check(
      'a still-connected printer is not reconnected',
      p.log.filter((l) => l.startsWith('connectToDevice')).length === 0,
    );
    check('and still gets the whole slip', p.received().length === slip.length);
  }

  // --- second slip in a row, same socket ---
  {
    const p = fakePrinter();
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip);
    const first = p.chunks.length;
    await bt.printBytes(ADDR, slip);
    check('two slips back to back', p.received().length === slip.length * 2, p.received().length + ' bytes');
    check('the second reuses the open socket', p.log.filter((l) => l.startsWith('connectToDevice')).length === 1);
    check('and is chunked the same way', p.chunks.length === first * 2);
  }

  // --- the printer refuses a write partway through ---
  {
    const p = fakePrinter({ failWriteAt: 3 });
    nativeState.module = p.api;
    await throws(
      'a refused write is reported, not swallowed',
      () => bt.printBytes(ADDR, slip),
      'stopped accepting data',
    );
    check('and it stops there rather than spraying the rest', p.chunks.length === 3, p.chunks.length + ' chunks got through');
  }

  // --- the socket dies mid-slip ---
  {
    const p = fakePrinter({ throwWriteAt: 2 });
    nativeState.module = p.api;
    await throws('a dropped connection surfaces', () => bt.printBytes(ADDR, slip), 'Broken pipe');
  }

  // --- pairing was never done ---
  {
    const p = fakePrinter({ connectFails: true });
    nativeState.module = p.api;
    await throws('an unpairable printer surfaces', () => bt.printBytes(ADDR, slip), 'connection failed');
    check('and nothing was sent', p.chunks.length === 0);
  }

  // --- a flaky bridge on the connection check ---
  {
    const p = fakePrinter({ connectionCheckThrows: true });
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip);
    check(
      'a failed "are you connected?" is treated as "no"',
      p.log.filter((l) => l.startsWith('connectToDevice')).length === 1,
    );
    check('and the slip still prints', p.received().length === slip.length);
  }

  // --- permissions ---
  {
    rnState.denyPermissions = true;
    const p = fakePrinter();
    nativeState.module = p.api;
    await throws(
      'refusing Bluetooth permission says where to change it',
      () => bt.printBytes(ADDR, slip),
      'Settings',
    );
    check('and nothing was sent', p.chunks.length === 0);
    check(
      'both Android 12 permissions are asked for',
      (rnState.permissionsAsked ?? []).length === 2 &&
        rnState.permissionsAsked.includes('android.permission.BLUETOOTH_CONNECT') &&
        rnState.permissionsAsked.includes('android.permission.BLUETOOTH_SCAN'),
      JSON.stringify(rnState.permissionsAsked),
    );
    rnState.denyPermissions = false;
  }

  // --- older Android, where the permissions are granted at install ---
  {
    rnState.apiLevel = 30;
    rnState.permissionsAsked = null;
    const p = fakePrinter();
    nativeState.module = p.api;
    await bt.printBytes(ADDR, slip);
    check('Android 11 is not asked at runtime', rnState.permissionsAsked == null);
    check('and prints anyway', p.received().length === slip.length);
    rnState.apiLevel = 33;
  }

  // --- inside Expo Go there is no native module ---
  {
    nativeState.module = null;
    check('Expo Go reports printing as unavailable', bt.isPrintingAvailable() === false);
    await throws(
      'and explains why rather than failing blankly',
      () => bt.printBytes(ADDR, slip),
      'needs the installed app',
    );
  }

  // --- the installed app has it ---
  {
    nativeState.module = fakePrinter().api;
    check('the installed app reports printing as available', bt.isPrintingAvailable() === true);
    rnState.os = 'ios';
    check('iOS does not claim Classic printing', bt.isPrintingAvailable() === false);
    rnState.os = 'android';
  }

  /* ---------------- choosing a printer ---------------- */
  console.log('');
  console.log('Finding and remembering the printer');

  {
    const p = fakePrinter();
    nativeState.module = p.api;
    const found = await bt.listPairedPrinters();
    check('lists what Android has paired', found.length === 2, JSON.stringify(found));
    check('with names, so a device is recognisable', found[0].name === 'SRS583', found[0].name);
  }

  {
    const p = fakePrinter({ bonded: [
      { name: 'SRS583', address: '66:22:CC:11:AA:01' },
      { name: 'No address', address: '' },
      { address: '66:22:CC:11:AA:03' },
      null,
    ] });
    nativeState.module = p.api;
    const found = await bt.listPairedPrinters();
    check('drops devices with no address', found.length === 2, JSON.stringify(found));
    check('names an unnamed device by its address', found[1].name === '66:22:CC:11:AA:03', found[1].name);
  }

  {
    const p = fakePrinter({ bluetoothOff: true });
    nativeState.module = p.api;
    await throws('Bluetooth switched off says so plainly', () => bt.listPairedPrinters(), 'Bluetooth is off');
  }

  {
    const p = fakePrinter({ bonded: [] });
    nativeState.module = p.api;
    const found = await bt.listPairedPrinters();
    check('nothing paired yet is empty, not an error', Array.isArray(found) && found.length === 0);
  }

  {
    store.clear();
    check('no printer remembered on a fresh install', (await bt.loadSavedPrinter()) === null);
    await bt.saveSelectedPrinter({ name: 'SRS583', address: ADDR });
    const saved = await bt.loadSavedPrinter();
    check('the chosen printer survives a restart', saved && saved.address === ADDR, JSON.stringify(saved));
    await bt.saveSelectedPrinter(null);
    check('and can be forgotten', (await bt.loadSavedPrinter()) === null);
  }

  {
    store.set('shridhar.printer', '{not json');
    check('a corrupted saved printer does not crash the app', (await bt.loadSavedPrinter()) === null);
    store.clear();
  }

  {
    const p = fakePrinter({ startConnected: true });
    nativeState.module = p.api;
    await bt.disconnectPrinter(ADDR);
    check('disconnects when asked', p.log.some((l) => l.startsWith('disconnect:')));
    nativeState.module = null;
    await bt.disconnectPrinter(ADDR);
    check('and disconnecting in Expo Go is harmless', true);
  }
}

transportChecks()
  .then(() => {
    Module._load = realLoad;
    fs.rmSync(BUILD, { recursive: true, force: true });
    console.log('');
    if (failures) {
      console.log(failures + ' check(s) failed');
      process.exit(1);
    }
    console.log('All printer checks passed.');
  })
  .catch((e) => {
    Module._load = realLoad;
    fs.rmSync(BUILD, { recursive: true, force: true });
    console.error(e);
    process.exit(1);
  });
