/**
 * One sign-in for the whole app (build 77): a saved session goes straight in on a cold start,
 * the Stock window opens with the saved stock token and forgets stock's session only after Sign
 * out / Switch user, and a token in its last week is refreshed quietly.
 *
 * Pure functions from shared/src/session.ts, plus source checks that the tablet wires them.
 *
 *   node scripts/sessiontest.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const shared = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'index.js'));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ok   ' + name); }
  else { failures++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', wanted ' + JSON.stringify(expected));
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25);
function jwt(expMs) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ role: 'shop', exp: Math.floor(expMs / 1000) }) + '.sig';
}
const FRESH = jwt(NOW + 25 * DAY);
const ENDING = jwt(NOW + 3 * DAY);
const DEAD = jwt(NOW - DAY);

console.log('tokens');
eq('expiry read from the JWT', shared.tokenExpiry(FRESH), Math.floor((NOW + 25 * DAY) / 1000) * 1000);
eq('not a JWT: no expiry', shared.tokenExpiry('abc'), null);
eq('none', shared.tokenState(null, NOW), 'none');
eq('25 days left: fresh', shared.tokenState(FRESH, NOW), 'fresh');
eq('3 days left: refresh quietly', shared.tokenState(ENDING, NOW), 'refresh');
eq('past: expired', shared.tokenState(DEAD, NOW), 'expired');
eq('no readable expiry is trusted', shared.tokenState('a.b.c', NOW), 'fresh');

console.log('\ncold start');
const shopPin = shared.coldStart({ token: FRESH, personRole: null, stockToken: null }, NOW);
eq('shop PIN session goes straight in', [shopPin.signedIn, shopPin.needSignIn, shopPin.locked], [true, false, false]);
eq('a cold start never forgets stock', shopPin.forgetStock, false);
const admin = shared.coldStart({ token: FRESH, personRole: 'admin', stockToken: FRESH }, NOW);
eq('admin goes straight in with the stock token', [admin.signedIn, admin.stockToken === FRESH, admin.needSignIn], [true, true, false]);
const worker = shared.coldStart({ token: null, personRole: 'worker', stockToken: FRESH }, NOW);
eq('worker opens stock only, no sign-in', [worker.stockOnly, worker.needSignIn, worker.signedIn], [true, false, false]);
const renew = shared.coldStart({ token: ENDING, personRole: null, stockToken: null }, NOW);
eq('billing token in its last week: in, and refreshed quietly', [renew.signedIn, renew.refreshBilling], [true, true]);
const lapsed = shared.coldStart({ token: DEAD, personRole: null, stockToken: null }, NOW);
eq('lapsed billing token: sign in once', [lapsed.signedIn, lapsed.needSignIn], [false, true]);
const adminStockLapsed = shared.coldStart({ token: FRESH, personRole: 'admin', stockToken: DEAD }, NOW);
eq('admin with a lapsed stock token: sign in once', adminStockLapsed.needSignIn, true);
const workerLapsed = shared.coldStart({ token: null, personRole: 'godown', stockToken: DEAD }, NOW);
eq('godown with a lapsed stock token: sign in once', [workerLapsed.stockOnly, workerLapsed.needSignIn], [false, true]);
const nothing = shared.coldStart({ token: null, personRole: null, stockToken: null }, NOW);
eq('nothing saved: sign-in screen', nothing.needSignIn, true);

console.log('\nStock window first load');
const handed = shared.stockFirstLoad(FRESH, false, NOW);
eq('saved stock token handed over as #token=', handed.hash, '#token=' + encodeURIComponent(FRESH));
eq('and nothing forgotten', [handed.forget, handed.needPhone], [false, false]);
eq('normal cold start, no token: no forget', shared.stockFirstLoad(null, false, NOW).forget, false);
eq('shop PIN with no token: the phone note', shared.stockFirstLoad(null, false, NOW).needPhone, true);
eq('after Sign out / Switch user: forget', shared.stockFirstLoad(null, true, NOW).forget, true);
eq('a fresh token wins over a pending forget', shared.stockFirstLoad(FRESH, true, NOW).forget, false);
eq('a lapsed token is not handed over', shared.stockFirstLoad(DEAD, false, NOW).hash, '');

console.log('\nsession read back from the Stock window');
eq('a live JWT is kept', shared.acceptStockToken(FRESH, NOW), FRESH);
eq('a lapsed one is not', shared.acceptStockToken(DEAD, NOW), null);
eq('junk is not', shared.acceptStockToken('<script>', NOW), null);
eq('nor a non-string', shared.acceptStockToken(42, NOW), null);

console.log('\nwiring');
const shop = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'lib', 'useShop.tsx'), 'utf8');
const stock = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'screens', 'StockScreen.tsx'), 'utf8');
const web = fs.readFileSync(path.join(ROOT, 'client', 'src', 'lib', 'useShop.tsx'), 'utf8');
check('tablet does not lock on a cold start', /const \[locked, setLocked\] = useState\(false\)/.test(shop));
check('tablet start-up uses coldStart', /coldStart\(\{/.test(shop));
check('tablet refreshes the billing token quietly', /api\.refresh\(\)/.test(shop));
check('Stock window decides with stockFirstLoad', /stockFirstLoad\(token, pending/.test(stock));
check('forget is only injected on firstLoad.forget', /firstLoad\.forget && !firstDone\.current \? FORGET_STOCK_SESSION/.test(stock));
check('Stock window reports its session back', /type: 'session'/.test(stock) && /keepStockToken/.test(stock));
check('web refreshes the billing token quietly', /tokenState\(getToken\(\)/.test(web) && /api\.refresh\(\)/.test(web));

check('Stock tab active wakes the window', /if \(active\) wake\(\)/.test(stock));
check('app resume on Stock wakes the window', /state === 'active' && activeRef\.current\) wake\(\)/.test(stock));
check('wake requests focus, refreshes handwriting, refocuses', /requestFocus/.test(stock) && /refreshHandwriting\(\)/.test(stock) && /injectJavaScript\(REFOCUS\)/.test(stock));
check('last focused box tracked via focusin', /'focusin'/.test(stock) && /REPORT_SESSION \+ TRACK_FOCUS/.test(stock));
check('DROP_FOCUS kept while hidden', /if \(!activeRef\.current\) \{ web\.current\?\.injectJavaScript\(DROP_FOCUS\)/.test(stock));
console.log('\nreconnect (APK 80)');
eq('delay 0', shared.reconnectDelayMs(0), 1000);
eq('delay 1', shared.reconnectDelayMs(1), 2000);
eq('delay 2', shared.reconnectDelayMs(2), 4000);
eq('delay 3', shared.reconnectDelayMs(3), 5000);
eq('delay 50', shared.reconnectDelayMs(50), 5000);
eq('delay bad', shared.reconnectDelayMs(NaN), 1000);
eq('delay negative', shared.reconnectDelayMs(-2), 1000);
eq('reload last page', shared.reloadTarget('https://s.x/admin/allot', 'https://s.x/'), 'https://s.x/admin/allot');
eq('reload strips token', shared.reloadTarget('https://s.x/#token=abc', 'https://s.x'), 'https://s.x/');
eq('reload foreign url -> base', shared.reloadTarget('https://evil.y/', 'https://s.x'), 'https://s.x');
eq('reload none -> base', shared.reloadTarget(null, 'https://s.x/'), 'https://s.x');
eq('health url', shared.healthUrl('https://s.x/'), 'https://s.x/api/health');
check('renderError is blank, never Android error page', /renderError=\{\(\) => <View/.test(stock));
check('overlay says connection lost', /t\('stock\.connectionLost'\)/.test(stock));
check('retry uses reconnectDelayMs', /reconnectDelayMs\(attempts\.current\)/.test(stock) && !/RETRY_AFTER_MS/.test(stock));
check('health probe with timeout', /healthUrl\(url\)/.test(stock) && /HEALTH_PROBE_TIMEOUT_MS/.test(stock));
check('health success goes through retryNow (no double retry)', /res\.ok && failingRef\.current\) retryNow\(\)/.test(stock) && /clearTimeout\(retryTimer\.current\)/.test(stock));
check('last stock URL tracked', /lastUrl\.current = s\.url/.test(stock) && /reloadTarget\(lastUrl\.current/.test(stock));
check('online listener injected', /'online'/.test(stock) && /ONLINE_REFRESH/.test(stock) && /stock-online/.test(stock));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
