import { bandRowsFor, type PrintSpeed } from './printPace';

const ESC = 0x1b;
const GS = 0x1d;

/** A run of fully blank rows at least this long goes out as a paper feed, not as image data. */
export const BLANK_FEED_MIN_ROWS = 8;

/**
 * Packed 1-bit rows (MSB first, `ceil(width/8)` bytes a row) as the ESC/POS stream a thermal
 * printer takes: ESC @, align left, the image in GS v 0 bands, ESC d 4 to clear the tear bar.
 *
 * Shared by the phone and the counter PC so the two cannot send different bytes.
 *
 * Cheaper than a plain dump of every row:
 *   - blank rows above the first dot and below the last are not sent at all;
 *   - a run of BLANK_FEED_MIN_ROWS or more fully blank rows inside the slip becomes ESC J n
 *     (feed n dots), so a gap costs three bytes instead of a band. The paper still moves the same
 *     distance, so everything between the first and last dot lands where it did.
 * Bands are at most bandRowsFor(speed) rows: 48 on Fast, 24 otherwise.
 */
export function encodeRasterEscPos(
  bits: Uint8Array, width: number, height: number, speed: PrintSpeed | string | undefined,
): Uint8Array {
  const bpr = Math.ceil(width / 8);
  const bandRows = bandRowsFor(speed);
  const blank = (y: number) => {
    for (let i = y * bpr, end = i + bpr; i < end; i++) if (bits[i]) return false;
    return true;
  };
  let top = 0;
  while (top < height && blank(top)) top++;
  let bottom = height - 1;
  while (bottom >= top && blank(bottom)) bottom--;

  const order: Array<number[] | { from: number; to: number }> = [[ESC, 0x40], [ESC, 0x61, 0x00]];

  // Length of the blank run starting at y (0 when y has dots), never past `bottom`.
  const runAt = (y: number) => {
    let r = 0;
    while (y + r <= bottom && blank(y + r)) r++;
    return r;
  };

  let y = top;
  while (y <= bottom) {
    const start = y;
    while (y <= bottom) {
      const r = runAt(y);
      if (r >= BLANK_FEED_MIN_ROWS) break;
      y += Math.max(1, r);
    }
    for (let s = start; s < y; s += bandRows) {
      const h = Math.min(bandRows, y - s);
      order.push([GS, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
      order.push({ from: s * bpr, to: (s + h) * bpr });
    }
    if (y <= bottom) {
      let r = runAt(y);
      y += r;
      while (r > 0) {
        const n = Math.min(255, r);
        order.push([ESC, 0x4a, n]);
        r -= n;
      }
    }
  }
  order.push([ESC, 0x64, 0x04]); // feed 4 lines so the slip clears the tear bar

  const size = order.reduce((n, o) => n + (Array.isArray(o) ? o.length : o.to - o.from), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const o of order) {
    if (Array.isArray(o)) { out.set(o, at); at += o.length; }
    else { out.set(bits.subarray(o.from, o.to), at); at += o.to - o.from; }
  }
  return out;
}
