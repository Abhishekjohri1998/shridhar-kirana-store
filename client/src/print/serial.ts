import { planPrintWrites, type PrintSpeed } from '@shridhar/shared';

/**
 * Printing over a serial port.
 *
 * This is the path that reaches a **Bluetooth Classic** printer directly. A browser cannot open an
 * SPP/RFCOMM socket itself, but it does not have to: once Windows (or Linux) has paired the
 * printer, the operating system exposes it as an outgoing COM port, and Web Serial can open that
 * port and write ESC/POS straight down it. The same code drives a USB-to-serial printer.
 *
 * Limits worth knowing:
 *  - Chrome or Edge on a desktop OS, over https or localhost. Android Chrome has no Web Serial,
 *    so a tablet uses the system print path (RawBT) or a BLE printer instead.
 *  - The port has to exist first: pair the printer in the OS, which is where the COM port comes
 *    from. Nothing here can create one.
 */

const BAUD_KEY = 'shridhar.serialBaud';

/** What ESC/POS printers are normally set to. 9600 is the usual factory default. */
export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;

/** Bluetooth SPP ports ignore the baud rate; a real serial printer does not, and the wrong one
 *  prints garbage, which is why this is a setting rather than a constant. */
export function loadBaudRate(): number {
  try {
    const stored = Number(localStorage.getItem(BAUD_KEY));
    return SERIAL_BAUD_RATES.includes(stored as (typeof SERIAL_BAUD_RATES)[number]) ? stored : 9600;
  } catch {
    return 9600;
  }
}

export function saveBaudRate(rate: number): void {
  try {
    localStorage.setItem(BAUD_KEY, String(rate));
  } catch {
    /* storage blocked; the choice just will not be remembered */
  }
}

export class SerialPrintError extends Error {}

type Connected = { port: SerialPort; label: string };

let connected: Connected | null = null;

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function connectedSerialName(): string | null {
  return connected?.label ?? null;
}

/** A COM port has no friendly name in Web Serial, so build one from the USB ids when present. */
function labelFor(port: SerialPort): string {
  const info = port.getInfo?.() ?? {};
  const vendor = info.usbVendorId;
  const product = info.usbProductId;
  if (vendor == null) return 'Serial printer';
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  return 'Serial printer ' + hex(vendor) + ':' + hex(product ?? 0);
}

/**
 * Show the browser's port chooser and open the chosen port. Must be called from a click -- the
 * browser refuses a port request without a user gesture.
 */
export async function chooseSerialPrinter(baudRate = loadBaudRate()): Promise<string> {
  if (!isWebSerialAvailable()) {
    throw new SerialPrintError(
      'This browser has no Web Serial. Use Chrome or Edge on a computer, or print through the system dialog.',
    );
  }

  const port = await navigator.serial.requestPort();
  try {
    await port.open({ baudRate });
  } catch (e) {
    // Almost always the port being held by something else -- a print spooler, or another tab.
    throw new SerialPrintError(
      'Could not open that port. Close anything else using the printer and try again. (' +
        (e instanceof Error ? e.message : String(e)) +
        ')',
    );
  }

  if (connected && connected.port !== port) await disconnectSerial();
  connected = { port, label: labelFor(port) };
  return connected.label;
}

export async function disconnectSerial(): Promise<void> {
  const open = connected;
  connected = null;
  if (!open) return;
  try {
    await open.port.close();
  } catch {
    /* already gone */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Band by band, paced to the head (see planPrintWrites). write() resolving only means the OS took
 * the bytes -- an SPP port takes them far faster than the printer burns them, which is how a long
 * slip used to overrun the printer and print garbage after item 8.
 */
export async function printBytesOverSerial(bytes: Uint8Array, speed: PrintSpeed = 'safe'): Promise<void> {
  if (!connected) throw new SerialPrintError('No serial printer is connected. Choose a port first.');
  const { port } = connected;
  if (!port.writable) throw new SerialPrintError('That port is no longer writable. Reconnect the printer.');

  const writer = port.writable.getWriter();
  try {
    for (const step of planPrintWrites(bytes, speed)) {
      await writer.write(step.bytes);
      if (step.waitAfterMs > 0) await sleep(step.waitAfterMs);
    }
  } finally {
    writer.releaseLock();
  }
}
