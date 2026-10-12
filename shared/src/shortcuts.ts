/**
 * Keyboard shortcuts for the bill screen, shared by the web app, the tablet app and the tests.
 *
 * The client's own list. A key press is reduced to a chord -- Ctrl, Shift, Alt and one key name,
 * always in that order, e.g. "Ctrl+Shift+P" -- and the chord names an action. Modifiers match
 * exactly, so F2 and Shift+F2 are different keys and Ctrl+F4 is nothing at all.
 *
 * The tablet's native key hook (mobile/plugins/withStylus.js) holds the same chord list, so it
 * knows which keys to keep from the text boxes; scripts/plugintest.js checks the two agree.
 */
import type { MsgKey } from './i18n';

export type ShortcutAction =
  | 'toggleApp'
  | 'prevBill'
  | 'nextBill'
  | 'history'
  | 'bill'
  | 'settings'
  | 'hideNames'
  | 'customer'
  | 'customerName'
  | 'customerNameKn'
  | 'customerPhone'
  | 'lineName'
  | 'lineQty'
  | 'lineUnit'
  | 'linePrice'
  | 'lineTick'
  | 'tickAll'
  | 'preview'
  | 'save'
  | 'print';

export interface Shortcut {
  chord: string;
  action: ShortcutAction;
  /** Works on every screen, not only the bill (F1, Alt+B, Alt+S). */
  global?: boolean;
  /** Its line in the help list. */
  labelKey: MsgKey;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { chord: 'F1', action: 'toggleApp', global: true, labelKey: 'keys.toggleApp' },
  { chord: 'Ctrl+PageUp', action: 'prevBill', labelKey: 'keys.prevBill' },
  { chord: 'Ctrl+PageDown', action: 'nextBill', labelKey: 'keys.nextBill' },
  { chord: 'Alt+B', action: 'bill', global: true, labelKey: 'keys.bill' },
  { chord: 'Alt+H', action: 'history', labelKey: 'keys.history' },
  { chord: 'Alt+S', action: 'settings', global: true, labelKey: 'keys.settings' },
  { chord: 'Alt+C', action: 'customer', labelKey: 'keys.customer' },
  { chord: 'F2', action: 'customerName', labelKey: 'keys.customerName' },
  { chord: 'Shift+F2', action: 'customerNameKn', labelKey: 'keys.customerNameKn' },
  { chord: 'F3', action: 'customerPhone', labelKey: 'keys.customerPhone' },
  { chord: 'F4', action: 'lineName', labelKey: 'keys.lineName' },
  { chord: 'F5', action: 'lineQty', labelKey: 'keys.lineQty' },
  { chord: 'F6', action: 'lineUnit', labelKey: 'keys.lineUnit' },
  { chord: 'F7', action: 'linePrice', labelKey: 'keys.linePrice' },
  { chord: 'F8', action: 'lineTick', labelKey: 'keys.lineTick' },
  { chord: 'Ctrl+H', action: 'hideNames', labelKey: 'keys.hideNames' },
  { chord: 'Ctrl+A', action: 'tickAll', labelKey: 'keys.tickAll' },
  { chord: 'Ctrl+P', action: 'preview', labelKey: 'keys.preview' },
  { chord: 'Ctrl+S', action: 'save', labelKey: 'keys.save' },
  { chord: 'Ctrl+Shift+P', action: 'print', labelKey: 'keys.print' },
];

/** A key press as either app sees it. `key` is a KeyboardEvent.key or the native key name. */
export interface KeyPress {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** "a" -> "A", "ArrowUp" -> "Up"; F-keys and PageUp/PageDown as they are. */
export function keyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (key === 'ArrowUp') return 'Up';
  if (key === 'ArrowDown') return 'Down';
  return key;
}

export function chordOf(p: KeyPress): string {
  return (p.ctrl ? 'Ctrl+' : '') + (p.shift ? 'Shift+' : '') + (p.alt ? 'Alt+' : '') + keyName(p.key);
}

