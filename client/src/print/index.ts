import type { PaperProfile, ReceiptDoc } from '@shridhar/shared';
import { rasterToEscPos } from './escpos';
import { rasterize } from './raster';
import { printBytesOverBluetooth } from './bluetooth';
import { printBytesOverSerial } from './serial';

export type PrintMode = 'system' | 'bluetooth' | 'serial';

const PAGE_STYLE_ID = 'shridhar-page-size';

/**
 * Point the print stylesheet at the roll the shop actually loads. `@page` is document-level and
 * cannot be scoped by a selector, so the rule is written into a style element instead of living
 * in the stylesheet with a hardcoded size.
 */
export function applyPaperToPrintSheet(paper: PaperProfile): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(PAGE_STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = PAGE_STYLE_ID;
    document.head.appendChild(el);
  }
  const dotMm = paper.printableMm / paper.dots;
  el.textContent =
    '@media print{' +
    '@page{size:' + paper.pageMm + 'mm auto;margin:' + (paper.key === '80mm' ? 3 : 2) + 'mm}' +
    '#print-root{--dot:' + dotMm.toFixed(6) + 'mm}' +
    '#print-root .receipt{width:calc(var(--dot) * ' + paper.dots + ')}' +
    '}';
}

export const PRINT_MODE_KEY = 'shridhar.printMode';

export function loadPrintMode(): PrintMode {
  try {
    const stored = localStorage.getItem(PRINT_MODE_KEY);
    return stored === 'bluetooth' || stored === 'serial' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function savePrintMode(mode: PrintMode): void {
  try {
    localStorage.setItem(PRINT_MODE_KEY, mode);
  } catch {
    // Storage blocked; the choice just will not survive a reload.
  }
}

/** Resolves when `promise` settles or `ms` elapses, whichever comes first. */
function atMost(promise: Promise<unknown> | undefined, ms: number): Promise<void> {
  const capped = new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  return promise ? Promise.race([promise.then(() => undefined, () => undefined), capped]) : capped;
}

/** One frame for React to commit the receipt, one for layout to settle. */
function twoFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Hand the receipt to the operating system's print dialog. The print stylesheet sizes the page to
 * a 58mm roll and hides everything except the receipt, so this works with a thermal printer
 * installed as a normal printer, with Android's print service, and with save-as-PDF.
 *
 * The caller must already have the receipt rendered into #print-root.
 *
 * Both waits are capped, because neither is guaranteed to settle: requestAnimationFrame does not
 * fire at all while the tab is in the background, and a webfont that fails to load can leave
 * document.fonts.ready pending. Uncapped, either one loses the print silently and leaves the
 * button stuck on "Printing".
 */
export async function printViaSystem(): Promise<void> {
  // Without the font wait the Kannada can print in a fallback face, or as empty boxes, first time.
  await atMost(document.fonts?.ready, 1500);
  await atMost(twoFrames(), 300);
  window.print();
}

/** Send the receipt to a BLE printer as ESC/POS raster dots. */
export async function printViaBluetooth(doc: ReceiptDoc): Promise<void> {
  await atMost(document.fonts?.ready, 1500);
  await printBytesOverBluetooth(rasterToEscPos(rasterize(doc)));
}

/** Send the receipt down a serial port -- which is what a Bluetooth Classic printer looks like
 *  once the operating system has paired it. */
export async function printViaSerial(doc: ReceiptDoc): Promise<void> {
  await atMost(document.fonts?.ready, 1500);
  await printBytesOverSerial(rasterToEscPos(rasterize(doc)));
}

export { chooseBluetoothPrinter, connectedPrinterName, isWebBluetoothAvailable, BluetoothPrintError } from './bluetooth';
export {
  chooseSerialPrinter, connectedSerialName, isWebSerialAvailable, disconnectSerial,
  SERIAL_BAUD_RATES, loadBaudRate, saveBaudRate, SerialPrintError,
} from './serial';
export { rasterize } from './raster';
export { rasterToEscPos } from './escpos';
