/**
 * The MongoDB schemas, checked without a MongoDB.
 *
 * This exists because of a bug that reached a real user. Every line of the slip is handwriting
 * now, and handwriting carries no typed name -- but the bill line schema still marked both name
 * fields `required`, and Mongoose's `required` validator rejects an empty string. The result was
 * that no bill could be saved at all: a 500 on every print.
 *
 * Nothing caught it, because the pipeline test drives the JSON file store, which validates
 * nothing. So this loads the Mongoose models and validates documents against them in memory.
 * `validateSync()` needs no connection, which means the schema can be checked on every run
 * rather than only when someone happens to have Atlas to hand.
 *
 *   node scripts/schematest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.schematest-build');

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
  tsc, '-p', 'server/tsconfig.json', '--outDir', BUILD, '--noEmit', 'false',
], { cwd: ROOT, stdio: 'inherit' });

const mongoose = require(path.join(ROOT, 'node_modules', 'mongoose'));

/**
 * Loading the module registers the models. No connection is made, and none is needed:
 * `validateSync` runs entirely in memory.
 */
require(path.join(BUILD, 'store', 'mongo.js'));
// Loaded here, not at the point of use: the build directory is deleted before the checks end.
const { upsertDoc } = require(path.join(BUILD, 'store', 'types.js'));
function models() {
  return mongoose.models;
}

const SAMPLE_INK = { w: 300, h: 62, strokes: [[10, 40, 30, 12, 50, 40], [70, 20, 70, 50]] };

function billDoc(lines) {
  return {
    no: 1,
    at: new Date().toISOString(),
    lines,
    total: 100,
    paid: 100,
    balance: 0,
    showBalance: false,
  };
}

