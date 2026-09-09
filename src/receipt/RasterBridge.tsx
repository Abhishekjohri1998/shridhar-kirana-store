import React, { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ReceiptDoc } from './doc';
import type { Raster } from './raster';
import { RASTER_HTML } from './rasterHtml';

export type { Raster };
export type RasterHandle = { rasterize: (doc: ReceiptDoc) => Promise<Raster> };

type Pending = { resolve: (r: Raster) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Invisible 1x1 WebView that turns a ReceiptDoc into printer dots. Mount it once, high in the
 * tree, and hold on to the ref -- the page is only ready after its first load, so keeping it
 * alive means the first print of the day isn't the slow one.
 */
export const RasterBridge = forwardRef<RasterHandle, {}>(function RasterBridge(_props, ref) {
  const web = useRef<WebView>(null);
  const pending = useRef<Pending | null>(null);

  const settle = useCallback((fn: (p: Pending) => void) => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    fn(p);
  }, []);

  useImperativeHandle(ref, () => ({
    rasterize: (doc: ReceiptDoc) =>
      new Promise<Raster>((resolve, reject) => {
        if (pending.current) {
          reject(new Error('Still rendering the previous receipt'));
          return;
        }
        const timer = setTimeout(() => {
          settle((p) => p.reject(new Error('Receipt renderer did not respond')));
        }, 10000);
        pending.current = { resolve, reject, timer };
        const payload = JSON.stringify(JSON.stringify(doc));
        web.current?.injectJavaScript(`window.__render(${payload});true;`);
      }),
  }));

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { ok?: boolean; ready?: boolean; error?: string; width?: number; height?: number; data?: string };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.ready) return;
      if (msg.ok && msg.data && msg.width && msg.height) {
        const raster: Raster = { width: msg.width, height: msg.height, data: msg.data };
        settle((p) => p.resolve(raster));
      } else {
        settle((p) => p.reject(new Error(msg.error || 'Could not render the receipt')));
      }
    },
    [settle],
  );

  return (
    <WebView
      ref={web}
      source={{ html: RASTER_HTML }}
      originWhitelist={['*']}
      javaScriptEnabled
      onMessage={onMessage}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
    />
  );
});
