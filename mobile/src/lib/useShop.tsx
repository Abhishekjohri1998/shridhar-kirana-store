import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  lineHasSomething,
  DEFAULT_SETTINGS, MAX_PARKED, afterClosing, billTotal, closeDraft, emptyDraft, makeT,
  nextLineId, receiptLabelsFor, reviveDraft, round2, rateForTotal, draftForStock, mergeStockTicks,
  type Bill, type BillLine, type Customer, type Draft, type Ink, type Item, type Lang, type PersonRole,
  type ReceiptLabels, type Settings, type T, type TodaySummary,
} from '@shridhar/shared';

/** What a stock suggestion fills a line with. */
export type StockPick = { nameEn: string; nameKn: string; unit: string; stockItemId: string; rate: number };
import {
  ApiError, api, checkStoredPin, forgetPin, getBaseUrl, getToken, loadPerson, loadStoredConfig,
  markStockSignOut, rememberPin, savePerson, setServerUrl, setToken,
  type CustomerInput, type StoredPerson,
} from './api';

const CACHE_KEY = 'shridhar.cache';
/* One key per parked bill, and a small index saying which exist and which is showing.
 *
 * Per bill rather than one blob because handwriting is the bulk of it -- a written line is a few
 * kilobytes of stroke coordinates, and a long bill runs to a hundred and more. Small keys keep
 * each write cheap and stop one enormous bill taking the others down with it if storage is full. */
const DRAFTS_KEY = 'shridhar.drafts';
const DRAFT_KEY = 'shridhar.draft.';

type Parked = { list: Draft[]; activeId: string };

async function readParked(): Promise<Parked | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFTS_KEY);
    if (!raw) return null;
    const index = JSON.parse(raw) as { ids: string[]; activeId: string };
    const pairs = await AsyncStorage.multiGet(index.ids.map((id) => DRAFT_KEY + id));
    const list = pairs
      .map(([, value]) => (value ? reviveDraft(JSON.parse(value) as Draft) : null))
      .filter((d): d is Draft => d != null);
    if (list.length === 0) return null;
    return { list, activeId: list.some((d) => d.id === index.activeId) ? index.activeId : list[0]!.id };
  } catch {
    return null;
  }
}

async function writeParked(parked: Parked): Promise<void> {
  try {
    const ids = parked.list.map((d) => d.id);
    await AsyncStorage.multiSet([
      [DRAFTS_KEY, JSON.stringify({ ids, activeId: parked.activeId })],
      ...parked.list.map((d) => [DRAFT_KEY + d.id, JSON.stringify(d)] as [string, string]),
    ]);
    // Bills that have been printed or closed since the last write.
    const keys = await AsyncStorage.getAllKeys();
    const stale = keys.filter(
      (k) => k.startsWith(DRAFT_KEY) && !ids.includes(k.slice(DRAFT_KEY.length)),
    );
    if (stale.length > 0) await AsyncStorage.multiRemove(stale);
  } catch {
    // Storage full or unavailable. A parked bill will not survive a restart; the one on screen
    // is untouched, which is the part that matters.
  }
}


type Cache = { settings: Settings };

/**
 * `customer` overrides whoever is attached in state.
 *
 * A customer saved moments earlier is not visible here yet: this callback closed over the old
 * value, and React has not re-rendered. Passing the fresh one is the only reliable way to bill
 * someone who was attached in the same click.
 */
export type CommitOptions = { paid?: number; showBalance?: boolean; customer?: Customer | null };

