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
  /** Absent in builds before 62. */
  setTakeEnter?: (on: boolean) => void;
  /** Absent in builds before 63. */
  setShortcuts?: (level: number) => void;
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

/**
 * Tells the native side a bill box has the cursor, so a hardware Enter is used up there and
 * reaches JavaScript once, as `hwKey` 'enter', instead of also going on to the text box (where
 * Android submitted it twice and moved the cursor down on its own). The caller then does what
 * the box's submit would have done.
 */
export function setTakeEnter(on: boolean): void {
  try { mod?.setTakeEnter?.(on); } catch { /* an older build */ }
}

/** Whether this build takes Enter natively (62 on); before that the box's own submit does. */
export function takesEnter(): boolean {
  return typeof mod?.setTakeEnter === 'function';
}

/** A shortcut chord from a hardware keyboard (build 63), as shared/src/shortcuts.ts reads it. */
export type HwShortcut = { key: string; ctrl: boolean; shift: boolean; alt: boolean };

/**
 * Keyboard shortcuts read natively: F1-F8, Ctrl+PageUp/PageDown, Alt+H/C, Ctrl+A/P/S,
 * Ctrl+Shift+P. Only sent while switched on with setShortcuts. Returns the unsubscribe.
 */
export function onHardwareShortcut(fn: (e: HwShortcut) => void): () => void {
  if (!mod) return () => undefined;
  const sub = DeviceEventEmitter.addListener('hwShortcut', (e: Partial<HwShortcut>) => {
    if (typeof e?.key !== 'string') return;
    fn({ key: e.key, ctrl: e.ctrl === true, shift: e.shift === true, alt: e.alt === true });
  });
  return () => sub.remove();
}

/**
 * Which shortcuts the native side keeps from everything else: 0 none, 1 F1 alone (any screen
 * of the billing app, and Stock), 2 the bill screen's whole list.
 */
export function setShortcuts(level: 0 | 1 | 2): void {
  try { mod?.setShortcuts?.(level); } catch { /* an older build */ }
}
