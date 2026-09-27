import { parseDecimal } from './fields';
import { checkItem } from './pricing';
import type { Item, ItemUnit, PriceSlab } from './types';

/**
 * An item while it is being typed into a form.
 *
 * Every number is kept as the text typed, so "12." survives a keystroke and a blank minimum means
 * "no minimum" rather than 0. Both item screens -- the counter PC and the tablet -- go through
 * this one conversion, so they accept and refuse exactly the same things.
 */
export type UnitDraft = {
  code: string;
  label: string;
  labelKn: string;
  perBase: string;
  price: string;
  min: string;
  max: string;
  /** Written as the shop would say it: "10:4.5; 50:4". */
  slabs: string;
};

export type ItemDraft = {
  id?: string;
  nameEn: string;
  nameKn: string;
  place: string;
  reorderAt: string;
  active: boolean;
  units: UnitDraft[];
};

const text = (n: number | null | undefined) => (n == null ? '' : String(n));

export function slabsToText(slabs: PriceSlab[]): string {
  return slabs.map((s) => s.minQty + ':' + s.rate).join('; ');
}

export function blankUnit(first: boolean): UnitDraft {
  return {
    code: first ? 'pc' : '', label: '', labelKn: '',
    perBase: first ? '1' : '', price: '', min: '', max: '', slabs: '',
  };
}

export function blankItem(): ItemDraft {
  return { nameEn: '', nameKn: '', place: '', reorderAt: '', active: true, units: [blankUnit(true)] };
}

export function itemToDraft(item: Item): ItemDraft {
  return {
    id: item.id,
    nameEn: item.nameEn,
    nameKn: item.nameKn,
    place: item.place,
    reorderAt: item.reorderAt ? String(item.reorderAt) : '',
    active: item.active,
    units: item.units.map((u) => ({
      code: u.code, label: u.label, labelKn: u.labelKn,
      perBase: text(u.perBase), price: text(u.price), min: text(u.min), max: text(u.max),
      slabs: slabsToText(u.slabs),
    })),
  };
}

export type DraftResult = { ok: true; item: Omit<Item, 'id'> & { id?: string } } | { ok: false; error: string };

/** The form's text turned into an item, or the first thing wrong with it, in plain words. */
export function draftToItem(d: ItemDraft): DraftResult {
  const units: ItemUnit[] = [];
  for (const [i, u] of d.units.entries()) {
    const code = u.code.trim();
    const name = code || 'unit ' + (i + 1);
    const perBase = i === 0 ? 1 : parseDecimal(u.perBase);
    if (perBase == null) return { ok: false, error: '"' + name + '": how many does it hold?' };
    const price = parseDecimal(u.price);
    if (price == null) return { ok: false, error: '"' + name + '" needs a price.' };
    const min = u.min.trim() ? parseDecimal(u.min) : null;
    const max = u.max.trim() ? parseDecimal(u.max) : null;
    if (u.min.trim() && min == null) return { ok: false, error: '"' + name + '": the lowest price is not a number.' };
    if (u.max.trim() && max == null) return { ok: false, error: '"' + name + '": the highest price is not a number.' };
    const slabs: PriceSlab[] = [];
    for (const part of u.slabs.split(/[;,]/).map((p) => p.trim()).filter(Boolean)) {
      const [q, r] = part.split(':').map((x) => parseDecimal(x ?? ''));
      if (q == null || r == null || !(q > 0)) {
        return { ok: false, error: '"' + name + '": "' + part + '" should look like 10:4.5.' };
      }
      slabs.push({ minQty: q, rate: r });
    }
    units.push({ code, label: u.label.trim(), labelKn: u.labelKn.trim(), perBase, price, slabs, min, max });
  }
  const reorderAt = d.reorderAt.trim() ? parseDecimal(d.reorderAt) : 0;
  if (reorderAt == null) return { ok: false, error: 'The "running low" figure is not a number.' };
  const item = {
    ...(d.id ? { id: d.id } : {}),
    nameEn: d.nameEn.trim(),
    nameKn: d.nameKn.trim(),
    place: d.place.trim(),
    reorderAt,
    active: d.active,
    units,
  };
  const problem = checkItem(item);
  return problem ? { ok: false, error: problem } : { ok: true, item };
}

/** "pc 5 · pack 110 · box 640", for a list row. */
export function unitSummary(item: Item): string {
  return item.units.map((u) => (u.label || u.code) + ' ' + u.price).join(' · ');
}
