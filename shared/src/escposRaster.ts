import { bandRowsFor, type PrintSpeed } from './printPace';

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Packed 1-bit rows (MSB first, `ceil(width/8)` bytes a row) as the ESC/POS stream a thermal
 * printer takes: ESC @, align left, the image in GS v 0 bands, ESC d 4 to clear the tear bar.
 *
 * Shared by the phone and the counter PC so the two cannot send different bytes.
 *
 * Cheaper than a plain dump of every row:
 *   - blank rows above the first dot and below the last are not sent at all;
 *   - blank rows inside the slip ARE sent as image rows. (APK 73 turned long blank runs into ESC J
 *     feeds; some printers feed less than asked, which squeezed the space between lines.)
 * Bands are at most bandRowsFor(speed) rows: 24 at every speed.
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

  for (let s = top; s <= bottom; s += bandRows) {
    const h = Math.min(bandRows, bottom + 1 - s);
    order.push([GS, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
    order.push({ from: s * bpr, to: (s + h) * bpr });
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
