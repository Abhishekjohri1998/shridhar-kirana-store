import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  lineHasSomething,
  DEFAULT_SETTINGS, MAX_PARKED, afterClosing, billTotal, closeDraft, emptyDraft, makeT,
  nextLineId, receiptLabelsFor, reviveDraft, round2,
  type Bill, type BillLine, type Customer, type Draft, type Ink, type Item, type Lang,
  type ReceiptLabels, type Settings, type T, type TodaySummary,
} from '@shridhar/shared';
import { ApiError, api, getToken, setToken } from './api';

const CACHE_KEY = 'shridhar.cache';
/* One key per parked bill, and a small index saying which exist and which is showing.
 *
 * Per bill rather than one blob because handwriting is the bulk of it -- a written line is a few
 * kilobytes of stroke coordinates, and a long bill runs to a hundred and more. Small keys keep
 * each write cheap and stop one enormous bill taking the others down with it if storage is full. */
const DRAFTS_KEY = 'shridhar.drafts';
const DRAFT_KEY = 'shridhar.draft.';

type Parked = { list: Draft[]; activeId: string };

function readParked(): Parked | null {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return null;
    const index = JSON.parse(raw) as { ids: string[]; activeId: string };
    const list: Draft[] = [];
    for (const id of index.ids) {
      const one = localStorage.getItem(DRAFT_KEY + id);
      if (one) list.push(reviveDraft(JSON.parse(one) as Draft));
    }
    if (list.length === 0) return null;
    return { list, activeId: list.some((d) => d.id === index.activeId) ? index.activeId : list[0]!.id };
  } catch {
    return null;
  }
}

function writeParked(parked: Parked): void {
  try {
    const ids = parked.list.map((d) => d.id);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ids, activeId: parked.activeId }));
    for (const d of parked.list) localStorage.setItem(DRAFT_KEY + d.id, JSON.stringify(d));
    // Bills that have been printed or closed since the last write.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DRAFT_KEY) && !ids.includes(key.slice(DRAFT_KEY.length))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage blocked or full. A parked bill will not survive a reload; the one on screen is
    // untouched, which is the part that matters.
  }
}


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

/**
 * `customer` overrides whoever is attached in state.
 *
 * A customer saved moments earlier is not visible here yet: this callback closed over the old
 * value, and React has not re-rendered. Passing the fresh one is the only reliable way to bill
 * someone who was attached in the same click.
 */
