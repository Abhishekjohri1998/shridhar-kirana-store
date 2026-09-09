import { PermissionsAndroid, Platform } from 'react-native';
import { bytesToBase64 } from '../lib/base64';

export type PairedPrinter = { name: string; address: string };

/**
 * Loaded lazily and on purpose. The native Bluetooth module only exists in a real dev/release
 * build, so requiring it at the top of a module would crash the whole app inside Expo Go --
 * where we still want the billing screens and the receipt preview to work for a demo.
 */
function nativeModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-bluetooth-classic');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

export function isPrintingAvailable(): boolean {
  return Platform.OS === 'android' && nativeModule() != null;
}

export class PrinterError extends Error {}

/** Android 12+ split Bluetooth out of location into its own runtime permissions. */
async function ensurePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (api < 31) return;
  const wanted = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  ].filter(Boolean) as string[];
  const granted = await PermissionsAndroid.requestMultiple(wanted as never[]);
  const denied = wanted.filter((p) => granted[p as never] !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length) {
    throw new PrinterError('Bluetooth permission was refused. Allow it in Settings > Apps > Kirana Billing.');
  }
}

function requireModule(): any {
  const bt = nativeModule();
  if (!bt) {
    throw new PrinterError(
      'Bluetooth printing needs the installed app (a dev or release build). Inside Expo Go you can bill and preview, but not print.',
    );
  }
  return bt;
}

/** Printers are paired once in Android's own Bluetooth settings; we only list what is bonded. */
export async function listPairedPrinters(): Promise<PairedPrinter[]> {
  const bt = requireModule();
  await ensurePermissions();
  if ((await bt.isBluetoothEnabled()) === false) {
    throw new PrinterError('Bluetooth is off. Turn it on and try again.');
  }
  const devices = await bt.getBondedDevices();
  return (devices ?? []).map((d: any) => ({
    name: String(d?.name ?? d?.address ?? 'Unknown'),
    address: String(d?.address ?? ''),
  })).filter((d: PairedPrinter) => d.address.length > 0);
}

async function connected(bt: any, address: string): Promise<boolean> {
  try {
    return (await bt.isDeviceConnected(address)) === true;
  } catch {
    return false;
  }
}

const CHUNK = 512;
const CHUNK_PAUSE_MS = 40;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Send raw ESC/POS bytes to a paired printer. The bytes go out in small chunks with a short
 * pause between them: these printers have a few hundred bytes of buffer and silently drop
 * whatever overruns it, which shows up as a receipt that stops halfway down the paper.
 */
export async function printBytes(address: string, bytes: Uint8Array): Promise<void> {
  const bt = requireModule();
  await ensurePermissions();

  if (!(await connected(bt, address))) {
    await bt.connectToDevice(address, { CONNECTOR_TYPE: 'rfcomm', DELIMITER: '', READ_SIZE: 1024 });
  }

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    const ok = await bt.writeToDevice(address, bytesToBase64(slice), 'base64');
    if (ok === false) throw new PrinterError('The printer stopped accepting data. Check that it is on and in range.');
    if (i + CHUNK < bytes.length) await sleep(CHUNK_PAUSE_MS);
  }
}

export async function disconnectPrinter(address: string): Promise<void> {
  const bt = nativeModule();
  if (!bt) return;
  try {
    await bt.disconnectFromDevice(address);
  } catch {
    /* already gone */
  }
}
