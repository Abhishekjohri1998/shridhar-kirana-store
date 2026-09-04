import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { money } from '@shridhar/shared';
import { PrintProvider } from './lib/usePrint';
import { useShop } from './lib/useShop';
import { BillPage } from './pages/BillPage';
import { CustomersPage } from './pages/CustomersPage';
import { HistoryPage } from './pages/HistoryPage';
import { ItemsPage } from './pages/ItemsPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = [
  { to: '/bill', key: 'nav.bill' },
  { to: '/items', key: 'nav.items' },
  { to: '/customers', key: 'nav.customers' },
  { to: '/history', key: 'nav.history' },
  { to: '/settings', key: 'nav.settings' },
] as const;

export function App() {
  const shop = useShop();

  if (!shop.ready) {
    return <p className="page muted center">{shop.t('app.loading')}</p>;
  }

  if (!shop.signedIn) {
    return <LoginPage />;
  }

  return (
    <PrintProvider>
      <div className="app">
        {/* Only shown by the desktop sidebar layout. */}
        <div className="brand">{shop.t('app.brand')}</div>

        <header className="topbar">
          <h1>{shop.settings.shopName}</h1>
          <span className="badge">{shop.t('app.today', { amount: money(shop.today.total) })}</span>
        </header>

        <main className="main">
          <Routes>
            <Route path="/bill" element={<BillPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/bill" replace />} />
          </Routes>
        </main>

        {/* One set of links. CSS turns it into a bottom tab bar on phones and a sidebar on desktop. */}
        <nav className="nav" aria-label={shop.t('nav.sections')}>
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {shop.t(tab.key)}
              {/* Customers who have gone quiet are surfaced here rather than only on their page. */}
              {tab.to === '/customers' && shop.inactive.length > 0 ? (
                <span className="tab-badge" aria-label={shop.t('nav.quietCount', { n: shop.inactive.length })}>
                  {shop.inactive.length}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
      </div>
    </PrintProvider>
  );
}