type Shop = {
  /** False until the saved address and session have been read off the device. */
  ready: boolean;
  serverUrl: string;
  signedIn: boolean;
  /** Signed in, but the PIN has not been given since the app was last opened. */
  locked: boolean;
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
  /** Extra information about this sale, which prints under the totals. */
  note: string;

  lang: Lang;
  t: T;
  receiptLabels: ReceiptLabels;

  saveServerUrl: (url: string) => Promise<void>;
  signIn: (pin: string) => Promise<void>;
  /** Who signed in by phone and PIN; null for the shop PIN. */
  person: StoredPerson | null;
  /** The stock session that came with the person, handed to the Stock window. */
  stockToken: string | null;
  /** A shop worker or the godown: stock's screens only, no billing. */
  stockOnly: boolean;
  /** Sign in by personal phone and PIN, checked by the stock server. */
  signInPerson: (phone: string, pin: string) => Promise<PersonRole>;
  /** Back to the sign-in screen for somebody else. Parked bills stay. */
  switchUser: () => void;
  /** Whether the sign-in screen shows the shop PIN rather than phone + PIN. */
  pinMode: boolean;
  setPinMode: (on: boolean) => void;
  /** Let a signed-in session back in. Throws with a message if the PIN is wrong. */
  unlock: (pin: string) => Promise<void>;
  signOut: () => void;
  forgetServer: () => void;
  reload: () => Promise<void>;
  /**
   * Everything the server just erased, forgotten on this device too.
   *
   * `reload` refetches; this throws away. They are different jobs and the difference is what a
   * shopkeeper saw as "the customers are not getting deleted": the list on screen was the one
   * fetched at startup, and a parked bill still held a whole customer who no longer existed --
   * which is how a deleted customer got written back the next time that bill was saved.
   */
  forgetEverything: () => Promise<void>;
  /** Bumped when the books are emptied, so a screen holding its own list knows to fetch again. */
  dataVersion: number;
  refreshInactive: () => Promise<void>;

  addItemToCart: (item: Item, qty?: number) => void;
  addLooseLine: (input: { name?: string; ink?: Ink | null; rate: number; qty: number }) => void;
  setLineQty: (index: number, qty: number) => void;
  setLineInk: (index: number, ink: Ink | null) => void;
  addBlankLine: () => void;
  setLineRate: (index: number, rate: number) => void;
  /** The line total typed in the price box: the rate becomes total / qty, and qty stays (1 if none). */
  setLineTotal: (index: number, total: number) => void;
  setLineName: (index: number, name: string) => void;
  setLineGiven: (index: number, given: boolean) => void;
  /** Another line of writing for the same item, under its first. At most two more. */
  addLineStrip: (index: number) => void;
  /** Take away one of the added lines of writing. */
  removeLineStrip: (index: number, strip: number) => void;
  /** Writing on one of the added lines. */
  setLineMoreInk: (index: number, strip: number, ink: Ink | null) => void;
  /** Ticks or unticks every line at once. */
  setAllGiven: (given: boolean) => void;
  /** Whether the server's link to the stock app is on. Everything stock-shaped hides when not. */
  stockOn: boolean;
  /** Fill a line from a stock suggestion: names, unit, stock's id and price. */
  pickStockItem: (index: number, pick: StockPick) => void;
  removeLine: (index: number) => void;
  clearCart: () => void;
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
  saveCustomer: (input: CustomerInput) => Promise<Customer>;
  setPaidInput: (value: string) => void;
  setPrintBalance: (value: boolean, fromUser?: boolean) => void;
  setNote: (value: string) => void;
  customerDraft: { name: string; nameKn: string; phone: string };
  setCustomerDraft: (draft: { name: string; nameKn: string; phone: string }) => void;

  saveSettings: (patch: Partial<Settings>) => Promise<void>;
};

