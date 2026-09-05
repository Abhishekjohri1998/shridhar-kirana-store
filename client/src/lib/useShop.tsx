import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEFAULT_SETTINGS, billTotal, makeT, receiptLabelsFor, round2,
  type Bill, type BillLine, type Customer, type Ink, type Item, type Lang, type ReceiptLabels,
  type Settings, type T, type TodaySummary,
} from '@shridhar/shared';
import { ApiError, api, getToken, setToken } from './api';

const CACHE_KEY = 'shridhar.cache';

type Cache = { settings: Settings };

/** The item list and shop name are cached so the billing screen still draws when the counter's
 *  wifi drops. Writing a bill still needs the server -- that is said plainly in the UI. */
function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage blocked or full; the cache is an optimisation, not a requirement.
  }
}

export type CommitOptions = { paid?: number; showBalance?: boolean };

type Shop = {
  ready: boolean;
  signedIn: boolean;
  offline: boolean;
  settings: Settings;
  bills: Bill[];
  today: TodaySummary;
  cart: BillLine[];
  cartTotal: number;
  /** The customer this bill is for, if any. Their details print at the top of the slip. */
  customer: Customer | null;
  /** Cash taken, as typed. Blank means the whole total. */
  paidInput: string;
  /** Whether the paid and balance lines print on this bill. */
  printBalance: boolean;
  /** False until the shopkeeper touches the checkbox, after which it stops being suggested. */
  printBalanceTouched: boolean;
  /** Customers who have not been in for `settings.inactiveAfterDays`. */
  inactive: Customer[];
  /** Interface language, and the translator for it. */
  lang: Lang;
  t: T;
  /** The receipt's own words, in the shop's language. */
  receiptLabels: ReceiptLabels;

  signIn: (pin: string) => Promise<void>;
  signOut: () => void;
  reload: () => Promise<void>;
  refreshInactive: () => Promise<void>;

  addItemToCart: (item: Item, qty?: number) => void;
  /** A line typed by hand, written by hand, or with no description at all -- all are allowed. */
  addLooseLine: (input: { name?: string; ink?: Ink | null; rate: number; qty: number }) => void;
  setLineQty: (index: number, qty: number) => void;
  setLineInk: (index: number, ink: Ink | null) => void;
  addBlankLine: () => void;
  setLineRate: (index: number, rate: number) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
  /** Records the bill on the server, which assigns its number, total and balance. */
  commitBill: (options?: CommitOptions) => Promise<Bill>;

  setCustomer: (customer: Customer | null) => void;
  saveCustomer: (input: { id?: string; name: string; phone: string }) => Promise<Customer>;
  setPaidInput: (value: string) => void;
  setPrintBalance: (value: boolean, fromUser?: boolean) => void;

  saveSettings: (patch: Partial<Settings>) => Promise<void>;
};

