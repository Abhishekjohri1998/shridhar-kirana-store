import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/*
 * The app's own small native module, written into the android project by
 * mobile/plugins/withStylus.js. Absent in Expo Go, in a build made before the plugin, and on
 * anything but Android -- every caller here copes with that.
 */
type ShridharNative = {
  shareToWhatsApp: (phoneE164: string, fileUri: string, text: string) => Promise<string>;
  /** Absent in builds before 59. */
  setSuggestOpen?: (open: boolean) => void;
};

const mod: ShridharNative | undefined =
  Platform.OS === 'android' ? (NativeModules.ShridharNative as ShridharNative | undefined) : undefined;

/** Whether the S Pen's button (or its eraser end) is held right now. */
let penHeld = false;

if (mod) {
  DeviceEventEmitter.addListener('penButton', (e: { down?: boolean }) => {
    penHeld = e?.down === true;
  });
}

export function penButtonHeld(): boolean {
  return penHeld;
}

export function hasNativeWhatsApp(): boolean {
  return mod != null;
}

/**
 * Opens WhatsApp in this number's chat with the picture attached; the shopkeeper taps Send.
 * Rejects when WhatsApp is not there (or the module is not in this build), so the caller can
 * fall back to the share sheet.
 */
export async function shareToWhatsApp(phoneE164: string, fileUri: string, text: string): Promise<void> {
  if (!mod) throw new Error('no native module');
  await mod.shareToWhatsApp(phoneE164, fileUri, text);
}

/** A key from a hardware keyboard, read natively: React Native's TextInput never reports arrows. */
export type HwKey = 'up' | 'down' | 'enter';

/**
 * Up, Down and Enter from a keyboard plugged into the tablet, while a text box has the cursor.
 * Returns the unsubscribe. Does nothing on a build without the module, and the on-screen
 * keyboard never sends these.
 */
export function onHardwareKey(fn: (key: HwKey) => void): () => void {
  if (!mod) return () => undefined;
  const sub = DeviceEventEmitter.addListener('hwKey', (e: { key?: string }) => {
    if (e?.key === 'up' || e?.key === 'down' || e?.key === 'enter') fn(e.key);
  });
  return () => sub.remove();
}

/**
 * Tells the native side whether a suggestion list is showing: only then are Up and Down kept
 * from moving the cursor in the box, so they move through the list instead.
 */
export function setSuggestOpen(open: boolean): void {
  try { mod?.setSuggestOpen?.(open); } catch { /* an older build */ }
}
