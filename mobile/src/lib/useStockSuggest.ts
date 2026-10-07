import { useCallback, useEffect, useRef, useState } from 'react';
import { sellUnitOf } from '@shridhar/shared';
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
 * The web app keeps an identical copy in client/src/lib; change both.
 */
export function useStockSuggest() {
  const shop = useShop();
  const on = shop.stockOn;

  /** The line whose name box is being typed in, and what it says. */
  const [query, setQuery] = useState<{ key: string; q: string } | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);

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
  };

  /** A tap on the item itself: it goes on in stock's selling unit. */
  const pickItem = (index: number, line: BillLine, item: StockItem) => {
    const unit = sellUnitOf(item);
    if (unit) pick(index, line, item, unit);
  };

  /** The units a picked line can switch between, once known. */
  const unitsFor = (line: BillLine): StockUnit[] => units[line.itemId] ?? [];

  /** After a reload the menu is empty: find the line's item in stock again, by its id. */
  const loadUnits = (line: BillLine) => {
    if (!on || !line.stockItemId || units[line.itemId]) return;
    const id = line.stockItemId;
    api.stockItems(line.nameEn || line.nameKn)
      .then((r) => {
        const found = (Array.isArray(r.items) ? r.items : []).find((x) => x.id === id);
        if (found) setUnits((m) => ({ ...m, [line.itemId]: found.units }));
      })
      .catch(() => undefined);
  };

  /**
   * Another unit for a picked line. Its price comes with it, then stock's rate for the quantity --
   * unless the shopkeeper has typed a price of their own, which stays.
   */
  const changeUnit = (index: number, line: BillLine, unit: StockUnit) => {
    if (!line.stockItemId) return;
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
    onNameTyped,
    close,
    pick,
    pickItem,
    unitsFor,
    loadUnits,
    changeUnit,
    onQty,
    onRateTyped,
    warnFor,
  };
}
