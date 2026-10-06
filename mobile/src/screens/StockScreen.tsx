import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { markStockSignOut, stockSignOutPending } from '../lib/api';
import { useShop } from '../lib/useShop';
import { C, R, TYPE } from '../theme';

/*
 * The stock app, opened as the website it is.
 *
 * Billing and stock are two separate programs, kept apart at the shop's asking: none of stock's
 * code lives in this folder. This screen is a browser window onto the stock server, so the
 * counter can reach both from one app. Stock has its own sign-in, remembered inside the window.
 *
 * A person who signed in by phone and PIN brings a stock session with them; the window's first
 * load carries it as `#token=`, which the stock site signs in with, so the Stock tab opens
 * already signed in. After "Switch user" with no new session (the shop PIN), the window's first
 * load drops the last person's stored session instead.
 */

/** Forgets the stock site's saved session. Only ever on the first load after a switch. */
const FORGET_STOCK_SESSION = `
try { localStorage.removeItem('stock.token'); } catch (e) {}
true;
`;

const STOCK_KEY = 'shridhar.stockUrl';

function shippedStockUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as { stockUrl?: string };
  return extra.stockUrl ?? '';
}

/*
 * The stock site saves Excel and CSV files through blob links, which an Android WebView drops on
 * the floor. This hands each one to the app instead, which saves it and opens the share sheet.
 */
const CATCH_DOWNLOADS = `
(function () {
  if (window.__stockDownloads) return;
  window.__stockDownloads = true;
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var href = this.href || '';
    var name = this.getAttribute('download');
    if (name && href.indexOf('blob:') === 0) {
      fetch(href).then(function (r) { return r.blob(); }).then(function (blob) {
        var reader = new FileReader();
        reader.onload = function () {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'download', name: name, mime: blob.type || 'application/octet-stream',
            data: String(reader.result).replace(/^data:[^,]*,/, ''),
          }));
        };
        reader.readAsDataURL(blob);
      });
      return;
    }
    return click.call(this);
  };
})();
true;
`;

/*
 * A page that puts the cursor in a box as it loads would raise the keyboard over billing while
 * this window is loading hidden. Loaded hidden, nothing on it keeps the focus.
 */
const DROP_FOCUS = `
try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
true;
`;

/**
 * `active` is false while the window is loaded hidden behind billing (App mounts it as soon as
 * an admin is in, so the first tap on Stock is instant). Hidden, it takes no back presses and
 * no focus.
 */
export function StockScreen({ active = true }: { active?: boolean }) {
  const shop = useShop();
  const t = shop.t;
  const web = useRef<WebView>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /* Decided once, when the window first opens: hand over this person's session, or forget the
     last one. Neither is repeated on later loads, so stock's own sign-out keeps working. */
  const [firstLoad, setFirstLoad] = useState<{ hash: string; forget: boolean } | null>(null);
  const firstDone = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  /* One step before the window can start loading: the saved address and whether the last
     person's stock session is to be forgotten, read together. */
  useEffect(() => {
    let alive = true;
    const token = shop.stockToken;
    void Promise.all([
      AsyncStorage.getItem(STOCK_KEY).catch(() => null),
      stockSignOutPending(),
    ]).then(([saved, pending]) => {
      if (!alive) return;
      setUrl(saved || shippedStockUrl());
      setFirstLoad({
        hash: token ? '#token=' + encodeURIComponent(token) : '',
        forget: !token && pending,
      });
      if (pending) void markStockSignOut(false);
    });
    return () => { alive = false; };
    // Once per mount: App remounts this window when the person changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android's back button walks back through stock's own pages before it leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!active || !canBack) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [active, canBack]);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: { type?: string; name?: string; mime?: string; data?: string };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type !== 'download' || !msg.name || !msg.data) return;
    const safe = msg.name.replace(/[^\w.\-]+/g, '_');
    const file = FileSystem.cacheDirectory + safe;
    await FileSystem.writeAsStringAsync(file, msg.data, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file, { mimeType: msg.mime, dialogTitle: safe });
    }
  }, []);

  const saveAddress = async () => {
    const next = draft.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(next)) return;
    await AsyncStorage.setItem(STOCK_KEY, next);
    setEditing(false);
    setFailed(false);
    setUrl(next);
  };

  if (url === null || firstLoad === null) {
    return <View style={styles.center}><ActivityIndicator color={C.accent} /></View>;
  }

  if (!url || failed || editing) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('stock.title')}</Text>
        <Text style={styles.note}>{url && !editing ? t('stock.offline') : t('stock.address')}</Text>
        {editing || !url ? (
          <>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://"
              placeholderTextColor={C.faint}
            />
            <Pressable style={styles.btn} onPress={saveAddress}>
              <Text style={styles.btnText}>{t('common.save')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={styles.btn}
              onPress={() => { setFailed(false); setLoading(true); web.current?.reload(); }}
            >
              <Text style={styles.btnText}>{t('stock.retry')}</Text>
            </Pressable>
            <Pressable onPress={() => { setDraft(url); setEditing(true); }} hitSlop={8}>
              <Text style={styles.link}>{t('stock.change')}</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <WebView
        ref={web}
        source={{ uri: firstLoad.hash ? url + '/' + firstLoad.hash : url }}
        style={styles.fill}
        domStorageEnabled
        javaScriptEnabled
        pullToRefreshEnabled
        allowFileAccess
        setSupportMultipleWindows={false}
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        injectedJavaScriptBeforeContentLoaded={
          firstLoad.forget && !firstDone.current ? FORGET_STOCK_SESSION + CATCH_DOWNLOADS : CATCH_DOWNLOADS
        }
        onMessage={onMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => {
          firstDone.current = true;
          setLoading(false);
          if (!activeRef.current) { web.current?.injectJavaScript(DROP_FOCUS); }
        }}
        onError={() => setFailed(true)}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
        onNavigationStateChange={(s) => setCanBack(s.canGoBack)}
      />
      {loading ? (
        <View style={styles.loadingBar} pointerEvents="none">
          <ActivityIndicator color={C.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, backgroundColor: C.bg },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12,
    backgroundColor: C.bg,
  },
  title: { ...TYPE.title },
  note: { color: C.soft, textAlign: 'center', maxWidth: 360 },
  input: {
    alignSelf: 'stretch', maxWidth: 420, width: '100%', borderWidth: 1, borderColor: C.lineStrong,
    borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, color: C.ink,
    backgroundColor: C.card,
  },
  btn: {
    backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 22, paddingVertical: 10,
  },
  btnText: { color: C.accentInk, fontWeight: '700' },
  link: { color: C.accentDeep, fontWeight: '600' },
  loadingBar: { position: 'absolute', top: 10, alignSelf: 'center' },
});
