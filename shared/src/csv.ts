import { checkItem } from './pricing';
import type { Item, ItemUnit, PriceSlab } from './types';

/**
 * Spreadsheets in and out.
 *
 * CSV rather than .xlsx: it needs no library, and Excel opens it. The byte-order mark at the
 * front is what makes Excel read the Kannada as Kannada rather than as mojibake -- without it,
 * Excel guesses the file's encoding from the system locale and guesses wrong.
 */

const BOM = '﻿';

function cell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/**
 * One row per unit, so a spreadsheet can hold an item's piece, pack and box prices side by side
 * in the way a shopkeeper already keeps them on paper. The first row of an item is its base unit.
 * Slabs go in one cell as "10:4.5; 50:4" -- from ten at 4.50, from fifty at 4.
 */
export const ITEM_CSV_HEADER = [
  'item_id', 'name_en', 'name_kn', 'place', 'reorder_at', 'active',
  'unit', 'unit_label', 'unit_label_kn', 'per_base', 'price', 'min', 'max', 'slabs',
];

export function itemsToCsv(items: Item[]): string {
  const rows: (string | number | boolean | null | undefined)[][] = [ITEM_CSV_HEADER];
  for (const it of items) {
    for (const u of it.units) {
      rows.push([
        it.id, it.nameEn, it.nameKn, it.place, it.reorderAt, it.active ? 'yes' : 'no',
        u.code, u.label, u.labelKn, u.perBase, u.price, u.min ?? '', u.max ?? '',
        u.slabs.map((s) => s.minQty + ':' + s.rate).join('; '),
      ]);
    }
  }
  return toCsv(rows);
}

export type CsvItem = Omit<Item, 'id'> & { id?: string };
export type CsvResult = { items: CsvItem[]; errors: string[] };

/**
 * Read items back. Rows belong to the same item when they share an id -- or, for a new item
 * typed in by hand with no id yet, when they share a name.
 *
 * Every problem is reported with its row number rather than stopping at the first, so a
 * spreadsheet of two hundred items is fixed in one pass rather than two hundred.
 */
export function csvToItems(text: string): CsvResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length === 0) return { items: [], errors: ['The file is empty.'] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const need of ['name_en', 'name_kn', 'unit', 'price']) {
    if (col(need) < 0) errors.push('Missing column "' + need + '".');
  }
  if (errors.length) return { items: [], errors };

  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
  const num = (v: string) => (v === '' ? null : Number(v));
  const groups = new Map<string, CsvItem>();

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const id = get(r, 'item_id');
    const nameEn = get(r, 'name_en');
    const nameKn = get(r, 'name_kn');
    const key = id || (nameEn + '\u0000' + nameKn).toLowerCase();
    const perBase = num(get(r, 'per_base')) ?? 1;
    const price = num(get(r, 'price'));
    if (price == null || Number.isNaN(price)) {
      errors.push('Row ' + line + ': price is not a number.');
      return;
    }
    const slabs: PriceSlab[] = [];
    for (const part of get(r, 'slabs').split(';').map((p) => p.trim()).filter(Boolean)) {
      const [q, rate] = part.split(':').map((x) => Number(x.trim()));
      if (!(q! > 0) || !(rate! >= 0)) {
        errors.push('Row ' + line + ': "' + part + '" should look like 10:4.5.');
        continue;
      }
      slabs.push({ minQty: q!, rate: rate! });
    }
    const unit: ItemUnit = {
      code: get(r, 'unit') || 'pc',
      label: get(r, 'unit_label'),
      labelKn: get(r, 'unit_label_kn'),
      perBase,
      price,
      slabs,
      min: num(get(r, 'min')),
      max: num(get(r, 'max')),
    };
    let item = groups.get(key);
    if (!item) {
      item = {
        ...(id ? { id } : {}),
        nameEn,
        nameKn,
        place: get(r, 'place'),
        reorderAt: num(get(r, 'reorder_at')) ?? 0,
        active: !/^(no|false|0)$/i.test(get(r, 'active')),
        units: [],
      };
      groups.set(key, item);
    }
    item.units.push(unit);
  });

  const items: CsvItem[] = [];
  for (const it of groups.values()) {
    const problem = checkItem(it);
    if (problem) errors.push((it.nameEn || it.nameKn || 'An item') + ': ' + problem);
    else items.push(it);
  }
  return { items, errors };
}
