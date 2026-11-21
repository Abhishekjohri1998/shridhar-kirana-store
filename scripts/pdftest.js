/**
 * The bill as an A4 PDF (shared/src/billPdf.ts): the page layout, the drawing script, and the
 * hand-written PDF file. Pure functions from shared/; no server, no browser.
 *
 *   node scripts/pdftest.js
 */
const path = require('node:path');
const vm = require('node:vm');
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

const settings = { ...S.DEFAULT_SETTINGS, shopName: 'Shridhar Kirani Stores', footer: 'Thank you, visit again', language: 'en' };
const line = (i, o) => ({ itemId: 'l' + i, nameKn: 'Item number ' + i, nameEn: '', qty: 1, rate: 10 + i, ...o });
const bill = (lines, o) => ({
  no: 41, at: '2026-11-21T10:30:00.000Z', lines, total: lines.reduce((t, l) => t + l.qty * l.rate, 0),
  paid: 0, balance: 0, showBalance: false, ...o,
});
const texts = (pages) => pages.flatMap((p) => p.ops.filter((o) => o.t === 'text').map((o) => o.text));

console.log('\nA long bill runs onto more pages');
{
  const lines = Array.from({ length: 45 }, (_, i) => line(i + 1));
  const pages = S.billPdfPages(bill(lines), settings);
  check('45 lines need a second page', pages.length >= 2, String(pages.length));
  check('every page is A4', pages.every((p) => p.w === 595 && p.h === 842));
  check('the column headings on every page', pages.every((p) => p.ops.some((o) => o.t === 'text' && o.text === 'Amount')));
  check('and "Rate" and "Qty" among them', pages.every((p) => ['Qty', 'Rate'].every((h) => p.ops.some((o) => o.t === 'text' && o.text === h))));
  const all = texts(pages);
  const numbers = Array.from({ length: 45 }, (_, i) => String(i + 1));
  check('every line number once', numbers.every((n) => all.filter((t) => t === n).length >= 1));
  check('every item named', lines.every((l) => all.includes(l.nameKn)));
  eq('page numbers on each', pages.map((p) => p.ops.find((o) => o.t === 'text' && /^Page \d/.test(o.text))?.text),
    pages.map((_, i) => 'Page ' + (i + 1) + ' / ' + pages.length));
  check('a later page names the shop and bill', texts([pages[1]]).some((t) => t.includes('Bill #41')));
  check('nothing drawn off the page', pages.every((p) => p.ops.every((o) => o.t !== 'text' || (o.y > 0 && o.y < 842 && o.x >= 0 && o.x <= 595))));
  check('the total is on the last page', texts([pages[pages.length - 1]]).includes(S.money(bill(lines).total)));
  check('the footer too', texts([pages[pages.length - 1]]).includes('Thank you, visit again'));
}

console.log('\nOne page, no page number');
{
  const pages = S.billPdfPages(bill([line(1), line(2)]), settings);
  eq('a short bill is one page', pages.length, 1);
  check('with no "Page 1 / 1"', !texts(pages).some((t) => t.startsWith('Page')));
  check('the shop name at the top', texts(pages)[0] === 'Shridhar Kirani Stores');
}

console.log('\nQuantity and rate columns');
{
  const pages = S.billPdfPages(bill([
    line(1, { nameKn: 'Sugar', qty: 2, rate: 44, unit: 'kg' }),
    line(2, { nameKn: 'Soap', qty: 3, rate: 25 }),
    line(3, { nameKn: 'Matches', qty: 1, rate: 5 }),
  ]), settings);
  const all = texts(pages);
  check('counted in a unit: "2 kg"', all.includes('2 kg'));
  check('its rate', all.includes('44'));
  check('and its amount', all.includes('88'));
  check('more than one, no unit: "3" at 25', all.includes('3') && all.includes('25') && all.includes('75'));
  const row = pages[0].ops.filter((o) => o.t === 'text' && Math.abs(o.y - pages[0].ops.find((p) => p.t === 'text' && p.text === 'Matches').y) < 1);
  eq('a plain item and price: no quantity or rate, just the amount', row.map((o) => o.text).sort(), ['3', '5', 'Matches'].sort());
}

console.log('\nHandwriting');
{
  const ink = { w: 400, h: 64, strokes: [[10, 10, 60, 50, 120, 20], [200, 30, 380, 40], [390, 30]] };
  const pages = S.billPdfPages(bill([line(1, { nameKn: '', ink, rate: 120 }), line(2, { nameKn: '', ink, rate: 30, given: true })]), settings);
  const inks = pages[0].ops.filter((o) => o.t === 'ink');
  eq('one drawing per written line', inks.length, 2);
  check('inside the item column', inks.every((o) => o.x >= 70 && o.x + (380 - 10) * o.scale <= 70 + 250 + 1),
    JSON.stringify(inks.map((o) => [o.x, o.scale])));
  check('one size of writing for the bill', inks[0].scale === inks[1].scale);
  check('a ticked line gets its tick', texts(pages).includes('✓'));
  check('and its price', texts(pages).includes('120') && texts(pages).includes('30'));
}

