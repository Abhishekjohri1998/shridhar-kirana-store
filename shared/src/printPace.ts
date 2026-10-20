/**
 * How a banded ESC/POS slip is fed to a thermal printer that has a few hundred bytes of buffer
 * and no flow control. Pure: it returns the plan, and each transport (phone Bluetooth, Web
 * Serial, Web Bluetooth) just writes it.
 *
 * The printer drops whatever overruns its buffer, and a dropped byte inside a GS v 0 band turns
 * the rest of that band -- and every band after it -- into garbage. So: one band at a time, and
 * after each band wait as long as the head needs to burn it.
 */

export type PrintSpeed = 'normal' | 'safe';
export const PRINT_SPEEDS: PrintSpeed[] = ['normal', 'safe'];
export const DEFAULT_PRINT_SPEED: PrintSpeed = 'safe';

/** Rows per GS v 0 band. 24 rows of a 58mm head is 1152 bytes. */
export const PRINT_BAND_ROWS = 24;
/** Taller than this and the slip goes out as separate parts with a gap between. */
export const PRINT_PART_ROWS = 6000;

export type PaceProfile = {
  rowsPerSecond: number;
  minBandWaitMs: number;
  chunk: number;
  chunkPauseMs: number;
  startWaitMs: number;
  partGapMs: number;
};

export function paceProfile(speed: PrintSpeed | string | undefined): PaceProfile {
  return speed === 'normal'
    ? { rowsPerSecond: 250, minBandWaitMs: 60, chunk: 256, chunkPauseMs: 20, startWaitMs: 150, partGapMs: 500 }
    : { rowsPerSecond: 125, minBandWaitMs: 120, chunk: 256, chunkPauseMs: 40, startWaitMs: 150, partGapMs: 500 };
}

export function printSpeedOf(s: { printSpeed?: string } | null | undefined): PrintSpeed {
  return s?.printSpeed === 'normal' ? 'normal' : 'safe';
}

export type PlannedWrite = { bytes: Uint8Array; waitAfterMs: number };

const GS = 0x1d;

/** The rows of a GS v 0 band starting at `at`, or -1 if there is not a whole band there. */
function bandAt(bytes: Uint8Array, at: number): { rows: number; end: number } | null {
  if (at + 8 > bytes.length || bytes[at] !== GS || bytes[at + 1] !== 0x76 || bytes[at + 2] !== 0x30) return null;
  const bpr = bytes[at + 4]! | (bytes[at + 5]! << 8);
  const rows = bytes[at + 6]! | (bytes[at + 7]! << 8);
  const end = at + 8 + bpr * rows;
  return end <= bytes.length ? { rows, end } : null;
}

function chunked(out: PlannedWrite[], bytes: Uint8Array, p: PaceProfile, lastWait: number): void {
  for (let i = 0; i < bytes.length; i += p.chunk) {
    const last = i + p.chunk >= bytes.length;
    out.push({ bytes: bytes.subarray(i, Math.min(i + p.chunk, bytes.length)), waitAfterMs: last ? lastWait : p.chunkPauseMs });
  }
}

/**
 * The write plan for an ESC/POS stream: the preamble (ESC @ ...) then a pause, each band in
 * chunks followed by its print time, a long gap every PRINT_PART_ROWS rows, then the trailer.
 * Bytes are passed through untouched -- concatenating the plan gives back the input exactly.
 */
export function planPrintWrites(bytes: Uint8Array, speed: PrintSpeed | string | undefined): PlannedWrite[] {
  const p = paceProfile(speed);
  const out: PlannedWrite[] = [];
  let at = 0;
  let loose = at;
  let sawBand = false;
  let partRows = 0;
  while (at < bytes.length) {
    const band = bytes[at] === GS ? bandAt(bytes, at) : null;
    if (!band) {
      at++;
      continue;
    }
    if (loose < at) chunked(out, bytes.subarray(loose, at), p, sawBand ? p.chunkPauseMs : p.startWaitMs);
    if (partRows > 0 && partRows + band.rows > PRINT_PART_ROWS) {
      const prev = out[out.length - 1];
      if (prev) prev.waitAfterMs = Math.max(prev.waitAfterMs, p.partGapMs);
      partRows = 0;
    }
    const burn = Math.max(p.minBandWaitMs, Math.ceil((band.rows / p.rowsPerSecond) * 1000));
    chunked(out, bytes.subarray(at, band.end), p, burn);
    partRows += band.rows;
    sawBand = true;
    at = loose = band.end;
  }
  if (loose < bytes.length) chunked(out, bytes.subarray(loose), p, 0);
  const last = out[out.length - 1];
  if (last) last.waitAfterMs = 0;
  return out;
}
