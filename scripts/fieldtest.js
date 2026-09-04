/**
 * Exhaustive tests for every input-field rule in the app.
 *
 * These live apart from selftest.js because they are pure: the rules were pulled out of the four
 * pages into shared/src/fields.ts precisely so that every odd thing a person can type into a
 * price box could be checked here in milliseconds, instead of one keystroke at a time through a
 * browser.
 *
 *   node scripts/fieldtest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.fieldtest-build');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}

/** Asserts a parser accepts `input` and yields `value`. */
function accepts(fn, label, input, value) {
  const r = fn(input);
  check(label + ' accepts ' + JSON.stringify(input),
    r.ok && r.value === value,
    r.ok ? 'got ' + r.value + ', wanted ' + value : 'rejected: ' + r.error);
}

/** Asserts a parser rejects `input`, with a message that says something useful. */
function rejects(fn, label, input) {
  const r = fn(input);
  const usable = !r.ok && typeof r.error === 'string' && r.error.length > 10 && /[.!]$/.test(r.error);
  check(label + ' rejects ' + JSON.stringify(input), !r.ok && usable,
    r.ok ? 'accepted as ' + r.value : 'message not usable: ' + JSON.stringify(r.error));
}

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc, 'shared/src/fields.ts',
  '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019',
  '--strict', '--skipLibCheck', '--lib', 'es2019,dom',
], { cwd: ROOT, stdio: 'inherit' });

const F = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'fields.js'));
const BUILD_SHARED = path.join(ROOT, 'shared', 'dist', 'cjs');

// Things people actually type by accident, and things that used to slip through Number().
const NOT_NUMBERS = [
  '', ' ', '   ', 'abc', 'two', 'ಎರಡು', '-', '+', '.', '..', '1.2.3', '1,5', '1 5', '1/2',
  '5rs', 'Rs 5', '₹5', '5%', 'NaN', 'Infinity', '-Infinity', '1e3', '0x1f', '0b11', '1_000',
  '½', '٥', 'null', 'undefined', '+-5', '5-', '- 5',
];

console.log('\nparseDecimal: only plain decimals');
for (const bad of NOT_NUMBERS) {
  check('rejects ' + JSON.stringify(bad), F.parseDecimal(bad) === null, 'got ' + F.parseDecimal(bad));
}
check('accepts a whole number', F.parseDecimal('42') === 42);
check('accepts a decimal', F.parseDecimal('12.5') === 12.5);
check('accepts a leading dot', F.parseDecimal('.5') === 0.5);
check('accepts a trailing dot', F.parseDecimal('5.') === 5);
check('accepts a signed number', F.parseDecimal('-3') === -3);
check('trims surrounding spaces', F.parseDecimal('  7  ') === 7);

console.log('\nPrice field (bill line)');
for (const bad of NOT_NUMBERS) rejects(F.parsePrice, 'price', bad);
rejects(F.parsePrice, 'price', '0');
rejects(F.parsePrice, 'price', '0.00');
rejects(F.parsePrice, 'price', '-5');
rejects(F.parsePrice, 'price', '1000001');
accepts(F.parsePrice, 'price', '45', 45);
accepts(F.parsePrice, 'price', '12.50', 12.5);
accepts(F.parsePrice, 'price', ' 20 ', 20);
accepts(F.parsePrice, 'price', '0.5', 0.5);
accepts(F.parsePrice, 'price', '1000000', 1000000);
// Paise beyond two decimals cannot be printed or paid, so they are rounded, not kept.
accepts(F.parsePrice, 'price', '12.999', 13);
accepts(F.parsePrice, 'price', '12.994', 12.99);

console.log('\nRate field (catalogue item)');
rejects(F.parseRate, 'rate', '');
rejects(F.parseRate, 'rate', '0');
rejects(F.parseRate, 'rate', 'free');
accepts(F.parseRate, 'rate', '62', 62);
check('rate and price agree on every input',
  NOT_NUMBERS.concat(['0', '-1', '45', '12.5']).every(
    (v) => F.parseRate(v).ok === F.parsePrice(v).ok,
  ));

