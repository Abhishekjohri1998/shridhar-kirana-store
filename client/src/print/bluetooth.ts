/**
 * Direct ESC/POS printing over Web Bluetooth.
 *
 * Two hard limits worth knowing before relying on this:
 *  - Web Bluetooth only speaks Bluetooth Low Energy. A browser cannot open a Bluetooth Classic
 *    (SPP/RFCOMM) serial port at all, and most cheap Indian pocket printers are Classic. For those,
 *    print through the operating system instead -- that path is in ./index.ts.
 *  - It needs Chrome or Edge, and a secure context (https, or localhost during development).
 */

/**
 * Service UUIDs seen on BLE receipt printers. Web Bluetooth will not let a page touch a service
 * it did not declare up front, so this list is the limit of what can be discovered -- but within
 * each service the characteristic is found by asking which ones are writable, rather than by
 * hardcoding a UUID, because these generic units are not consistent about it.
 */
const PRINTER_SERVICES: (number | string)[] = [
  0xffe0,
  0xff00,
  0x18f0,
  0xae30,
  0xfee7,
  0xff80,
  0xffb0,
  0x1811,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];

/** BLE writes are capped by the negotiated MTU; 180 bytes is under every printer we have seen. */
const CHUNK = 180;
/**
 * Only used for printers that offer write-without-response and nothing else. An acknowledged
 * write paces itself, but an unacknowledged one has no backpressure at all, so those need a
 * gap -- and a gap means a timer, which browsers throttle to about a second once the tab goes to
 * the background. A long receipt would then take minutes, or stop halfway. Hence the preference
 * for acknowledged writes below.
 */
const CHUNK_PAUSE_MS = 20;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BluetoothPrintError extends Error {}

type Connected = {
  name: string;
  characteristic: BluetoothRemoteGATTCharacteristic;
  device: BluetoothDevice;
};

let connected: Connected | null = null;

export function isWebBluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function connectedPrinterName(): string | null {
  return connected?.device.gatt?.connected ? connected.name : null;
}

/**
 * Ask the browser to show its device chooser, then find a characteristic we can write to.
 * Must be called from a click -- the browser refuses a device request without a user gesture.
 */
export async function chooseBluetoothPrinter(): Promise<string> {
  if (!isWebBluetoothAvailable()) {
    throw new BluetoothPrintError(
      'This browser has no Web Bluetooth. Use Chrome, or print through the system dialog instead.',
    );
  }

  const device = await navigator.bluetooth.requestDevice({
    // acceptAllDevices, because printers advertise a wide spread of vendor service ids and a
    // filtered chooser tends to show nothing at all.
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });

  const gatt = await device.gatt?.connect();
  if (!gatt) throw new BluetoothPrintError('Could not open a connection to that device');

  const seen: string[] = [];
  for (const service of PRINTER_SERVICES) {
    let characteristics: BluetoothRemoteGATTCharacteristic[];
    try {
      const found = await gatt.getPrimaryService(service);
      characteristics = await found.getCharacteristics();
      seen.push(String(service));
    } catch {
      continue; // Device does not expose this one.
    }
    // Any characteristic we are allowed to write to will carry ESC/POS.
    const writable = characteristics.find(
      (c) => c.properties.write || c.properties.writeWithoutResponse,
    );
    if (!writable) continue;

    connected = { name: device.name ?? 'Bluetooth printer', characteristic: writable, device };
    device.addEventListener('gattserverdisconnected', () => {
      connected = null;
    });
    return connected.name;
  }

  gatt.disconnect();
  throw new BluetoothPrintError(
    seen.length === 0
      ? 'That device exposes no printer service the browser is allowed to use. It is almost certainly a Bluetooth Classic printer, which no website can reach directly -- use the serial port or the system print dialog instead.'
      : 'Found service ' + seen.join(', ') + ' on that device but nothing writable in it. Use the serial port or the system print dialog instead.',
  );
}

export async function printBytesOverBluetooth(bytes: Uint8Array): Promise<void> {
  if (!connected || !connected.device.gatt?.connected) {
    throw new BluetoothPrintError('No Bluetooth printer is connected. Choose one first.');
  }
  const { characteristic } = connected;

  const acknowledged = characteristic.properties.write;

  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    if (acknowledged) {
      await characteristic.writeValue(slice as unknown as BufferSource);
    } else {
      await characteristic.writeValueWithoutResponse(slice as unknown as BufferSource);
      if (i + CHUNK < bytes.length) await sleep(CHUNK_PAUSE_MS);
    }
  }
}
