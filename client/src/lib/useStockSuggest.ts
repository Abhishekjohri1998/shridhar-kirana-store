import { useCallback, useEffect, useRef, useState } from 'react';
import { FALLBACK_UNIT, bestMatch, sellUnitOf } from '@shridhar/shared';
import type { BillLine, StockItem, StockUnit } from '@shridhar/shared';
import { api } from './api';
import { useShop } from './useShop';

/**
 * The stock app's help while a line is typed: matching items under the name box, and the rate
 * asked for again when the quantity of a picked item changes.
 *
 * Every answer is stock's. Which items match, and what a quantity slab does to a rate, are
 * decided over there -- the shop asked for the two codebases to stay apart -- so this only asks,
 * waits a beat between keystrokes, and shows what came back. With the link off it does nothing
 * at all and the name box is the plain box it always was.
 *
 * The tablet app keeps an identical copy in mobile/src/lib; change both.
 */
export function useStockSuggest() {
  const shop = useShop();
  const on = shop.stockOn;

  /** The line whose name box is being typed in, and what it says. */
  const [query, setQuery] = useState<{ key: string; q: string } | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  /**
   * Which suggestion Enter takes, shown on the list: the best match for what was typed when the
   * list arrives, then wherever the arrow keys move it. -1 with no list.
   */
  const [highlight, setHighlight] = useState(-1);
  const typedNow = useRef('');
  typedNow.current = query?.q ?? '';
  useEffect(() => {
    const best = bestMatch(items, typedNow.current);
    setHighlight(best ? items.indexOf(best) : -1);
  }, [items]);

  useEffect(() => {
    const q = query?.q.trim() ?? '';
    if (!on || q.length < 2) {
      setItems([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      api.stockItems(q)
        .then((r) => { if (alive) setItems(Array.isArray(r.items) ? r.items : []); })
        .catch(() => { if (alive) setItems([]); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [on, query]);

  /*
   * What is known about each picked line that the bill itself does not carry: the unit's price
   * range for the warning, stock's own warning from the last quote, and whether the shopkeeper
   * has typed a rate of their own since -- after which re-quoting would overwrite their price.
   */
  const [bounds, setBounds] = useState<Record<string, { min?: number; max?: number }>>({});
  const [quoteWarn, setQuoteWarn] = useState<Record<string, 'below' | 'above' | null>>({});
  const handRate = useRef(new Set<string>());
  /** Each picked line's units, for its unit menu. Lost on a reload; loadUnits asks stock again. */
  const [units, setUnits] = useState<Record<string, StockUnit[]>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cart = useRef(shop.cart);
  cart.current = shop.cart;

  useEffect(() => () => { for (const k of Object.keys(timers.current)) clearTimeout(timers.current[k]); }, []);

  const onNameTyped = useCallback((key: string, text: string) => {
    if (!on) return;
    setQuery({ key, q: text });
  }, [on]);

  const close = useCallback(() => setQuery(null), []);

  /** Up or down the suggestions, round from the last to the first. */
  const moveHighlight = useCallback((step: 1 | -1) => {
    setHighlight((h) => {
      const n = items.length;
      if (!n) return -1;
      if (h < 0) return step > 0 ? 0 : n - 1;
      return (h + step + n) % n;
    });
  }, [items]);

  /** Items stock found again for a line it was not picked for, by the line's itemId. */
  const found = useRef<Record<string, StockItem>>({});

  const pick = (index: number, line: BillLine, item: StockItem, unit: StockUnit) => {
    shop.pickStockItem(index, {
      nameEn: item.nameEn,
      nameKn: item.nameKn,
      unit: unit.code,
      stockItemId: item.id,
      rate: unit.price,
    });
    handRate.current.delete(line.itemId);
    setUnits((m) => ({ ...m, [line.itemId]: Array.isArray(item.units) ? item.units : [] }));
    setBounds((b) => ({ ...b, [line.itemId]: { min: unit.min, max: unit.max } }));
    setQuoteWarn((w) => ({ ...w, [line.itemId]: null }));
    setQuery(null);
    setItems([]);
    // A quantity already on the line may sit in a slab, so ask straight away.
    if (line.qty !== 1) requote(line.itemId, item.id, unit.code, line.qty);
    fillLastPrice(line.itemId, lineNameOf(item), item.id, unit.code);
  };

  /*
   * The rate this item last went at -- to this customer first, else to anyone -- in place of
   * stock's list price, once the billing server answers. Only while the line is still what it
   * was asked for and its price is not the shopkeeper's own; it stays "auto", so a change of
   * quantity still asks stock again as before.
   */
  const fillLastPrice = (key: string, name: string, stockItemId: string | undefined, unit: string) => {
    if (!name.trim() && !stockItemId) return;
    api.lastPrice(name, stockItemId, shop.customer?.id)
      .then((r) => {
        if (typeof r?.rate !== 'number' || !(r.rate > 0) || handRate.current.has(key)) return;
        const at = cart.current.findIndex((l) => l.itemId === key);
        const line = cart.current[at];
        if (!line || line.unit !== unit || (line.stockItemId ?? undefined) !== stockItemId) return;
        if (r.rate !== line.rate) shop.setLineRate(at, r.rate);
      })
      .catch(() => undefined);
  };

  /**
   * A typed name stock does not know: it stays as typed, counted in NOS, with the price it last
   * went at when the shop has sold it before. Nothing at all for an empty name.
   */
  const pickNos = (index: number, line: BillLine, typed?: string) => {
    const name = typed ?? (line.nameKn || line.nameEn);
    if (!name.trim()) return false;
    shop.pickStockItem(index, {
      nameEn: line.stockItemId ? '' : line.nameEn, nameKn: typed ?? line.nameKn, unit: FALLBACK_UNIT, rate: line.rate,
    });
    setQuery(null);
    setItems([]);
    fillLastPrice(line.itemId, name, undefined, FALLBACK_UNIT);
    return true;
  };

  /**
   * Enter in the name box: the highlighted suggestion, else the best match for what was typed,
   * in stock's selling unit -- else the name as typed, in NOS. Asks stock straight away when its
   * list for this line has not come back yet, so a quick Enter is not taken for "unknown".
   * Resolves to whether the line was filled.
   */
  const pickBest = async (index: number, line: BillLine, typed: string): Promise<boolean> => {
    if (!typed.trim()) return false;
    let list = query?.key === line.itemId && query.q === typed ? items : [];
    if (on && !list.length && typed.trim().length >= 2) {
      list = await api.stockItems(typed.trim())
        .then((r) => (Array.isArray(r.items) ? r.items : []))
        .catch(() => [] as StockItem[]);
    }
    const chosen = (highlight >= 0 && list === items && items[highlight]) || bestMatch(list, typed);
    const unit = chosen ? sellUnitOf(chosen) : undefined;
    if (chosen && unit) {
      pick(index, line, chosen, unit);
      return true;
    }
    return pickNos(index, line, typed);
  };

  /** A tap on the item itself: it goes on in stock's selling unit. */
  const pickItem = (index: number, line: BillLine, item: StockItem) => {
    const unit = sellUnitOf(item);
    if (unit) pick(index, line, item, unit);
  };

  /** A line's name as stock gave it, either language. */
  const lineNameOf = (x: { nameEn: string; nameKn: string }) => x.nameEn || x.nameKn;

  /** The units a picked line can switch between, once known. */
  const unitsFor = (line: BillLine): StockUnit[] => units[line.itemId] ?? [];

  /** After a reload the menu is empty: find the line's item in stock again, by its id. */
  const loadUnits = (line: BillLine) => {
    if (!on || units[line.itemId]) return;
    const id = line.stockItemId;
    const name = (line.nameEn || line.nameKn).trim();
    if (!name) return;
    api.stockItems(name)
      .then((r) => {
        const list = Array.isArray(r.items) ? r.items : [];
        // A NOS line: stock may know the name by now -- only the exact name counts.
        const hit = id
          ? list.find((x) => x.id === id)
          : list.find((x) => [x.nameEn, x.nameKn].some((n) => (n ?? '').trim().toLowerCase() === name.toLowerCase()));
        if (!hit) return;
        if (!id) found.current[line.itemId] = hit;
        setUnits((m) => ({ ...m, [line.itemId]: Array.isArray(hit.units) ? hit.units : [] }));
      })
      .catch(() => undefined);
  };

  /**
   * Another unit for a picked line. Its price comes with it, then stock's rate for the quantity --
   * unless the shopkeeper has typed a price of their own, which stays.
   */
  const changeUnit = (index: number, line: BillLine, unit: StockUnit) => {
    if (!line.stockItemId) {
      // A NOS line whose name stock has since been found to know: choosing its unit picks it.
      const item = found.current[line.itemId];
      if (item) pick(index, line, item, unit);
      return;
    }
    const mine = handRate.current.has(line.itemId);
    shop.pickStockItem(index, {
      nameEn: line.nameEn,
      nameKn: line.nameKn,
      unit: unit.code,
      stockItemId: line.stockItemId,
      rate: mine ? line.rate : unit.price,
    });
    setBounds((b) => ({ ...b, [line.itemId]: { min: unit.min, max: unit.max } }));
    setQuoteWarn((w) => ({ ...w, [line.itemId]: null }));
    if (!mine && line.qty !== 1) requote(line.itemId, line.stockItemId, unit.code, line.qty);
  };

  /** NOS from the unit menu: the line lets go of stock's item and keeps its name and price. */
  const chooseNos = (index: number, line: BillLine) => {
    if (line.unit === FALLBACK_UNIT && !line.stockItemId) return;
    shop.pickStockItem(index, { nameEn: line.nameEn, nameKn: line.nameKn, unit: FALLBACK_UNIT, rate: line.rate });
    setBounds((b) => ({ ...b, [line.itemId]: {} }));
    setQuoteWarn((w) => ({ ...w, [line.itemId]: null }));
  };

  /** Stock's rate for this quantity, a beat after the last change, unless the rate is the shopkeeper's. */
  const requote = (key: string, item: string, unit: string, qty: number) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      api.stockQuote(item, unit, qty)
        .then((q) => {
          if (handRate.current.has(key)) return;
          // Found again by id: lines above may have been removed while stock was answering.
          const at = cart.current.findIndex((l) => l.itemId === key);
          const line = cart.current[at];
          if (!line || line.stockItemId !== item || line.unit !== unit || line.qty !== qty) return;
          if (typeof q.rate === 'number' && q.rate !== line.rate) shop.setLineRate(at, q.rate);
          setQuoteWarn((w) => ({ ...w, [key]: q.warn ?? null }));
        })
        .catch(() => undefined);
    }, 400);
  };

  const onQty = (index: number, line: BillLine, qty: number) => {
    if (!(qty > 0)) return;
    shop.setLineQty(index, qty);
    if (on && line.stockItemId && line.unit && !handRate.current.has(line.itemId)) {
      requote(line.itemId, line.stockItemId, line.unit, qty);
    }
  };

  /** The shopkeeper typed a price on a picked line: from now on it is theirs, not stock's. */
  const onRateTyped = (line: BillLine) => {
    if (line.stockItemId) handRate.current.add(line.itemId);
  };

  /** Outside the unit's usual range, by the shopkeeper's price or by stock's own quote. */
  const warnFor = (line: BillLine): 'below' | 'above' | null => {
    if (!on || !line.stockItemId) return null;
    const b = bounds[line.itemId];
    if (b && line.rate > 0) {
      if (b.min != null && line.rate < b.min) return 'below';
      if (b.max != null && line.rate > b.max) return 'above';
      if (handRate.current.has(line.itemId)) return null;
    }
    return quoteWarn[line.itemId] ?? null;
  };

  return {
    on,
    /** The line the suggestions belong under, if any are showing. */
    openFor: on && query && items.length > 0 ? query.key : null,
    items,
    /** The suggestion the arrow keys are on, or -1. */
    highlight,
    moveHighlight,
    onNameTyped,
    close,
    pick,
    pickItem,
    pickBest,
    chooseNos,
    unitsFor,
    loadUnits,
    changeUnit,
    onQty,
    onRateTyped,
    warnFor,
  };
}
