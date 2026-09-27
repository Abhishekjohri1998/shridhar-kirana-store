import { useEffect, useMemo, useRef, useState } from 'react';
import {
  blankItem, blankUnit, draftToItem, itemMatches, itemToDraft, itemsToCsv, unitSummary,
  type Item, type ItemDraft, type UnitDraft,
} from '@shridhar/shared';
import { Dialog } from '../components/Dialog';
import { Empty } from '../components/Empty';
import { ItemsIcon } from '../components/Icons';
import { api } from '../lib/api';
import { useShop } from '../lib/useShop';

/**
 * The item list: what the typing mode will search and stock will count.
 *
 * One item, several ways of selling it -- page 7 of the shop's brief. Each unit carries its own
 * price, how many of the first unit it holds, a cheaper rate by quantity, and a bargaining range.
 * The shop can type the catalogue in a spreadsheet instead, and bring it in whole.
 */
export function ItemsPage() {
  const shop = useShop();
  const t = shop.t;
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await api.listItems(true));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.dataVersion]);

  // The same matcher the server searches with, so the list and the typing mode agree.
  const results = useMemo(
    () => (query.trim() ? items.filter((i) => itemMatches(i, query)) : items),
    [items, query],
  );
  const selling = items.filter((i) => i.active).length;

  const save = async () => {
    if (!draft) return;
    const checked = draftToItem(draft);
    if (!checked.ok) {
      setDraftError(checked.error);
      return;
    }
    setBusy(true);
    try {
      const { id, ...fields } = checked.item;
      if (id) await api.updateItem(id, fields);
      else await api.createItem(fields);
      setDraft(null);
      setDraftError(null);
      await load();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await api.deleteItem(draft.id);
      setDraft(null);
      await load();
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([itemsToCsv(items)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'items-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const { saved } = await api.importItems(await file.text());
      setNotice(t('it.importDone', { n: saved }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const setUnit = (i: number, patch: Partial<UnitDraft>) =>
    setDraft((d) => (d ? { ...d, units: d.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) } : d));

  return (
    <div className="page">
      {error ? <p className="error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{error}</p> : null}
      {notice ? <p className="notice">{notice}</p> : null}

      <div className="stat-row">
        <div className="stat">
          <span className="muted small">{t('it.count')}</span>
          <strong>{selling}</strong>
        </div>
        <div className="stat">
          <span className="muted small">{t('it.retiredCount')}</span>
          <strong>{items.length - selling}</strong>
        </div>
      </div>

      <div className="search-row">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('it.searchPlaceholder')}
          aria-label={t('it.searchAria')}
        />
        <button
          className="btn"
          style={{ flex: '0 0 auto', paddingInline: 16 }}
          onClick={() => { setDraft(blankItem()); setDraftError(null); }}
        >
          {t('common.new')}
        </button>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn plain slim" disabled={items.length === 0} onClick={exportCsv}>
          {t('it.export')}
        </button>
        <button className="btn plain slim" onClick={() => fileInput.current?.click()}>
          {t('it.import')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importCsv(file);
          }}
        />
        <span className="muted small" style={{ flexBasis: '100%' }}>{t('it.importNote')}</span>
      </div>

      {loading ? (
        <p className="muted center small">{t('it.loading')}</p>
      ) : results.length === 0 ? (
        <Empty icon={<ItemsIcon />}>{items.length === 0 ? t('it.noneYet') : t('it.nothing')}</Empty>
      ) : (
        <div className="list">
          {results.map((it) => (
            <button
              key={it.id}
              className="list-row"
              onClick={() => { setDraft(itemToDraft(it)); setDraftError(null); }}
            >
              <span className="grow">
                <span style={{ display: 'block', fontWeight: 700 }}>
                  {[it.nameKn, it.nameEn].filter(Boolean).join(' · ')}
                </span>
                <span className="muted small">
                  {unitSummary(it)}
                  {it.place ? ' · ' + it.place : ''}
                  {!it.active ? ' · ' + t('it.retired') : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {draft ? (
        <Dialog
          title={draft.id ? t('it.editTitle') : t('it.newTitle')}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn plain" onClick={() => setDraft(null)}>{t('common.cancel')}</button>
              <button className="btn" disabled={busy} onClick={() => void save()}>{t('common.save')}</button>
            </>
          }
        >
          <div className="stack">
            {draftError ? <p className="error" role="alert">{draftError}</p> : null}
            <div className="field">
              <label htmlFor="it-kn">{t('it.nameKn')}</label>
              <input id="it-kn" className="input" autoFocus value={draft.nameKn}
                onChange={(e) => setDraft({ ...draft, nameKn: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="it-en">{t('it.nameEn')}</label>
              <input id="it-en" className="input" value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} />
            </div>

            <div className="field">
              <label>{t('it.units')}</label>
              <p className="muted small" style={{ marginTop: 0 }}>{t('it.unitsHint')}</p>
              {draft.units.map((u, i) => (
                <div key={i} className="unit-box">
                  <div className="unit-grid">
                    <label className="field">
                      <span className="small muted">{t('it.unitCode')}</span>
                      <input className="input" value={u.code} placeholder="pc"
                        onChange={(e) => setUnit(i, { code: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="small muted">{t('it.perBase')}</span>
                      <input className="input" inputMode="decimal" value={i === 0 ? '1' : u.perBase}
                        disabled={i === 0} placeholder="24"
                        onChange={(e) => setUnit(i, { perBase: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="small muted">{t('it.price')}</span>
                      <input className="input" inputMode="decimal" value={u.price}
                        onChange={(e) => setUnit(i, { price: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="small muted">{t('it.min')}</span>
                      <input className="input" inputMode="decimal" value={u.min}
                        onChange={(e) => setUnit(i, { min: e.target.value })} />
                    </label>
                    <label className="field">
                      <span className="small muted">{t('it.max')}</span>
                      <input className="input" inputMode="decimal" value={u.max}
                        onChange={(e) => setUnit(i, { max: e.target.value })} />
                    </label>
                  </div>
                  <label className="field">
                    <span className="small muted">{t('it.slabs')}</span>
                    <input className="input" value={u.slabs} placeholder="10:4.5; 50:4"
                      onChange={(e) => setUnit(i, { slabs: e.target.value })} />
                  </label>
                  {i > 0 ? (
                    <button className="btn plain slim" onClick={() =>
                      setDraft({ ...draft, units: draft.units.filter((_, j) => j !== i) })}>
                      {t('it.removeUnit')}
                    </button>
                  ) : null}
                </div>
              ))}
              <p className="muted small">{t('it.slabsHint')}</p>
              <button className="btn plain slim" disabled={draft.units.length >= 8}
                onClick={() => setDraft({ ...draft, units: [...draft.units, blankUnit(false)] })}>
                {t('it.addUnit')}
              </button>
            </div>

            <div className="field">
              <label htmlFor="it-place">{t('it.place')}</label>
              <input id="it-place" className="input" value={draft.place}
                onChange={(e) => setDraft({ ...draft, place: e.target.value })} />
              <p className="muted small">{t('it.placeHint')}</p>
            </div>
            <div className="field">
              <label htmlFor="it-reorder">{t('it.reorderAt')}</label>
              <input id="it-reorder" className="input" inputMode="decimal" value={draft.reorderAt}
                onChange={(e) => setDraft({ ...draft, reorderAt: e.target.value })} />
              <p className="muted small">{t('it.reorderHint')}</p>
            </div>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              <span>{t('it.active')}</span>
            </label>
            {draft.id ? (
              <>
                <button className="btn danger" style={{ width: '100%' }} disabled={busy} onClick={() => void remove()}>
                  {t('it.delete')}
                </button>
                <p className="muted small" style={{ margin: 0 }}>{t('it.deleteNote')}</p>
              </>
            ) : null}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