console.log('\nQuantity field');
for (const bad of NOT_NUMBERS) rejects(F.parseQty, 'qty', bad);
rejects(F.parseQty, 'qty', '0');
rejects(F.parseQty, 'qty', '-2');
rejects(F.parseQty, 'qty', '100001');
accepts(F.parseQty, 'qty', '1', 1);
accepts(F.parseQty, 'qty', '5', 5);
accepts(F.parseQty, 'qty', '1.5', 1.5);
accepts(F.parseQty, 'qty', '0.25', 0.25);
accepts(F.parseQty, 'qty', '.5', 0.5);
accepts(F.parseQty, 'qty', '100000', 100000);
// Grams on a kilo scale, and a third of a kilo, both have to land somewhere sane.
accepts(F.parseQty, 'qty', '1.2345', 1.235);
accepts(F.parseQty, 'qty', '1.2344', 1.234);
accepts(F.parseQty, 'qty', '0.3333', 0.333);

console.log('\nPaid field');
// Blank is a real answer here: it means paid in full.
accepts((v) => F.parsePaid(v, 222), 'paid', '', 222);
accepts((v) => F.parsePaid(v, 222), 'paid', '   ', 222);
accepts((v) => F.parsePaid(v, 222), 'paid', '0', 0);
accepts((v) => F.parsePaid(v, 222), 'paid', '100', 100);
accepts((v) => F.parsePaid(v, 222), 'paid', '222', 222);
// Overpaying is allowed: it leaves the customer in credit.
accepts((v) => F.parsePaid(v, 222), 'paid', '500', 500);
accepts((v) => F.parsePaid(v, 222), 'paid', '99.995', 100);
for (const bad of NOT_NUMBERS.filter((b) => b.trim() !== '')) rejects((v) => F.parsePaid(v, 222), 'paid', bad);
rejects((v) => F.parsePaid(v, 222), 'paid', '-1');
rejects((v) => F.parsePaid(v, 222), 'paid', '10000001');
check('a blank paid field rounds the total it stands in for',
  F.parsePaid('', 12.345).ok && F.parsePaid('', 12.345).value === 12.35);

console.log('\nQuiet-days field');
for (const bad of NOT_NUMBERS) rejects(F.parseQuietDays, 'quiet days', bad);
rejects(F.parseQuietDays, 'quiet days', '0');
rejects(F.parseQuietDays, 'quiet days', '-30');
rejects(F.parseQuietDays, 'quiet days', '3651');
rejects(F.parseQuietDays, 'quiet days', '30.5');
rejects(F.parseQuietDays, 'quiet days', '.5');
accepts(F.parseQuietDays, 'quiet days', '1', 1);
accepts(F.parseQuietDays, 'quiet days', '30', 30);
accepts(F.parseQuietDays, 'quiet days', ' 45 ', 45);
accepts(F.parseQuietDays, 'quiet days', '3650', 3650);

console.log('\nShop name and footer');
rejects(F.checkShopName, 'shop name', '');
rejects(F.checkShopName, 'shop name', '    ');
rejects(F.checkShopName, 'shop name', 'x'.repeat(81));
check('shop name accepts a normal name', F.checkShopName(' Shridhar Kirani Stores ').ok);
check('shop name is trimmed', F.checkShopName('  Shop  ').value === 'Shop');
check('shop name accepts Kannada', F.checkShopName('ಶ್ರೀಧರ ಕಿರಾಣಿ').ok);
check('footer may be empty', F.checkFooter('').ok && F.checkFooter('').value === '');
check('footer is trimmed', F.checkFooter('  Thanks  ').value === 'Thanks');
rejects(F.checkFooter, 'footer', 'x'.repeat(121));

console.log('\nItem names');
check('both blank is refused', !F.checkItemNames('', '').ok);
check('whitespace only is refused', !F.checkItemNames('  ', '   ').ok);
check('Kannada only fills in the English name',
  F.checkItemNames('ಅಕ್ಕಿ', '').nameEn === 'ಅಕ್ಕಿ');
check('English only fills in the Kannada name',
  F.checkItemNames('', 'Rice').nameKn === 'Rice');
check('both given are kept as given',
  F.checkItemNames(' ಅಕ್ಕಿ ', ' Rice ').nameKn === 'ಅಕ್ಕಿ' && F.checkItemNames('ಅಕ್ಕಿ', 'Rice').nameEn === 'Rice');
check('an over-long name is refused', !F.checkItemNames('x'.repeat(121), '').ok);

console.log('');
console.log('Breaking Kannada text safely');
const SH = require(path.join(BUILD_SHARED, 'index.js'));
const KN_WORDS = ['ಅಕ್ಕಿ', 'ಮೆಣಸಿನಕಾಯಿ',
  'ಆಲೂಗಡ್ಡೆ', 'ಇಪ್ಪತ್ತೈದು'];
