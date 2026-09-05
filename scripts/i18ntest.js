/**
 * Keeps the two languages in step.
 *
 * TypeScript already forces the Kannada dictionary to carry every English key, so nothing can be
 * missing. What it cannot see is a key left as English text by accident, a placeholder like {n}
 * dropped in translation (which would print "{n} bills" as "bills"), or a key that no longer
 * appears anywhere in the app. Those are what this checks.
 *
 *   node scripts/i18ntest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.i18ntest-build');
// One dictionary serves both apps, so usage has to be counted across both. Scanning only the
// web client made any key the phone alone uses look dead.
const SRC_DIRS = [
  path.join(ROOT, 'client', 'src'),
  path.join(ROOT, 'mobile', 'src'),
  path.join(ROOT, 'mobile', 'App.tsx'),
];

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc, 'shared/src/i18n.ts',
  '--outDir', BUILD, '--module', 'commonjs', '--target', 'es2019',
  '--strict', '--skipLibCheck', '--lib', 'es2019,dom',
], { cwd: ROOT, stdio: 'inherit' });

const { STRINGS, makeT, receiptLabelsFor } = require(path.join(BUILD, 'i18n.js'));

const en = STRINGS.en;
const kn = STRINGS.kn;
const keys = Object.keys(en);

console.log('');
console.log('Dictionary shape');
check('there is something to translate', keys.length > 100, keys.length + ' keys');
check('both languages have the same keys',
  JSON.stringify(Object.keys(en).sort()) === JSON.stringify(Object.keys(kn).sort()));
check('no English string is empty', keys.every((k) => en[k].trim().length > 0));
check('no Kannada string is empty', keys.every((k) => kn[k].trim().length > 0));

console.log('');
console.log('Placeholders survive translation');
const holders = (s) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
for (const key of keys) {
  const a = holders(en[key]);
  const b = holders(kn[key]);
  if (a === '' && b === '') continue;
  check('placeholders match for ' + key, a === b, 'en=' + a + ' kn=' + b);
}

console.log('');
console.log('The Kannada is actually Kannada');
const KANNADA = /[ಀ-೿]/;
// A handful are meant to stay in Latin: the transliteration examples, and product names.
const LATIN_BY_DESIGN = new Set(['kni.placeholder', 'set.langEn', 'set.langKn', 'login.pin', 'common.new']);
const untranslated = keys.filter(
  (k) => !LATIN_BY_DESIGN.has(k) && !KANNADA.test(kn[k]) && /[A-Za-z]{3}/.test(kn[k]),
);
check('no key was left as plain English', untranslated.length === 0, untranslated.join(', '));
const identical = keys.filter((k) => !LATIN_BY_DESIGN.has(k) && en[k] === kn[k]);
check('no key is byte-identical to the English', identical.length === 0, identical.join(', '));

console.log('');
console.log('Every key is used, and every used key exists');
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name) && true) out.push(full);
  }
  return out;
}
const sourceFiles = SRC_DIRS.flatMap((p) => (fs.statSync(p).isDirectory() ? walk(p) : [p]));
const sources = sourceFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set(
  [...sources.matchAll(/(?<![A-Za-z0-9_$])t\(\s*'([\w.]+)'/g)].map((m) => m[1]),
);
// TABS in App.tsx names its keys in a table, then feeds them through t().
for (const m of sources.matchAll(/key:\s*'((?:nav)\.[\w.]+)'/g)) used.add(m[1]);
// Settings passes these as a variable, so they never appear literally inside t(...).
for (const m of sources.matchAll(/'(set\.saved[\w.]*)'/g)) used.add(m[1]);

const unknown = [...used].filter((k) => !(k in en));
check('no key is used that does not exist', unknown.length === 0, unknown.join(', '));
const unused = keys.filter((k) => !used.has(k));
check('no key is left over unused', unused.length === 0, unused.join(', '));

console.log('');
console.log('The translator itself');
const tEn = makeT('en');
const tKn = makeT('kn');
check('English comes back English', tEn('nav.bill') === 'Bill', tEn('nav.bill'));
check('Kannada comes back Kannada', KANNADA.test(tKn('nav.bill')), tKn('nav.bill'));
check('a placeholder is filled', tEn('app.today', { amount: '222' }) === 'Today 222', tEn('app.today', { amount: '222' }));
check('a missing variable is left visible rather than printed as undefined',
  tEn('app.today') === 'Today {amount}', tEn('app.today'));
check('an unknown language falls back to English', makeT('xx')('nav.bill') === 'Bill');
check('extra variables are ignored', tEn('nav.bill', { nope: 1 }) === 'Bill');

console.log('');
console.log('Receipt labels');
const enLabels = receiptLabelsFor('en');
const knLabels = receiptLabelsFor('kn');
check('the English slip says TOTAL', enLabels.total === 'TOTAL');
check('every slip label is translated',
  Object.keys(enLabels).every((k) => KANNADA.test(knLabels[k])),
  JSON.stringify(knLabels));
check('the slip labels have the same fields in both',
  JSON.stringify(Object.keys(enLabels).sort()) === JSON.stringify(Object.keys(knLabels).sort()));
// The slip is 384 dots across; a long label pushes the amount off the paper.
const longest = Object.entries(knLabels).sort((a, b) => b[1].length - a[1].length)[0];
check('no slip label is absurdly long', longest[1].length <= 12, longest.join('='));

fs.rmSync(BUILD, { recursive: true, force: true });

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All i18n checks passed.');
