import { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { money, type MsgKey } from '@shridhar/shared';
import { PrintProvider } from './src/lib/usePrint';
import { ShopProvider, useShop } from './src/lib/useShop';
import { BillScreen } from './src/screens/BillScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { ItemsScreen } from './src/screens/ItemsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ServerScreen } from './src/screens/ServerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { C } from './src/theme';

const TABS = [
  { key: 'bill', label: 'nav.bill' },
  { key: 'items', label: 'nav.items' },
  { key: 'customers', label: 'nav.customers' },
  { key: 'history', label: 'nav.history' },
  { key: 'settings', label: 'nav.settings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function Shell() {
  const shop = useShop();
  const [tab, setTab] = useState<TabKey>('bill');

  if (!shop.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  // Three gates, in the order a new phone hits them: where is the server, who are you, then work.
  if (!shop.serverUrl) return <ServerScreen />;
  if (!shop.signedIn) return <LoginScreen />;

  return (
    <PrintProvider>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Text style={styles.headerText} numberOfLines={1}>
            {shop.settings.shopName}
          </Text>
          <Text style={styles.badge}>{shop.t('app.today', { amount: money(shop.today.total) })}</Text>
        </View>

        {/* All five stay mounted. Keeping the cart alive while the shopkeeper checks a rate on
            another tab matters more here than saving a few megabytes. */}
        <View style={styles.body}>
          <View style={tab === 'bill' ? styles.visible : styles.hidden}>
            <BillScreen />
          </View>
          <View style={tab === 'items' ? styles.visible : styles.hidden}>
            <ItemsScreen />
          </View>
          <View style={tab === 'customers' ? styles.visible : styles.hidden}>
            <CustomersScreen />
          </View>
          <View style={tab === 'history' ? styles.visible : styles.hidden}>
            <HistoryScreen />
          </View>
          <View style={tab === 'settings' ? styles.visible : styles.hidden}>
            <SettingsScreen />
          </View>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((item) => (
            <Pressable key={item.key} style={styles.tab} onPress={() => setTab(item.key)}>
              <Text style={[styles.tabLabel, tab === item.key && styles.tabLabelActive]} numberOfLines={1}>
                {shop.t(item.label as MsgKey)}
              </Text>
              {item.key === 'customers' && shop.inactive.length > 0 ? (
                <Text style={styles.tabBadge}>{shop.inactive.length}</Text>
              ) : null}
              <View style={[styles.tabMark, tab === item.key && styles.tabMarkActive]} />
            </Pressable>
          ))}
        </View>
      </View>
    </PrintProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ShopProvider>
          <Shell />
        </ShopProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  shell: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, backgroundColor: C.card,
    borderBottomWidth: 1, borderColor: C.line, gap: 8,
  },
  headerText: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink },
  badge: {
    fontSize: 12, color: C.soft, borderWidth: 1, borderColor: C.line,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  body: { flex: 1 },
  visible: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card },
  tab: { flex: 1, alignItems: 'center', paddingTop: 9 },
  tabLabel: { fontSize: 12, color: C.soft, fontWeight: '600' },
  tabLabelActive: { color: C.accent, fontWeight: '800' },
  tabBadge: {
    position: 'absolute', top: 2, right: 10, minWidth: 16, textAlign: 'center',
    backgroundColor: C.danger, color: '#fff', fontSize: 10, borderRadius: 8,
    paddingHorizontal: 4, overflow: 'hidden',
  },
  tabMark: { height: 3, width: 24, borderRadius: 2, marginTop: 6, backgroundColor: 'transparent' },
  tabMarkActive: { backgroundColor: C.accent },
});
