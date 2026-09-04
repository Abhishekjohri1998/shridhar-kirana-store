/**
 * Breaking Indic text without mangling it.
 *
 * A long item description that will not fit the paper has to be broken somewhere. Slicing by code
 * unit is fine for Latin and wrong for Kannada: "ಇಪ್ಪತ್ತೈದು" cut in half gives "ಇಪ್ಪತ" and
 * "್ತೈದು", and that second piece begins with a bare virama, which prints as a stray mark on its
 * own. Cutting "ಅಕ್ಕಿ" in the middle splits the ಕ್ಕ conjunct.
 *
 * The browser already breaks correctly in the on-screen preview, so getting this wrong made the
 * preview and the paper disagree -- the one thing the shared receipt model exists to prevent.
 */

/** Virama (the "kill the inherent vowel" mark) for the Indic scripts, Kannada's being U+0CCD. */
const VIRAMA = /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D4D]$/;

/** A base character followed by any combining marks. The fallback when Intl.Segmenter is absent. */
const BASE_PLUS_MARKS = /\P{M}\p{M}*/gu;

/**
 * Split into pieces that are safe to break between: never starting with a combining mark, and
 * never splitting a consonant conjunct, because a cluster ending in a virama is joined to the one
 * after it.
 */
export function breakUnits(text: string): string[] {
  const raw = rawClusters(text);
  const out: string[] = [];
  let pending = '';
  for (const cluster of raw) {
    pending += cluster;
    // A trailing virama means the next consonant belongs to this same conjunct.
    if (VIRAMA.test(pending)) continue;
    out.push(pending);
    pending = '';
  }
  if (pending) out.push(pending);
  return out;
}

function rawClusters(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new (Intl as unknown as {
      Segmenter: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> };
    }).Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map((s) => s.segment);
  }
  return text.match(BASE_PLUS_MARKS) ?? [...text];
}

/**
 * The longest prefix of `text` that still measures within `maxWidth`, broken only where it is safe
 * to break. Returns an empty string only when even one unit will not fit, which the caller has to
 * handle to avoid looping forever.
 */
export function fitPrefix(text: string, maxWidth: number, measure: (s: string) => number): string {
  const units = breakUnits(text);
  let fitted = '';
  for (const unit of units) {
    const candidate = fitted + unit;
    if (measure(candidate) > maxWidth) break;
    fitted = candidate;
  }
  return fitted;
}
