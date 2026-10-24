/**
 * Keeping bills and "Today" fresh while the app sits open (the blank History of the client's
 * screenshot): the backoff after a failed load, the midnight timer, and History's
 * "failed" versus "empty" -- "No bills yet" only after a load that worked.
 *
 * Pure functions from shared/src/freshness.ts, plus a source check that both apps wire them.
 *
 *   node scripts/freshtest.js
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

console.log('backoff');
eq('no failure, no wait', shared.retryDelay(0), 0);
eq('1st failure 5 s', shared.retryDelay(1), 5000);
eq('2nd failure 15 s', shared.retryDelay(2), 15000);
eq('3rd failure 30 s', shared.retryDelay(3), 30000);
eq('4th failure 60 s', shared.retryDelay(4), 60000);
eq('then 60 s for ever', shared.retryDelay(40), 60000);
eq('screen refresh every 60 s', shared.SCREEN_REFRESH_MS, 60000);

console.log('midnight');
eq('23:59:00 -> 60 s + grace', shared.msUntilMidnight(new Date(2026, 9, 24, 23, 59, 0), 2000), 62000);
eq('00:00:00 -> a full day', shared.msUntilMidnight(new Date(2026, 9, 24, 0, 0, 0), 0), 24 * 3600 * 1000);
eq('noon -> 12 h', shared.msUntilMidnight(new Date(2026, 9, 24, 12, 0, 0), 0), 12 * 3600 * 1000);
check('month end rolls over', shared.msUntilMidnight(new Date(2026, 9, 31, 23, 0, 0), 0) === 3600 * 1000);
check('day changed across midnight', shared.dayChanged(new Date(2026, 9, 24, 23, 59), new Date(2026, 9, 25, 0, 1)));
check('same day not changed', !shared.dayChanged(new Date(2026, 9, 24, 1, 0), new Date(2026, 9, 24, 23, 0)));

console.log('history: failed vs empty');
eq('first load running, nothing cached', shared.historyView('loading', 0), { banner: null, body: 'loading' });
eq('loaded, none -> No bills yet', shared.historyView('ok', 0), { banner: null, body: 'empty' });
eq('loaded, some -> list', shared.historyView('ok', 3), { banner: null, body: 'list' });
eq('failed, nothing cached -> banner, NOT No bills yet', shared.historyView('failed', 0), { banner: 'failed', body: 'none' });
eq('failed, cached list -> banner + last good list', shared.historyView('failed', 5), { banner: 'failed', body: 'list' });
eq('reloading over a list keeps the list', shared.historyView('loading', 5), { banner: null, body: 'list' });

console.log('wiring');
for (const app of ['mobile', 'client']) {
  const shop = fs.readFileSync(path.join(ROOT, app, 'src', 'lib', 'useShop.tsx'), 'utf8');
  check(app + ': tracks loadState', /setLoadState\('failed'\)/.test(shop) && /setLoadState\('ok'\)/.test(shop));
  check(app + ': retries on the backoff', /retryDelay\(failuresRef\.current\)/.test(shop));
  check(app + ': reloads at midnight', /msUntilMidnight\(new Date\(\)\)/.test(shop));
  check(app + ': caches the last good bills', /bills: loadedBills/.test(shop));
  check(app + ': 60 s reload hook', /export function useKeepFresh/.test(shop) && /SCREEN_REFRESH_MS/.test(shop));
  if (app === 'mobile') check('mobile: reloads when the app comes to the front', /state === 'active'\) void refresh\(\)/.test(shop));
  else check('client: reloads on visibilitychange and online', /'online', go/.test(shop) && /'visibilitychange', onVisible/.test(shop));
}
const mHist = fs.readFileSync(path.join(ROOT, 'mobile', 'src', 'screens', 'HistoryScreen.tsx'), 'utf8');
const cHist = fs.readFileSync(path.join(ROOT, 'client', 'src', 'pages', 'HistoryPage.tsx'), 'utf8');
check('mobile History: pull to refresh', /RefreshControl/.test(mHist));
check('client History: refresh button', /hist\.refresh/.test(cHist));
for (const [n, src] of [['mobile', mHist], ['client', cHist]]) {
  check(n + ' History: uses historyView', /historyView\(shop\.loadState/.test(src));
  check(n + ' History: failed banner with Retry', /hist\.loadFailed/.test(src) && /hist\.retry/.test(src));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