(async () => {
  const registered = models();
  const Bill = registered.Bill;
  const Customer = registered.Customer;
  const SettingsModel = registered.Settings;

  console.log('');
  console.log('MongoDB schemas, validated in memory');

  check('the bill model is registered', Boolean(Bill));
  if (!Bill) {
    console.log('\ncannot continue without the Bill model');
    process.exit(1);
  }

  // The bug, exactly: a line that is handwriting and a price, with no typed name anywhere.
  const handwritten = new Bill(billDoc([
    { itemId: 'line-1', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 100 },
  ]));
  const handwrittenError = handwritten.validateSync();
  check(
    'a handwritten line with no typed name is valid',
    !handwrittenError,
    handwrittenError && Object.keys(handwrittenError.errors).join(', '),
  );

  // The other shape the slip produces: a price with nothing written beside it.
  const bare = new Bill(billDoc([
    { itemId: 'line-2', nameKn: '', nameEn: '', qty: 1, rate: 100 },
  ]));
  const bareError = bare.validateSync();
  check(
    'a bare price with no writing is valid',
    !bareError,
    bareError && Object.keys(bareError.errors).join(', '),
  );

  // Several lines, because the failure was reported per index and only showed up past the first.
  const many = new Bill(billDoc([
    { itemId: 'a', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 23 },
    { itemId: 'b', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 46 },
    { itemId: 'c', nameKn: '', nameEn: '', ink: SAMPLE_INK, qty: 1, rate: 75 },
  ]));
  check('a whole slip of handwriting is valid', !many.validateSync());

  // A typed name still has to be allowed: the shape older bills were saved in.
  const typed = new Bill(billDoc([
    { itemId: 'akki', nameKn: 'ಅಕ್ಕಿ', nameEn: 'Rice', qty: 2, rate: 50 },
  ]));
  check('a line with typed names is still valid', !typed.validateSync());

  // The carried-balance fields. Both optional on purpose: every bill already in Atlas predates
  // them, and `required: true` with a default is the exact pairing that once made every print
  // fail -- which is why this file exists.
  const line = [{ itemId: 'x', nameKn: '', nameEn: '', qty: 1, rate: 5 }];
  const carried = new Bill({
    ...billDoc(line), previousBalance: 370, previousBalanceAt: '2026-08-02T10:00:00',
  });
  check('a bill carrying a balance forward is valid', !carried.validateSync());
  const undated = new Bill({ ...billDoc(line), previousBalance: 370, previousBalanceAt: null });
  check('and one carrying a balance with no date', !undated.validateSync());
  const older = new Bill(billDoc(line));
  check('a bill written before the fields existed is still valid', !older.validateSync());
  check('and reads as carrying nothing', older.previousBalance === 0 && older.previousBalanceAt === null,
    JSON.stringify([older.previousBalance, older.previousBalanceAt]));

  // Cancelling is a flag on the bill, so every bill written before the flag existed has to read
  // as live rather than as undefined.
  const voided = new Bill({ ...billDoc(line), cancelled: true, cancelledAt: '2026-09-07T10:00:00' });
  check('a cancelled bill is valid', !voided.validateSync());
  check('a bill written before cancelling existed reads as live',
    older.cancelled === false && older.cancelledAt === null,
    JSON.stringify([older.cancelled, older.cancelledAt]));

  // What must still be refused, so this has not simply turned validation off.
  const noRate = new Bill(billDoc([{ itemId: 'x', nameKn: '', nameEn: '', qty: 1 }]));
  check('a line with no rate is refused', Boolean(noRate.validateSync()));

  const noNumber = new Bill({ ...billDoc([{ itemId: 'x', nameKn: '', nameEn: '', qty: 1, rate: 5 }]), no: undefined });
  check('a bill with no number is refused', Boolean(noNumber.validateSync()));

  check(
    'the ink survives validation with its strokes intact',
    handwritten.lines[0].ink.strokes.length === 2,
    JSON.stringify(handwritten.lines[0].ink && handwritten.lines[0].ink.strokes.length),
  );

  if (Customer) {
    const customer = new Customer({
      id: 'p9886012345', name: 'Ramesh', phone: '9886012345',
      since: new Date().toISOString(), totalBilled: 0, totalPaid: 0, billCount: 0, lastVisit: null,
    });
    check('a customer with no bills yet is valid', !customer.validateSync());
  }

  await mongoose.disconnect().catch(() => {});
  fs.rmSync(BUILD, { recursive: true, force: true });

  /*
   * Update operators that Mongo will actually accept.
   *
   * This file exists because the JSON file store the rest of the suite drives cannot reproduce
   * MongoDB's rules. This is the second bug of that kind: settings were saved with the same field
   * in both `$set` and `$setOnInsert`, which Mongo rejects as error 40, so every settings save
   * returned a 500 against Atlas and passed against the file store. The shop found it by trying
   * to rename itself.
   */
  if (SettingsModel) {
    // The GST number is optional with a plain default -- never `required: true` alongside one,
    // which is the pairing that made every print return 500 and the reason this file exists.
    const bare = new SettingsModel({
      key: 'shop', shopName: 'Shop', footer: 'Thanks', paper: '58mm', language: 'en',
      showRate: false, inactiveAfterDays: 30,
    });
    check('settings with no GST number are valid', !bare.validateSync());
    check('and the field reads as empty rather than missing', bare.gstin === '',
      JSON.stringify(bare.gstin));
    const withGst = new SettingsModel({
      key: 'shop', shopName: 'Shop', footer: 'Thanks', paper: '58mm', language: 'en',
      showRate: false, inactiveAfterDays: 30, gstin: '29ABCDE1234F1Z5',
    });
    check('settings with one are valid too', !withGst.validateSync());
  }

  // The Kannada twins: optional, defaulting to '', so a record written before they existed reads
  // as empty rather than undefined -- which is what lets pickLang fall back cleanly.
  const oldCustomer = new Customer({
    id: 'p1', name: 'Ramesh', phone: '9886012345',
    since: new Date().toISOString(), totalBilled: 0, totalPaid: 0, billCount: 0, lastVisit: null,
  });
  check('a customer written before the Kannada box is valid', !oldCustomer.validateSync());
  check('and reads as empty rather than missing', oldCustomer.nameKn === '',
    JSON.stringify(oldCustomer.nameKn));
  const bothNames = new Customer({
    id: 'p2', name: 'Suresh', nameKn: 'ಸುರೇಶ್', phone: '9886012399',
    since: new Date().toISOString(), totalBilled: 0, totalPaid: 0, billCount: 0, lastVisit: null,
  });
  check('a customer with both names is valid', !bothNames.validateSync());

  console.log('\nUpdate documents Mongo will accept');
  const DEFAULTS = { shopName: 'Shop', footer: 'Thanks', paper: '58mm', language: 'en',
    showRate: false, inactiveAfterDays: 30, key: 'shop' };

  const renamed = upsertDoc({ shopName: 'Shridhar Kirani Stores' }, DEFAULTS);
  check('a field being set is not also seeded on insert',
    !('shopName' in (renamed.$setOnInsert || {})), JSON.stringify(renamed.$setOnInsert));
  check('and it is still set', renamed.$set.shopName === 'Shridhar Kirani Stores');
  check('the untouched defaults are still seeded',
    renamed.$setOnInsert.footer === 'Thanks' && renamed.$setOnInsert.key === 'shop');

  // The rule, over every field there is: no path may appear in two operators.
  for (const field of Object.keys(DEFAULTS)) {
    const doc = upsertDoc({ [field]: 'x' }, DEFAULTS);
    const both = Object.keys(doc.$set || {}).filter((k) => k in (doc.$setOnInsert || {}));
    check('no operator collision when patching ' + field, both.length === 0, both.join(','));
  }

  // Mongo rejects an empty operator too, so neither may be sent empty.
  const nothing = upsertDoc({}, DEFAULTS);
  check('an empty patch sends no $set', !('$set' in nothing));
  const everything = upsertDoc({ ...DEFAULTS }, DEFAULTS);
  check('a patch covering everything sends no $setOnInsert', !('$setOnInsert' in everything));

  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('All schema checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  fs.rmSync(BUILD, { recursive: true, force: true });
  process.exit(1);
});
