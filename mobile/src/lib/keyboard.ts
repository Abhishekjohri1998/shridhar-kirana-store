import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Whether the on-screen keyboard is up.
 *
 * The app had no idea. Android is configured `adjustResize`, so the window really does shrink
 * when the keyboard opens -- but the shell holds a floor under its own height (the safe-area
 * frame measured while there was no keyboard), so the content stayed full height and the
 * overflow came out of the one band that can shrink: the slip card, which clips. On a phone the
 * item list went to nothing, and the shopkeeper could not see the line being written.
 *
 * `keyboardDidShow` rather than `WillShow`: Android does not fire the will- events.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return open;
}