const COMBINING = /^\p{M}/u;
const VIRAMA_END = /್$/u;
for (const word of KN_WORDS) {
  const units = SH.breakUnits(word);
  check('breaking ' + word + ' loses nothing', units.join('') === word, JSON.stringify(units));
  check('no piece of ' + word + ' starts with a combining mark',
    units.every((u) => !COMBINING.test(u)), JSON.stringify(units));
  check('no piece of ' + word + ' ends on a dangling virama',
    units.every((u) => !VIRAMA_END.test(u)), JSON.stringify(units));
}
check('a conjunct is kept whole',
  SH.breakUnits('ಅಕ್ಕಿ').join('|') === 'ಅ|ಕ್ಕಿ',
  SH.breakUnits('ಅಕ್ಕಿ').join('|'));
check('Latin still breaks per character', SH.breakUnits('abc').join('|') === 'a|b|c');
check('an empty string yields nothing', SH.breakUnits('').length === 0);
// fitPrefix must never return something that would loop the caller forever.
const measure = (s) => s.length;
check('fitPrefix respects the budget', SH.fitPrefix('ಮೆಣಸಿನ', 4, measure).length <= 4);
check('fitPrefix returns empty when even one cluster is too wide',
  SH.fitPrefix('ಮೆ', 1, measure) === '');
check('fitPrefix takes the whole string when it fits',
  SH.fitPrefix('ಮೆ', 99, measure) === 'ಮೆ');

console.log('');
console.log('Phone numbers fold to one canonical form');
// The same regular entered these ways has to be one customer, not five with a split khata.
const SAME = ['9886012345', '98860 12345', '98860-12345', '+919886012345', '+91 98860 12345',
  '91 9886012345', '09886012345', '0 98860 12345', '0091 9886012345', '(+91) 98860-12345'];
const folded = new Set(SAME.map(F.normalisePhone));
check('ten ways of writing one number give one number, ' + [...folded].join('/'),
  folded.size === 1 && folded.has('9886012345'), [...folded].join(', '));
check('a plain ten-digit number is untouched', F.normalisePhone('9876543210') === '9876543210');
check('a different number stays different',
  F.normalisePhone('+919876543210') !== F.normalisePhone('+919886012345'));
check('a landline with an STD zero folds', F.normalisePhone('080-12345678') === '8012345678');
check('letters yield nothing', F.normalisePhone('call me') === '');
check('an empty string yields nothing', F.normalisePhone('') === '');
// checkCustomer has to agree, since that is what the form actually calls.
check('the customer form folds the country code too',
  F.checkCustomer('R', '+91 98860 12345').phone === '9886012345',
  F.checkCustomer('R', '+91 98860 12345').phone);
check('and folds the trunk zero',
  F.checkCustomer('R', '09886012345').phone === '9886012345');

console.log('\nCustomer fields');
check('both blank is refused', !F.checkCustomer('', '').ok);
check('whitespace only is refused', !F.checkCustomer('  ', ' ').ok);
check('name only is fine', F.checkCustomer('Ramesh', '').ok);
check('number only is fine', F.checkCustomer('', '9886012345').ok);
check('spaces in a number are stripped',
  F.checkCustomer('R', '98860 12345').phone === '9886012345');
check('punctuation and the country code both come off',
  F.checkCustomer('R', '+91-98860-12345').phone === '9886012345',
  F.checkCustomer('R', '+91-98860-12345').phone);
check('a too-short number is refused', !F.checkCustomer('R', '123').ok);
check('a too-long number is refused', !F.checkCustomer('R', '1234567890123456').ok);
check('a letters-only number is refused as blank-with-no-name', !F.checkCustomer('', 'abcd').ok);
check('an over-long name is refused', !F.checkCustomer('x'.repeat(81), '').ok);
check('the phone check is the same one the server uses',
  F.normalisePhone('+91 (98860) 12345') === '9886012345',
  F.normalisePhone('+91 (98860) 12345'));

console.log('\nUnit field');
check('blank unit becomes pc', F.checkUnit('').value === 'pc');
check('whitespace unit becomes pc', F.checkUnit('   ').value === 'pc');
check('a unit is trimmed', F.checkUnit(' kg ').value === 'kg');
rejects(F.checkUnit, 'unit', 'x'.repeat(17));

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All field checks passed.');
