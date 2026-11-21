import { PDF_PAGE_SCRIPT } from '@shridhar/shared';
import { RASTER_HTML } from './rasterHtml';

/**
 * The bill-as-PDF drawing, added to the receipt WebView's page beside the rasteriser (which it
 * leaves alone: the printer parity tests run that script on its own).
 *
 * Call window.__pdf(jsonString) with { pages, k, font }; it replies through postMessage with
 * { ok, pages: [{ w, h, jpeg }] }, jpeg being base64 without the data: prefix.
 */
const PDF_GLUE = `
(function () {
  function post(o) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o));
  }
  window.__pdf = function (json) {
    try {
      var p = JSON.parse(json);
      var out = [];
      for (var i = 0; i < p.pages.length; i++) {
        var pg = p.pages[i];
        var c = document.createElement('canvas');
        c.width = Math.round(pg.w * p.k);
        c.height = Math.round(pg.h * p.k);
        drawPdfPage(c.getContext('2d'), pg, p.k, p.font);
        out.push({ w: c.width, h: c.height, jpeg: c.toDataURL('image/jpeg', 0.85).replace(/^data:image\\/jpeg;base64,/, '') });
      }
      post({ ok: true, pages: out });
    } catch (e) {
      post({ ok: false, error: String((e && e.message) || e) });
    }
  };
})();
`;

export const RENDER_HTML = RASTER_HTML.replace(
  '</body>',
  '<script>' + PDF_PAGE_SCRIPT + PDF_GLUE + '</script></body>',
);
