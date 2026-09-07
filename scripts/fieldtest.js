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
console.log('One size for every hand-written line on a slip');
/*
 * The bug this guards: each line used to be fitted to the row height on its own, so a short
 * word like "1k" was blown up to the same 46 dots as a tall scrawl, and a slip came out with
 * the shopkeeper's own handwriting in three different sizes.
 */
const TALL = { w: 300, h: 120, strokes: [[10, 10, 10, 110, 60, 110]] };
const SMALL = { w: 300, h: 120, strokes: [[10, 50, 40, 50, 40, 70]] };
const WIDE = { w: 900, h: 120, strokes: [[0, 60, 880, 60]] };
const ROW = 46;
const WIDTH = SH.inkMaxWidth(384);

const both = SH.planInk([TALL, SMALL], WIDTH, ROW);
/*
 * The writing gets the whole height it is given; the pen's overhang is added to the *row* around
 * it (INK_ROW_ADVANCE), not taken out of the writing. Taking it out of the writing was the first
 * attempt and made every slip's handwriting slightly smaller, which the shop noticed at once.
 */
check('the tallest line fills the height it is given', Math.abs(both.height - ROW) < 0.001,
  both.height + ' vs ' + ROW);
check('and the row is taller than the writing, to hold the pen',
  SH.INK_ROW_ADVANCE === SH.INK_ROW_HEIGHT + 2 * SH.INK_BLEED,
  SH.INK_ROW_ADVANCE + ' vs ' + SH.INK_ROW_HEIGHT);
check('and the pen has somewhere to go', SH.INK_BLEED * 2 >= SH.INK_STROKE_DOTS,
  'bleed ' + SH.INK_BLEED + ' vs stroke ' + SH.INK_STROKE_DOTS);
check('the gutter is real', SH.INK_GUTTER > 0, String(SH.INK_GUTTER));
check('the origin is the top of the union', both.originY === 10, String(both.originY));
const drawnSmall = (SH.inkBounds(SMALL).maxY - both.originY) * both.scale;
const drawnTall = (SH.inkBounds(TALL).maxY - both.originY) * both.scale;
check('the small line stays smaller than the tall one', drawnSmall < drawnTall * 0.75,
  drawnSmall + ' vs ' + drawnTall);
check('order does not change the plan',
  JSON.stringify(SH.planInk([SMALL, TALL], WIDTH, ROW)) === JSON.stringify(both));
// inkFit still fits the space it is given exactly -- it is the thumbnail's rule, not the slip's.
// Give it the same reduced space and the two agree, which is what says planInk subtracts the
// gutter and the pen rather than doing something else to the scale.
check('a line on its own matches a plain fit of the room it has',
  Math.abs(
    SH.planInk([TALL], WIDTH, ROW).scale
      - SH.inkFit(TALL, WIDTH - SH.INK_GUTTER - 2 * SH.INK_BLEED, ROW).scale,
  ) < 1e-9,
  SH.planInk([TALL], WIDTH, ROW).scale + ' vs '
    + SH.inkFit(TALL, WIDTH - SH.INK_GUTTER - 2 * SH.INK_BLEED, ROW).scale);
const wide = SH.planInk([WIDE, SMALL], WIDTH, ROW);
check('a line too wide for the paper caps the scale',
  (SH.inkBounds(WIDE).maxX - SH.inkBounds(WIDE).minX) * wide.scale <= WIDTH + 0.001,
  String(wide.scale));
check('and then it is the width, not the row, that is filled', wide.height < ROW, String(wide.height));
const none = SH.planInk([], WIDTH, ROW);
check('an empty slip does not divide by zero',
  Number.isFinite(none.scale) && none.scale > 0 && none.height === 0, JSON.stringify(none));
const flat = SH.planInk([{ w: 300, h: 120, strokes: [[10, 40, 90, 40]] }], WIDTH, ROW);
check('a single flat line still gets a usable scale',
  Number.isFinite(flat.scale) && flat.scale > 0, JSON.stringify(flat));

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

console.log('\nGST number');
/*
 * Warned about, never refused. A real GSTIN is fifteen characters in a fixed shape, but a shop
 * with a provisional or unusual number still has to be able to bill -- so a wrong-looking number
 * is saved with a complaint rather than blocked.
 */
