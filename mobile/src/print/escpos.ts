import { base64ToBytes } from '../lib/base64';
import type { Raster } from './RasterBridge';

const ESC = 0x1b;
const GS = 0x1d;

/** Rows per GS v 0 command. These printers have small input buffers and garble or drop a single
 *  tall image, so the receipt goes out as a stack of short bands instead. */
const BAND = 64;

/** Wrap the rendered dots in the ESC/POS commands a thermal printer expects. */
export function rasterToEscPos(raster: Raster): Uint8Array {
  const bits = base64ToBytes(raster.data);
  const bpr = Math.ceil(raster.width / 8);
  const bands = Math.ceil(raster.height / BAND);
  const out = new Uint8Array(2 + 3 + bands * 8 + bits.length + 3);
  let at = 0;
  const push = (...bytes: number[]) => {
    for (const b of bytes) out[at++] = b;
  };

  push(ESC, 0x40); // initialise
  push(ESC, 0x61, 0x00); // align left

  for (let y = 0; y < raster.height; y += BAND) {
    const h = Math.min(BAND, raster.height - y);
    // GS v 0 m xL xH yL yH -- m=0 is normal density
    push(GS, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff);
    out.set(bits.subarray(y * bpr, (y + h) * bpr), at);
    at += h * bpr;
  }

  push(ESC, 0x64, 0x04); // feed 4 lines so the slip clears the tear bar
  return out.subarray(0, at);
}