/** The action a key press asks for, or null. `billScreen` false leaves only the global ones. */
export function shortcutFor(p: KeyPress, billScreen = true): ShortcutAction | null {
  const chord = chordOf(p);
  const hit = SHORTCUTS.find((s) => s.chord === chord);
  if (!hit) return null;
  return billScreen || hit.global ? hit.action : null;
}

/** Up and Down between lines, with no modifier; anything else is not a line move. */
export function lineMoveFor(p: KeyPress): -1 | 1 | null {
  if (p.ctrl || p.shift || p.alt) return null;
  const k = keyName(p.key);
  return k === 'Up' ? -1 : k === 'Down' ? 1 : null;
}

/** The columns of a bill line a cursor can be in. */
export type LineColumn = 'name' | 'qty' | 'unit' | 'price' | 'tick';

/**
 * The top-most line showing in the scroll area: the first whose middle is at or below the top
 * edge, so a line scrolled half out of sight does not count. `rows` are in content coordinates
 * (top from the start of the list), in bill order. -1 for no rows.
 */
export function topVisibleLine(rows: readonly { top: number; height: number }[], offset: number): number {
  if (rows.length === 0) return -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.top + r.height / 2 >= offset) return i;
  }
  return rows.length - 1;
}

/**
 * Which line F5-F8 act on: always the top-most line showing on screen -- never the line the
 * cursor happens to be in, and never line 1 unless it is the one at the top.
 */
export function shortcutLine(rows: readonly { top: number; height: number }[], offset: number): number {
  return topVisibleLine(rows, offset);
}

/**
 * Which line F4 (item name) goes to: the top-most line showing on screen that is not
 * handwritten (`written`). None showing: the first such line below the visible area. -1 when
 * there is none at all, and the caller makes a new line. (A typed line inside the visible area
 * comes before any below it, so one scan down from the top line covers both.)
 */
export function nameShortcutLine(
  rows: readonly { top: number; height: number }[],
  offset: number,
  written: (i: number) => boolean,
): number {
  const top = topVisibleLine(rows, offset);
  if (top < 0) return -1;
  for (let i = top; i < rows.length; i++) if (!written(i)) return i;
  return -1;
}

/**
 * The line Up or Down moves to in the same column: the nearest one in that direction that has
 * the column (`has`). Null at either end -- nothing is created and nothing wraps.
 */
export function moveInColumn(
  index: number,
  delta: -1 | 1,
  count: number,
  has: (i: number) => boolean = () => true,
): number | null {
  for (let i = index + delta; i >= 0 && i < count; i += delta) {
    if (has(i)) return i;
  }
  return null;
}

/**
 * The bill tab before or after the active one. No wrap: before the first stays put (null), and
 * after the last is 'new' -- Ctrl+PageDown on the last bill starts a new one, as "+ New bill".
 */
export function adjacentBill(ids: readonly string[], active: string, delta: -1 | 1): string | 'new' | null {
  const at = ids.indexOf(active);
  const from = at < 0 ? 0 : at;
  const to = from + delta;
  if (to < 0) return null;
  if (to >= ids.length) return delta === 1 ? 'new' : null;
  return ids[to] ?? null;
}

/** The customer box a shortcut puts the cursor in, or null for any other action. */
export type CustomerField = 'name' | 'nameKn' | 'phone';
export function customerFieldFor(action: ShortcutAction): CustomerField | null {
  switch (action) {
    case 'customer': case 'customerName': return 'name';
    case 'customerNameKn': return 'nameKn';
    case 'customerPhone': return 'phone';
    default: return null;
  }
}

/**
 * Focusing a customer box that may not be on screen yet: the section is folded away (web) or
 * shows the attached customer's chip. `mounted` says whether the boxes exist now. Returns what
 * to do: focus straight away, or open the section and focus once the box mounts.
 */
export function customerFocusPlan(mounted: boolean): 'focus' | 'openThenFocus' {
  return mounted ? 'focus' : 'openThenFocus';
}
