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
const BAND = 64;

/**
 * Walk an ESC/POS stream and describe it, refusing to guess: an unexpected byte is an error, not
 * something to skip. If this parses, a printer's firmware will not be surprised either.
 */
function parseEscPos(bytes) {
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
  while (at < bytes.length && bytes[at] === GS) {
    expect('raster header', GS, 0x76, 0x30, 0x00);
    const bpr = bytes[at] | (bytes[at + 1] << 8);
    at += 2;
    const rows = bytes[at] | (bytes[at + 1] << 8);
    at += 2;
    if (rows < 1 || rows > BAND) throw new Error('band of ' + rows + ' rows at ' + at);
    const need = bpr * rows;
    if (at + need > bytes.length) throw new Error('band claims ' + need + ' bytes, only ' + (bytes.length - at) + ' left');
    bands.push({ bpr, rows, data: bytes.subarray(at, at + need) });
    at += need;
  }

  expect('feed', ESC, 0x64, 0x04);
  if (at !== bytes.length) throw new Error(bytes.length - at + ' trailing byte(s) after the feed');
  return { bands, rows: bands.reduce((n, b) => n + b.rows, 0), bpr: bands[0] ? bands[0].bpr : 0 };
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
  try {
    const webDots = webRasterize(doc);
    height = webDots.height;
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
  check(
    label + ': all ' + height + ' dot rows reach the printer',
    parsed.rows === height,
    parsed.rows + ' rows in ' + parsed.bands.length + ' band(s), receipt is ' + height + ' rows',
  );
  check(
    label + ': banded in ' + Math.ceil(height / BAND) + ', as the buffer requires',
    parsed.bands.length === Math.ceil(height / BAND),
    parsed.bands.length + ' bands',
  );
  check(
    label + ': banded, not one tall image',
    parsed.bands.every((b) => b.rows <= BAND) && parsed.bands.length >= 1,
    'largest band ' + Math.max(...parsed.bands.map((b) => b.rows)) + ' rows',
  );
}

/* ================================================================== *
 * 2. The Bluetooth transport delivers all of it                       *
 * ================================================================== */
async function transportChecks() {
  console.log('');
  console.log('Bluetooth Classic transport');

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
    check(
      'reassembles to a slip the printer can parse',
      (() => { try { parseEscPos(got); return true; } catch { return false; } })(),
    );
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
