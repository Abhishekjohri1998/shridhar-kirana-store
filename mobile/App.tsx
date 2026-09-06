import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { Caveat_700Bold, useFonts } from '@expo-google-fonts/caveat';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { money, type MsgKey } from '@shridhar/shared';
import { Mark, SECTION_ICONS } from './src/components/Icons';
import { PrintProvider } from './src/lib/usePrint';
import { ShopProvider, useShop } from './src/lib/useShop';
import { BillScreen } from './src/screens/BillScreen';
import { CustomersScreen } from './src/screens/CustomersScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ServerScreen } from './src/screens/ServerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { C, R, T, TYPE, handFont, shadow } from './src/theme';

const TABS = [
  { key: 'bill', label: 'nav.bill' },
  { key: 'customers', label: 'nav.customers' },
  { key: 'history', label: 'nav.history' },
  { key: 'settings', label: 'nav.settings' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * One tab. The icon lifts a hair when its section is the active one -- a pixel of movement, but
 * it is what stops the bar reading as a painted-on strip.
 */
function Tab({
  tab, active, badge, label, onPress,
}: {
  tab: TabKey;
  active: boolean;
  badge: number;
  label: string;
  onPress: () => void;
}) {
  const Icon = SECTION_ICONS[tab];
  const lift = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(lift, {
      toValue: active ? 1 : 0,
      duration: T.base,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, lift]);

  return (
    <Pressable style={styles.tab} onPress={onPress}>
      <Animated.View
        style={{
          transform: [
            { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) },
            { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) },
          ],
        }}
      >
        <Icon size={22} color={active ? C.accentDeep : C.soft} />
      </Animated.View>

      <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Text>

      {badge > 0 ? <Text style={styles.tabBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function Shell() {
  const shop = useShop();
  const [tab, setTab] = useState<TabKey>('bill');
  // Held until the face is ready, so no heading is drawn once in the wrong font and again in
  // the right one.
  const [fontsReady] = useFonts({ Caveat_700Bold });
  const barWidth = useRef(0);
  const slide = useRef(new Animated.Value(0)).current;

  if (!shop.ready || !fontsReady) {
    return (
      <View style={styles.loading}>
        <Mark size={44} color={C.accentEdge} />
        <ActivityIndicator color={C.accent} style={{ marginTop: 18 }} />
      </View>
    );
  }

  // Three gates, in the order a new phone hits them: where is the server, who are you, then work.
  if (!shop.serverUrl) return <ServerScreen />;
  if (!shop.signedIn) return <LoginScreen />;

  const index = TABS.findIndex((t) => t.key === tab);

  const go = (next: TabKey) => {
    setTab(next);
    // The indicator slides between tabs rather than jumping, which is the cheapest way to say
    // "you are still in the same app, one section over".
    Animated.spring(slide, {
      toValue: TABS.findIndex((t) => t.key === next),
      damping: 18,
      stiffness: 220,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  };

  return (
    <PrintProvider>
      <View style={styles.shell}>
        <View style={styles.header}>
          <Mark size={24} color={C.accent} />
          <Text style={[styles.headerText, handFont(shop.settings.shopName, 19)]} numberOfLines={1}>
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

        <View
          style={styles.tabBar}
          onLayout={(e) => {
            barWidth.current = e.nativeEvent.layout.width;
            slide.setValue(index);
          }}
        >
          <Animated.View
            style={[
              styles.indicator,
              {
                width: `${100 / TABS.length}%`,
                transform: [
                  {
                    translateX: slide.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, barWidth.current / TABS.length],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.indicatorInk} />
          </Animated.View>

          {TABS.map((item) => (
            <Tab
              key={item.key}
              tab={item.key}
              active={tab === item.key}
              badge={item.key === 'customers' ? shop.inactive.length : 0}
              label={shop.t(item.label as MsgKey)}
              onPress={() => go(item.key)}
            />
          ))}
        </View>
      </View>
    </PrintProvider>
  );
}

/** Plain padding rather than SafeAreaView, so the child is free to state its own height. */
function SafeArea({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {children}
    </View>
  );
}

export default function App() {
  return (
    // Gesture handler needs a root of its own, and it has to be the outermost view or the
    // writing strip never receives a touch.
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={C.card} />
        <ShopProvider>
          <SafeArea>
            <Shell />
          </SafeArea>
        </ShopProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1, minHeight: 0, backgroundColor: C.bg },
  /* Fills its parent. An explicit height was tried while the app was still locked to portrait,
     and it froze the shell at the height of whichever orientation happened to load first --
     rotate the tablet and the app kept the old size with the tab bar stranded mid-screen. The
     orientation lock was the real fault; this is back to flex. */
  shell: { flex: 1, backgroundColor: C.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderColor: C.line,
    gap: 10,
  },
  headerText: { ...TYPE.title, flex: 1 },
  badge: {
    fontSize: 12,
    fontWeight: '600',
    color: C.accentDeep,
    backgroundColor: C.accentWash,
    borderWidth: 1,
    borderColor: C.accentEdge,
    borderRadius: R.pill,
    paddingHorizontal: 11,
    paddingVertical: 4,
    overflow: 'hidden',
  },

  // minHeight 0 so a tall child cannot push the row taller than the screen; without it a
  // scroll view inside can refuse to shrink and the whole shell grows past the window.
  body: { flex: 1, minHeight: 0 },
  visible: { flex: 1, minHeight: 0 },
  hidden: { display: 'none' },

  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    ...shadow(2),
  },
  indicator: { position: 'absolute', top: 0, left: 0, alignItems: 'center' },
  indicatorInk: { width: 32, height: 3, borderRadius: 3, backgroundColor: C.accentBright },

  tab: { flex: 1, alignItems: 'center', paddingTop: 10, paddingBottom: 8, gap: 3 },
  tabLabel: { fontSize: 11, color: C.soft, fontWeight: '600' },
  tabLabelActive: { color: C.accentDeep, fontWeight: '800' },
  tabBadge: {
    position: 'absolute',
    top: 4,
    right: 14,
    minWidth: 17,
    textAlign: 'center',
    backgroundColor: C.danger,
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 17,
    borderRadius: R.pill,
    paddingHorizontal: 4,
    overflow: 'hidden',
  },
});
