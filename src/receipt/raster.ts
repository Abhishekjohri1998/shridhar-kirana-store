/** A rendered receipt as printer dots: `data` is base64 packed bits, MSB first, 1 = black. */
export type Raster = { width: number; height: number; data: string };
