import { useEffect, useMemo, useState } from 'react';
import {
  checkCustomer,
  customerMatches,
  money,
  stamp,
  type Bill,
  type Customer,
} from '@shridhar/shared';
import { BillDialog } from '../components/BillDialog';
import { Dialog } from '../components/Dialog';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';
import { Empty } from '../components/Empty';
import { CustomersIcon } from '../components/Icons';

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function CustomersPage() {
  const shop = useShop();
  const t = shop.t;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ customer: Customer; bills: Bill[] } | null>(null);
  /** The one bill being looked at, from this customer's list. */
  const [bill, setBill] = useState<Bill | null>(null);
  const [draft, setDraft] = useState<{ id?: string; name: string; phone: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setCustomers(await api.listCustomers());
      await shop.refreshInactive();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Loading once on mount is deliberate: the list is refreshed by the actions on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return customers;
    // One matcher, shared with the suggestions under the bill screen and with both stores, so
    // "who exists" cannot get a different answer depending on which box you typed in.
    return customers.filter((c) => customerMatches(c, query));
  }, [query, customers]);

  const owing = useMemo(() => customers.filter((c) => c.balance > 0), [customers]);
  const owedTotal = useMemo(() => owing.reduce((s, c) => s + c.balance, 0), [owing]);

  const openCustomer = async (customer: Customer) => {
    setError(null);
    try {
      setOpen(await api.getCustomer(customer.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!draft) return;
    const fields = checkCustomer(draft.name, draft.phone);
    if (!fields.ok) {
      setError(fields.error);
      return;
    }
    try {
      await api.saveCustomer({ ...(draft.id ? { id: draft.id } : {}), name: fields.name, phone: fields.phone });
      setDraft(null);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (customer: Customer) => {
    try {
      await api.deleteCustomer(customer.id);
      setOpen(null);
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      {error ? <p className="error" role="alert">{error}</p> : null}

      {/* The nudge list the shop asked for: regulars who have gone quiet. */}
      {shop.inactive.length > 0 ? (
        <section className="notice" style={{ marginBottom: 12 }}>
          <strong>
            {shop.inactive.length === 1
              ? t('cs.inactiveOne', { days: shop.settings.inactiveAfterDays })
              : t('cs.inactiveMany', { n: shop.inactive.length, days: shop.settings.inactiveAfterDays })}
          </strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {shop.inactive.slice(0, 8).map((c) => (
              <li key={c.id}>
                {c.name || c.phone || t('cs.unnamed')}
                {c.phone && c.name ? ' · ' + c.phone : ''} — {t('cs.inactiveRow', { n: daysSince(c.lastVisit) ?? 0 })}
                {c.balance > 0 ? t('cs.inactiveOwes', { amount: money(c.balance) }) : ''}
              </li>
            ))}
          </ul>
          {shop.inactive.length > 8 ? (
            <p className="small muted" style={{ margin: '6px 0 0' }}>
              {t('cs.andMore', { n: shop.inactive.length - 8 })}
            </p>
          ) : null}
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            {t('cs.inactiveNote')}
          </p>
        </section>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <span className="muted small">{t('cs.customers')}</span>
          <strong>{customers.length}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t('cs.owing')}</span>
          <strong>{owing.length}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t('cs.outstanding')}</span>
          <strong>{money(owedTotal)}</strong>
        </div>
      </div>

      <div className="search-row">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('cs.searchPlaceholder')}
          aria-label={t('cs.searchAria')}
        />
        <button
          className="btn"
          style={{ flex: '0 0 auto', paddingInline: 16 }}
          onClick={() => setDraft({ name: '', phone: '' })}
        >
          {t('common.new')}
        </button>
      </div>

      {loading ? (
        <p className="muted center small">{t('cs.loading')}</p>
      ) : results.length === 0 ? (
        <Empty icon={<CustomersIcon />}>
          {customers.length === 0 ? t('cs.noneYet') : t('cs.nobody')}
        </Empty>
      ) : (
        <div className="list">
          {results.map((c) => {
            const quiet = daysSince(c.lastVisit);
            return (
              <button key={c.id} className="list-row" onClick={() => void openCustomer(c)}>
                <span className="grow">
                  <span style={{ display: 'block', fontWeight: 700 }}>{c.name || t('cs.unnamed')}</span>
                  <span className="muted small">
                    {c.phone || t('cs.noNumber')} ·{' '}
                    {c.billCount === 0
                      ? t('cs.noBillsYet')
                      : (c.billCount === 1 ? t('cs.oneBill') : t('cs.nBills', { n: c.billCount })) +
                        (quiet == null ? '' : quiet === 0 ? t('cs.lastInToday') : t('cs.lastInDays', { n: quiet }))}
                  </span>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <span style={{ display: 'block', fontWeight: 700 }}>{money(c.totalBilled)}</span>
                  {c.balance !== 0 ? (
                    <span className="small" style={{ color: c.balance > 0 ? 'var(--danger)' : 'var(--soft)' }}>
                      {c.balance > 0 ? t('cs.owes') : t('cs.credit')}
                      {money(Math.abs(c.balance))}
                    </span>
                  ) : (
                    <span className="muted small">{t('cs.settled')}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {bill ? (
        <BillDialog
          bill={bill}
          onClose={() => setBill(null)}
          onCancelled={(cancelled) => {
            // Rewrite the row in the open customer's list, and refresh their running figures --
            // cancelling took money back out of them.
            setOpen((prev) =>
              prev
                ? { ...prev, bills: prev.bills.map((b) => (b.no === cancelled.no ? cancelled : b)) }
                : prev,
            );
            void load();
          }}
        />
      ) : null}

      {open ? (
        <Dialog
          title={open.customer.name || open.customer.phone || 'Customer'}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setOpen(null)}>{t('common.close')}</button>
              <button
                className="btn"
                onClick={() =>
                  setDraft({ id: open.customer.id, name: open.customer.name, phone: open.customer.phone })
                }
              >
                {t('common.edit')}
              </button>
            </>
          }
        >
          <div className="stat-row" style={{ marginBottom: 12 }}>
            <div className="stat">
              <span className="muted small">{t('cs.totalTransaction')}</span>
              <strong>{money(open.customer.totalBilled)}</strong>
            </div>
            <div className="stat">
              <span className="muted small">{t('cs.paid')}</span>
              <strong>{money(open.customer.totalPaid)}</strong>
            </div>
            <div className="stat">
              <span className="muted small">{t('cs.balance')}</span>
              <strong>{money(open.customer.balance)}</strong>
            </div>
          </div>

          <p className="muted small">
            {open.customer.phone ? open.customer.phone + ' · ' : ''}
            {t('cs.since', { date: stamp(open.customer.since) })}
            {open.customer.lastVisit ? t('cs.lastVisit', { date: stamp(open.customer.lastVisit) }) : ''}
          </p>

          {open.bills.length === 0 ? (
            <p className="muted small">{t('cs.noBills')}</p>
          ) : (
            <div className="list">
              {open.bills.map((b) => (
                /* Tappable now: the bill is already here in full, so looking at what was printed
                   -- or cancelling it -- needs no trip to the server. */
                <button key={b.no} className="list-row" onClick={() => setBill(b)}>
                  <span className="grow">
                    <span style={{ display: 'block' }}>{t('hist.billNo', { no: b.no })}</span>
                    <span className="muted small">
                      {stamp(b.at)}
                      {b.cancelled ? ' · ' + t('hist.cancelled') : ''}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span style={{ display: 'block', fontWeight: 700 }}>
                      {b.cancelled ? '—' : money(b.total)}
                    </span>
                    {!b.cancelled && b.paid !== b.total ? (
                      <span className="muted small">{t('cs.paidOf', { amount: money(b.paid) })}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Dialog>
      ) : null}

      {draft ? (
        <Dialog
          title={draft.id ? t('cs.editTitle') : t('cs.newTitle')}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
              <button className="btn" onClick={() => void save()}>{t('common.save')}</button>
            </>
          }
        >
          <div className="stack">
            <div className="field">
              <label htmlFor="c-name">{t('cs.name')}</label>
              <input
                id="c-name"
                className="input"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="c-phone">{t('cs.phone')}</label>
              <input
                id="c-phone"
                className="input"
                inputMode="tel"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </div>
            {draft.id ? (
              <button
                className="btn danger"
                style={{ width: '100%' }}
                onClick={() => {
                  const existing = customers.find((c) => c.id === draft.id);
                  if (existing) void remove(existing);
                }}
              >
                {t('cs.removeCustomer')}
              </button>
            ) : null}
            <p className="muted small" style={{ margin: 0 }}>
              {t('cs.removeNote')}
            </p>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
