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

export function recordShellHeight(height: number): void {
  layoutProbe.shellHeight = Math.round(height);
}
