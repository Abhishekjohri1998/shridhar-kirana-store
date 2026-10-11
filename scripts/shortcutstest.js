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
  [{ key: 'b', alt: true }, 'bill'],
  [{ key: 's', alt: true }, 'settings'],
  [{ key: 'h', ctrl: true }, 'hideNames'],
  [{ key: 'H', ctrl: true }, 'hideNames'],
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

console.log('\nOff the bill screen only F1, Alt+B and Alt+S are live');
eq('F1 anywhere', S.shortcutFor({ key: 'F1' }, false), 'toggleApp');
eq('Ctrl+S elsewhere is nothing', S.shortcutFor({ key: 's', ctrl: true }, false), null);
eq('Alt+H elsewhere is nothing', S.shortcutFor({ key: 'h', alt: true }, false), null);
eq('Alt+B anywhere', S.shortcutFor({ key: 'b', alt: true }, false), 'bill');
eq('Alt+S anywhere', S.shortcutFor({ key: 's', alt: true }, false), 'settings');
eq('Ctrl+H elsewhere is nothing', S.shortcutFor({ key: 'h', ctrl: true }, false), null);

console.log('\nThe list itself');
const chords = S.SHORTCUTS.map((s) => s.chord);
check('no chord twice', new Set(chords).size === chords.length);
check('every action once', new Set(S.SHORTCUTS.map((s) => s.action)).size === S.SHORTCUTS.length);
check('every entry has a help line', S.SHORTCUTS.every((s) => S.STRINGS.en[s.labelKey] && S.STRINGS.kn[s.labelKey]));
check('F1, Alt+B and Alt+S are the global ones', S.SHORTCUTS.filter((s) => s.global).map((s) => s.chord).sort().join() === 'Alt+B,Alt+S,F1');
eq('Ctrl+H is not Alt+H', S.shortcutFor({ key: 'h', ctrl: true }), 'hideNames');
eq('a plain B is typing', S.shortcutFor({ key: 'b' }), null);

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
eq('previous on the first stays (no wrap)', S.adjacentBill(['a', 'b', 'c'], 'a', -1), null);
eq('next on the last makes a new bill (no wrap)', S.adjacentBill(['a', 'b', 'c'], 'c', 1), 'new');
eq('one bill: Ctrl+PageDown makes a new bill', S.adjacentBill(['a'], 'a', 1), 'new');
eq('one bill: Ctrl+PageUp stays', S.adjacentBill(['a'], 'a', -1), null);
eq('previous from the middle', S.adjacentBill(['a', 'b', 'c'], 'b', -1), 'a');

console.log('\nThe tab shows the rounded total');
const line = (qty, rate) => ({ itemId: 'l' + rate, qty, rate, nameKn: 'x', nameEn: '' });
const draft = { ...S.emptyDraft('d1'), lines: [line(1, 110.04)] };
eq('rounded on a step of 1: 110, as the receipt', S.draftTotal(draft, 1), 110);
eq('step 0: to the paisa', S.draftTotal(draft, 0), 110.04);
const two = { ...S.emptyDraft('d2'), lines: [line(1, 110.04), line(3, 37.5)] };
eq('each line rounded, then added (110 + 113)', S.draftTotal(two, 1), 223);
eq('and that is the bill total the screen shows',
  S.draftTotal(two, 1), S.billTotal(S.roundLines(two.lines, 1)));

