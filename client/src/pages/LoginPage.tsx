import { useState } from 'react';
import { Mark } from '../components/Mark';
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
    <div className="signin">
      <form className="signin-card" onSubmit={submit}>
        <Mark className="signin-mark" />
        <h1>{shop.settings.shopName}</h1>
        <p className="signin-sub">{shop.t('login.prompt')}</p>

        {error ? (
          <p className="error" role="alert" style={{ textAlign: 'left', marginBottom: 14 }}>
            {error}
          </p>
        ) : null}

        <div className="field" style={{ textAlign: 'left', marginBottom: 14 }}>
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

        <button className={busy ? 'btn busy' : 'btn'} type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? shop.t('login.checking') : shop.t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
