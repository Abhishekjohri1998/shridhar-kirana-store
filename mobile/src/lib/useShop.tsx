import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SETTINGS, billTotal, makeT, receiptLabelsFor, round2,
  type Bill, type BillLine, type Customer, type Ink, type Item, type Lang, type ReceiptLabels,
  type Settings, type T, type TodaySummary,
} from '@shridhar/shared';
import { ApiError, api, getBaseUrl, getToken, loadStoredConfig, setServerUrl, setToken } from './api';

const CACHE_KEY = 'shridhar.cache';

type Cache = { settings: Settings };

export type CommitOptions = { paid?: number; showBalance?: boolean };

type Shop = {
  /** False until the saved address and session have been read off the device. */
  ready: boolean;
  serverUrl: string;
  signedIn: boolean;
  offline: boolean;

  settings: Settings;
  bills: Bill[];
  today: TodaySummary;
  cart: BillLine[];
  cartTotal: number;
  customer: Customer | null;
  inactive: Customer[];
  paidInput: string;
  printBalance: boolean;
  printBalanceTouched: boolean;

  lang: Lang;
  t: T;
  receiptLabels: ReceiptLabels;

  saveServerUrl: (url: string) => Promise<void>;
  signIn: (pin: string) => Promise<void>;
  signOut: () => void;
  forgetServer: () => void;
  reload: () => Promise<void>;
  refreshInactive: () => Promise<void>;

  addItemToCart: (item: Item, qty?: number) => void;
  addLooseLine: (input: { name?: string; ink?: Ink | null; rate: number; qty: number }) => void;
  setLineQty: (index: number, qty: number) => void;
  setLineInk: (index: number, ink: Ink | null) => void;
  addBlankLine: () => void;
  setLineRate: (index: number, rate: number) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
  commitBill: (options?: CommitOptions) => Promise<Bill>;

  setCustomer: (customer: Customer | null) => void;
  saveCustomer: (input: { id?: string; name: string; phone: string }) => Promise<Customer>;
  setPaidInput: (value: string) => void;
  setPrintBalance: (value: boolean, fromUser?: boolean) => void;

  saveSettings: (patch: Partial<Settings>) => Promise<void>;
};

