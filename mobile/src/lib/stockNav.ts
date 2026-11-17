/*
 * One app, two halves: Settings opens a page of the stock website (its places, people, units and
 * the rest), and the stock website asks for the app's Settings. Both go through here, so neither
 * screen needs to know where the other is mounted.
 */
type Listener = (path: string) => void;

const stockListeners = new Set<Listener>();
let pendingPath: string | null = null;

/** Show the Stock tab at this stock address (e.g. '/admin/places'). */
export function openStockAt(path: string): void {
  pendingPath = path;
  stockListeners.forEach((fn) => fn(path));
}

/** App switches to Stock; the Stock window goes to the page. Returns the unsubscribe. */
export function onOpenStock(fn: Listener): () => void {
  stockListeners.add(fn);
  return () => { stockListeners.delete(fn); };
}

/** The page asked for before the Stock window was ready, taken once. */
export function takePendingStockPath(): string | null {
  const p = pendingPath;
  pendingPath = null;
  return p;
}

/** The stock pages the app's Settings opens, with their i18n keys. */
export const STOCK_SETTINGS_PAGES = [
  { path: '/admin/places', label: 'set.stockPlaces' },
  { path: '/admin/people', label: 'set.stockPeople' },
  { path: '/admin/units', label: 'set.stockUnits' },
  { path: '/admin/purchases', label: 'set.stockSuppliers' },
  { path: '/admin/vehicles', label: 'set.stockVehicles' },
  { path: '/admin/files', label: 'set.stockExcel' },
  { path: '/admin/settings', label: 'set.stockSettings' },
] as const;
