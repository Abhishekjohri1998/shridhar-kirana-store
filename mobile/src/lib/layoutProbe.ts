/**
 * How tall the app shell actually measured.
 *
 * Written by App.tsx as the shell lays out, read by the Settings screen so a shopkeeper in
 * another town can photograph the number. Those two are not parent and child, and threading a
 * React context through the whole tree for one diagnostic would cost more than it explains.
 *
 * Deliberately mutable and deliberately small: when the layout question that prompted it is
 * settled, this file and its two call sites delete cleanly.
 */
export const layoutProbe = { shellHeight: 0 };

/**
 * Whether to print the measurements on the bill screen itself.
 *
 * The tab bar sits mid-screen on one tablet and nowhere else, and three fixes aimed at the
 * layout have all missed -- because the question that decides between "the layout did not fill
 * its window" and "Android gave the app a short window" has never actually been measured on the
 * device. The numbers are already in Settings, but a screenshot of the bill screen is what
 * arrives; so for now they go where they will be seen.
 *
 * Set to false, and this constant, the line in App.tsx and its two onLayout handlers all come
 * out together.
 */
export const SHOW_LAYOUT_PROBE = true;

export function recordShellHeight(height: number): void {
  layoutProbe.shellHeight = Math.round(height);
}