const GOOD = '29ABCDE1234F1Z5';
check('a real-shaped number is accepted without complaint',
  F.checkGstin(GOOD).value === GOOD && F.checkGstin(GOOD).warning === null);
check('lower case is raised', F.checkGstin('29abcde1234f1z5').value === GOOD);
check('spaces and dashes are dropped', F.checkGstin('29 ABCDE-1234 F1Z5').value === GOOD);
check('blank is fine and says nothing',
  F.checkGstin('').value === '' && F.checkGstin('').warning === null);
check('nothing at all does not throw', F.checkGstin(null).value === '');
check('a short one warns about its length',
  (F.checkGstin('29ABCDE1234F1Z').warning || '').includes('15'));
check('but is still handed back to be saved', F.checkGstin('29ABCDE1234F1Z').value.length === 14);
check('a wrong shape of the right length warns',
  F.checkGstin('2XABCDE1234F1Z5').warning != null);
check('and it too is handed back', F.checkGstin('2XABCDE1234F1Z5').value.length === 15);
check('the check is stable under itself',
  F.checkGstin(F.checkGstin('29 abcde 1234 f1z5').value).value === GOOD);

console.log('\nFinding a customer by typing English');
/*
 * The shop types at a counter, in English, and the names already in the book are in Kannada.
 * searchKey reduces both to the same rough phonetic key so one finds the other; the name itself
 * is never touched, only how it is matched.
 *
 * The middle column is not decoration: it is how the repo's own Latin-to-Kannada transliterator
 * spells these words (selftest.js pins all nine), with capitals for retroflex consonants and
 * doubled letters for long vowels. The right-hand column is what a person actually types. Every
 * row of it exercises one folding rule, which is the whole reason the folding exists.
 */
const NAMES = [
  // stored           the scheme's spelling   what a shopkeeper types
  ['ಅಕ್ಕಿ', 'akki', 'akki'],
  ['ಎಣ್ಣೆ', 'eNNe', 'enne'],
  ['ಹಾಲು', 'haalu', 'halu'],
  ['ಹಿಟ್ಟು', 'hiTTu', 'hittu'],
  ['ಬೆಳೆ', 'beLe', 'bele'],
  ['ನಂದಿ', 'naMdi', 'nandi'],
];
for (const [stored, scheme, typed] of NAMES) {
  const key = SH.searchKey(stored);
  check('typing "' + typed + '" reaches ' + stored, SH.searchKey(typed) === key,
    SH.searchKey(typed) + ' vs ' + key);
  check('and so does the scheme spelling "' + scheme + '"', SH.searchKey(scheme) === key,
    SH.searchKey(scheme) + ' vs ' + key);
}

// The two spellings the reversed tables get wrong on their own, and the commonest surname in
// Karnataka is one of them.
check('gowda reaches ಗೌಡ', SH.searchKey('gowda') === SH.searchKey('ಗೌಡ'));
check('so does gouda', SH.searchKey('gouda') === SH.searchKey('ಗೌಡ'));
check('vishwa reaches ವಿಶ್ವ',
  SH.searchKey('vishwa') === SH.searchKey('ವಿಶ್ವ'));

// Adding a way to match must not take one away.
const RAMESH = { name: 'ರಮೇಶ್', phone: '9886012345' };
check('English finds a Kannada name', F.customerMatches(RAMESH, 'ramesh'));
check('a prefix of it does too', F.customerMatches(RAMESH, 'rame'));
check('Kannada still finds a Kannada name', F.customerMatches(RAMESH, 'ರಮೇ'));
check('the number still finds them', F.customerMatches(RAMESH, '9886'));
const LATIN = { name: 'Ramesha', phone: '9886012399' };
check('English still finds an English name', F.customerMatches(LATIN, 'rames'));
check('and Kannada finds an English name', F.customerMatches(LATIN, 'ರಮೇ'));

// What must not match.
check('a different name does not', !F.customerMatches(RAMESH, 'suresh'));
check('and the keys really are different',
  SH.searchKey('ರಮೇಶ್') !== SH.searchKey('ಸುರೇಶ್'));
// The bug the old `includes('')` comment records: an empty query listing the whole book.
check('an empty query matches nobody', !F.customerMatches(RAMESH, ''));
check('nor does whitespace', !F.customerMatches(RAMESH, '   '));
check('a middle fragment does not match -- prefix, not substring',
  !F.customerMatches(LATIN, 'mesha'));
