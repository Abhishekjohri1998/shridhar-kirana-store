/**
 * How a banded ESC/POS slip is fed to a thermal printer that has a few hundred bytes of buffer
 * and no flow control. Pure: it returns the plan, and each transport (phone Bluetooth, Web
 * Serial, Web Bluetooth) just writes it.
 *
 * The printer drops whatever overruns its buffer, and a dropped byte inside a GS v 0 band turns
 * the rest of that band -- and every band after it -- into garbage. So: one band at a time, and
 * after each band wait as long as the head needs to burn it.
 */

export type PrintSpeed = 'fast' | 'normal' | 'safe';
/** Fastest first: the order Settings offers them in. */
export const PRINT_SPEEDS: PrintSpeed[] = ['fast', 'normal', 'safe'];
export const DEFAULT_PRINT_SPEED: PrintSpeed = 'fast';

/** Rows per GS v 0 band on Normal and Safe. 24 rows of a 58mm head is 1152 bytes. */
export const PRINT_BAND_ROWS = 24;
/** Rows per band on Fast: half the band headers and half the per-band floors. */
export const FAST_BAND_ROWS = 48;
/** Taller than this and the slip goes out as separate parts with a gap between. */
export const PRINT_PART_ROWS = 6000;

/** How tall a band may be at this speed. */
export function bandRowsFor(speed: PrintSpeed | string | undefined): number {
  return printSpeedOf({ printSpeed: speed as string | undefined }) === 'fast' ? FAST_BAND_ROWS : PRINT_BAND_ROWS;
}

export type PaceProfile = {
  rowsPerSecond: number;
  minBandWaitMs: number;
  chunk: number;
  chunkPauseMs: number;
  startWaitMs: number;
  partGapMs: number;
};

export function paceProfile(speed: PrintSpeed | string | undefined): PaceProfile {
  switch (printSpeedOf({ printSpeed: speed as string | undefined })) {
    case 'normal':
      return { rowsPerSecond: 250, minBandWaitMs: 60, chunk: 256, chunkPauseMs: 20, startWaitMs: 150, partGapMs: 500 };
    case 'safe':
      return { rowsPerSecond: 125, minBandWaitMs: 120, chunk: 256, chunkPauseMs: 40, startWaitMs: 150, partGapMs: 500 };
    default:
      return { rowsPerSecond: 600, minBandWaitMs: 15, chunk: 512, chunkPauseMs: 5, startWaitMs: 150, partGapMs: 500 };
  }
}

/** The shop's speed; anything unknown or absent is Fast. */
export function printSpeedOf(s: { printSpeed?: string } | null | undefined): PrintSpeed {
  const v = s?.printSpeed;
  return v === 'normal' || v === 'safe' ? v : 'fast';
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

/** Dots a line of the printer's own font advances by, at single height (24-dot glyph + gap). */
export const TEXT_LINE_DOTS = 30;

/** Length of the fixed-size command starting at `at`, or 1 for a plain byte. */
function commandLength(bytes: Uint8Array, at: number): number {
  const b = bytes[at];
  if (b === 0x1b) {
    const c = bytes[at + 1];
    if (c === 0x40) return 2; // ESC @
    if (c === 0x61 || c === 0x64 || c === 0x4a || c === 0x45 || c === 0x21 || c === 0x74 || c === 0x32 || c === 0x33) return 3;
    return 1;
  }
  if (b === GS && bytes[at + 1] === 0x21) return 3; // GS ! n
  return 1;
}

/**
 * The write plan for an ESC/POS stream: ESC @ then a settle, each band in chunks followed by
 * its print time, each line of text and each paper feed (ESC J / ESC d) followed by the time it
 * takes, a long gap every PRINT_PART_ROWS rows, then the trailer with no wait. Bytes are passed
 * through untouched -- concatenating the plan gives back the input exactly.
 */
export function planPrintWrites(bytes: Uint8Array, speed: PrintSpeed | string | undefined): PlannedWrite[] {
  const p = paceProfile(speed);
  const out: PlannedWrite[] = [];
  const motion = (rows: number) => Math.max(p.minBandWaitMs, Math.ceil((rows / p.rowsPerSecond) * 1000));
  let at = 0;
  let loose = 0;
  let partRows = 0;
  let textHeight = 1;
  const flush = (to: number, wait: number) => {
    if (loose < to) chunked(out, bytes.subarray(loose, to), p, wait);
    loose = to;
  };
  const addRows = (rows: number) => {
    if (partRows > 0 && partRows + rows > PRINT_PART_ROWS) {
      const prev = out[out.length - 1];
      if (prev) prev.waitAfterMs = Math.max(prev.waitAfterMs, p.partGapMs);
      partRows = 0;
    }
  };
  while (at < bytes.length) {
    const band = bytes[at] === GS ? bandAt(bytes, at) : null;
    if (band) {
      flush(at, p.chunkPauseMs);
      addRows(band.rows);
      chunked(out, bytes.subarray(at, band.end), p, motion(band.rows));
      partRows += band.rows;
      at = loose = band.end;
      continue;
    }
    const len = commandLength(bytes, at);
    const b = bytes[at]!;
    const c = bytes[at + 1];
    const n = bytes[at + 2] ?? 0;
    at += len;
    if (len === 2) {
      flush(at, p.startWaitMs); // ESC @: let the printer reset before anything else
    } else if (len === 3 && b === GS) {
      textHeight = (n & 0x0f) + 1;
    } else if (len === 3 && c === 0x21) {
      textHeight = n & 0x10 ? 2 : 1;
    } else if (len === 3 && (c === 0x4a || c === 0x64) && n > 0) {
      // Paper feeds: nothing to burn, so they do not count towards a part, but the paper still
      // takes time to move.
      flush(at, motion(c === 0x4a ? n : n * TEXT_LINE_DOTS));
    } else if (len === 1 && b === 0x0a) {
      const rows = TEXT_LINE_DOTS * textHeight;
      addRows(rows);
      flush(at, motion(rows));
      partRows += rows;
    }
  }
  flush(bytes.length, 0);
  const last = out[out.length - 1];
  if (last) last.waitAfterMs = 0;
  return out;
}
