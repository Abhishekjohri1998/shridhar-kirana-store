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

/*
 * The same list, less the one entry that now means something.
 *
 * A price box takes a sum since the shop asked for two kilos at 44 to be enterable as 44*2, so
 * `1/2` is no longer a typo there -- it is half a rupee. parseDecimal still refuses it, and so do
 * the fields that take a plain number and nothing else: a quantity, a count of days.
 */
const NOT_AMOUNTS = NOT_NUMBERS.filter((x) => x !== '1/2');

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
for (const bad of NOT_AMOUNTS) rejects(F.parsePrice, 'price', bad);
check('half a rupee is a sum now, not a typo', F.parsePrice('1/2').value === 0.5);
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
for (const bad of NOT_AMOUNTS.filter((b) => b.trim() !== '')) rejects((v) => F.parsePaid(v, 222), 'paid', bad);
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
console.log('');
console.log('The PIN check that works without a server');
/*
 * The shop bills through power cuts and dead links, so the lock on a fresh start is checked
 * against a digest kept on the device rather than against the server. Written out by hand
 * because neither runtime offers a synchronous digest and a native one would mean rebuilding
 * the app -- so these are the published vectors, which is what says the arithmetic is right.
 */
check('the empty string', SH.sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
check('abc', SH.sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('a sentence', SH.sha256('The quick brown fox jumps over the lazy dog') === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
check('one that crosses a block boundary',
  SH.sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')
    === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
check('Kannada goes through as UTF-8', SH.sha256('ಅಕ್ಕಿ').length === 64);

check('the same PIN and salt give the same digest',
  SH.pinDigest('104528', 'abc') === SH.pinDigest('104528', 'abc'));
check('a different PIN does not', SH.pinDigest('104528', 'abc') !== SH.pinDigest('104529', 'abc'));
check('and neither does the same PIN on another device',
  SH.pinDigest('104528', 'abc') !== SH.pinDigest('104528', 'xyz'));
check('surrounding spaces are not part of the PIN',
  SH.pinDigest(' 104528 ', 'abc') === SH.pinDigest('104528', 'abc'));
check('the stored value does not contain the PIN',
  !SH.pinDigest('104528', 'abc').includes('104528'));

console.log('');
console.log('Every hand-written line fitted to its own row');
/*
 * The shop's complaint, from a printed slip: three hand-written items came out at three
 * different sizes, and lines sat at different heights within their rows. Both followed from one
 * scale and one origin shared across the whole slip -- which was deliberate, to keep the
 * proportions the shopkeeper wrote, and which read as raggedness on paper.
 *
 * Each line is now fitted to its own row. What these guard: that two lines of different sizes
 * print the same height, that a line starts at the top of its row wherever it sat on the strip,
 * that the strip's own pixel size no longer changes the printed size, and that a tiny mark is
 * not magnified into a banner.
 */
const TALL = { w: 300, h: 120, strokes: [[10, 10, 10, 110, 60, 110]] };
// A smaller hand, but a real one: it covers a third of the strip, so it fills its row.
const SMALL = { w: 300, h: 120, strokes: [[10, 40, 40, 40, 40, 82]] };
const WIDE = { w: 900, h: 120, strokes: [[0, 60, 880, 60]] };
const ROW = 46;
const WIDTH = SH.inkMaxWidth(384);
const drawnHeight = (ink, fit) => {
  const b = SH.inkBounds(ink);
  return (b.maxY - b.minY) * fit.scale;
};

const tallFit = SH.inkRowFit(TALL, WIDTH, ROW);
const smallFit = SH.inkRowFit(SMALL, WIDTH, ROW);
check('a line fills the height it is given', Math.abs(drawnHeight(TALL, tallFit) - ROW) < 0.001,
  drawnHeight(TALL, tallFit) + ' vs ' + ROW);
check('and a smaller hand fills it too, so the lines are even',
  Math.abs(drawnHeight(SMALL, smallFit) - ROW) < 0.001,
  drawnHeight(SMALL, smallFit) + ' vs ' + ROW);
check('each line starts at its own top, not at the top of the slip',
  tallFit.originY === SH.inkBounds(TALL).minY && smallFit.originY === SH.inkBounds(SMALL).minY,
  tallFit.originY + ' / ' + smallFit.originY);
check('one line does not change another',
  SH.inkRowFit(TALL, WIDTH, ROW).scale === tallFit.scale, String(tallFit.scale));

// The fault that had nothing to do with taste: strokes are stored in the pixels of the strip
// they were written on, and that strip is 96 or 116 tall depending on the room the row had.
const ROOMY = { w: 600, h: 240, strokes: [[20, 20, 20, 220, 120, 220]] };
check('the same writing on a bigger strip prints the same size',
  Math.abs(drawnHeight(ROOMY, SH.inkRowFit(ROOMY, WIDTH, ROW)) - drawnHeight(TALL, tallFit)) < 0.001,
  drawnHeight(ROOMY, SH.inkRowFit(ROOMY, WIDTH, ROW)) + ' vs ' + drawnHeight(TALL, tallFit));

// A stray dash must not become the largest thing on the bill.
const DASH = { w: 300, h: 120, strokes: [[10, 60, 40, 60]] };
const dashFit = SH.inkRowFit(DASH, WIDTH, ROW);
check('a tiny mark is not blown up to fill the row',
  drawnHeight(DASH, dashFit) < ROW, String(drawnHeight(DASH, dashFit)));
check('and the cap is what held it', Math.abs(dashFit.scale - (ROW / DASH.h) * SH.MAX_INK_UPSCALE) < 1e-9,
  dashFit.scale + ' vs ' + (ROW / DASH.h) * SH.MAX_INK_UPSCALE);

check('the row is taller than the writing, to hold the pen',
  SH.INK_ROW_ADVANCE === SH.INK_ROW_HEIGHT + 2 * SH.INK_BLEED,
  SH.INK_ROW_ADVANCE + ' vs ' + SH.INK_ROW_HEIGHT);
check('and the pen has somewhere to go', SH.INK_BLEED * 2 >= SH.INK_STROKE_DOTS,
  'bleed ' + SH.INK_BLEED + ' vs stroke ' + SH.INK_STROKE_DOTS);
check('the gutter is real', SH.INK_GUTTER > 0, String(SH.INK_GUTTER));

const wideFit = SH.inkRowFit(WIDE, WIDTH, ROW);
check('a line too wide for the paper caps the scale',
  (SH.inkBounds(WIDE).maxX - SH.inkBounds(WIDE).minX) * wideFit.scale <= WIDTH + 0.001,
  String(wideFit.scale));
check('and then it is the width, not the row, that is filled',
  drawnHeight(WIDE, wideFit) < ROW, String(drawnHeight(WIDE, wideFit)));
const flatFit = SH.inkRowFit({ w: 300, h: 120, strokes: [[10, 40, 90, 40]] }, WIDTH, ROW);
check('a single flat line still gets a usable scale',
  Number.isFinite(flatFit.scale) && flatFit.scale > 0, JSON.stringify(flatFit));

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

console.log('\nA Kannada name of its own');
/*
 * Two boxes, and whichever is filled is what shows. Not the item rule (nameKn || nameEn, always
 * Kannada): a shop that switches back to English has to get its English name back, while a
 * customer who only ever had one name must never render as blank.
 */
const RAMESH_KN = '\u0cb0\u0cae\u0cc7\u0cb6\u0ccd';
const eqs = (label, actual, expected) => check(label, actual === expected, JSON.stringify(actual));

eqs('Kannada mode prefers the Kannada name', SH.pickLang('Ramesh', RAMESH_KN, 'kn'), RAMESH_KN);
eqs('English mode prefers the English one', SH.pickLang('Ramesh', RAMESH_KN, 'en'), 'Ramesh');
eqs('Kannada mode falls back with no Kannada', SH.pickLang('Ramesh', '', 'kn'), 'Ramesh');
eqs('English mode falls back with no English', SH.pickLang('', RAMESH_KN, 'en'), RAMESH_KN);
eqs('both empty is empty, not undefined', SH.pickLang('', '', 'kn'), '');
eqs('undefined on either side is tolerated', SH.pickLang(undefined, undefined, 'en'), '');
eqs('whitespace counts as empty', SH.pickLang('Ramesh', '   ', 'kn'), 'Ramesh');

// The helper the screens use, so the argument order cannot be got wrong at ten call sites.
eqs('customerName in Kannada', SH.customerName({ name: 'Ramesh', nameKn: RAMESH_KN }, 'kn'), RAMESH_KN);
eqs('customerName in English', SH.customerName({ name: 'Ramesh', nameKn: RAMESH_KN }, 'en'), 'Ramesh');
eqs('customerName with no Kannada at all', SH.customerName({ name: 'Ramesh' }, 'kn'), 'Ramesh');

// A name in either box is enough, as a name or a phone always was.
check('a Kannada name alone is accepted', F.checkCustomer('', '', RAMESH_KN).ok);
eqs('and comes back on the Kannada side', F.checkCustomer('', '', RAMESH_KN).nameKn, RAMESH_KN);
check('all three empty is still refused', !F.checkCustomer('', '', '').ok);
check('an over-long Kannada name is refused', !F.checkCustomer('', '', 'x'.repeat(81)).ok);

// Searching must reach a customer who only has the Kannada box filled, or the second box makes
// people harder to find rather than easier.
const KN_ONLY = { name: '', nameKn: RAMESH_KN, phone: '9886012345' };
check('English finds a Kannada-only customer', F.customerMatches(KN_ONLY, 'ramesh'));
check('a prefix does too', F.customerMatches(KN_ONLY, 'rame'));
check('Kannada finds them', F.customerMatches(KN_ONLY, '\u0cb0\u0cae\u0cc7'));
check('a different name does not', !F.customerMatches(KN_ONLY, 'suresh'));
const BOTH_NAMES = { name: 'Ramesha Kumar', nameKn: RAMESH_KN, phone: '9000000001' };
check('either box can match: the English one', F.customerMatches(BOTH_NAMES, 'kumar'));
check('and the Kannada one', F.customerMatches(BOTH_NAMES, '\u0cb0\u0cae\u0cc7'));

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
 * Bills set aside                                                     *
 *                                                                     *
 * The list operations, the id that must never repeat, and the JSON    *
 * round trip that parking a bill on the tablet depends on.            *
 * ------------------------------------------------------------------ */
console.log('');
console.log('Parked bills');

const D = require(path.join(BUILD_SHARED, 'drafts.js'));

const blank = D.emptyDraft('a');
check('a fresh draft is empty', D.isDraftEmpty(blank));
check('and comes to nothing', D.draftTotal(blank) === 0);
check('a typed name alone makes it worth keeping', !D.isDraftEmpty({ ...blank, typed: { name: 'Ramesh', nameKn: '', phone: '' } }));
check('so does a Kannada name alone', !D.isDraftEmpty({ ...blank, typed: { name: '', nameKn: RAMESH_KN, phone: '' } }));
// The cross that clears a line is greyed out when the line carries nothing. It used to ask
// `!ink && rate === 0` -- the rule from before items could be typed -- so a typed item with no
// price yet counted as empty and could not be cancelled, while a hand-written one could.
check('a typed name alone makes a line worth something',
  D.lineHasSomething({ itemId: 'a', nameKn: 'Sugar 2kg', nameEn: '', qty: 1, rate: 0 }));
check('so does a price on its own',
  D.lineHasSomething({ itemId: 'a', nameKn: '', nameEn: '', qty: 1, rate: 20 }));
check('and handwriting on its own',
  D.lineHasSomething({ itemId: 'a', nameKn: '', nameEn: '', qty: 1, rate: 0,
    ink: { w: 10, h: 10, strokes: [[0, 0, 5, 5]] } }));
check('an untouched line carries nothing',
  !D.lineHasSomething({ itemId: 'a', nameKn: '   ', nameEn: '', qty: 1, rate: 0 }));
check('nor does a writing strip with no strokes on it yet',
  !D.lineHasSomething({ itemId: 'a', nameKn: '', nameEn: '', qty: 1, rate: 0,
    ink: { w: 10, h: 10, strokes: [] } }));

check('a note alone makes it worth keeping', !D.isDraftEmpty({ ...blank, note: 'Delivery Tuesday' }));
// A bill parked by an older app has no note at all. Read straight back, `isDraftEmpty` would
// call .trim() on undefined and take the bill screen down on launch with the bill inside it.
const older = { ...blank };
delete older.note;
check('a draft parked before notes existed survives being read back',
  D.isDraftEmpty(D.reviveDraft(older)));
eqs('and comes back with an empty note', D.reviveDraft(older).note, '');
check('so does an attached customer', !D.isDraftEmpty({ ...blank, customer: { id: 'c1', name: 'Ramesh', phone: '9000000007', balance: 0 } }));

const written = {
  ...blank,
  lines: [{ itemId: 'line-1', nameEn: '', nameKn: '', qty: 1, unit: 'pc', rate: 0, amount: 0,
            ink: { w: 300, h: 64, strokes: [[10, 20, 12, 22, 40, 30]] } }],
};
check('a blank line with handwriting is not empty', !D.isDraftEmpty(written));
check('an untouched blank line still is', D.isDraftEmpty({ ...blank, lines: [{ ...written.lines[0], ink: null }] }));
check('a priced line is not empty either', !D.isDraftEmpty({ ...blank, lines: [{ ...written.lines[0], ink: null, rate: 20 }] }));

const three = ['a', 'b', 'c'].map(D.emptyDraft);
eqs('closing the middle one leaves the others', D.closeDraft(three, 'b', 'z').map((d) => d.id).join(','), 'a,c');
eqs('and the one showing does not move', D.afterClosing(three, 'b', 'a'), 'a');
eqs('closing the one showing falls back to its neighbour', D.afterClosing(three, 'b', 'b'), 'a');
eqs('closing the first falls forward instead', D.afterClosing(three, 'a', 'a'), 'b');
eqs('closing the last of all leaves a fresh one', D.closeDraft([D.emptyDraft('a')], 'a', 'z').map((d) => d.id).join(','), 'z');
check('and that fresh one is blank', D.isDraftEmpty(D.closeDraft([written], 'a', 'z')[0]));
check('there is a ceiling on parked bills', D.MAX_PARKED >= 2 && D.MAX_PARKED <= 20);

// The collision the old 'line-' + Date.now() + '-' + cart.length could not survive: two bills
// making a line in the same millisecond at the same length shared an id, and the writing strips
// are keyed by it -- one bill's handwriting appeared on another's line.
const ids = new Set();
for (let i = 0; i < 5000; i++) ids.add(D.nextLineId());
eqs('five thousand line ids, none repeated', ids.size, 5000);
check('a prefix is honoured', D.nextLineId('row').startsWith('row-'));

const trip = JSON.parse(JSON.stringify({ ...written, paidInput: '50', customerBalanceAt: '2026-09-01' }));
eqs('handwriting survives the round trip to storage', JSON.stringify(trip.lines[0].ink), JSON.stringify(written.lines[0].ink));
eqs('and so does the part payment', trip.paidInput, '50');
eqs('and the date the balance was carried from', trip.customerBalanceAt, '2026-09-01');

// A pad seeded from a bill written before the tablet was turned holds coordinates in the old
// pad's space; a new stroke beside them would print at a different size.
const moved = SH.rescaleStrokes([[{ x: 10, y: 20 }], [{ x: 100, y: 40 }]], { w: 200, h: 40 }, { w: 400, h: 80 });
eqs('strokes double with the pad', JSON.stringify(moved), JSON.stringify([[{ x: 20, y: 40 }], [{ x: 200, y: 80 }]]));
check('the same size is left alone, object and all', SH.rescaleStrokes(moved, { w: 5, h: 5 }, { w: 5, h: 5 }) === moved);
check('a zero-width origin does not divide by zero', SH.rescaleStrokes([[{ x: 1, y: 1 }]], { w: 0, h: 0 }, { w: 9, h: 9 })[0][0].x === 1);

/* ------------------------------------------------------------------ *
 * Doing the sum in the price box                                      *
 *                                                                     *
 * Two kilos at 44 used to be worked out in the shopkeeper's head       *
 * while a queue waited. Android's number pad has no x or / key, so     *
 * the app supplies them and this is what it does with them.            *
 * ------------------------------------------------------------------ */
console.log('');
console.log('Sums in a money box');

const calc = (x) => SH.evaluateAmount(x);

eqs('two kilos at 44', calc('44*2'), 88);
eqs('the times sign the strip types', calc('44\u00d72'), 88);
eqs('and the x people write by hand', calc('44 x 2'), 88);
eqs('half of 88', calc('88/2'), 44);
eqs('the divide sign too', calc('88\u00f72'), 44);
eqs('a note and a coin', calc('100+50'), 150);
eqs('and change taken back off', calc('100-15'), 85);

// Taught precedence, not left to right: 44*2+10 is 98, and 108 would be a wrong bill.
eqs('times before plus', calc('44*2+10'), 98);
eqs('and whichever way round it is written', calc('10+44*2'), 98);
eqs('divide before minus', calc('100-10/2'), 95);

eqs('a third of ten, to the paisa', calc('10/3'), 3.33);
eqs('a plain number is still a plain number', calc('44'), 44);
eqs('so is one with paise', calc('12.50'), 12.5);
eqs('and one starting with a dot', calc('.5'), 0.5);

// Half-typed is the state the box is in on nearly every keystroke. It has to mean "not yet" --
// never an error, and never zero, or the line price would flicker between taps.
eqs('halfway through typing is not an error', calc('44*'), null);
eqs('nor is nothing at all', calc(''), null);
eqs('nor is a box of spaces', calc('   '), null);
eqs('an operator cannot start it', calc('*2'), null);
eqs('two operators in a row are a slip', calc('44**2'), null);
eqs('dividing by nothing has no answer', calc('44/0'), null);
eqs('two dots are a typo', calc('44..2'), null);
eqs('a comma is not a decimal point here', calc('44,2'), null);
eqs('exponents are not money', calc('1e3'), null);
eqs('nor is hex', calc('0x1f'), null);
eqs('and letters are letters', calc('abc'), null);
check('a negative total is not produced', calc('10-25') === -15);

// Through the real field rules, which is where the sum actually lands.
eqs('a sum reaches the price box', F.parsePrice('44*2').ok && F.parsePrice('44*2').value, 88);
check('a sum that comes to zero is refused like any zero', !F.parsePrice('10-10').ok);
check('and so is one that goes negative', !F.parsePrice('10-25').ok);
check('a sum over the maximum is refused', !F.parsePrice('999999*99').ok);
eqs('the paid box adds up the notes', F.parsePaid('100+50+20', 0).value, 170);
eqs('and a blank one still means the whole total', F.parsePaid('', 170).value, 170);
check('a half-typed sum in the paid box is refused, not read as zero',
  !F.parsePaid('100+', 0).ok);

/* ------------------------------------------------------------------ *
 * Turning the page on the slip                                        *
 *                                                                     *
 * Scrolling to the end kept the line being written at the bottom edge *
 * of the glass. The slip should fill a page and then start a fresh    *
 * one, the way paper does.                                            *
 * ------------------------------------------------------------------ */
console.log('');
console.log('Turning the page');

const flip = (v) => SH.pageFlip(v);
// A page five rows tall, rows a hundred tall.
const page = { rowHeight: 100, offset: 0, viewport: 500 };

eqs('a row well inside the page leaves it alone', flip({ ...page, rowTop: 200 }), null);
eqs('the last row that fits leaves it alone too', flip({ ...page, rowTop: 400 }), null);
eqs('one pixel past the fold turns the page', flip({ ...page, rowTop: 401 }), 401);
eqs('and the row lands at the top, not one row up', flip({ ...page, rowTop: 900 }), 900);
eqs('a row scrolled off the top comes back', flip({ ...page, offset: 600, rowTop: 300 }), 300);
eqs('the first row never scrolls above the slip', flip({ ...page, offset: 50, rowTop: 0 }), 0);
eqs('nothing measured yet, nothing moves', flip({ rowTop: 900, rowHeight: 0, offset: 0, viewport: 500 }), null);
eqs('no viewport either', flip({ rowTop: 900, rowHeight: 100, offset: 0, viewport: 0 }), null);
check('the answer is never negative',
  [0, 50, 400, 401, 900].every((rowTop) => {
    const y = flip({ ...page, rowTop });
    return y === null || y >= 0;
  }));

eqs('the tail is a page less one row', SH.slipTailPadding(500, 100), 400);
eqs('a slip shorter than a row asks for nothing', SH.slipTailPadding(80, 100), 0);
eqs('and nothing measured asks for nothing', SH.slipTailPadding(0, 100), 0);

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

/* ------------------------------------------------------------------ *
 * The address a build ships knowing                                   *
 *                                                                     *
 * The APK carries the shop's server so an install goes straight to    *
 * the PIN screen. The precedence is the part worth pinning down: a    *
 * device pointed somewhere else by hand must not be dragged back by   *
 * an update.                                                          *
 * ------------------------------------------------------------------ */
console.log('');
console.log('The built-in server address');

// The rule as api.ts applies it: `stored || normalise(builtIn)`.
const pick = (stored, builtIn) => stored || (builtIn.trim() ? U.normaliseServerUrl(builtIn) : '');

eqs('a fresh install uses the address in the build',
  pick('', 'shridhar-billing.duckdns.org'), 'https://shridhar-billing.duckdns.org');
eqs('a saved address wins over it',
  pick('http://192.168.1.5:4000', 'shridhar-billing.duckdns.org'), 'http://192.168.1.5:4000');
eqs('a build made for nobody still asks', pick('', ''), '');
eqs('and a blank built-in address is not turned into one', pick('', '   '), '');
check('the built-in address is forced to https, so Android will not block it',
  pick('', 'shridhar-billing.duckdns.org').startsWith('https://'));

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All field checks passed.');
