import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  INK_BLEED, INK_GUTTER, INK_ROW_ADVANCE, INK_STROKE_DOTS, RASTER, type ReceiptDoc,
} from '@shridhar/shared';
import { RASTER_HTML } from './rasterHtml';

export type Raster = { width: number; height: number; data: string };
/** A picture of the slip: the same layout, drawn larger, as a PNG data URL. */
export type RasterImage = { width: number; height: number; image: string };
export type RasterHandle = {
  rasterize: (doc: ReceiptDoc) => Promise<Raster>;
  imageOf: (doc: ReceiptDoc, scale?: number) => Promise<RasterImage>;
};

type Reply = Raster | RasterImage;
type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

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

  /** One request, whether the answer wanted is dots or a picture. */
  const render = useCallback(
    (doc: ReceiptDoc, imageScale?: number) =>
      new Promise<Reply>((resolve, reject) => {
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
          inkRowAdvance: INK_ROW_ADVANCE,
          inkStrokeDots: INK_STROKE_DOTS,
          inkGutter: INK_GUTTER,
          inkBleed: INK_BLEED,
          ...(imageScale ? { imageScale } : {}),
        });
        web.current?.injectJavaScript('window.__render(' + JSON.stringify(payload) + ');true;');
      }),
    [settle],
  );

  useImperativeHandle(ref, () => ({
    rasterize: (doc: ReceiptDoc) => render(doc) as Promise<Raster>,
    // Three times the print head's resolution: the same slip, legible on a phone screen rather
    // than the size of a stamp when it lands in a chat.
    imageOf: (doc: ReceiptDoc, scale = 3) => render(doc, scale) as Promise<RasterImage>,
  }));

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: {
        ok?: boolean; ready?: boolean; error?: string;
        width?: number; height?: number; data?: string; image?: string;
      };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.ready) return;
      if (msg.ok && msg.image && msg.width && msg.height) {
        settle((p) => p.resolve({
          width: msg.width as number, height: msg.height as number, image: msg.image as string,
        }));
      } else if (msg.ok && msg.data && msg.width && msg.height) {
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
