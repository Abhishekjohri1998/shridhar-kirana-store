import AsyncStorage from '@react-native-async-storage/async-storage';
import { normaliseServerUrl, type Bill, type BillLine, type Customer, type Item, type Settings, type TodaySummary } from '@shridhar/shared';

const TOKEN_KEY = 'shridhar.token';
const SERVER_KEY = 'shridhar.server';

/**
 * Where the server is.
 *
 * The web app never needed this -- it is served by the same process it talks to. A phone is a
 * different machine, so "localhost" would mean the phone itself. The address is therefore
 * something the shopkeeper enters once: the counter PC on the shop wifi, or the hosted URL.
 */
let baseUrl = '';
let token: string | null = null;

export function getBaseUrl(): string {
  return baseUrl;
}

export function getToken(): string | null {
  return token;
}

/** Read the saved address and session once at startup. */
export async function loadStoredConfig(): Promise<{ baseUrl: string; token: string | null }> {
  try {
    const pairs = await AsyncStorage.multiGet([SERVER_KEY, TOKEN_KEY]);
    baseUrl = pairs[0]?.[1] ?? '';
    token = pairs[1]?.[1] ?? null;
  } catch {
    // First run, or storage unavailable: the app will ask for the address.
  }
  return { baseUrl, token };
}

export async function setServerUrl(raw: string): Promise<string> {
  baseUrl = normaliseServerUrl(raw);
  try {
    await AsyncStorage.setItem(SERVER_KEY, baseUrl);
  } catch {
    /* it will just have to be entered again next launch */
  }
  return baseUrl;
}

export async function setToken(next: string | null): Promise<void> {
  token = next;
  try {
    if (next) await AsyncStorage.setItem(TOKEN_KEY, next);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    /* the session simply will not be remembered */
  }
}

export { normaliseServerUrl };

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Anything slower than this on a shop wifi is a wrong address, not a slow server. */
const TIMEOUT_MS = 8000;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!baseUrl) throw new ApiError(0, 'No server address set yet.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(baseUrl + '/api' + path, {
      ...init,
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    // On a phone this is nearly always the address or the wifi, so say that rather than
    // repeating the browser's wording about a failed fetch.
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ApiError(
      0,
      aborted
        ? 'The server did not answer. Check the address and that the phone is on the same wifi.'
        : 'Cannot reach ' + baseUrl + '. Check the address and the wifi.',
    );
  } finally {
    clearTimeout(timer);
  }

  // A 401 from the login route means the PIN was wrong, not that a session lapsed.
  if (res.status === 401 && path !== '/auth/login') {
    await setToken(null);
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }
  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'Request failed (' + res.status + ')');
  return body as T;
}

export const api = {
  /** Used by the setup screen to check an address before saving it. */
  health: () => request<{ ok: boolean; storage: 'mongo' | 'file' }>('/health'),
  login: (pin: string) => request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),

  listItems: () => request<Item[]>('/items'),
  createItem: (item: Omit<Item, 'id'> & { id?: string }) =>
    request<Item>('/items', { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (id: string, item: Omit<Item, 'id'>) =>
    request<Item>('/items/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(item) }),
  deleteItem: (id: string) => request<void>('/items/' + encodeURIComponent(id), { method: 'DELETE' }),

  getSettings: () => request<Settings>('/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  listBills: (limit = 100) => request<Bill[]>('/bills?limit=' + limit),
  createBill: (payload: { lines: BillLine[]; customerId?: string; paid?: number; showBalance?: boolean }) =>
    request<Bill>('/bills', { method: 'POST', body: JSON.stringify(payload) }),
  today: () => request<TodaySummary>('/summary/today'),

  listCustomers: () => request<Customer[]>('/customers'),
  searchCustomers: (q: string) => request<Customer[]>('/customers/search?q=' + encodeURIComponent(q)),
  getCustomer: (id: string) =>
    request<{ customer: Customer; bills: Bill[]; balanceAt: string | null }>(
      '/customers/' + encodeURIComponent(id),
    ),
  saveCustomer: (input: { id?: string; name: string; phone: string }) =>
    input.id
      ? request<Customer>('/customers/' + encodeURIComponent(input.id), {
          method: 'PUT',
          body: JSON.stringify({ name: input.name, phone: input.phone }),
        })
      : request<Customer>('/customers', { method: 'POST', body: JSON.stringify(input) }),
  deleteCustomer: (id: string) => request<void>('/customers/' + encodeURIComponent(id), { method: 'DELETE' }),
  inactiveCustomers: () => request<{ days: number; customers: Customer[] }>('/customers/inactive'),
};