const Ctx = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const cached = readCache();
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(() => getToken() != null);
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState<Settings>(cached?.settings ?? DEFAULT_SETTINGS);
  const [bills, setBills] = useState<Bill[]>([]);
  const [today, setToday] = useState<TodaySummary>({ count: 0, total: 0 });
  const [cart, setCart] = useState<BillLine[]>([]);
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [inactive, setInactive] = useState<Customer[]>([]);
  // These live here, not in the Bill page, because the page unmounts whenever the shopkeeper
  // looks at another tab. A part payment typed and then forgotten would otherwise be silently
  // discarded and the bill recorded as paid in full.
  const [paidInput, setPaidInput] = useState('');
  const [printBalance, setPrintBalanceState] = useState(false);
  const [printBalanceTouched, setPrintBalanceTouched] = useState(false);

  const setPrintBalance = useCallback((value: boolean, fromUser = true) => {
    setPrintBalanceState(value);
    if (fromUser) setPrintBalanceTouched(true);
  }, []);

  /** Changing who the bill is for resets the payment, which belonged to the previous customer. */
  const setCustomer = useCallback((next: Customer | null) => {
    setCustomerState(next);
    setPaidInput('');
    setPrintBalanceState(false);
    setPrintBalanceTouched(false);
  }, []);

  // Declared before the callbacks below, which need it for the messages they throw.
  const lang: Lang = settings.language === 'kn' ? 'kn' : 'en';
  const t = useMemo(() => makeT(lang), [lang]);
  const receiptLabels = useMemo(() => receiptLabelsFor(lang), [lang]);

  const refreshInactive = useCallback(async () => {
    try {
      const { customers } = await api.inactiveCustomers();
      setInactive(customers);
    } catch {
      // A missing nudge list is not worth interrupting billing over.
    }
  }, []);

  const reload = useCallback(async () => {
    if (getToken() == null) {
      setSignedIn(false);
      setReady(true);
      return;
    }
    try {
      const [loadedSettings, loadedBills, loadedToday] = await Promise.all([
        api.getSettings(),
        api.listBills(100),
        api.today(),
      ]);
      setSettings(loadedSettings);
      setBills(loadedBills);
      setToday(loadedToday);
      setOffline(false);
      setSignedIn(true);
      writeCache({ settings: loadedSettings });
      void refreshInactive();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSignedIn(false);
      } else {
        // Keep whatever the cache gave us and say so, rather than showing an empty shop.
        setOffline(true);
      }
    } finally {
      setReady(true);
    }
  }, [refreshInactive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const signIn = useCallback(
    async (pin: string) => {
      const { token } = await api.login(pin);
      setToken(token);
      setSignedIn(true);
      await reload();
    },
    [reload],
  );

  const resetDraft = useCallback(() => {
    setCart([]);
    setCustomerState(null);
    setPaidInput('');
    setPrintBalanceState(false);
    setPrintBalanceTouched(false);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setSignedIn(false);
    resetDraft();
  }, [resetDraft]);

  const addItemToCart = useCallback((item: Item, qty = 1) => {
    setCart((prev) => {
      // Handwritten lines are never merged: two of them are two different things written.
      const at = prev.findIndex((l) => l.itemId === item.id && l.rate === item.rate && !l.ink);
      if (at >= 0) {
        const next = [...prev];
        const existing = next[at]!;
        next[at] = { ...existing, qty: existing.qty + qty };
        return next;
      }
      return [...prev, { itemId: item.id, nameKn: item.nameKn, nameEn: item.nameEn, qty, rate: item.rate }];
    });
  }, []);

  const addLooseLine = useCallback(({ name, ink, rate, qty }: { name?: string; ink?: Ink | null; rate: number; qty: number }) => {
    const trimmed = (name ?? '').trim();
    setCart((prev) => [
      ...prev,
      {
        itemId: 'loose-' + Date.now() + '-' + prev.length,
        nameKn: trimmed,
        nameEn: trimmed,
        ...(ink && ink.strokes.length > 0 ? { ink } : {}),
        qty,
        rate,
      },
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

  /** Replace what was written on one line of the slip. */
  const setLineInk = useCallback((index: number, ink: Ink | null) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing) return prev;
      const { ink: _drop, ...rest } = existing;
      next[index] = ink && ink.strokes.length > 0 ? { ...rest, ink } : rest;
      return next;
    });
  }, []);

  /** An empty line at the foot of the slip, so there is always somewhere to write next. */
  const addBlankLine = useCallback(() => {
    setCart((prev) => [
      ...prev,
      { itemId: 'line-' + Date.now() + '-' + prev.length, nameKn: '', nameEn: '', qty: 1, rate: 0 },
    ]);
  }, []);

  const setLineRate = useCallback((index: number, rate: number) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing) return prev;
      next[index] = { ...existing, rate };
      return next;
    });
  }, []);

  const removeLine = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearCart = useCallback(() => resetDraft(), [resetDraft]);

  const commitBill = useCallback(
    async (options: CommitOptions = {}) => {
      // The slip always carries one empty line so there is somewhere to write next. It is
      // scaffolding, not something the customer bought, so it never reaches the printer.
      const lines = cart.filter((l) => l.ink || l.rate > 0 || l.nameKn.trim().length > 0);
      if (lines.length === 0) throw new Error(t('bill.nothingYet'));
      const bill = await api.createBill({
        lines,
        ...(customer ? { customerId: customer.id } : {}),
        ...(options.paid == null ? {} : { paid: options.paid }),
        showBalance: Boolean(options.showBalance && customer),
      });
      resetDraft();
      setBills((prev) => [bill, ...prev].slice(0, 100));
      setToday((prev) => ({ count: prev.count + 1, total: round2(prev.total + bill.total) }));
      // A customer who just bought something is no longer overdue a nudge.
      if (bill.customer) setInactive((prev) => prev.filter((c) => c.id !== bill.customer?.id));
      return bill;
    },
    [cart, customer, resetDraft, t],
  );

  const saveCustomer = useCallback(async (input: { id?: string; name: string; phone: string }) => {
    const saved = await api.saveCustomer(input);
    setCustomer(saved);
    return saved;
  }, []);



  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await api.updateSettings(patch);
    setSettings(next);
    // The nudge list depends on the window, so it has to be recomputed when that changes.
    if (patch.inactiveAfterDays != null) void refreshInactive();
  }, [refreshInactive]);

  const value = useMemo<Shop>(
    () => ({
      ready, signedIn, offline, settings, bills, today, cart,
      cartTotal: billTotal(cart),
      customer, inactive, paidInput, printBalance, printBalanceTouched,
      lang, t, receiptLabels,
      signIn, signOut, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setCustomer, saveCustomer, setPaidInput, setPrintBalance,
      saveSettings,
    }),
    [
      ready, signedIn, offline, settings, bills, today, cart, customer, inactive,
      paidInput, printBalance, printBalanceTouched, lang, t, receiptLabels,
      signIn, signOut, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setCustomer, saveCustomer, setPrintBalance,
      saveSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(Ctx);
  if (!shop) throw new Error('useShop must be used inside ShopProvider');
  return shop;
}