console.log('\nRates keep their precision (build 64)');
eq('500 g at 0.056: the rate is kept on a step of 1', S.roundedRate(500, 0.056, 1), 0.056);
eq('and on no step', S.roundedRate(500, 0.056, 0), 0.056);
eq('the line is 28', S.roundedLineAmount(500, 0.056, 1), 28);
eq('roundLines keeps 0.056', S.roundLines([{ itemId: 'g', nameKn: '', nameEn: '', qty: 500, rate: 0.056 }], 1)[0].rate, 0.056);
{
  const r = S.roundedRate(7, 13.333, 1); // 93.331 -> 93
  check('93.331 -> 93: qty x rate is 93', S.lineAmount(7, r) === 93, String(r));
  check('and the rate is not cut to 2 decimals', Math.abs(r - 93 / 7) < 1e-9, String(r));
}
eq('"each" shows 0.056', S.rateText(0.056), '0.056');
eq('"each" shows 12.50', S.rateText(12.5), '12.50');
eq('"each" shows 170', S.rateText(170), '170');
eq('"each" shows 166.667 for 500/3', S.rateText(500 / 3), '166.667');

console.log('\nWiring (build 64)');
{
  const rd = (p) => require('node:fs').readFileSync(path.join(__dirname, '..', p), 'utf8');
  for (const f of ['mobile/src/screens/BillScreen.tsx', 'client/src/pages/BillPage.tsx']) {
    const src = rd(f);
    check(f + ': Ctrl+PageDown on the last bill makes a new one', src.includes("if (id === 'new') shop.newBill();"));
    check(f + ': Ctrl+H toggles hideNames', src.includes("case 'hideNames': shop.setHideNames(!shop.hideNames); return;"));
    check(f + ': "each" shows the rate to 3 places', src.includes("t('bill.each', { rate: rateText(line.rate) })"));
  }
  check('web: Ctrl+H never opens the browser history', rd('client/src/pages/BillPage.tsx').includes("if (shortcutFor(press) === 'hideNames') e.preventDefault();"));
  check('web: Alt+B and Alt+S from any page', rd('client/src/App.tsx').includes("navigate(action === 'bill' ? '/bill' : '/settings')"));
  check('tablet: Alt+B and Alt+S from any screen', rd('mobile/App.tsx').includes("global === 'bill' || global === 'settings'"));
  const stock = rd('mobile/src/screens/StockScreen.tsx');
  check('stock spinner: onLoadStart no longer sets it', !/onLoadStart=\{[^\n]*setLoading\(true\)/.test(stock));
  check('stock spinner: cleared at full progress', stock.includes('if (e.nativeEvent.progress >= 1) setLoading(false);'));
  check('stock spinner: 10 s safety timer', stock.includes('const SPINNER_MAX_MS = 10000;') && stock.includes('setTimeout(() => setLoading(false), SPINNER_MAX_MS)'));
  check('stock spinner: still shown for our own retries', /const retryNow[\s\S]{0,200}setLoading\(true\)/.test(stock));
}

console.log('\nCustomer boxes, even when the section is folded away');
eq('F2 -> name', S.customerFieldFor('customerName'), 'name');
eq('Alt+C -> name', S.customerFieldFor('customer'), 'name');
eq('Shift+F2 -> Kannada name', S.customerFieldFor('customerNameKn'), 'nameKn');
eq('F3 -> phone', S.customerFieldFor('customerPhone'), 'phone');
eq('F4 is not a customer box', S.customerFieldFor('lineName'), null);
eq('boxes on screen: focus now', S.customerFocusPlan(true), 'focus');
eq('folded away: open, then focus once mounted', S.customerFocusPlan(false), 'openThenFocus');
const fs = require('node:fs');
for (const app of ['client', 'mobile']) {
  const src = fs.readFileSync(path.join(__dirname, '..', app, 'src', 'components', 'CustomerBar.tsx'), 'utf8');
  check(app + ': the bar opens itself and keeps the wish', src.includes('setPendingFocus(field)') && src.includes("customerFocusPlan(box != null) === 'focus'"));
  check(app + ': and focuses the box once it mounts', src.includes('const box = fieldRefs.current[pendingFocus];') && src.includes('box.focus();'));
}
check('web: a folded section is expanded first', fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'components', 'CustomerBar.tsx'), 'utf8').replace(/\r\n/g, '\n').includes('setExpanded(true);\n      if (shop.customer) setOpen(true);'));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All shortcut checks passed.');