console.log('\nWords, Kannada, quotations, hidden names, balance');
{
  const kn = S.billPdfPages(bill([line(1)]), { ...settings, language: 'kn', shopNameKn: 'ಶ್ರೀಧರ' }, S.receiptLabelsFor('kn'));
  check('Kannada headings', ['ಪ್ರಮಾಣ', 'ದರ', 'ಮೊತ್ತ'].every((w) => texts(kn).includes(w)));
  check('and the Kannada shop name', texts(kn)[0] === 'ಶ್ರೀಧರ');
  const q = S.billPdfPages(bill([line(1)], { kind: 'quotation' }), settings);
  check('a quotation says so', texts(q).includes('QUOTATION') && texts(q).includes('Not a bill') && texts(q).includes('Quote #41'));
  const hidden = S.billPdfPages(bill([line(1, { nameKn: 'Secret item' })], { hideNames: true }), settings);
  check('descriptions hidden: no name', !texts(hidden).includes('Secret item'));
  const owed = S.billPdfPages(bill([line(1, { rate: 100 })], {
    total: 100, paid: 50, balance: 250, showBalance: true, previousBalance: 200, previousBalanceAt: '2026-11-01T00:00:00.000Z', note: 'Deliver after 5',
  }), settings);
  const t = texts(owed);
  check('old balance as a line of the table', t.some((s) => s.startsWith('Old bal.')) && t.includes('200'));
  check('total includes it', t.includes('300'));
  check('paid and balance', t.includes('Paid') && t.includes('50') && t.includes('Balance') && t.includes('250'));
  check('the note', t.some((s) => s === 'Note: Deliver after 5'));
}

console.log('\nWrapping long names');
{
  const w = S.pdfWrap('Sunrise premium basmati rice extra long grain special festival pack', 11, 120);
  check('wrapped to the width', w.length > 1 && w.every((l) => S.pdfTextWidth(l, 11) <= 120 + 12));
  const long = S.pdfWrap(Array(40).fill('word').join(' '), 11, 80);
  check('at most three lines, the last cut', long.length === 3 && long[2].endsWith('…'));
  check('a word wider than the column is broken', S.pdfWrap('a'.repeat(80), 11, 60).length > 1);
}

console.log('\nThe drawing script');
{
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (k === 'measureText' ? (s) => ({ width: s.length * 5 }) : (...a) => calls.push([k, ...a]))),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(S.PDF_PAGE_SCRIPT, sandbox);
  const ink = { w: 400, h: 64, strokes: [[10, 10, 60, 50], [200, 30]] };
  const pages = S.billPdfPages(bill([line(1, { nameKn: '', ink }), line(2)]), settings);
  sandbox.drawPdfPage(ctx, pages[0], 2, S.PDF_FONT);
  const textOps = pages[0].ops.filter((o) => o.t === 'text').length;
  eq('every text drawn', calls.filter((c) => c[0] === 'fillText').length, textOps);
  check('strokes drawn', calls.some((c) => c[0] === 'lineTo') && calls.some((c) => c[0] === 'arc'));
  check('scaled to pixels', calls.some((c) => c[0] === 'scale' && c[1] === 2));
}

console.log('\nThe PDF file');
{
  const jpeg = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 255);
  const bytes = S.pdfFromJpegs([{ jpeg: jpeg(500), width: 1190, height: 1684 }, { jpeg: jpeg(300), width: 1190, height: 1684 }]);
  const s = Buffer.from(bytes).toString('latin1');
  check('starts as a PDF', s.startsWith('%PDF-1.4'));
  check('ends as one', s.trimEnd().endsWith('%%EOF'));
  check('two pages', s.includes('/Count 2'));
  check('A4', s.includes('/MediaBox [0 0 595 842]'));
  check('JPEG pictures', (s.match(/\/Filter \/DCTDecode/g) || []).length === 2);
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  check('startxref points at the table', s.slice(xref, xref + 4) === 'xref');
  const entries = s.slice(xref).split('\n').slice(3).filter((l) => / 00000 n $/.test(l)).map((l) => Number(l.slice(0, 10)));
  check('every object where the table says', entries.length === 8 && entries.every((off, i) => s.slice(off).startsWith((i + 1) + ' 0 obj')),
    JSON.stringify(entries));
  check('each picture whole', s.includes('/Length 500 >>') && s.includes('/Length 300 >>'));
  eq('the file name', [S.billPdfName({ no: 7 }), S.billPdfName({ no: 3, kind: 'quotation' })], ['bill-7.pdf', 'quotation-3.pdf']);
}

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All PDF checks passed.');