export type CommitOptions = { paid?: number; showBalance?: boolean; customer?: Customer | null };

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
  /** Extra information about this sale, which prints under the totals. */
  note: string;
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
  /**
   * Everything the server just erased, forgotten here too.
   *
   * `reload` refetches; this throws away. A parked bill holds a whole Customer object of its
   * own, and after an erase that object refers to somebody the server has forgotten -- which is
   * how a deleted customer got written back the next time that bill was saved.
   */
  forgetEverything: () => Promise<void>;
  /** Bumped when the books are emptied, so a page holding its own list knows to fetch again. */
  dataVersion: number;
  refreshInactive: () => Promise<void>;

  addItemToCart: (item: Item, qty?: number) => void;
  /** A line typed by hand, written by hand, or with no description at all -- all are allowed. */
  addLooseLine: (input: { name?: string; ink?: Ink | null; rate: number; qty: number }) => void;
  setLineQty: (index: number, qty: number) => void;
  setLineInk: (index: number, ink: Ink | null) => void;
  addBlankLine: () => void;
  setLineRate: (index: number, rate: number) => void;
  setLineName: (index: number, name: string) => void;
  setLineGiven: (index: number, given: boolean) => void;
  /** Ticks or unticks every line at once. */
  setAllGiven: (given: boolean) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
  /** Records the bill on the server, which assigns its number, total and balance. */
  commitBill: (options?: CommitOptions) => Promise<Bill>;

  setCustomer: (customer: Customer | null) => void;
  /** ISO date the attached customer's balance was last added to, or null. */
  customerBalanceAt: string | null;

  /** Every bill in progress, the one showing first among equals. */
  drafts: Draft[];
  activeDraftId: string;
  /** Put this bill aside and start a fresh one. Does nothing once MAX_PARKED are waiting. */
  newBill: () => void;
  switchBill: (id: string) => void;
  closeBill: (id: string) => void;
  saveCustomer: (input: {
    id?: string; name: string; nameKn?: string; phone: string; address?: string; notes?: string;
  }) => Promise<Customer>;
  setPaidInput: (value: string) => void;
  setPrintBalance: (value: boolean, fromUser?: boolean) => void;
  setNote: (value: string) => void;
  customerDraft: { name: string; nameKn: string; phone: string };
  setCustomerDraft: (draft: { name: string; nameKn: string; phone: string }) => void;

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
  const [inactive, setInactive] = useState<Customer[]>([]);

  /*
   * Several bills at once, one of them showing.
   *
   * A second customer arriving while the first bill is half-written used to mean making them wait
   * or throwing the slip away. So the draft that used to be seven separate pieces of state is now
   * a list of them, and everything the screens already read -- cart, customer, paidInput and the
   * rest -- is a view onto whichever is active. That is what keeps this out of the dozens of call
   * sites that use them.
   */
  const [parked, setParked] = useState<Parked>(() => {
    const saved = readParked();
    if (saved) return saved;
    const first = emptyDraft(nextLineId('bill'));
    return { list: [first], activeId: first.id };
  });

  /*
   * Written a beat after the last change rather than on every pen stroke, which would be a write
   * every few milliseconds while somebody is writing. A crash between beats loses a second of the
   * bill on screen; today a crash loses the whole thing, so this is strictly better.
   */
  useEffect(() => {
    const timer = window.setTimeout(() => writeParked(parked), 1200);
    return () => window.clearTimeout(timer);
  }, [parked]);
  const active = parked.list.find((d) => d.id === parked.activeId) ?? parked.list[0]!;

  /**
   * Change the bill being written, leaving the parked ones alone.
   *
   * Returns the previous state untouched when nothing actually changed, which is not an
   * optimisation but a correctness fix. Setting a piece of `useState` to the value it already
   * holds is a no-op and React bails out; a setter that always builds a fresh object never does,
   * so the two effects that re-suggest the print-balance switch and top up the blank line saw a
   * new context on every render and re-ran forever. Four thousand state changes in three seconds,
   * measured, before this line existed.
   */
  const patchActive = useCallback((fn: (d: Draft) => Draft) => {
    setParked((prev) => {
      const list = prev.list.map((d) => (d.id === prev.activeId ? fn(d) : d));
      return list.every((d, i) => d === prev.list[i]) ? prev : { ...prev, list };
    });
  }, []);

  const cart = active.lines;
  const customer = active.customer;
  const customerBalanceAt = active.customerBalanceAt;
  const customerDraft = active.typed;
  const paidInput = active.paidInput;
  const printBalance = active.printBalance;
  const printBalanceTouched = active.printBalanceTouched;
  const note = active.note;

  const setCart = useCallback(
    (next: BillLine[] | ((prev: BillLine[]) => BillLine[])) => {
      patchActive((d) => {
        const lines = typeof next === 'function'
          ? (next as (p: BillLine[]) => BillLine[])(d.lines)
          : next;
        // The mutators return the array they were given when they change nothing, and that has
        // to travel all the way up or React cannot bail out.
        return lines === d.lines ? d : { ...d, lines };
      });
    },
    [patchActive],
  );
  const setCustomerState = useCallback(
    (next: Customer | null) => patchActive((d) => (d.customer === next ? d : { ...d, customer: next })),
    [patchActive],
  );
  const setCustomerBalanceAt = useCallback(
    (next: string | null) =>
      patchActive((d) => (d.customerBalanceAt === next ? d : { ...d, customerBalanceAt: next })),
    [patchActive],
  );
  const setCustomerDraft = useCallback(
    (typed: { name: string; nameKn: string; phone: string }) =>
      patchActive((d) =>
        d.typed.name === typed.name && d.typed.nameKn === typed.nameKn && d.typed.phone === typed.phone
          ? d
          : { ...d, typed }),
    [patchActive],
  );
  const setPaidInput = useCallback(
    (value: string) => patchActive((d) => (d.paidInput === value ? d : { ...d, paidInput: value })),
    [patchActive],
  );
  const setNote = useCallback(
    (value: string) => patchActive((d) => (d.note === value ? d : { ...d, note: value })),
    [patchActive],
  );
  const setPrintBalanceState = useCallback(
    (value: boolean) => patchActive((d) => (d.printBalance === value ? d : { ...d, printBalance: value })),
    [patchActive],
  );
  const setPrintBalanceTouched = useCallback(
    (value: boolean) =>
      patchActive((d) => (d.printBalanceTouched === value ? d : { ...d, printBalanceTouched: value })),
    [patchActive],
  );


  const setPrintBalance = useCallback((value: boolean, fromUser = true) => {
    setPrintBalanceState(value);
    if (fromUser) setPrintBalanceTouched(true);
  }, []);

  /** Changing who the bill is for resets the payment, which belonged to the previous customer. */
  const setCustomer = useCallback((next: Customer | null) => {
    setCustomerState(next);
    setCustomerBalanceAt(null);
    setPaidInput('');
    setPrintBalanceState(false);
    setPrintBalanceTouched(false);
    /*
     * When their balance was last added to, for the dated line on the slip. Asked for only when
     * there is a balance to date, so attaching a settled customer still costs no request, and
     * allowed to fail quietly: the line prints without the date rather than blocking a sale.
     */
    if (next && next.balance > 0) {
      void api
        .getCustomer(next.id)
        .then((detail) => setCustomerBalanceAt(detail.balanceAt))
        .catch(() => undefined);
    }
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

  const [dataVersion, setDataVersion] = useState(0);

  const forgetEverything = useCallback(async () => {
    // One empty bill, holding nobody. Parked drafts keep a Customer object of their own, and
    // after an erase that object refers to somebody the server has forgotten.
    const fresh = emptyDraft(nextLineId('bill'));
    setParked({ list: [fresh], activeId: fresh.id });
    try {
      const stale = Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_KEY));
      for (const k of [CACHE_KEY, DRAFTS_KEY, ...stale]) localStorage.removeItem(k);
    } catch {
      /* the cache is an optimisation; losing the removal is not worth failing the erase over */
    }
    setDataVersion((n) => n + 1);
    await reload();
  }, [reload]);

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

  /** Empty the bill being written, keeping any others parked. */
  const resetDraft = useCallback(() => {
    patchActive((d) => ({ ...emptyDraft(d.id) }));
  }, [patchActive]);

  /** Put this bill aside and start a fresh one. Refuses past MAX_PARKED rather than doing nothing. */
  const newBill = useCallback(() => {
    setParked((prev) => {
      if (prev.list.length >= MAX_PARKED) return prev;
      const fresh = emptyDraft(nextLineId('bill'));
      return { list: [...prev.list, fresh], activeId: fresh.id };
    });
  }, []);

  const switchBill = useCallback((id: string) => {
    setParked((prev) => (prev.list.some((d) => d.id === id) ? { ...prev, activeId: id } : prev));
  }, []);

  const closeBill = useCallback((id: string) => {
    setParked((prev) => {
      const nextActive = afterClosing(prev.list, id, prev.activeId);
      const list = closeDraft(prev.list, id, nextLineId('bill'));
      return { list, activeId: list.some((d) => d.id === nextActive) ? nextActive : list[0]!.id };
    });
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
        itemId: nextLineId('loose'),
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

  /** The item's name, typed rather than written. Kannada goes in the same box as English. */
  const setLineName = useCallback((index: number, name: string) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing || existing.nameKn === name) return prev;
      next[index] = { ...existing, nameKn: name };
      return next;
    });
  }, []);

  /** Handed over, as against merely listed. */
  const setLineGiven = useCallback((index: number, given: boolean) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing || (existing.given ?? false) === given) return prev;
      next[index] = { ...existing, given };
      return next;
    });
  }, []);

  /** Every line at once, for the common case where the whole bag went over the counter. */
  const setAllGiven = useCallback((given: boolean) => {
    setCart((prev) => (prev.every((l) => (l.given ?? false) === given)
      ? prev
      : prev.map((l) => ({ ...l, given }))));
  }, []);

  /** An empty line at the foot of the slip, so there is always somewhere to write next. */
  const addBlankLine = useCallback(() => {
    setCart((prev) => [
      ...prev,
      { itemId: nextLineId(), nameKn: '', nameEn: '', qty: 1, rate: 0 },
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
      const lines = cart.filter(lineHasSomething);
      if (lines.length === 0) throw new Error(t('bill.nothingYet'));
      const billTo = options.customer !== undefined ? options.customer : customer;
      const bill = await api.createBill({
        lines,
        ...(billTo ? { customerId: billTo.id } : {}),
        ...(options.paid == null ? {} : { paid: options.paid }),
        showBalance: Boolean(options.showBalance && billTo),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      /*
       * A printed bill leaves the stack. When it was the only one, the slip is simply cleared --
       * there has to be something to write on. With others parked, closing takes the shopkeeper
       * back to one of those, which is where they were going anyway.
       */
      setParked((prev) => {
        if (prev.list.length <= 1) {
          return { ...prev, list: prev.list.map((d) => (d.id === prev.activeId ? emptyDraft(d.id) : d)) };
        }
        const nextActive = afterClosing(prev.list, prev.activeId, prev.activeId);
        const list = closeDraft(prev.list, prev.activeId, nextLineId('bill'));
        return { list, activeId: list.some((d) => d.id === nextActive) ? nextActive : list[0]!.id };
      });
      setBills((prev) => [bill, ...prev].slice(0, 100));
      setToday((prev) => ({ count: prev.count + 1, total: round2(prev.total + bill.total) }));
      // A customer who just bought something is no longer overdue a nudge.
      if (bill.customer) setInactive((prev) => prev.filter((c) => c.id !== bill.customer?.id));
      return bill;
    },
    [cart, customer, note, resetDraft, t],
  );

  const saveCustomer = useCallback(async (input: {
    id?: string; name: string; nameKn?: string; phone: string; address?: string; notes?: string;
  }) => {
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
      customer, inactive, paidInput, printBalance, printBalanceTouched, note,
      lang, t, receiptLabels,
      signIn, signOut, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setLineName, setLineGiven, setAllGiven,
      drafts: parked.list, activeDraftId: parked.activeId, newBill, switchBill, closeBill,
      customerBalanceAt, setCustomer, saveCustomer, setPaidInput, setPrintBalance, setNote,
      customerDraft, setCustomerDraft,
      saveSettings, forgetEverything, dataVersion,
    }),
    [
      ready, signedIn, offline, settings, bills, today, cart, customer, inactive,
      paidInput, printBalance, printBalanceTouched, note, lang, t, receiptLabels,
      signIn, signOut, reload, refreshInactive,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, removeLine, clearCart, commitBill,
      setLineName, setLineGiven, setAllGiven,
      parked, newBill, switchBill, closeBill,
      customerBalanceAt, setCustomer, saveCustomer, setPrintBalance, setNote, customerDraft,
      saveSettings, forgetEverything, dataVersion,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(Ctx);
  if (!shop) throw new Error('useShop must be used inside ShopProvider');
  return shop;
}
