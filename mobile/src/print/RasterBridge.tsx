import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  INK_ROW_HEIGHT, INK_STROKE_DOTS, RASTER, inkMaxWidth, type ReceiptDoc,
} from '@shridhar/shared';
import { RASTER_HTML } from './rasterHtml';

export type Raster = { width: number; height: number; data: string };
export type RasterHandle = { rasterize: (doc: ReceiptDoc) => Promise<Raster> };

type Pending = { resolve: (r: Raster) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/**
 * Invisible 1x1 WebView that turns a ReceiptDoc into printer dots. Mounted once, high in the
 * tree, and kept alive: the page is only ready after its first load, so keeping it means the
 * first print of the day is not the slow one.
 */
type RasterBridgeProps = Record<never, never>;

export const RasterBridge = forwardRef<RasterHandle, RasterBridgeProps>(function RasterBridge(_props, ref) {
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
          settle((p) => p.reject(new Error('The receipt renderer did not respond')));
        }, 10000);
        pending.current = { resolve, reject, timer };

        // Every measurement comes from shared, so the page holds the algorithm and none of
        // the numbers.
        const payload = JSON.stringify({
          doc,
          pad: RASTER.pad,
          itemSize: RASTER.itemSize,
          qtyCol: RASTER.qtyCol,
          threshold: RASTER.threshold,
          inkRowHeight: INK_ROW_HEIGHT,
          inkStrokeDots: INK_STROKE_DOTS,
          inkMaxWidth: inkMaxWidth(doc.width),
        });
        web.current?.injectJavaScript('window.__render(' + JSON.stringify(payload) + ');true;');
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
        settle((p) => p.resolve({ width: msg.width as number, height: msg.height as number, data: msg.data as string }));
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
