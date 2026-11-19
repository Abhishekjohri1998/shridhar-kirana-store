import { useEffect, useRef } from 'react';
import { createScanDetector } from '@shridhar/shared';

/**
 * A barcode scanner on the counter PC, paired as a keyboard: it types the code very fast and
 * presses Enter (see shared/src/scan.ts for how that is told from a person typing).
 *
 * Nothing a person types is held back or lost. The scanner's characters land wherever the cursor
 * is, like any typing; when Enter completes a scan, that Enter is stopped before the page sees it,
 * the box the run landed in is put back as it was before the run began, and `onScan` gets the
 * code. With no box focused the characters land nowhere and the scan still arrives.
 */
export function useScanner(onScan: (code: string) => void, on = true): void {
  const latest = useRef(onScan);
  latest.current = onScan;
  useEffect(() => {
    if (!on) return undefined;
    const detector = createScanDetector();
    /** The box the current run started in, and what it held before the run's first key. */
    let start: { el: HTMLInputElement | HTMLTextAreaElement; value: string } | null = null;
    const forget = () => {
      detector.reset();
      start = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.repeat) {
        forget();
        return;
      }
      if (e.key === 'Enter' || e.keyCode === 13) {
        const code = detector.enter(e.timeStamp);
        const from = start;
        start = null;
        if (!code) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (from && from.el.value !== from.value) putBack(from.el, from.value);
        latest.current(code);
        return;
      }
      if (e.key.length === 1) {
        detector.char(e.key, e.timeStamp);
        // A fresh run begins with this key: remember the box as it is now, before the key lands.
        if (detector.pending().length === 1) {
          const el = document.activeElement;
          start = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? { el, value: el.value } : null;
        }
        return;
      }
      // Shift comes with every capital letter a scanner types; anything else ends the run.
      if (e.key !== 'Shift') forget();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [on]);
}

/**
 * Sets a React-controlled box's text the way typing would, so its onChange runs and the page's
 * state follows: React listens for the input event and reads the value through the native setter.
 */
function putBack(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
