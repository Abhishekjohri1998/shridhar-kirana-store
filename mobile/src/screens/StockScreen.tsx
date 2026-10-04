import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useShop } from '../lib/useShop';
import { C, R, TYPE } from '../theme';

/*
 * The stock app, opened as the website it is.
 *
 * Billing and stock are two separate programs, kept apart at the shop's asking: none of stock's
 * code lives in this folder. This screen is a browser window onto the stock server, so the
 * counter can reach both from one app. Stock has its own sign-in, remembered inside the window.
 */

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

export function StockScreen() {
  const shop = useShop();
  const t = shop.t;
  const web = useRef<WebView>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(STOCK_KEY)
      .then((saved) => setUrl(saved || shippedStockUrl()))
      .catch(() => setUrl(shippedStockUrl()));
  }, []);

  // Android's back button walks back through stock's own pages before it leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canBack) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [canBack]);

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

  if (url === null) {
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
        source={{ uri: url }}
        style={styles.fill}
        domStorageEnabled
        javaScriptEnabled
        pullToRefreshEnabled
        allowFileAccess
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={CATCH_DOWNLOADS}
        onMessage={onMessage}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
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
