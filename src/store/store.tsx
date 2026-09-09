import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { billTotal } from '../receipt/doc';
import { SEED_ITEMS } from '../data/seedItems';
import { DEFAULT_SETTINGS, type Bill, type BillLine, type Item, type Settings } from '../types';

const K_ITEMS = 'kb.items';
const K_SETTINGS = 'kb.settings';
const K_BILLS = 'kb.bills';
const K_BILL_NO = 'kb.billNo';

/** How many past bills to keep for reprinting. A busy counter does ~100 bills a day. */
const HISTORY_LIMIT = 300;

type Store = {
  ready: boolean;
  items: Item[];
  settings: Settings;
  bills: Bill[];
  cart: BillLine[];
  cartTotal: number;

  addItemToCart: (item: Item, qty?: number) => void;
  addCustomLine: (name: string, rate: number, qty: number) => void;
  setLineQty: (index: number, qty: number) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
  /** Freeze the cart into a numbered bill, save it, and empty the cart. */
  commitBill: () => Promise<Bill>;

  upsertItem: (item: Item) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billNo, setBillNo] = useState(1);
  const [cart, setCart] = useState<BillLine[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [loadedItems, loadedSettings, loadedBills, loadedNo] = await Promise.all([
        readJson<Item[] | null>(K_ITEMS, null),
        readJson<Partial<Settings>>(K_SETTINGS, {}),
        readJson<Bill[]>(K_BILLS, []),
        readJson<number>(K_BILL_NO, 1),
      ]);
      if (!alive) return;
      // A null item list means first run; an empty one means the shopkeeper deleted everything.
      setItems(loadedItems ?? SEED_ITEMS);
      setSettings({ ...DEFAULT_SETTINGS, ...loadedSettings });
      setBills(loadedBills);
      setBillNo(typeof loadedNo === 'number' && loadedNo > 0 ? loadedNo : 1);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistItems = useCallback(async (next: Item[]) => {
    setItems(next);
    await AsyncStorage.setItem(K_ITEMS, JSON.stringify(next));
  }, []);

  const addItemToCart = useCallback((item: Item, qty = 1) => {
    setCart((prev) => {
      const at = prev.findIndex((l) => l.itemId === item.id && l.rate === item.rate);
      if (at >= 0) {
        const next = [...prev];
        const existing = next[at]!;
        next[at] = { ...existing, qty: existing.qty + qty };
        return next;
      }
      return [...prev, { itemId: item.id, nameKn: item.nameKn, nameEn: item.nameEn, qty, rate: item.rate }];
    });
  }, []);

  const addCustomLine = useCallback((name: string, rate: number, qty: number) => {
    setCart((prev) => [
      ...prev,
      { itemId: `custom-${Date.now()}`, nameKn: name, nameEn: name, qty, rate },
    ]);
  }, []);

  const setLineQty = useCallback((index: number, qty: number) => {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((_, i) => i !== index);
      const next = [...prev];
      const existing = next[index];
      if (!existing) return prev;
      next[index] = { ...existing, qty };
      return next;
    });
  }, []);

  const removeLine = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const commitBill = useCallback(async () => {
    if (!cart.length) throw new Error('Nothing on the bill yet');
    const bill: Bill = {
      no: billNo,
      at: new Date().toISOString(),
      lines: cart,
      total: billTotal(cart),
    };
    const nextBills = [bill, ...bills].slice(0, HISTORY_LIMIT);
    const nextNo = billNo + 1;
    setBills(nextBills);
    setBillNo(nextNo);
    setCart([]);
    await Promise.all([
      AsyncStorage.setItem(K_BILLS, JSON.stringify(nextBills)),
      AsyncStorage.setItem(K_BILL_NO, JSON.stringify(nextNo)),
    ]);
    return bill;
  }, [bills, billNo, cart]);

  const upsertItem = useCallback(
    async (item: Item) => {
      const at = items.findIndex((i) => i.id === item.id);
      const next = at >= 0 ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item];
      await persistItems(next);
    },
    [items, persistItems],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      await persistItems(items.filter((i) => i.id !== id));
    },
    [items, persistItems],
  );

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      await AsyncStorage.setItem(K_SETTINGS, JSON.stringify(next));
    },
    [settings],
  );

  const value = useMemo<Store>(
    () => ({
      ready,
      items,
      settings,
      bills,
      cart,
      cartTotal: billTotal(cart),
      addItemToCart,
      addCustomLine,
      setLineQty,
      removeLine,
      clearCart,
      commitBill,
      upsertItem,
      deleteItem,
      saveSettings,
    }),
    [
      ready, items, settings, bills, cart,
      addItemToCart, addCustomLine, setLineQty, removeLine, clearCart, commitBill,
      upsertItem, deleteItem, saveSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore must be used inside StoreProvider');
  return store;
}
