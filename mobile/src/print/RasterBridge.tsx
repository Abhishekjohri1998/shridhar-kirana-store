import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  PDF_DRAW_SCALE, PDF_FONT, rasterNumbers, type PdfPage, type ReceiptDoc,
} from '@shridhar/shared';
import { RENDER_HTML } from './pdfHtml';

export type Raster = { width: number; height: number; data: string };
/** A picture of the slip: the same layout, drawn larger, as a PNG data URL. */
export type RasterImage = { width: number; height: number; image: string };
/** One page of the bill-as-PDF, drawn: base64 JPEG and its size in pixels. */
export type PdfPageImage = { w: number; h: number; jpeg: string };
export type RasterHandle = {
  rasterize: (doc: ReceiptDoc) => Promise<Raster>;
  imageOf: (doc: ReceiptDoc, scale?: number) => Promise<RasterImage>;
  /** The bill's A4 pages (billPdfPages) drawn, for pdfFromJpegs. */
  pdfPages: (pages: PdfPage[]) => Promise<PdfPageImage[]>;
};

type Reply = Raster | RasterImage | PdfPageImage[];
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
          ...rasterNumbers(),
          ...(imageScale ? { imageScale } : {}),
        });
        web.current?.injectJavaScript('window.__render(' + JSON.stringify(payload) + ');true;');
      }),
    [settle],
  );

  /** The PDF's pages, through the same one-at-a-time request slot. */
  const drawPages = useCallback(
    (pages: PdfPage[]) =>
      new Promise<Reply>((resolve, reject) => {
        if (pending.current) {
          reject(new Error('Still rendering the previous receipt'));
          return;
        }
        // A long bill is several A4 pages: more time than one slip.
        const timer = setTimeout(() => {
          settle((p) => p.reject(new Error('The receipt renderer did not respond')));
        }, 30000);
        pending.current = { resolve, reject, timer };
        const payload = JSON.stringify({ pages, k: PDF_DRAW_SCALE, font: PDF_FONT });
        web.current?.injectJavaScript('window.__pdf(' + JSON.stringify(payload) + ');true;');
      }),
    [settle],
  );

  useImperativeHandle(ref, () => ({
    pdfPages: (pages: PdfPage[]) => drawPages(pages) as Promise<PdfPageImage[]>,
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
        pages?: PdfPageImage[];
      };
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.ready) return;
      if (msg.ok && Array.isArray(msg.pages)) {
        const pages = msg.pages;
        settle((p) => p.resolve(pages));
      } else if (msg.ok && msg.image && msg.width && msg.height) {
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
      source={{ html: RENDER_HTML }}
      originWhitelist={['*']}
      javaScriptEnabled
      onMessage={onMessage}
      style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
    />
  );
});
