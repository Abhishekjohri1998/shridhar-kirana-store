import { useEffect, useRef, useState } from 'react';
import {
  checkCustomer,
  money,
  searchKey,
  type Customer,
} from '@shridhar/shared';
import { CustomersIcon } from './Icons';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';

/**
 * Customer name and phone for the top of the slip.
 *
 * Typing either one searches the customers already on file and offers them, which is what the
 * shop asked for -- a regular should not have to be re-entered, and re-entering them by hand is
 * how you end up with the same person stored three times.
 */
export function CustomerBar() {
  const shop = useShop();
  const t = shop.t;
  // Held in the shared draft, not here: the bill needs to read it at print time, and switching
  // tabs used to throw it away.
  const name = shop.customerDraft.name;
  const phone = shop.customerDraft.phone;
  const setName = (next: string) => shop.setCustomerDraft({ name: next, phone });
  const setPhone = (next: string) => shop.setCustomerDraft({ name, phone: next });
  const [matches, setMatches] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Naming a customer is optional and most bills skip it, so the two fields stay folded away
  // until asked for. On a phone they were costing a quarter of the screen that the stock list
  // needed more.
  const [expanded, setExpanded] = useState(false);
  const seq = useRef(0);

  const query = name.trim() || phone.trim();

  useEffect(() => {
    if (shop.customer || query.length < 1) {
      setMatches([]);
      return;
    }
    // Debounced, and answers are dropped if a newer keystroke has already been sent -- otherwise
    // a slow reply overwrites the suggestions for what is now a different query.
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const found = await api.searchCustomers(query);
        if (seq.current === mine) setMatches(found);
      } catch {
        if (seq.current === mine) setMatches([]);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query, shop.customer]);

  const attach = (customer: Customer) => {
    shop.setCustomer(customer);
    setMatches([]);
    setOpen(false);
    setExpanded(false);
    setError(null);
  };

  const saveNew = async () => {
    const fields = checkCustomer(name, phone);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    setError(null);
    try {
      await shop.saveCustomer({ name: fields.name, phone: fields.phone });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const detach = () => {
    shop.setCustomer(null);
    setName('');
    setPhone('');
    setOpen(true);
    setExpanded(true);
  };

  if (shop.customer && !open) {
    const c = shop.customer;
    return (
      <div className="customer-bar">
        <div className="customer-chip">
          <span className="grow ellipsis">
            <strong>{c.name || t('cust.unnamed')}</strong>
            {c.phone ? <span className="muted small"> · {c.phone}</span> : null}
          </span>
          {/* The balance if there is one, because that is the figure the shopkeeper is looking
              for; the bill count only when there is nothing more pressing to say. */}
          <span className="customer-figure">
            {c.balance !== 0
              ? t('cust.balanceOf', { amount: money(c.balance) })
              : c.billCount === 0
                ? t('cust.firstBill')
                : t('cust.totalOf', { amount: money(c.totalBilled) })}
          </span>
          <button className="btn plain slim" onClick={detach}>{t('cust.change')}</button>
        </div>
      </div>
    );
  }

  // Nothing typed, nobody attached: offer the fields rather than presenting them.
  if (!shop.customer && !expanded) {
    return (
      <div className="customer-bar">
        <button type="button" className="customer-add" onClick={() => setExpanded(true)}>
          <CustomersIcon className="customer-add-icon" />
          <span className="grow">{t('cust.addOptional')}</span>
          <span className="customer-add-plus" aria-hidden="true">+</span>
        </button>
      </div>
    );
  }

  /*
   * Is the typed pair already one of the suggestions?
   *
   * Compared by phonetic key, not by text. Now that typing `ramesh` finds a customer stored as
   * ರಮೇಶ್, a literal comparison would call them different people -- so the shopkeeper would be
   * offered "Add this customer" for somebody already in the book, and one tap would make a
   * duplicate. The search finding them is exactly what makes this check need the same rule.
   */
  const exact = matches.some(
    (m) =>
      searchKey(m.name) === searchKey(name) && m.phone === phone.trim().replace(/\D/g, ''),
  );

  return (
    <div className="customer-bar">
      <div className="customer-box">
        {error ? <p className="error small" role="alert">{error}</p> : null}
        <div className="customer-fields">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('cust.namePlaceholder')}
          aria-label={t('cust.nameAria')}
          autoComplete="off"
        />
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('cust.phonePlaceholder')}
          aria-label={t('cust.phoneAria')}
          inputMode="tel"
          autoComplete="off"
        />

          {query.length > 0 && !exact ? (
            <button className="btn plain slim" onClick={() => void saveNew()}>
              {searching ? t('cust.looking') : t('cust.addToBill')}
            </button>
          ) : null}

          {shop.customer ? (
            <button className="btn plain slim" onClick={() => setOpen(false)}>
              {t('cust.keep', { name: shop.customer.name || shop.customer.phone })}
            </button>
          ) : null}
        </div>

        {/* Floated above the strip rather than sitting in it: a list that grows in flow would
            push a pinned footer up over the writing with every keystroke. */}
        {matches.length > 0 ? (
          <ul className="suggestions" aria-label={t('cust.matching')}>
            {matches.map((m) => (
              <li key={m.id}>
                <button className="suggestion" onClick={() => attach(m)}>
                  <span className="grow ellipsis">
                    <strong>{m.name || t('cust.unnamed')}</strong>
                    {m.phone ? <span className="muted small"> · {m.phone}</span> : null}
                  </span>
                  <span className="muted small">
                    {m.balance !== 0
                      ? t('cust.balanceOf', { amount: money(m.balance) })
                      : t('cust.totalOf', { amount: money(m.totalBilled) })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
