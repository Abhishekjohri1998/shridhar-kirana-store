import { encodeRasterEscPos, type PrintSpeed } from '@shridhar/shared';

/**
 * Barcode labels on the shop's receipt printer, asked for by the stock website in the Stock tab
 * (item page -> Barcode -> Print label).
 *
 * Billing keeps no barcode logic: stock sends each label's bars already worked out (`modules`, one
 * '1' or '0' per module of the symbol, quiet zones not included), and this only draws them. The
 * bars go as a raster picture, which every printer prints; the words as the printer's own text,
 * which is why they are plain Latin (the item's English name).
 */
export type BarcodeLabel = {
  /** The digits printed under the bars. */
  code: string;
  /** The symbol's modules, '1' black, '0' white: 95 for an EAN-13. */
  modules: string;
  /** The item's name, in Latin letters. */
  title: string;
  /** "Rs 165 / Jar", or ''. */
  price: string;
};

const ESC = 0x1b;
const PAPER_DOTS = 384;
const BAR_HEIGHT = 80;

/** A label as stock sent it, checked: anything else is refused before a byte reaches the printer. */
export function checkLabel(raw: unknown): BarcodeLabel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = typeof r.code === 'string' ? r.code.trim() : '';
  const modules = typeof r.modules === 'string' ? r.modules : '';
  if (!/^[0-9A-Z-]{4,32}$/.test(code) || !/^[01]{20,300}$/.test(modules)) return null;
  const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : '');
  return { code, modules, title: text(r.title), price: text(r.price) };
}

/** Printable ASCII only: the printer's own text has no Kannada, and odd bytes become commands. */
function ascii(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.replace(/₹/g, 'Rs ')) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c < 0x7f) out.push(c);
  }
  return out;
}

/** The bars as a picture the width of the paper, centred, each module as wide as fits. */
export function barsRaster(modules: string, height = BAR_HEIGHT): { bits: Uint8Array; width: number; height: number } {
  const module = Math.max(1, Math.min(4, Math.floor((PAPER_DOTS - 40) / modules.length)));
  const left = Math.floor((PAPER_DOTS - modules.length * module) / 2);
  const bpr = PAPER_DOTS / 8;
  const bits = new Uint8Array(bpr * height);
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] !== '1') continue;
    for (let dx = 0; dx < module; dx++) {
      const x = left + i * module + dx;
      for (let y = 0; y < height; y++) bits[y * bpr + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { bits, width: PAPER_DOTS, height };
}

/** Every label, `copies` times each, as one run of printer bytes. */
export function labelBytes(labels: BarcodeLabel[], copies: number, speed: PrintSpeed | string | undefined): Uint8Array {
  const out: number[] = [ESC, 0x40];
  const n = Math.max(1, Math.min(200, Math.floor(copies)));
  for (const label of labels) {
    const bars = barsRaster(label.modules);
    const picture = encodeRasterEscPos(bars.bits, bars.width, bars.height, speed);
    for (let k = 0; k < n; k++) {
      out.push(ESC, 0x61, 1); // centred
      if (label.title) out.push(ESC, 0x45, 1, ...ascii(label.title), 0x0a, ESC, 0x45, 0);
      if (label.price) out.push(...ascii(label.price), 0x0a);
      out.push(ESC, 0x61, 0); // the picture is centred by its own padding
      for (const b of picture) out.push(b);
      out.push(ESC, 0x61, 1, ...ascii(label.code), 0x0a);
      out.push(...ascii('- - - - - - - - - - - - - - - -'), 0x0a, 0x0a);
    }
  }
  out.push(0x0a, 0x0a);
  return Uint8Array.from(out);
}
