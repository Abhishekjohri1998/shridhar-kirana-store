import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, StatusBar, StyleSheet, Text, View,
} from 'react-native';
// Imported by weight, not from the package root: the root re-exports all four faces and metro
// then bundles every one of them, which is three quarters of a megabyte of fonts the app never
// draws with -- paid for on every over-the-air update, on a shop's mobile data.
import { Caveat_700Bold } from '@expo-google-fonts/caveat/700Bold';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { money, pickLang, type MsgKey } from '@shridhar/shared';
import { Mark, SECTION_ICONS } from './src/components/Icons';
import { PrintProvider } from './src/lib/usePrint';
import { ShopProvider, useShop } from './src/lib/useShop';
import { reportInsets, useHeldInsets } from './src/lib/screenEdges';
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

/**
 * How tall the safe area actually measured, handed down to the shell as a floor.
 *
 * The shell is told to fill its parent, and on one tablet it did not -- the totals and the tab
 * bar ended up stranded mid-screen. Three fixes assumed a height and all three missed; this one
 * measures. A parent cannot disagree with itself, so unlike an explicit window height it can
 * never overflow.
 *
 * Kept now that the fault is settled: the device that showed it reports shell and safe area at
 * the same height, which is this doing its job.
 */
const safeFrame = { height: 0, subscribers: new Set<(h: number) => void>() };

function useSafeFrame(): number {
  const [height, setHeight] = useState(safeFrame.height);
  useEffect(() => {
    safeFrame.subscribers.add(setHeight);
    return () => { safeFrame.subscribers.delete(setHeight); };
  }, []);
  return height;
}

function reportSafeFrame(height: number): void {
  const next = Math.round(height);
  if (next === safeFrame.height) return;
  safeFrame.height = next;
  safeFrame.subscribers.forEach((fn) => fn(next));
}

function Shell() {
  const shop = useShop();
  const [tab, setTab] = useState<TabKey>('bill');
  // Held until the face is ready, so no heading is drawn once in the wrong font and again in
  // the right one.
  const [fontsReady] = useFonts({ Caveat_700Bold });
  const barWidth = useRef(0);
  const slide = useRef(new Animated.Value(0)).current;
  const frame = useSafeFrame();
  const insets = useHeldInsets();

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
  const shopName = pickLang(shop.settings.shopName, shop.settings.shopNameKn, shop.lang);

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
      <View
        style={[styles.shell, frame > 0 ? { minHeight: frame } : null]}
      >
        <View style={styles.header}>
          <Mark size={24} color={C.accent} />
          <Text style={[styles.headerText, handFont(shopName, 19)]} numberOfLines={1}>
            {shopName}
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
          style={[styles.tabBar, { paddingBottom: insets.bottom }]}
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
  const live = useSafeAreaInsets();
  const measured = useHeldInsets();
  /*
   * Until something has actually been measured, the live figures are the best there is -- going
   * through the effect first would draw the header under the status bar for a frame. After that
   * the held ones win, which is the whole point.
   */
  const insets = measured.top === 0 && measured.bottom === 0 ? live : measured;

  // Ignored while a dialog is up: see `held`.
  useEffect(() => {
    reportInsets(live.top, live.bottom);
  }, [live.top, live.bottom]);

  /*
   * Padded at the top only. The gesture bar's share at the foot is padding *inside* the tab bar
   * instead, so the bar's own surface reaches the bottom edge of the glass and there is no strip
   * of background below it to mistake for the bar having moved.
   */
  return (
    <View
      style={[styles.safe, { paddingTop: insets.top }]}
      onLayout={(e) => reportSafeFrame(e.nativeEvent.layout.height - insets.top)}
    >
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
  /* Fills its parent, with a floor of whatever the parent measured -- see safeFrame. An
     explicit height from useWindowDimensions was tried once and backfired: under the old
     portrait lock the hook reported a height the parent did not have and the shell froze at the
     wrong size. The floor here comes from the parent itself, so the two cannot disagree. */
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
