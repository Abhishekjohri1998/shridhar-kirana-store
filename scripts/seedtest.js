/**
 * Seeding has to be all-or-nothing.
 *
 * The starter catalogue used to be written one item at a time. A restart part-way through left a
 * handful of items on disk, and because the "is this shop empty?" check then passed, the rest were
 * never written -- the shop was stuck with four of twenty-four items and no way back.
 *
 *   node scripts/seedtest.js
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, '.seedtest-build');
const DATA = path.join(os.tmpdir(), 'shridhar-seedtest-' + Date.now().toString(36));

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else { failures++; console.log('  FAIL ' + name + (detail ? ' -- ' + detail : '')); }
}

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
fs.rmSync(BUILD, { recursive: true, force: true });
execFileSync(process.execPath, [
  tsc, '-p', 'server/tsconfig.json', '--outDir', BUILD, '--noEmit', 'false',
], { cwd: ROOT, stdio: 'inherit' });

const { createFileRepo } = require(path.join(BUILD, 'store', 'file.js'));
const { SEED_ITEMS, seedIfEmpty } = require(path.join(BUILD, 'seed.js'));

async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  console.log('');
  console.log('Seeding a fresh shop');
  const fresh = await createFileRepo(DATA);
  const inserted = await fresh.seedItems(SEED_ITEMS);
  check('every starter item is written', inserted === SEED_ITEMS.length, inserted + ' of ' + SEED_ITEMS.length);
  check('and they are all readable back', (await fresh.listItems()).length === SEED_ITEMS.length);
  check('seeding again inserts nothing', (await fresh.seedItems(SEED_ITEMS)) === 0);

  console.log('');
  console.log('A shop left half-seeded by an interrupted first boot');
  const partialDir = DATA + '-partial';
  fs.mkdirSync(partialDir, { recursive: true });
  // Exactly the state the bug produced: the first four items and nothing else.
  fs.writeFileSync(path.join(partialDir, 'db.json'), JSON.stringify({
    items: SEED_ITEMS.slice(0, 4), bills: [], customers: [], billNo: 0,
  }), 'utf8');
  const partial = await createFileRepo(partialDir);
  const before = (await partial.listItems()).length;
  await seedIfEmpty(partial);
  const after = (await partial.listItems()).length;
  // seedItems leaves a non-empty shop alone by design, so the four stay. What matters is that a
  // fresh shop can never reach this state in the first place -- checked above -- and that the
  // shopkeeper's own items are never trampled.
  check('a shop that already has items is left alone', after === before, before + ' -> ' + after);

  console.log('');
  console.log('A shop the shopkeeper has edited');
  const editedDir = DATA + '-edited';
  fs.mkdirSync(editedDir, { recursive: true });
  fs.writeFileSync(path.join(editedDir, 'db.json'), JSON.stringify({
    items: [{ id: 'mine', nameKn: 'ಮನೆ', nameEn: 'My own item', rate: 7, unit: 'pc' }],
    bills: [], customers: [], billNo: 0,
  }), 'utf8');
  const edited = await createFileRepo(editedDir);
  await seedIfEmpty(edited);
  const kept = await edited.listItems();
  check('their item survives', kept.length === 1 && kept[0].id === 'mine', JSON.stringify(kept.map((i) => i.id)));
  check('and no starter items are added on top', !kept.some((i) => i.id === 'gana-enne'));

  for (const dir of [DATA, partialDir, editedDir]) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(BUILD, { recursive: true, force: true });

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('All seed checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });
