import { useMemo, useState } from 'react';
import {
  checkItemNames,
  checkUnit,
  money,
  parseRate,
  type Item,
} from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { KannadaInput } from '../components/KannadaInput';
import { useShop } from '../lib/useShop';

type Draft = { id?: string; nameKn: string; nameEn: string; rate: string; unit: string };

const BLANK: Draft = { nameKn: '', nameEn: '', rate: '', unit: 'pc' };

export function ItemsPage() {
  const shop = useShop();
  const t = shop.t;
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Item | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shop.items;
    return shop.items.filter((i) => i.nameEn.toLowerCase().includes(q) || i.nameKn.includes(query.trim()));
  }, [query, shop.items]);

  const save = async () => {
    if (!draft) return;
    const names = checkItemNames(draft.nameKn, draft.nameEn);
    if (!names.ok) {
      setError(names.error);
      return;
    }
    const rate = parseRate(draft.rate);
    if (!rate.ok) {
      setError(rate.error);
      return;
    }
    const unit = checkUnit(draft.unit);
    if (!unit.ok) {
      setError(unit.error);
      return;
    }
    try {
      await shop.saveItem({
        id: draft.id, nameKn: names.nameKn, nameEn: names.nameEn,
        rate: rate.value, unit: unit.value,
      });
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (item: Item) => {
    try {
      await shop.removeItem(item.id);
      setConfirmDelete(null);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      {error ? <p className="error" role="alert">{error}</p> : null}

      <div className="search-row">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('items.searchPlaceholder')}
          aria-label={t('items.searchAria')}
        />
        <button className="btn" style={{ flex: '0 0 auto', paddingInline: 16 }} onClick={() => setDraft(BLANK)}>
          {t('common.new')}
        </button>
      </div>

      <p className="muted small">
        {t('items.note', { n: shop.items.length })}
      </p>

      <div className="list">
        {results.map((item) => (
          <button
            key={item.id}
            className="list-row"
            onClick={() =>
              setDraft({ id: item.id, nameKn: item.nameKn, nameEn: item.nameEn, rate: String(item.rate), unit: item.unit })
            }
          >
            <span className="grow">
              <span style={{ display: 'block' }}>{item.nameKn}</span>
              <span className="muted small">{item.nameEn}</span>
            </span>
            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {money(item.rate)}
              <span className="muted small" style={{ fontWeight: 400 }}> /{item.unit}</span>
            </span>
          </button>
        ))}
      </div>

      {draft ? (
        <Dialog
          title={draft.id ? t('items.editTitle') : t('items.newTitle')}
          onClose={() => {
            setDraft(null);
            setError(null);
          }}
          footer={
            <>
              <button className="btn plain" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
              <button className="btn" onClick={save}>{t('common.save')}</button>
            </>
          }
        >
          <div className="stack">
            <KannadaInput
              id="i-kn"
              label={t('items.knName')}
              value={draft.nameKn}
              onChange={(nameKn) => setDraft((d) => (d ? { ...d, nameKn } : d))}
            />
            <div className="field">
              <label htmlFor="i-en">{t('items.enName')}</label>
              <input
                id="i-en"
                className="input"
                value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              />
            </div>
            <div className="row">
              <div className="field grow">
                <label htmlFor="i-rate">{t('items.rate')}</label>
                <input
                  id="i-rate"
                  className="input"
                  inputMode="decimal"
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                />
              </div>
              <div className="field grow">
                <label htmlFor="i-unit">{t('items.unit')}</label>
                <input
                  id="i-unit"
                  className="input"
                  placeholder={t('items.unitPlaceholder')}
                  value={draft.unit}
                  onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                />
              </div>
            </div>
            {draft.id ? (
              <button
                className="btn danger"
                style={{ width: '100%' }}
                onClick={() => {
                  const existing = shop.items.find((i) => i.id === draft.id);
                  if (existing) setConfirmDelete(existing);
                }}
              >
                {t('items.removeItem')}
              </button>
            ) : null}
          </div>
        </Dialog>
      ) : null}

      {confirmDelete ? (
        <Dialog
          title={t('items.removeTitle', { name: confirmDelete.nameEn })}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setConfirmDelete(null)}>{t('common.keep')}</button>
              <button className="btn danger" onClick={() => void remove(confirmDelete)}>{t('common.remove')}</button>
            </>
          }
        >
          <p className="small" style={{ margin: 0 }}>
            {t('items.removeBody')}
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