const Ctx = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrlState] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [bills, setBills] = useState<Bill[]>([]);
  const [today, setToday] = useState<TodaySummary>({ count: 0, total: 0 });
  const [cart, setCart] = useState<BillLine[]>([]);
  const [customer, setCustomerState] = useState<Customer | null>(null);
  const [inactive, setInactive] = useState<Customer[]>([]);
  // Part of the bill draft, not of one screen: a phone unmounts screens as you switch tabs, and
  // a part payment typed and then forgotten must not be silently discarded.
  const [paidInput, setPaidInput] = useState('');
  const [printBalance, setPrintBalanceState] = useState(false);
  const [printBalanceTouched, setPrintBalanceTouched] = useState(false);

  const lang: Lang = settings.language === 'kn' ? 'kn' : 'en';
  const t = useMemo(() => makeT(lang), [lang]);
  const receiptLabels = useMemo(() => receiptLabelsFor(lang), [lang]);

  const setPrintBalance = useCallback((value: boolean, fromUser = true) => {
    setPrintBalanceState(value);
    if (fromUser) setPrintBalanceTouched(true);
  }, []);

  const setCustomer = useCallback((next: Customer | null) => {
    setCustomerState(next);
    setPaidInput('');
    setPrintBalanceState(false);
    setPrintBalanceTouched(false);
  }, []);

  const resetDraft = useCallback(() => {
    setCart([]);
    setCustomerState(null);
    setPaidInput('');
    setPrintBalanceState(false);
    setPrintBalanceTouched(false);
  }, []);

  const refreshInactive = useCallback(async () => {
    try {
      const { customers } = await api.inactiveCustomers();
      setInactive(customers);
    } catch {
      // A missing nudge list is not worth interrupting billing over.
    }
  }, []);

  const loadEverything = useCallback(async () => {
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
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ settings: loadedSettings }));
    } catch {
      /* cache is an optimisation */
    }
    void refreshInactive();
  }, [refreshInactive]);

  const reload = useCallback(async () => {
    if (!getBaseUrl() || getToken() == null) {
      setSignedIn(false);
      return;
    }
    try {
      await loadEverything();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSignedIn(false);
      else setOffline(true);
    }
  }, [loadEverything]);

  // One startup pass: the address and session live on the device, so both reads are async.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadStoredConfig();
      if (!alive) return;
      setServerUrlState(stored.baseUrl);
      // The cached settings let the slip draw with the shop's own name before the network answers.
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw && alive) {
          const cache = JSON.parse(raw) as Cache;
          setSettings({ ...DEFAULT_SETTINGS, ...cache.settings });
        }
      } catch {
        /* no cache yet */
      }
      if (stored.baseUrl && stored.token) {
        setSignedIn(true);
        try {
          await loadEverything();
        } catch (e) {
          if (!alive) return;
          if (e instanceof ApiError && e.status === 401) setSignedIn(false);
          else setOffline(true);
        }
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loadEverything]);

  const saveServerUrl = useCallback(async (url: string) => {
    const saved = await setServerUrl(url);
    setServerUrlState(saved);
  }, []);

  const signIn = useCallback(
    async (pin: string) => {
      const { token } = await api.login(pin);
      await setToken(token);
      setSignedIn(true);
      await loadEverything();
    },
    [loadEverything],
  );

  const signOut = useCallback(() => {
    void setToken(null);
    setSignedIn(false);
    resetDraft();
  }, [resetDraft]);

  /**
   * Forget where the server is, sending the app back to its first screen.
   *
   * Without this the address entered on day one is the address for ever: a shop that moves its
   * server, or a test build pointed at a tunnel whose URL rotates, would leave the operator
   * staring at "cannot reach" with no way out but reinstalling.
   */
  const forgetServer = useCallback(() => {
    void setToken(null);
    void setServerUrl('');
    setServerUrlState('');
    setSignedIn(false);
    resetDraft();
  }, [resetDraft]);

  const addItemToCart = useCallback((item: Item, qty = 1) => {
    setCart((prev) => {
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

  const addLooseLine = useCallback(
    ({ name, ink, rate, qty }: { name?: string; ink?: Ink | null; rate: number; qty: number }) => {
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
    },
    [],
  );

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

  const setLineRate = useCallback((index: number, rate: number) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing) return prev;
      next[index] = { ...existing, rate };
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
      if (bill.customer) setInactive((prev) => prev.filter((c) => c.id !== bill.customer?.id));
      return bill;
    },
    [cart, customer, resetDraft, t],
  );

  const saveCustomer = useCallback(async (input: { id?: string; name: string; phone: string }) => {
    const saved = await api.saveCustomer(input);
    setCustomerState(saved);
    return saved;
  }, []);



  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = await api.updateSettings(patch);
      setSettings(next);
      if (patch.inactiveAfterDays != null) void refreshInactive();
    },
    [refreshInactive],
  );

  const value = useMemo<Shop>(
    () => ({
      ready, serverUrl, signedIn, offline,
      settings, bills, today, cart, cartTotal: billTotal(cart),
      customer, inactive, paidInput, printBalance, printBalanceTouched,
      lang, t, receiptLabels,
      saveServerUrl, signIn, signOut, forgetServer, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setCustomer, saveCustomer, setPaidInput, setPrintBalance,
      saveSettings,
    }),
    [
      ready, serverUrl, signedIn, offline, settings, bills, today, cart,
      customer, inactive, paidInput, printBalance, printBalanceTouched, lang, t, receiptLabels,
      saveServerUrl, signIn, signOut, forgetServer, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setCustomer, saveCustomer, setPrintBalance, saveSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(Ctx);
  if (!shop) throw new Error('useShop must be used inside ShopProvider');
  return shop;
}
