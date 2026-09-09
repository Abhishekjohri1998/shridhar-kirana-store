import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PrintProvider } from './src/printer/PrintProvider';
import { BillScreen } from './src/screens/BillScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { ItemsScreen } from './src/screens/ItemsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StoreProvider, useStore } from './src/store/store';
import { C } from './src/theme';

const TABS = [
  { key: 'bill', label: 'Bill' },
  { key: 'items', label: 'Items' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function Shell() {
  const { ready, settings } = useStore();
  const [tab, setTab] = useState<TabKey>('bill');

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Text style={styles.headerText} numberOfLines={1}>
          {settings.shopName}
        </Text>
      </View>

      {/* All four screens stay mounted. Keeping the cart alive while the shopkeeper checks a rate
          in the Items tab matters more here than saving a few megabytes. */}
      <View style={styles.body}>
        <View style={tab === 'bill' ? styles.visible : styles.hidden}>
          <BillScreen />
        </View>
        <View style={tab === 'items' ? styles.visible : styles.hidden}>
          <ItemsScreen />
        </View>
        <View style={tab === 'history' ? styles.visible : styles.hidden}>
          <HistoryScreen />
        </View>
        <View style={tab === 'settings' ? styles.visible : styles.hidden}>
          <SettingsScreen />
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tab}>
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            <View style={[styles.tabMark, tab === t.key && styles.tabMarkActive]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StoreProvider>
          <PrintProvider>
            <Shell />
          </PrintProvider>
        </StoreProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  shell: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  headerText: { fontSize: 20, fontWeight: '800', color: C.ink },
  body: { flex: 1 },
  visible: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card },
  tab: { flex: 1, alignItems: 'center', paddingTop: 10 },
  tabLabel: { fontSize: 14, color: C.soft, fontWeight: '600' },
  tabLabelActive: { color: C.accent, fontWeight: '800' },
  tabMark: { height: 3, width: 26, borderRadius: 2, marginTop: 6, backgroundColor: 'transparent' },
  tabMarkActive: { backgroundColor: C.accent },
});
