import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bytesToBase64 } from '../lib/base64';

const PRINTER_KEY = 'shridhar.printer';

export type PairedPrinter = { name: string; address: string };

/**
 * Bluetooth Classic printing.
 *
 * This is the reason the phone app exists. A browser cannot open an SPP/RFCOMM socket -- that is
 * a hard limit of every browser -- and most cheap portable thermal printers, very likely the
 * Shreyans SRS583, speak only Classic. Android can open one directly, so from here the printer
 * needs no RawBT in between and no COM port on a PC.
 */
function nativeModule(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-bluetooth-classic');
    return mod?.default ?? mod ?? null;
  } catch {
    // Absent in Expo Go, which has no custom native code. The installed APK has it.
    return null;
  }
}

export function isPrintingAvailable(): boolean {
  return Platform.OS === 'android' && nativeModule() != null;
}

export class PrinterError extends Error {}

/** Android 12 split Bluetooth out of location into its own runtime permissions. */
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
    throw new PrinterError(
      'Bluetooth permission was refused. Allow it in Settings › Apps › Shridhar Billing › Permissions.',
    );
  }
}

function requireModule(): any {
  const bt = nativeModule();
  if (!bt) {
    throw new PrinterError(
      'Bluetooth printing needs the installed app. Inside Expo Go you can bill and preview, but not print.',
    );
  }
  return bt;
}

/** Printers are paired once in Android's own Bluetooth settings; only bonded devices are listed. */
export async function listPairedPrinters(): Promise<PairedPrinter[]> {
  const bt = requireModule();
  await ensurePermissions();
  if ((await bt.isBluetoothEnabled()) === false) {
    throw new PrinterError('Bluetooth is off. Turn it on and try again.');
  }
  const devices = await bt.getBondedDevices();
  return (devices ?? [])
    .map((d: any) => ({ name: String(d?.name ?? d?.address ?? 'Unknown'), address: String(d?.address ?? '') }))
    .filter((d: PairedPrinter) => d.address.length > 0);
}

export async function loadSavedPrinter(): Promise<PairedPrinter | null> {
  try {
    const raw = await AsyncStorage.getItem(PRINTER_KEY);
    return raw ? (JSON.parse(raw) as PairedPrinter) : null;
  } catch {
    return null;
  }
}

export async function saveSelectedPrinter(printer: PairedPrinter | null): Promise<void> {
  try {
    if (printer) await AsyncStorage.setItem(PRINTER_KEY, JSON.stringify(printer));
    else await AsyncStorage.removeItem(PRINTER_KEY);
  } catch {
    /* the choice just will not be remembered */
  }
}

async function connected(bt: any, address: string): Promise<boolean> {
  try {
    return (await bt.isDeviceConnected(address)) === true;
  } catch {
    return false;
  }
}

/** These printers hold a few hundred bytes and silently drop whatever overruns. */
const CHUNK = 512;
const CHUNK_PAUSE_MS = 40;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function printBytes(address: string, bytes: Uint8Array): Promise<void> {
  const bt = requireModule();
  await ensurePermissions();

  // Asked before connecting, so the shopkeeper is told "Bluetooth is off" rather than whatever
  // the native module says about an adapter -- which is what reached the counter as
  // "Bluetooth mAdapter is not enabled".
  if ((await bt.isBluetoothEnabled()) === false) {
    throw new PrinterError('Bluetooth is off. Turn it on and try again.');
  }

  if (!(await connected(bt, address))) {
    await bt.connectToDevice(address, { CONNECTOR_TYPE: 'rfcomm', DELIMITER: '', READ_SIZE: 1024 });
  }

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    const ok = await bt.writeToDevice(address, bytesToBase64(slice), 'base64');
    if (ok === false) {
      throw new PrinterError('The printer stopped accepting data. Check it is on and in range.');
    }
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
