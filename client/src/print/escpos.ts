import { encodeRasterEscPos, type PrintSpeed } from '@shridhar/shared';
import type { Raster } from './raster';

/**
 * Wrap the rendered dots in ESC/POS: banded (24 rows at every speed), blank margins
 * dropped and blank gaps sent as paper feeds. Shared with the phone (encodeRasterEscPos).
 */
export function rasterToEscPos(raster: Raster, speed: PrintSpeed = 'fast'): Uint8Array {
  return encodeRasterEscPos(raster.bits, raster.width, raster.height, speed);
}
