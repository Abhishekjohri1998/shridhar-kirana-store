import { encodeRasterEscPos, type PrintSpeed } from '@shridhar/shared';
import { base64ToBytes } from '../lib/base64';
import type { Raster } from './RasterBridge';

/**
 * Wrap the rendered dots in the ESC/POS commands a thermal printer expects: banded (48 rows on
 * Fast, 24 otherwise), blank margins dropped and blank gaps sent as paper feeds. The encoding is
 * shared with the counter PC (encodeRasterEscPos), so the two send the same bytes.
 */
export function rasterToEscPos(raster: Raster, speed: PrintSpeed = 'fast'): Uint8Array {
  return encodeRasterEscPos(base64ToBytes(raster.data), raster.width, raster.height, speed);
}
