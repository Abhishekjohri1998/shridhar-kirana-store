import { useState } from 'react';
import { useShop } from '../lib/useShop';

export function LoginPage() {
  const shop = useShop();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError(shop.t('login.enterPin'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shop.signIn(pin.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '100%' }}>
      <form className="card stack" style={{ width: '100%', maxWidth: 360 }} onSubmit={submit}>
        <h1 style={{ margin: 0, fontSize: '1.15rem' }}>{shop.settings.shopName}</h1>
        <p className="muted small" style={{ margin: 0 }}>{shop.t('login.prompt')}</p>

        {error ? <p className="error" role="alert">{error}</p> : null}

        <div className="field">
          <label htmlFor="pin">{shop.t('login.pin')}</label>
          <input
            id="pin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>

        <button className="btn" type="submit" disabled={busy}>
          {busy ? shop.t('login.checking') : shop.t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
