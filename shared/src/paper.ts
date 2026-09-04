/**
 * Paper profiles. Dot counts are the printable width at the 203 dpi these thermal heads use:
 * a 58mm roll prints 48mm of it, an 80mm roll prints 72mm.
 *
 * Sizes elsewhere in the receipt are in dots, and a dot is a physical thing -- 1/203 inch -- so
 * a 24-dot line of text is the same height on both printers. Only the width changes, which is
 * why the wider paper simply fits more per line rather than scaling everything up.
 */
export type PaperKey = '58mm' | '80mm';

export type PaperProfile = {
  key: PaperKey;
  label: string;
  /** Printable width in dots. */
  dots: number;
  /** Physical printable width, for the print stylesheet. */
  printableMm: number;
  /** Roll width, which is what @page size has to be. */
  pageMm: number;
};

export const PAPERS: Record<PaperKey, PaperProfile> = {
  '58mm': { key: '58mm', label: '58 mm (2 inch)', dots: 384, printableMm: 48, pageMm: 58 },
  '80mm': { key: '80mm', label: '80 mm (3 inch)', dots: 576, printableMm: 72, pageMm: 80 },
};

export const PAPER_KEYS: PaperKey[] = ['58mm', '80mm'];

export function paperProfile(key: string | undefined): PaperProfile {
  return PAPERS[(key as PaperKey) ?? '58mm'] ?? PAPERS['58mm'];
}

/** Widest a handwritten description may print, leaving room for the quantity and the price. */
export function inkMaxWidth(paperDots: number): number {
  return Math.max(80, paperDots - 124);
}