// Digits alone must not be read as a name prefix.
check('a number that is not theirs does not match', !F.customerMatches(RAMESH, '9000'));

check('the key is stable under itself',
  SH.searchKey(SH.searchKey('ರಮೇಶ್')) === SH.searchKey('ರಮೇಶ್'));
check('an empty name has an empty key', SH.searchKey('') === '' && SH.searchKey('  ') === '');

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
check('letters in the phone field are refused rather than silently dropped',
  !F.checkCustomer('Abhishek', 'abcd').ok, JSON.stringify(F.checkCustomer('Abhishek', 'abcd')));
check('the same digit ten times is refused', !F.checkCustomer('A', '0000000000').ok);
check('and so is one repeated across a valid length', !F.checkCustomer('A', '1111111111').ok);
check('a real mobile is accepted', F.checkCustomer('A', '9876543210').phone === '9876543210');
check('a landline with its STD code is accepted',
  F.checkCustomer('A', '080 2345 6789').phone === '8023456789',
  F.checkCustomer('A', '080 2345 6789').phone);
check('an international prefix still folds away',
  F.checkCustomer('A', '0091 98860 12345').phone === '9886012345',
  F.checkCustomer('A', '0091 98860 12345').phone);
check('ten zeros are not mangled into eight digits',
  F.normalisePhone('0000000000') === '0000000000', F.normalisePhone('0000000000'));
check('a blank phone with a name is still fine', F.checkCustomer('Abhishek', '').ok);

console.log('\nUnit field');
check('blank unit becomes pc', F.checkUnit('').value === 'pc');
check('whitespace unit becomes pc', F.checkUnit('   ').value === 'pc');
check('a unit is trimmed', F.checkUnit(' kg ').value === 'kg');
rejects(F.checkUnit, 'unit', 'x'.repeat(17));

/* ------------------------------------------------------------------ *
 * The server address the phone is given                               *
 *                                                                     *
 * Android has blocked cleartext by default since API 28, so guessing  *
 * http for a public hostname produced a request the phone refused and  *
 * an error that blamed the wifi.                                       *
 * ------------------------------------------------------------------ */
const U = require(path.join(ROOT, 'shared', 'dist', 'cjs', 'serverUrl.js'));
const url = (x) => U.normaliseServerUrl(x);

console.log('');
console.log('Server address');
check('a shop LAN address stays http', url('192.168.1.5:4000') === 'http://192.168.1.5:4000', url('192.168.1.5:4000'));
check('10.x is a LAN too', url('10.0.0.9:4000') === 'http://10.0.0.9:4000', url('10.0.0.9:4000'));
check('172.16-31 is a LAN too', url('172.20.5.4:4000') === 'http://172.20.5.4:4000', url('172.20.5.4:4000'));
check('172.32 is not a LAN', url('172.32.5.4:4000') === 'https://172.32.5.4:4000', url('172.32.5.4:4000'));
check('localhost stays http', url('localhost:4000') === 'http://localhost:4000', url('localhost:4000'));
check('loopback stays http', url('127.0.0.1:4000') === 'http://127.0.0.1:4000', url('127.0.0.1:4000'));
check('a .local name stays http', url('counter.local:4000') === 'http://counter.local:4000', url('counter.local:4000'));
check('a public hostname becomes https',
  url('performing-minimum-ghz-nine.trycloudflare.com') === 'https://performing-minimum-ghz-nine.trycloudflare.com',
  url('performing-minimum-ghz-nine.trycloudflare.com'));
check('a public IP becomes https', url('13.234.1.9') === 'https://13.234.1.9', url('13.234.1.9'));
check('an explicit http is respected', url('http://example.com') === 'http://example.com');
check('an explicit https is respected', url('https://example.com') === 'https://example.com');
check('a trailing slash is dropped', url('https://example.com/') === 'https://example.com');
check('several trailing slashes go too', url('https://example.com///') === 'https://example.com');
check('surrounding space is ignored', url('  192.168.1.5:4000  ') === 'http://192.168.1.5:4000');
check('blank stays blank', url('') === '' && url('   ') === '');
check('a null does not throw', url(null) === '');
check('normalising twice changes nothing', url(url('192.168.1.5:4000')) === 'http://192.168.1.5:4000');
check('and twice on a public host too', url(url('shop.example.com')) === 'https://shop.example.com');

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All field checks passed.');
