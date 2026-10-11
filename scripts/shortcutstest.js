/**
 * Keyboard shortcuts (build 63): the key -> action table, the "top line showing" and Up/Down
 * column moves, and the rounded total on a bill's tab. Pure functions from shared/; no server.
 *
 *   node scripts/shortcutstest.js
 */
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'shared', 'dist', 'cjs', 'index.js'));

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}

console.log('\nThe client\'s list, key by key');
const want = [
  [{ key: 'F1' }, 'toggleApp'],
  [{ key: 'PageUp', ctrl: true }, 'prevBill'],
  [{ key: 'PageDown', ctrl: true }, 'nextBill'],
  [{ key: 'h', alt: true }, 'history'],
  [{ key: 'H', alt: true }, 'history'],
  [{ key: 'c', alt: true }, 'customer'],
  [{ key: 'F2' }, 'customerName'],
  [{ key: 'F2', shift: true }, 'customerNameKn'],
  [{ key: 'F3' }, 'customerPhone'],
  [{ key: 'F4' }, 'lineName'],
  [{ key: 'F5' }, 'lineQty'],
  [{ key: 'F6' }, 'lineUnit'],
  [{ key: 'F7' }, 'linePrice'],
  [{ key: 'F8' }, 'lineTick'],
  [{ key: 'a', ctrl: true }, 'tickAll'],
  [{ key: 'p', ctrl: true }, 'preview'],
  [{ key: 's', ctrl: true }, 'save'],
  [{ key: 'P', ctrl: true, shift: true }, 'print'],
];
for (const [press, action] of want) eq(S.chordOf(press) + ' is ' + action, S.shortcutFor(press), action);

console.log('\nModifiers match exactly');
eq('PageUp alone is nothing', S.shortcutFor({ key: 'PageUp' }), null);
eq('Ctrl+F4 is nothing', S.shortcutFor({ key: 'F4', ctrl: true }), null);
eq('Shift+F3 is nothing', S.shortcutFor({ key: 'F3', shift: true }), null);
eq('a plain H is typing, not History', S.shortcutFor({ key: 'h' }), null);
eq('Ctrl+Alt+S is not Save', S.shortcutFor({ key: 's', ctrl: true, alt: true }), null);
eq('Ctrl+Shift+P is Print, not Preview', S.shortcutFor({ key: 'p', ctrl: true, shift: true }), 'print');
eq('chord order is Ctrl, Shift, Alt', S.chordOf({ key: 'x', alt: true, shift: true, ctrl: true }), 'Ctrl+Shift+Alt+X');

console.log('\nOff the bill screen only F1 is live');
eq('F1 anywhere', S.shortcutFor({ key: 'F1' }, false), 'toggleApp');
eq('Ctrl+S elsewhere is nothing', S.shortcutFor({ key: 's', ctrl: true }, false), null);
eq('Alt+H elsewhere is nothing', S.shortcutFor({ key: 'h', alt: true }, false), null);

console.log('\nThe list itself');
const chords = S.SHORTCUTS.map((s) => s.chord);
check('no chord twice', new Set(chords).size === chords.length);
check('every action once', new Set(S.SHORTCUTS.map((s) => s.action)).size === S.SHORTCUTS.length);
check('every entry has a help line', S.SHORTCUTS.every((s) => S.STRINGS.en[s.labelKey] && S.STRINGS.kn[s.labelKey]));
check('only F1 is global', S.SHORTCUTS.filter((s) => s.global).map((s) => s.chord).join() === 'F1');

console.log('\nUp and Down');
eq('ArrowUp is -1', S.lineMoveFor({ key: 'ArrowUp' }), -1);
eq('ArrowDown is +1', S.lineMoveFor({ key: 'ArrowDown' }), 1);
eq('native "Down" is +1', S.lineMoveFor({ key: 'Down' }), 1);
eq('Shift+Down is not a line move', S.lineMoveFor({ key: 'ArrowDown', shift: true }), null);
eq('Left is not a line move', S.lineMoveFor({ key: 'ArrowLeft' }), null);

console.log('\nThe top line showing');
const rows = [0, 50, 100, 150, 200].map((top) => ({ top, height: 50 }));
eq('unscrolled: line 1', S.topVisibleLine(rows, 0), 0);
eq('scrolled exactly to line 3', S.topVisibleLine(rows, 100), 2);
eq('line 3 half out of sight still counts', S.topVisibleLine(rows, 125), 2);
eq('line 3 mostly gone: line 4', S.topVisibleLine(rows, 130), 3);
eq('past the end: the last line', S.topVisibleLine(rows, 900), 4);
eq('no lines', S.topVisibleLine([], 0), -1);
eq('uneven rows', S.topVisibleLine([{ top: 0, height: 120 }, { top: 120, height: 50 }], 70), 1);
eq('the cursor\'s line wins', S.shortcutLine(4, rows, 100), 4);
eq('no cursor: the top line showing', S.shortcutLine(null, rows, 100), 2);
eq('a cursor line out of range is ignored', S.shortcutLine(9, rows, 0), 0);

console.log('\nThe same column, one line over');
eq('down from 1', S.moveInColumn(1, 1, 5), 2);
eq('up from 1', S.moveInColumn(1, -1, 5), 0);
eq('up from the first stops', S.moveInColumn(0, -1, 5), null);
eq('down from the last stops (nothing is made)', S.moveInColumn(4, 1, 5), null);
eq('lines without the column are stepped over', S.moveInColumn(0, 1, 5, (i) => i !== 1 && i !== 2), 3);
eq('none left in that direction', S.moveInColumn(2, 1, 5, (i) => i < 2), null);

console.log('\nBill tabs');
eq('next', S.adjacentBill(['a', 'b', 'c'], 'a', 1), 'b');
eq('previous wraps to the last', S.adjacentBill(['a', 'b', 'c'], 'a', -1), 'c');
eq('next wraps to the first', S.adjacentBill(['a', 'b', 'c'], 'c', 1), 'a');
eq('one bill: nowhere to go', S.adjacentBill(['a'], 'a', 1), null);

console.log('\nThe tab shows the rounded total');
const line = (qty, rate) => ({ itemId: 'l' + rate, qty, rate, nameKn: 'x', nameEn: '' });
const draft = { ...S.emptyDraft('d1'), lines: [line(1, 110.04)] };
eq('rounded on a step of 1: 110, as the receipt', S.draftTotal(draft, 1), 110);
eq('step 0: to the paisa', S.draftTotal(draft, 0), 110.04);
const two = { ...S.emptyDraft('d2'), lines: [line(1, 110.04), line(3, 37.5)] };
eq('each line rounded, then added (110 + 113)', S.draftTotal(two, 1), 223);
eq('and that is the bill total the screen shows',
  S.draftTotal(two, 1), S.billTotal(S.roundLines(two.lines, 1)));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All shortcut checks passed.');