const Ctx = createContext<Shop | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrlState] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  /*
   * Locked until the PIN is given, and true to begin with.
   *
   * "Opened fresh" needs no AppState listener: this module is evaluated once per process, so a
   * warm resume keeps whatever the state was and a cold start begins here. Closing the app from
   * recents ends the process, which is exactly the case the shop asked about.
   *
   * It is not the same as being signed out. Signing out drops the token and resets the slip,
   * which would throw away a half-written bill someone parked before closing the app; locking
   * keeps the token, keeps the drafts, and only puts the screen behind the PIN.
   */
  const [locked, setLocked] = useState(true);
  const [person, setPerson] = useState<StoredPerson | null>(null);
  const [stockToken, setStockToken] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const stockOnly = person != null && person.role !== 'admin' && stockToken != null;
  const [offline, setOffline] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
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
    const first = emptyDraft(nextLineId('bill'));
    return { list: [first], activeId: first.id };
  });
  /** Held back until the saved bills have been read, so the first write cannot erase them. */
  const parkedLoaded = useRef(false);

  useEffect(() => {
    let alive = true;
    void readParked().then((saved) => {
      if (alive && saved) setParked(saved);
      parkedLoaded.current = true;
    });
    return () => { alive = false; };
  }, []);

  /*
   * Written a beat after the last change rather than on every pen stroke, which would be a write
   * every few milliseconds while somebody is writing. A crash between beats loses a second of the
   * bill on screen; today a crash loses the whole thing, so this is strictly better.
   */
  useEffect(() => {
    if (!parkedLoaded.current) return;
    const timer = setTimeout(() => void writeParked(parked), 1200);
    return () => clearTimeout(timer);
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

  /*
   * The link to the stock app, when the server has one.
   *
   * Asked once per sign-in. Off, or a server that predates the link, reads as false and every
   * piece of this -- suggestions, re-quoting, live drafts -- stays out of the way entirely.
   */
  const [stockOn, setStockOn] = useState(false);
  useEffect(() => {
    if (!signedIn) {
      setStockOn(false);
      return;
    }
    let alive = true;
    void api.stockStatus()
      .then((s) => { if (alive) setStockOn(s.on === true); })
      .catch(() => { if (alive) setStockOn(false); });
    return () => { alive = false; };
  }, [signedIn]);

  /*
   * The bill being written, sent to the stock app's worker screen so the racks can start picking
   * before the bill is printed.
   *
   * A beat after each change, and a heartbeat while it is open so stock's ticks come back even
   * when nobody is touching the counter. Only the bill showing is sent; a parked one goes quiet
   * and stock lets it lapse. `stockSent` remembers what stock has been shown, so a bill that is
   * cleared or closed can be taken off the worker screen at once; `stockSaved` remembers what was
   * printed, so a heartbeat already in flight cannot put a saved bill back up as a draft.
   */
  const stockSent = useRef(new Set<string>());
  const stockSaved = useRef(new Set<string>());
  const activeRef = useRef(active);
  activeRef.current = active;

  const pushDraft = useCallback(async (d: Draft) => {
    if (stockSaved.current.has(d.draftId)) return;
    stockSent.current.add(d.draftId);
    try {
      const { ticks } = await api.stockDraft(draftForStock(d));
      if (!stockSent.current.has(d.draftId) || !ticks) return;
      // Folded into whichever bill this was, by its draft id: the shopkeeper may have switched
      // to another bill while the answer was on its way.
      setParked((prev) => {
        const list = prev.list.map((x) => (x.draftId === d.draftId ? mergeStockTicks(x, ticks) : x));
        return list.every((x, i) => x === prev.list[i]) ? prev : { ...prev, list };
      });
    } catch {
      // Stock is down or the wifi blinked. The next beat tries again; billing carries on.
    }
  }, []);

  useEffect(() => {
    if (!stockOn || !signedIn || !active.lines.some(lineHasSomething)) return;
    const timer = setTimeout(() => void pushDraft(active), 1800);
    return () => clearTimeout(timer);
  }, [stockOn, signedIn, active, pushDraft]);

  useEffect(() => {
    if (!stockOn || !signedIn) return;
    const timer = setInterval(() => {
      const d = activeRef.current;
      if (d.lines.some(lineHasSomething)) void pushDraft(d);
    }, 4000);
    return () => clearInterval(timer);
  }, [stockOn, signedIn, pushDraft]);

  // A bill that was shown to stock and is no longer anywhere here was cleared or closed.
  useEffect(() => {
    if (!stockOn) return;
    const live = new Set(parked.list.map((d) => d.draftId));
    for (const id of [...stockSent.current]) {
      if (live.has(id)) continue;
      stockSent.current.delete(id);
      void api.stockDraft({ draftId: id, closed: true, lines: [] }).catch(() => undefined);
    }
  }, [stockOn, parked]);

  const lang: Lang = settings.language === 'kn' ? 'kn' : 'en';
  const t = useMemo(() => makeT(lang), [lang]);
  const receiptLabels = useMemo(() => receiptLabelsFor(lang), [lang]);

  const setPrintBalance = useCallback((value: boolean, fromUser = true) => {
    setPrintBalanceState(value);
    if (fromUser) setPrintBalanceTouched(true);
  }, []);

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

  const [dataVersion, setDataVersion] = useState(0);

  const forgetEverything = useCallback(async () => {
    // One empty bill, holding nobody. Parked drafts keep a Customer object of their own, and
    // after an erase that object refers to somebody the server has forgotten.
    const fresh = emptyDraft(nextLineId('bill'));
    setParked({ list: [fresh], activeId: fresh.id });
    try {
      const stale = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove([
        CACHE_KEY,
        DRAFTS_KEY,
        ...stale.filter((k) => k.startsWith(DRAFT_KEY)),
      ]);
    } catch {
      /* the cache is an optimisation; losing the removal is not worth failing the erase over */
    }
    setDataVersion((n) => n + 1);
    await reload();
  }, [reload]);


  // One startup pass: the address and session live on the device, so both reads are async.
  useEffect(() => {
    let alive = true;
    (async () => {
      const stored = await loadStoredConfig();
      const who = await loadPerson();
      if (!alive) return;
      setPerson(who.person);
      setStockToken(who.stockToken);
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
      await rememberPin(pin);
      // The shop PIN is nobody in particular, and brings no stock session.
      await savePerson(null, null);
      setPerson(null);
      setStockToken(null);
      setSignedIn(true);
      setLocked(false);
      await loadEverything();
    },
    [loadEverything],
  );

  /**
   * The PIN, checked on the device.
   *
   * Against the stored digest rather than the server, because the counter bills through power
   * cuts and dead links and a lock that needs the network is a lock that can shut the shop out
   * of its own till. An app upgraded from a build that predates the lock has nothing stored, so
   * that one case falls back to the server once and stores a digest on the way through.
   */
  const unlock = useCallback(async (pin: string) => {
    const known = await checkStoredPin(pin);
    if (known === true) {
      setLocked(false);
      return;
    }
    if (known === false) throw new Error(person ? t('login.wrongPersonPin') : t('login.wrongPin'));
    if (person) {
      // Nothing stored to check against: ask stock again, by the phone they signed in with.
      const got = await api.person(person.phone, pin);
      if (got.token) await setToken(got.token);
      await savePerson({ ...person, role: got.role, name: got.name }, got.stockToken);
      setStockToken(got.stockToken);
      await rememberPin(pin);
      setLocked(false);
      return;
    }
    const { token } = await api.login(pin);
    await setToken(token);
    await rememberPin(pin);
    setLocked(false);
  }, [t, person]);

  const forgetPerson = useCallback((): void => {
    void savePerson(null, null);
    setPerson(null);
    setStockToken(null);
    setPinMode(false);
  }, []);

  const signOut = useCallback(() => {
    void setToken(null);
    void forgetPin();
    if (person) void markStockSignOut(true);
    forgetPerson();
    setSignedIn(false);
    setLocked(true);
    resetDraft();
  }, [resetDraft, forgetPerson, person]);

  /*
   * Hand the tablet to somebody else. Like signing out, but the bills being written stay
   * parked, and the Stock window is told to drop the last person's session.
   */
  const switchUser = useCallback(() => {
    void setToken(null);
    void forgetPin();
    void markStockSignOut(true);
    forgetPerson();
    setSignedIn(false);
    setLocked(true);
  }, [forgetPerson]);

  const signInPerson = useCallback(async (phone: string, pin: string): Promise<PersonRole> => {
    const got = await api.person(phone.trim(), pin);
    const who: StoredPerson = { role: got.role, name: got.name, phone: phone.trim() };
    await savePerson(who, got.stockToken);
    await rememberPin(pin);
    // A fresh session for this person replaces whatever the Stock window held.
    await markStockSignOut(false);
    setPerson(who);
    setStockToken(got.stockToken);
    if (got.role === 'admin' && got.token) {
      await setToken(got.token);
      setLocked(false);
      await loadEverything();
    } else {
      // No billing for this role: drop any billing session the device still had.
      await setToken(null);
      setSignedIn(false);
      setLocked(false);
    }
    return got.role;
  }, [loadEverything]);

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
    forgetPerson();
    setSignedIn(false);
    resetDraft();
  }, [resetDraft, forgetPerson]);

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
          itemId: nextLineId('loose'),
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
      // Writing something makes writing the line's last-used way; clearing it does not.
      next[index] = ink && ink.strokes.length > 0 ? { ...rest, ink, lastMode: 'ink' } : rest;
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

  const setLineTotal = useCallback((index: number, total: number) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing) return prev;
      const qty = existing.qty > 0 ? existing.qty : 1;
      next[index] = { ...existing, qty, rate: rateForTotal(total, qty) };
      return next;
    });
  }, []);

  /** The item's name, typed rather than written. Kannada goes in the same box as English. */
  const setLineName = useCallback((index: number, name: string) => {
    setCart((prev) => {
      const next = [...prev];
      const existing = next[index];
      if (!existing || existing.nameKn === name) return prev;
      /*
       * Typing over an item picked from stock lets go of it: the unit and stock's id named that
       * item, and what is in the box now is something else. The rate stays -- it is the
       * shopkeeper's to change, and clearing it would be a surprise.
       */
      const { unit: _unit, stockItemId: _stock, ...plain } = existing;
      const base = existing.stockItemId ? { ...plain, nameEn: '' } : existing;
      // Typing something makes typing the line's last-used way, so that is what prints.
      next[index] = name.trim() ? { ...base, nameKn: name, lastMode: 'text' } : { ...base, nameKn: name };
      return next;
    });
  }, []);

  /** Handed over, as against merely listed. */
  /*
   * More lines of writing for one item, as a long item carries on to the next line on paper.
   * Each added strip is an empty Ink in `moreInk` until something is written on it; empty ones
   * are dropped before a bill is saved, so an added strip nobody used prints nothing.
   */
  const updateLine = useCallback((index: number, fn: (l: BillLine) => BillLine) => {
    setCart((prev) => {
      const existing = prev[index];
      if (!existing) return prev;
      const changed = fn(existing);
      if (changed === existing) return prev;
      const next = [...prev];
      next[index] = changed;
      return next;
    });
  }, []);

  const addLineStrip = useCallback((index: number) => {
    updateLine(index, (l) => {
      const more = l.moreInk ?? [];
      if (more.length >= 2) return l;
      return { ...l, moreInk: [...more, { w: 0, h: 0, strokes: [] }] };
    });
  }, [updateLine]);

  const removeLineStrip = useCallback((index: number, strip: number) => {
    updateLine(index, (l) => {
      const more = (l.moreInk ?? []).filter((_, i) => i !== strip);
      const { moreInk: _drop, ...rest } = l;
      return more.length ? { ...rest, moreInk: more } : rest;
    });
  }, [updateLine]);

  const setLineMoreInk = useCallback((index: number, strip: number, ink: Ink | null) => {
    updateLine(index, (l) => {
      const more = [...(l.moreInk ?? [])];
      if (strip >= more.length) return l;
      more[strip] = ink ?? { w: 0, h: 0, strokes: [] };
      return { ...l, moreInk: more, ...(ink && ink.strokes.length ? { lastMode: 'ink' as const } : {}) };
    });
  }, [updateLine]);


  /*
   * The tick, and when it moved. Stock's workers tick the same lines from the racks, and when
   * the two disagree the later change wins -- so every change here is stamped.
   */
  const setLineGiven = useCallback((index: number, given: boolean) => {
    patchActive((d) => {
      const existing = d.lines[index];
      if (!existing || (existing.given ?? false) === given) return d;
      const lines = [...d.lines];
      lines[index] = { ...existing, given };
      return { ...d, lines, givenAt: { ...d.givenAt, [existing.itemId]: Date.now() } };
    });
  }, [patchActive]);

  /** Every line at once, for the common case where the whole bag went over the counter. */
  const setAllGiven = useCallback((given: boolean) => {
    patchActive((d) => {
      if (d.lines.every((l) => (l.given ?? false) === given)) return d;
      const now = Date.now();
      const givenAt = { ...d.givenAt };
      for (const l of d.lines) if ((l.given ?? false) !== given) givenAt[l.itemId] = now;
      return { ...d, lines: d.lines.map((l) => ({ ...l, given })), givenAt };
    });
  }, [patchActive]);

  /**
   * An item picked from the stock app's suggestions: both names, the unit and stock's price.
   * Typing over the name afterwards lets go of the pick -- see setLineName.
   */
  const pickStockItem = useCallback((index: number, pick: StockPick) => {
    updateLine(index, (l) => ({
      ...l,
      nameEn: pick.nameEn,
      nameKn: pick.nameKn,
      unit: pick.unit,
      stockItemId: pick.stockItemId,
      rate: pick.rate,
      lastMode: 'text',
    }));
  }, [updateLine]);

  /** An empty line at the foot of the slip, so there is always somewhere to write next. */
  const addBlankLine = useCallback(() => {
    setCart((prev) => [
      ...prev,
      { itemId: nextLineId(), nameKn: '', nameEn: '', qty: 1, rate: 0 },
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
      // An added line of writing nobody wrote on is an empty strip, which the server rightly
      // refuses as ink -- so it is dropped here, and the bill saves.
      const lines = cart.filter(lineHasSomething).map((l) => {
        if (!l.moreInk) return l;
        const { moreInk, ...rest } = l;
        const used = moreInk.filter((i) => i.strokes.length > 0);
        return used.length ? { ...rest, moreInk: used } : rest;
      });
      if (lines.length === 0) throw new Error(t('bill.nothingYet'));
      const billTo = options.customer !== undefined ? options.customer : customer;
      const bill = await api.createBill({
        lines,
        ...(billTo ? { customerId: billTo.id } : {}),
        ...(options.paid == null ? {} : { paid: options.paid }),
        showBalance: Boolean(options.showBalance && billTo),
        ...(note.trim() ? { note: note.trim() } : {}),
        // So stock can swap the live draft on its worker screen for this bill, ticks and all.
        ...(stockOn ? { draftId: active.draftId } : {}),
      });
      stockSaved.current.add(active.draftId);
      stockSent.current.delete(active.draftId);
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
      if (bill.customer) setInactive((prev) => prev.filter((c) => c.id !== bill.customer?.id));
      return bill;
    },
    [cart, customer, note, resetDraft, t, stockOn, active.draftId],
  );

  const saveCustomer = useCallback(async (input: CustomerInput) => {
    const saved = await api.saveCustomer(input);
    // Through setCustomer, not setCustomerState: saving by phone can match somebody who already
    // owes money, and their balance needs dating like any other attachment. The web app has
    // always gone this way round.
    setCustomer(saved);
    return saved;
  }, [setCustomer]);



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
      ready, serverUrl, signedIn, locked, offline,
      settings, bills, today, cart, cartTotal: billTotal(cart),
      customer, inactive, paidInput, printBalance, printBalanceTouched, note,
      lang, t, receiptLabels,
      saveServerUrl, signIn, unlock, signOut, forgetServer, reload, refreshInactive,
      person, stockToken, stockOnly, signInPerson, switchUser, pinMode, setPinMode,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, setLineTotal, removeLine, clearCart, commitBill,
      setLineName, setLineGiven, addLineStrip, removeLineStrip, setLineMoreInk, setAllGiven,
      stockOn, pickStockItem,
      drafts: parked.list, activeDraftId: parked.activeId, newBill, switchBill, closeBill,
      customerBalanceAt, setCustomer, saveCustomer, setPaidInput, setPrintBalance, setNote,
      customerDraft, setCustomerDraft,
      saveSettings, forgetEverything, dataVersion,
    }),
    [
      ready, serverUrl, signedIn, locked, offline, settings, bills, today, cart,
      customer, inactive, paidInput, printBalance, printBalanceTouched, note, lang, t, receiptLabels,
      saveServerUrl, signIn, unlock, signOut, forgetServer, reload, refreshInactive,
      person, stockToken, stockOnly, signInPerson, switchUser, pinMode,
      addItemToCart, addLooseLine, setLineQty, setLineInk, addBlankLine, setLineRate, setLineTotal, removeLine, clearCart, commitBill,
      setLineName, setLineGiven, addLineStrip, removeLineStrip, setLineMoreInk, setAllGiven,
      stockOn, pickStockItem,
      parked, newBill, switchBill, closeBill,
      customerBalanceAt, setCustomer, saveCustomer, setPrintBalance, setNote, customerDraft, saveSettings,
      forgetEverything, dataVersion,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop(): Shop {
  const shop = useContext(Ctx);
  if (!shop) throw new Error('useShop must be used inside ShopProvider');
  return shop;
}
