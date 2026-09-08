import { useEffect, useState } from 'react';

/**
 * The edges of the screen the shell is drawn on, held steady while a dialog is open.
 *
 * A transparent Modal is a window of its own, and on Android the safe-area insets reported to
 * the app change while one is up. The shell padded its bottom with the live figure, so opening a
 * bill preview lifted the whole shell -- tab bar and all -- off the bottom edge and left a band
 * of empty cream beneath it, on the tablet and on a phone alike.
 *
 * The values measured with no dialog open are the ones that describe the actual screen, so those
 * are the ones the layout keeps. The modal count is what tells the two apart.
 *
 * A module of its own rather than a corner of App.tsx: Dialog needs the counter and App needs
 * the insets, and importing App from a component App itself renders is a cycle -- the kind that
 * leaves a hoisted function undefined at the moment it is called.
 */
const held = {
  top: 0,
  bottom: 0,
  subscribers: new Set<(v: { top: number; bottom: number }) => void>(),
};

let modalsOpen = 0;

/** Called by Dialog on the way in and out. The only Modal in the app is the one it owns. */
export function enterModal(): void {
  modalsOpen += 1;
}

export function exitModal(): void {
  modalsOpen = Math.max(0, modalsOpen - 1);
}

export function useHeldInsets(): { top: number; bottom: number } {
  const [value, setValue] = useState({ top: held.top, bottom: held.bottom });
  useEffect(() => {
    held.subscribers.add(setValue);
    return () => { held.subscribers.delete(setValue); };
  }, []);
  return value;
}

/** Ignored outright while a dialog is up -- that measurement describes the Modal, not the screen. */
export function reportInsets(top: number, bottom: number): void {
  if (modalsOpen > 0) return;
  const t = Math.round(top);
  const b = Math.round(bottom);
  if (t === held.top && b === held.bottom) return;
  held.top = t;
  held.bottom = b;
  held.subscribers.forEach((fn) => fn({ top: t, bottom: b }));
}
