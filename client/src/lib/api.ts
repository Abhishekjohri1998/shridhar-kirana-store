import type { Bill, BillLine, Customer, Item, Settings, TodaySummary } from '@shridhar/shared';

const TOKEN_KEY = 'shridhar.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing with storage blocked: the session simply will not be remembered.
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...init.headers,
      },
    });
  } catch {
    // The counter loses wifi more often than anything else goes wrong, so name that first.
    throw new ApiError(0, 'Cannot reach the server. Check the network and try again.');
  }

  // A 401 from the login route means the PIN was wrong, not that a session lapsed -- telling a
  // shopkeeper who mistyped their PIN that their session expired sends them looking for a
  // problem that is not there. Every other route's 401 really is an expired token.
  if (res.status === 401 && path !== '/auth/login') {
    setToken(null);
    throw new ApiError(401, 'Your session has expired. Sign in again.');
  }
  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'Request failed (' + res.status + ')');
  return body as T;
}

export const api = {
  login: (pin: string) => request<{ token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  health: () => request<{ ok: boolean; storage: 'mongo' | 'file' }>('/health'),

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
  /** Marks a bill cancelled and takes it out of the customer's totals. Not a delete. */
  cancelBill: (no: number) => request<Bill>('/bills/' + no + '/cancel', { method: 'POST' }),
  /** Only ever of an already-cancelled bill; the server refuses a live one with 409. */
  deleteBill: (no: number) => request<void>('/bills/' + no, { method: 'DELETE' }),
  /** Everything in the book, for keeping before a reset. */
  backup: () => request<{ at: string; settings: unknown; customers: unknown[]; bills: unknown[] }>('/backup'),
  eraseAll: (password: string, confirm: string) =>
    request<void>('/reset', { method: 'POST', body: JSON.stringify({ password, confirm }) }),
  today: () => request<TodaySummary>('/summary/today'),

  listCustomers: () => request<Customer[]>('/customers'),
  searchCustomers: (q: string) => request<Customer[]>('/customers/search?q=' + encodeURIComponent(q)),
  getCustomer: (id: string) =>
    request<{ customer: Customer; bills: Bill[]; balanceAt: string | null }>(
      '/customers/' + encodeURIComponent(id),
    ),
  saveCustomer: (input: { id?: string; name: string; nameKn?: string; phone: string }) =>
    input.id
      ? request<Customer>('/customers/' + encodeURIComponent(input.id), {
          method: 'PUT',
          // The whole customer, not a hand-picked pair. Sending {name, phone} alone left the
          // server's schema to fill nameKn with its '' default, so editing a phone number wiped
          // the Kannada name the shopkeeper had typed.
          body: JSON.stringify(input),
        })
      : request<Customer>('/customers', { method: 'POST', body: JSON.stringify(input) }),
  deleteCustomer: (id: string) => request<void>('/customers/' + encodeURIComponent(id), { method: 'DELETE' }),
  inactiveCustomers: () => request<{ days: number; customers: Customer[] }>('/customers/inactive'),
};
