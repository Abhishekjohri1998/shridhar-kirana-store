/**
 * Telling a barcode scanner from a person typing.
 *
 * A Bluetooth scanner in its usual mode pairs as a keyboard: it types the code's characters a few
 * milliseconds apart and presses Enter. Nobody types like that. So a run of at least
 * SCAN_MIN_CHARS characters, every one within SCAN_MAX_GAP_MS of the one before and Enter within
 * the same gap of the last, is a scan; anything slower is typing and is left alone.
 *
 * Used the same way by the website (key events in the browser) and the tablet (whose native code
 * keeps the same numbers; plugintest checks they agree).
 */

/** Fewest characters a scan has: EAN-8 is 8, the shop's own labels may be shorter. */
export const SCAN_MIN_CHARS = 6;
/** Longest wait between two of a scanner's keys. A fast typist's best is around 60-80 ms. */
export const SCAN_MAX_GAP_MS = 40;
/** Longest code kept; anything longer is not a product barcode. */
export const SCAN_MAX_CHARS = 32;

/** What a scanned code may contain once read. */
const CODE = /^[0-9A-Za-z-]+$/;

export interface ScanDetector {
  /** A printable character arrived at `at` (milliseconds, any clock that only goes forward). */
  char(c: string, at: number): void;
  /** Enter arrived at `at`: the scanned code, or null when this was a person typing. */
  enter(at: number): string | null;
  /** Any other key (Backspace, an arrow, a shortcut): the run so far is not a scan. */
  reset(): void;
  /** The run so far, as it would be read. */
  pending(): string;
}

export function createScanDetector(opts: { minChars?: number; maxGapMs?: number } = {}): ScanDetector {
  const minChars = opts.minChars ?? SCAN_MIN_CHARS;
  const maxGap = opts.maxGapMs ?? SCAN_MAX_GAP_MS;
  let run = '';
  let last = -Infinity;
  return {
    char(c, at) {
      if (c.length !== 1) {
        run = '';
        last = -Infinity;
        return;
      }
      // Too slow after the last one: a new run starts with this character.
      if (at - last > maxGap) run = '';
      run += c;
      last = at;
      if (run.length > SCAN_MAX_CHARS) run = run.slice(-SCAN_MAX_CHARS);
    },
    enter(at) {
      const code = run;
      const quick = at - last <= maxGap;
      run = '';
      last = -Infinity;
      return quick && code.length >= minChars && CODE.test(code) ? code : null;
    },
    reset() {
      run = '';
      last = -Infinity;
    },
    pending() {
      return run;
    },
  };
}

/** What the billing server answers for a scanned code. */
export type ScanAnswer<Item> =
  | { kind: 'found'; item: Item }
  /** Stock has no item with that code; it now waits for the admin under "Scanned, not linked". */
  | { kind: 'unknown' }
  /** The link to stock is off or did not answer. */
  | { kind: 'off' };
