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
  [{ key: 'F10' }, 'calculator'],
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

{
  console.log('\nTablet tab marker follows the active tab');
  const app = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');
  check('the bar width is state, so its travel is not stuck at 0', app.includes('const [barWidth, setBarWidth] = useState(0);') && !app.includes('barWidth.current'));
  check('the marker springs from the tab state', /useEffect\(\(\) => \{\s+Animated\.spring\(slide, \{\s+toValue: Math\.max\(0, TABS\.findIndex\(\(t\) => t\.key === tab\)\),[\s\S]*?\}, \[tab, slide\]\);/.test(app));
  check('same timing as before', app.includes('damping: 18,') && app.includes('stiffness: 220,') && app.includes('mass: 0.7,'));
  check('go() only sets the tab', !/const go = \(next: TabKey\) => \{[^}]*Animated/.test(app));
  check('travel uses the measured width', app.includes('outputRange: [0, barWidth / TABS.length]'));
}

{
  console.log('\nCustomer bar state is per bill (removing one bill\'s customer must not open the others)');
  const fs = require('node:fs');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  for (const [label, file] of [['mobile', ['mobile', 'src', 'screens', 'BillScreen.tsx']], ['client', ['client', 'src', 'pages', 'BillPage.tsx']]]) {
    const src = read(...file);
    const uses = src.match(/<CustomerBar\b[^>]*>/g) || [];
    check(label + ': every CustomerBar is keyed by the active draft', uses.length > 0 && uses.every((u) => u.includes('key={shop.activeDraftId}')), uses.join(' | '));
  }
}

console.log('\nThe calculator (build 71): F10, the safe parser, Put in box');
{
  eq('F10 opens the calculator', S.shortcutFor({ key: 'F10' }), 'calculator');
  check('F10 is in the help list', S.SHORTCUTS.some((k) => k.chord === 'F10' && k.labelKey === 'keys.calculator'));
  const plugin = require(require('node:path').join(__dirname, '..', 'mobile', 'plugins', 'withStylus.js'));
  check('and in the native key list', plugin.BILL_CHORDS.includes('F10') && plugin.moduleSource('x.y').includes('KEYCODE_F10 -> "F10"'));
  const fs = require('node:fs');
  const kt = path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'java', 'com', 'shridhar', 'billing', 'stylus', 'ShridharNativeModule.kt');
  if (fs.existsSync(kt)) check('the generated android module matches the plugin', fs.readFileSync(kt, 'utf8') === plugin.moduleSource('com.shridhar.billing'));
  const e = S.evaluateCalc;
  const cases = [
    ['2+3*4', 14], ['(2+3)*4', 20], ['2 × 3', 6], ['10 ÷ 4', 2.5], ['9 − 4', 5], ['1.5+.5', 2],
    ['200*5%', 10], ['200+5%', 210], ['200-10%', 180], ['50%', 0.5], ['((1+1))*3', 6], ['-3+5', 2],
    ['10/0', null], ['2+', null], ['(1+2', null], ['1+2)', null], ['', null], ['1..2', null],
    ['eval(1)', null], ['alert(1)', null], ['0x1f', null], ['1e3', null], ['2**3', null],
  ];
  for (const [sum, want] of cases) eq('calc ' + JSON.stringify(sum), e(sum), want);
  const bus = S.createCalcBus();
  eq('no box focused yet: nothing to put into', bus.put(5), false);
  let got = null;
  bus.setTarget((t) => { got = 'price:' + t; });
  bus.setTarget((t) => { got = 'qty:' + t; });
  eq('the last focused box takes the answer', bus.put(12.5), true);
  eq('as text', got, 'qty:12.5');
  bus.clearTarget();
  eq('a cleared box takes nothing', bus.put(1), false);
  let opened = 0;
  const off = bus.onOpen(() => { opened += 1; });
  bus.open(); off(); bus.open();
  eq('F10 and the button open it through the bus', opened, 1);
  const rd = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  for (const f of ['client/src/App.tsx', 'mobile/App.tsx']) check(f + ' shows the calculator', rd(f).includes('<Calculator />'));
  for (const f of ['client/src/components/Calculator.tsx', 'mobile/src/components/Calculator.tsx']) {
    check(f + ' uses no eval', !/\beval\(|new Function/.test(rd(f)) && rd(f).includes('evaluateCalc'));
  }
}

console.log('\nThe barcode scanner (build 87): a scan, told from typing');
{
  const scan = (text, gap, enterGap = gap) => {
    const d = S.createScanDetector();
    let t = 1000;
    for (const c of text) { d.char(c, t); t += gap; }
    return d.enter(t - gap + enterGap);
  };
  eq('13 digits 5 ms apart, then Enter: the code', scan('8909081007804', 5), '8909081007804');
  eq('the same typed by a person, 120 ms apart: not a scan', scan('8909081007804', 120), null);
  eq('a fast typist at 60 ms: still typing', scan('890908', 60), null);
  eq('a short run is not a scan', scan('12345', 5), null);
  eq('six is enough', scan('123456', 5), '123456');
  eq('an Enter that comes late is typing', scan('8909081007804', 5, 200), null);
  eq('letters and a dash, from the shop\'s own labels', scan('AB-1234', 8), 'AB-1234');
  eq('a space is not part of a code', scan('1234 5678', 5), null);
  {
    const d = S.createScanDetector();
    for (const [c, t] of [['h', 0], ['e', 150], ['l', 300]]) d.char(c, t);
    let t = 1000;
    for (const c of '8901063010017') { d.char(c, t); t += 4; }
    eq('typing first, then a scan: only the scan is read', d.enter(t), '8901063010017');
  }
  {
    const d = S.createScanDetector();
    let t = 0;
    for (const c of '890108') { d.char(c, t); t += 5; }
    d.reset();
    eq('another key in between (Backspace, an arrow) breaks the run', d.enter(t), null);
  }
  {
    const d = S.createScanDetector();
    eq('Enter on its own is not a scan', d.enter(10), null);
    let t = 0;
    for (const c of '1'.repeat(40)) { d.char(c, t); t += 3; }
    eq('a run longer than any barcode keeps its last 32', d.enter(t).length, S.SCAN_MAX_CHARS);
  }
  const rd = (p) => require('node:fs').readFileSync(path.join(__dirname, '..', p), 'utf8');
  check('the web Bill page listens for scans', rd('client/src/pages/BillPage.tsx').includes('useScanner('));
  check('and puts a box back the way typing would, so React follows', rd('client/src/lib/useScanner.ts').includes("el.dispatchEvent(new Event('input', { bubbles: true }))"));
  check('the tablet Bill screen takes hwScan', rd('mobile/src/screens/BillScreen.tsx').includes('onHardwareScan('));
  for (const f of ['client/src/lib/useStockSuggest.ts', 'mobile/src/lib/useStockSuggest.ts']) {
    check(f + ': a second scan adds one to the same line', rd(f).includes('l.stockItemId === item.id && l.unit === unit.code') && rd(f).includes('onQty(same, l, qty)'));
  }
}

console.log('\nCustomer filters and sorts (shared/src/customerFilters.ts)');
{
  const now = new Date('2026-11-19T12:00:00.000Z');
  const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
  const c = (id, name, o) => ({ id, name, phone: '', since: daysAgo(400), totalBilled: 0, totalPaid: 0, balance: 0, billCount: 0, lastVisit: null, ...o });
  const list = [
    c('a', 'Anand', { balance: 150, totalBilled: 900, billCount: 6, lastVisit: daysAgo(2) }),
    c('b', 'Bhavya', { balance: -50, totalBilled: 300, billCount: 2, lastVisit: daysAgo(40) }),
    c('c', 'Chandru', { totalBilled: 2000, billCount: 9, lastVisit: daysAgo(10) }),
    c('d', 'Deepa', { since: daysAgo(5) }),
    c('e', 'Eshwar', { balance: 400, totalBilled: 400, billCount: 1, lastVisit: daysAgo(90), since: daysAgo(90) }),
  ];
  const ids = (v) => S.filterCustomers(list, { ...S.DEFAULT_CUSTOMER_VIEW, ...v }, 'en', now).map((x) => x.id).join('');
  eq('all, by name', ids({}), 'abcde');
  eq('owes money', ids({ show: 'owes' }), 'ae');
  eq('paid ahead', ids({ show: 'advance' }), 'b');
  eq('not come for 30 days: billed before, not since', ids({ show: 'notCome', days: 30 }), 'be');
  eq('not come for 7 days', ids({ show: 'notCome', days: 7 }), 'bce');
  eq('never billed', ids({ show: 'never' }), 'd');
  eq('new this month', ids({ show: 'new' }), 'd');
  eq('biggest balance first', ids({ sort: 'balance', dir: 'desc' }), 'eacdb');
  eq('most billed first', ids({ sort: 'billed', dir: 'desc' }), 'caebd');
  eq('latest visit first, never-billed last', ids({ sort: 'lastVisit', dir: 'desc' }), 'acbed');
  eq('names Z to A', ids({ dir: 'desc' }), 'edcba');
  eq('owing, biggest first', ids({ show: 'owes', sort: 'balance', dir: 'desc' }), 'ea');
  eq('the list itself is left alone', list.map((x) => x.id).join(''), 'abcde');
  const counts = S.customerShowCounts(list, 30, now);
  eq('counts for the chips', [counts.all, counts.owes, counts.advance, counts.notCome, counts.never, counts.new], [5, 2, 1, 2, 1, 1]);
  eq('a stored view is read back', S.readCustomerView({ show: 'owes', days: 15, sort: 'balance', dir: 'asc' }), { show: 'owes', days: 15, sort: 'balance', dir: 'asc' });
  eq('nonsense in storage is the default', S.readCustomerView({ show: 'x', days: -3, sort: 'y' }), S.DEFAULT_CUSTOMER_VIEW);
  eq('each sort starts its own way', [S.defaultDir('name'), S.defaultDir('balance')], ['asc', 'desc']);

  // Sorted by town: A to Z, each town's people by name, no town last.
  const towns = [
    c('p', 'Prakash', { town: 'Kamalapura' }),
    c('q', 'Anil', { town: ' hosapete ' }),
    c('r', 'Zubair', { town: 'Hosapete' }),
    c('s', 'Bharath', {}),
    c('t', 'Girish', { town: 'Kamalapura' }),
  ];
  const byTown = (dir) => S.filterCustomers(towns, { ...S.DEFAULT_CUSTOMER_VIEW, sort: 'town', dir }, 'en', now).map((x) => x.id).join('');
  eq('by town, then name, no town last', byTown('asc'), 'qrtps');
  eq('towns Z to A, still no town last', byTown('desc'), 'tpqrs');
  eq('the town sort starts A to Z', S.defaultDir('town'), 'asc');
  eq('known towns: each once, A to Z, first spelling kept', S.knownTowns(towns), ['hosapete', 'Kamalapura']);
  eq('a town is tidied', S.townOf({ town: '  Old   Town ' }), 'Old Town');
  eq('a town sort is read back from storage', S.readCustomerView({ sort: 'town' }).sort, 'town');
}

console.log('\nTyped quantity in front of an item (stockQueryOf)');
{
  eq('a plain name', S.stockQueryOf('sugar'), { q: 'sugar' });
  eq('"2 sugar"', S.stockQueryOf('2 sugar'), { q: 'sugar', qty: 2 });
  eq('"2kg sugar"', S.stockQueryOf('2kg sugar'), { q: 'sugar', qty: 2 });
  eq('"1.5 kg toor dal"', S.stockQueryOf('1.5 kg toor dal'), { q: 'toor dal', qty: 1.5 });
  eq('"1/2 kg dal"', S.stockQueryOf('1/2 kg dal'), { q: 'dal', qty: 0.5 });
  eq('"3 pkt parle g"', S.stockQueryOf('3 pkt parle g'), { q: 'parle g', qty: 3 });
  eq('a number alone is asked as typed', S.stockQueryOf('500'), { q: '500' });
  eq('a name with a number in it', S.stockQueryOf('1 to 3 noodles'), { q: '1 to 3 noodles' });
  eq('the advance a bill uses', [S.advanceFor(-200, 500), S.advanceFor(-200, 150), S.advanceFor(100, 500), S.advanceFor(-50, 0)], [200, 150, 0, 0]);
  eq('the receipt language: its own switch, else the app\'s', [
    S.receiptLangOf({ language: 'en', receiptKannada: true }),
    S.receiptLangOf({ language: 'kn', receiptKannada: false }),
    S.receiptLangOf({ language: 'kn' }),
    S.receiptLangOf({ language: 'en' }),
  ], ['kn', 'en', 'kn', 'en']);
  const doc = S.buildReceipt({ no: 1, at: '2026-11-23T10:00:00.000Z', lines: [{ itemId: 'a', nameKn: 'ಅಕ್ಕಿ', nameEn: 'Rice', qty: 1, rate: 50 }], total: 50, paid: 50, balance: 0, showBalance: false },
    { ...S.DEFAULT_SETTINGS, shopName: 'Shop', shopNameKn: 'ಅಂಗಡಿ', language: 'en', receiptKannada: true }, S.receiptLabelsFor('kn'));
  check('Kannada receipt from an English app: the Kannada shop name', doc.rows[0].text === 'ಅಂಗಡಿ');
  check('and the Kannada item name', doc.rows.some((r) => r.t === 'item' && r.name === 'ಅಕ್ಕಿ'));

  // A typed line with a quantity prints it: "20 NOS Rice Flakes 2kg", not just the name and 2200.
  const typed = S.buildReceipt({ no: 2, at: '2026-11-23T10:00:00.000Z', total: 2350, paid: 2350, balance: 0, showBalance: false, lines: [
    { itemId: 'a', nameKn: 'Rice Flakes 2kg', nameEn: 'Rice Flakes 2kg', qty: 20, rate: 110 },
    { itemId: 'b', nameKn: 'Matches', nameEn: 'Matches', qty: 1, rate: 50 },
    { itemId: 'c', nameKn: 'Sona Masuri', nameEn: 'Sona Masuri', qty: 20, rate: 1850, unit: 'Pkt' },
    { itemId: 'd', nameKn: 'Dal', nameEn: 'Dal', qty: 2.5, rate: 0 },
  ] }, { ...S.DEFAULT_SETTINGS, shopName: 'Shop' });
  const names = typed.rows.filter((r) => r.t === 'item' && /\d/.test(r.no) && r.no !== 'No.').map((r) => r.name);
  eq('a typed line with a quantity prints it', names[0], '20 NOS Rice Flakes 2kg');
  eq('one of one, no unit: just the name', names[1], 'Matches');
  eq('a unit of its own is kept', names[2], '20 Pkt Sona Masuri');
  eq('a part quantity too', names[3], '2.5 NOS Dal');
  eq('the WhatsApp text says the same', S.billAsText({ ...{ no: 2, at: '2026-11-23T10:00:00.000Z', total: 2200, paid: 2200, balance: 0, showBalance: false }, lines: [{ nameKn: 'Rice Flakes 2kg', nameEn: 'Rice Flakes 2kg', qty: 20, rate: 110 }] }, 'Shop', { bill: 'Bill #', total: 'TOTAL', paid: 'Paid', balance: 'Balance' }).includes('20 NOS Rice Flakes 2kg = '), true);
}

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All shortcut checks passed.');
