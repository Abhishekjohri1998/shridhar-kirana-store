/**
 * Where to scroll the slip so the newest line leads a fresh page.
 *
 * The shop writes an item, prices it, writes the next. Scrolling to the very end after each one
 * pins the line being written to the bottom edge of the screen, so every item is written at the
 * foot of the glass. Paper does not behave that way: a page fills, and then you are at the top of
 * the next one with room for six or seven more.
 *
 * So this answers with a scroll position only when the newest line has actually fallen out of
 * view, and that position puts it at the top. While there is still room the answer is `null` and
 * the page does not move at all -- a slip that re-centred on every item would be the jumpy
 * version of this, and moving the page under a pen that is mid-word is the thing to avoid above
 * all else.
 */
export function pageFlip(view: {
  /** The newest row's offset inside the scrolling content. */
  rowTop: number;
  rowHeight: number;
  /** How much is currently scrolled off the top. */
  offset: number;
  /** The visible height of the slip. */
  viewport: number;
}): number | null {
  const { rowTop, rowHeight, offset, viewport } = view;
  // Nothing measured yet -- a first render must not scroll anywhere.
  if (viewport <= 0 || rowHeight <= 0) return null;

  const above = rowTop < offset;
  const below = rowTop + rowHeight > offset + viewport;
  if (!above && !below) return null;

  // Its own top, not a nudge by one row: the point is a clear page underneath it.
  return Math.max(0, rowTop);
}

/**
 * How much blank slip to leave under the last line.
 *
 * For the newest row to reach the top of the screen there has to be something below it to scroll
 * into, so the content is padded by a page less that one row. It is what the foot of a paper page
 * looks like anyway, and it shrinks as each new line fills it.
 */
export function slipTailPadding(viewport: number, rowHeight: number): number {
  if (viewport <= 0 || rowHeight <= 0) return 0;
  return Math.max(0, Math.round(viewport - rowHeight));
}
