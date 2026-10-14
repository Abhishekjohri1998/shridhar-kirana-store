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
  [{ key: 'c', alt: true }, 'customers'],
  [{ key: 'C', alt: true }, 'customers'],
  [{ key: 'F9' }, 'settings'],
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
check('every action once, but Settings twice (Alt+S and F9)', new Set(S.SHORTCUTS.map((s) => s.action)).size === S.SHORTCUTS.length - 1
  && S.SHORTCUTS.filter((s) => s.action === 'settings').map((s) => s.chord).join() === 'Alt+S,F9');
check('every entry has a help line', S.SHORTCUTS.every((s) => S.STRINGS.en[s.labelKey] && S.STRINGS.kn[s.labelKey]));
check('F1, Alt+B, Alt+S, F9 and Alt+C are the global ones', S.SHORTCUTS.filter((s) => s.global).map((s) => s.chord).sort().join() === 'Alt+B,Alt+C,Alt+S,F1,F9');
eq('Alt+C anywhere is Customers (build 66)', S.shortcutFor({ key: 'c', alt: true }, false), 'customers');
eq('F9 anywhere is Settings (build 66)', S.shortcutFor({ key: 'F9' }, false), 'settings');
eq('Alt+C is not the name box any more', S.customerFieldFor('customers'), null);
check('the help lists F9 in both languages', !!(S.STRINGS.en['keys.settingsF9'] && S.STRINGS.kn['keys.settingsF9']));
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
eq('F5-F8: the top line showing, wherever the cursor is', S.shortcutLine(rows, 100), 2);
eq('F5-F8: unscrolled, line 1', S.shortcutLine(rows, 0), 0);
{
  const ink = (set) => (i) => set.includes(i);
  eq('F4: the top line showing when it is typed', S.nameShortcutLine(rows, 100, ink([])), 2);
  eq('F4: handwritten lines at the top are skipped', S.nameShortcutLine(rows, 50, ink([1, 2])), 3);
  eq('F4: none typed on screen -- the first typed one below', S.nameShortcutLine(rows, 0, ink([0, 1, 2, 3])), 4);
  eq('F4: none at all -- a new line (-1)', S.nameShortcutLine(rows, 0, ink([0, 1, 2, 3, 4])), -1);
  eq('F4: never line 1 when it is scrolled away', S.nameShortcutLine(rows, 150, ink([])), 3);
}

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
  check('web: Alt+B, Alt+S / F9 and Alt+C from any page', rd('client/src/App.tsx').includes("action !== 'bill' && action !== 'settings' && action !== 'customers'") && rd('client/src/App.tsx').includes("navigate('/' + action)"));
  check('web: the bill page leaves Alt+C to the shell', rd('client/src/pages/BillPage.tsx').includes("action === 'settings' || action === 'customers') return;"));
  check('tablet: Alt+B, Alt+S / F9 and Alt+C from any screen', rd('mobile/App.tsx').includes("global === 'bill' || global === 'settings' || global === 'customers'"));
  for (const f of ['mobile/src/screens/BillScreen.tsx', 'client/src/pages/BillPage.tsx']) {
    check(f + ': Ctrl+Shift+P prints', rd(f).includes("case 'print': if (hasSomething && !saving && !printer.busy) void onPrint(); return;"));
  }
  const stock = rd('mobile/src/screens/StockScreen.tsx');
  check('stock spinner: onLoadStart no longer sets it', !/onLoadStart=\{[^\n]*setLoading\(true\)/.test(stock));
  check('stock spinner: cleared at full progress', stock.includes('if (e.nativeEvent.progress >= 1) setLoading(false);'));
  check('stock spinner: 10 s safety timer', stock.includes('const SPINNER_MAX_MS = 10000;') && stock.includes('setTimeout(() => setLoading(false), SPINNER_MAX_MS)'));
  check('stock spinner: still shown for our own retries', /const retryNow[\s\S]{0,200}setLoading\(true\)/.test(stock));
}

console.log('\nCustomer boxes, even when the section is folded away');
eq('F2 -> name', S.customerFieldFor('customerName'), 'name');
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

console.log('\nThe unit list F6 opens (build 67)');
{
  const codes = ['pc', 'Box', 'Dz', 'NOS'];
  eq('starts on the current unit', S.unitMenuStart(codes, 'Dz'), 2);
  eq('a unit not listed: the first chip', S.unitMenuStart(codes, 'kg'), 0);
  eq('no unit: the first chip', S.unitMenuStart(codes, undefined), 0);
  eq('an empty list: nothing', S.unitMenuStart([], 'pc'), -1);
  eq('right moves one', S.unitMenuStep(0, 1, 4), 1);
  eq('left moves back', S.unitMenuStep(2, -1, 4), 1);
  eq('right from the last wraps to the first', S.unitMenuStep(3, 1, 4), 0);
  eq('left from the first wraps to the last', S.unitMenuStep(0, -1, 4), 3);
  eq('no highlight yet: right is the first', S.unitMenuStep(-1, 1, 4), 0);
  eq('no highlight yet: left is the last', S.unitMenuStep(-1, -1, 4), 3);
  eq('no chips: nothing', S.unitMenuStep(0, 1, 0), -1);
  const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const web = rd('client/src/pages/BillPage.tsx');
  check('web: Left/Right/Enter/Escape taken while the list is open', ['ArrowLeft', 'ArrowRight', "'Enter'", "'Escape'"].every((k) => web.includes(k)) && web.includes("window.addEventListener('keydown', keys, true)"));
  check('web: Enter picks through changeUnit', web.includes('pickUnitAt(unitMenuAt, unitMenuLine, unitHi)') && web.includes('stock.changeUnit(index, line, u);'));
  check('web: the highlight is shown', web.includes("(at === unitHi ? ' on' : '')"));
  const tab = rd('mobile/src/screens/BillScreen.tsx');
  check('tablet: tells native the list is open', tab.includes('setUnitMenuOpen(unitMenu != null)'));
  check('tablet: the list has the keys first, Enter does not also move on', tab.includes('if (unitOpen.current) {') && tab.includes("if (key === 'enter' && !unitOpen.current) hwEnter.current()"));
  check('tablet: Enter picks through changeUnit', tab.includes('pickUnitAt(unitMenuAt, unitMenuLine, unitHi)') && tab.includes('stock.changeUnit(index, line, u);'));
  check('tablet: the highlight is shown', tab.includes('at === unitHi && styles.stockChipOn'));
  const i18n = rd('shared/src/i18n.ts');
  check('help says F6 then arrows and Enter, EN and KN', (i18n.match(/F6 (then|ನಂತರ) ← → Enter/g) || []).length === 2);
}

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All shortcut checks passed.');
