/**
 * The receipt rasteriser that runs inside a hidden WebView.
 *
 * A phone has no canvas outside a WebView, and a canvas is exactly what is needed: cheap ESC/POS
 * printers carry code pages for Latin, Cyrillic and CJK and none of them can render Kannada as
 * text, so the receipt has to be drawn and sent as dots. Android's own Noto Sans Kannada does the
 * shaping; handwriting is replayed as pen paths on the same canvas.
 *
 * Every measurement this page needs is handed to it in the payload -- row height, stroke weight,
 * the ink width cap -- so the numbers live once, in @shridhar/shared, and only the drawing
 * algorithm is here. `npm run rastertest` runs this exact script against a fake canvas in Node and
 * checks it produces the same dots as the web app's rasteriser for the same receipt.
 *
 * Call window.__render(jsonString); it replies through window.ReactNativeWebView.postMessage with
 * { ok, width, height, data } where data is base64 packed bits, MSB first, 1 = black.
 */
export const RASTER_SCRIPT = `
(function () {
  var FONT = '"Noto Sans Kannada","Noto Serif Kannada","Noto Sans",sans-serif';

  function post(o) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o));
  }
  function font(size, bold) { return (bold ? 'bold ' : '') + size + 'px ' + FONT; }
  function lh(size) { return Math.round(size * 1.5); }

  function b64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  var VIRAMA = /[\\u094D\\u09CD\\u0A4D\\u0ACD\\u0B4D\\u0BCD\\u0C4D\\u0CCD\\u0D4D]$/;

  /* Pieces that are safe to break between: never starting with a combining mark, and never
     splitting a consonant conjunct, because a cluster ending in a virama joins the next one. */
  function breakUnits(text) {
    var raw;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      raw = [];
      var it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
      for (var seg of it) raw.push(seg.segment);
    } else {
      raw = text.match(/[\\s\\S]/gu) || [];
    }
    var out = [], pending = '';
    for (var i = 0; i < raw.length; i++) {
      pending += raw[i];
      if (VIRAMA.test(pending)) continue;
      out.push(pending);
      pending = '';
    }
    if (pending) out.push(pending);
    return out;
  }

  var meas = document.createElement('canvas').getContext('2d');

  function wrap(text, size, bold, maxW) {
    meas.font = font(size, bold);
    var words = String(text == null ? '' : text).split(/\\s+/).filter(function (w) { return w.length; });
    if (!words.length) return [''];

    var lines = [], cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var t = cur + ' ' + words[i];
      if (meas.measureText(t).width <= maxW) cur = t;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);

    var out = [];
    for (var j = 0; j < lines.length; j++) {
      var rest = lines[j];
      while (meas.measureText(rest).width > maxW) {
        var units = breakUnits(rest), head = '';
        for (var k = 0; k < units.length; k++) {
          var candidate = head + units[k];
          if (meas.measureText(candidate).width > maxW) break;
          head = candidate;
        }
        if (!head || head === rest) break;
        out.push(head);
        rest = rest.slice(head.length);
      }
      out.push(rest);
    }
    return out;
  }

  function inkBounds(ink) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var s = 0; s < ink.strokes.length; s++) {
      var st = ink.strokes[s];
      for (var i = 0; i + 1 < st.length; i += 2) {
        if (st[i] < minX) minX = st[i];
        if (st[i] > maxX) maxX = st[i];
        if (st[i + 1] < minY) minY = st[i + 1];
        if (st[i + 1] > maxY) maxY = st[i + 1];
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: ink.w, maxY: ink.h };
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  // scale and originY arrive on the row, worked out across every line on the slip at once, so
  // this must not fit the writing itself -- doing that is what made short words print large.
  function drawInk(ctx, ink, x, y, scale, originY, strokeDots) {
    var box = inkBounds(ink);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-box.minX, -originY);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = strokeDots / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var s = 0; s < ink.strokes.length; s++) {
      var st = ink.strokes[s];
      if (st.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(st[0], st[1]);
      // Same midpoint-quadratic smoothing as the counter PC. scripts/rastertest.js proves the two
      // agree dot for dot, so this has to change on both sides at once or not at all.
      var n = st.length / 2;
      if (n === 1) {
        ctx.lineTo(st[0] + 0.01, st[1]);
      } else if (n === 2) {
        ctx.lineTo(st[2], st[3]);
      } else {
        for (var i = 1; i < n - 1; i++) {
          var cx = st[i * 2], cy = st[i * 2 + 1];
          var mx = (cx + st[(i + 1) * 2]) / 2, my = (cy + st[(i + 1) * 2 + 1]) / 2;
          ctx.quadraticCurveTo(cx, cy, mx, my);
        }
        ctx.lineTo(st[(n - 1) * 2], st[(n - 1) * 2 + 1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  window.__render = function (json) {
    try {
      var payload = JSON.parse(json);
      var doc = payload.doc;
      var PAD = payload.pad;
      var ITEM = payload.itemSize;
      var QTY_COL = payload.qtyCol;
      var THRESHOLD = payload.threshold;
      var INK_H = payload.inkRowAdvance;
      var INK_GUTTER = payload.inkGutter;
      var INK_BLEED = payload.inkBleed;
      var INK_S = payload.inkStrokeDots;
      var W = doc.width;

      var ops = [], y = 0, i, n;

      for (var r = 0; r < doc.rows.length; r++) {
        var row = doc.rows[r];

        if (row.t === 'space') { y += row.h; continue; }

        if (row.t === 'sep') { y += 6; ops.push({ op: 'dash', y: y }); y += 10; continue; }

        if (row.t === 'center') {
          var cs = row.size || 22;
          var cl = wrap(row.text, cs, !!row.bold, W - 2 * PAD);
          for (i = 0; i < cl.length; i++) {
            ops.push({ op: 'text', text: cl[i], x: W / 2, y: y, size: cs, bold: !!row.bold, align: 'center' });
            y += lh(cs);
          }
          continue;
        }

        if (row.t === 'kv') {
          var ks = row.size || 22;
          ops.push({ op: 'text', text: row.left, x: PAD, y: y, size: ks, bold: !!row.bold, align: 'left' });
          ops.push({ op: 'text', text: row.right, x: W - PAD, y: y, size: ks, bold: !!row.bold, align: 'right' });
          y += lh(ks);
          continue;
        }

        meas.font = font(ITEM, false);
        var amtW = meas.measureText(row.amount).width;
        // The gutter belongs to the whole description column, not to the handwriting alone.
        // The gutter belongs to the whole description column, not to the handwriting alone:
        // indent only the ink and a typed line like "Old bal." would sit a millimetre left of it.
        var nameX = PAD + QTY_COL + INK_GUTTER;
        var nameMax = Math.max(40, (W - PAD - amtW - 12) - nameX);
        ops.push({ op: 'text', text: row.no, x: PAD, y: y, size: ITEM, bold: false, align: 'left' });
        ops.push({ op: 'text', text: row.amount, x: W - PAD, y: y, size: ITEM, bold: false, align: 'right' });

        if (row.t === 'ink') {
          // Shifted by the pen's overhang so its painted edge lands on the column, not half
          // outside it. The width cap is already in row.scale, from planInk.
          ops.push({
            op: 'ink', ink: row.ink, x: nameX + INK_BLEED, y: y + INK_BLEED,
            scale: row.scale, originY: row.originY
          });
          // A shared scale means nothing overruns the row.
          y += INK_H;
          if (row.note) {
            ops.push({ op: 'text', text: row.note, x: nameX, y: y, size: 18, bold: false, align: 'left' });
            y += lh(18);
          }
          y += 4;
          continue;
        }

        var nl = wrap(row.name, ITEM, false, nameMax);
        for (n = 0; n < nl.length; n++) {
          ops.push({ op: 'text', text: nl[n], x: nameX, y: y, size: ITEM, bold: false, align: 'left' });
          y += lh(ITEM);
        }
        if (row.note) {
          ops.push({ op: 'text', text: row.note, x: nameX, y: y, size: 18, bold: false, align: 'left' });
          y += lh(18);
        }
        y += 4;
      }

      var H = Math.max(1, Math.ceil(y));
      /*
       * imageScale asks for a picture of the slip instead of printer dots -- the same layout,
       * the same ops, drawn larger so it is legible on a phone rather than a print head. One
       * multiplier on the whole context, so nothing below has to know which of the two it is
       * producing, and the dot path is untouched at scale 1.
       */
      var SCALE = payload.imageScale || 1;
      var c = document.createElement('canvas');
      c.width = W * SCALE; c.height = H * SCALE;
      var ctx = c.getContext('2d');
      if (SCALE !== 1) ctx.scale(SCALE, SCALE);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';

      for (i = 0; i < ops.length; i++) {
        var o = ops[i];
        if (o.op === 'dash') {
          for (var x = PAD; x < W - PAD; x += 8) ctx.fillRect(x, o.y, 4, 2);
        } else if (o.op === 'ink') {
          drawInk(ctx, o.ink, o.x, o.y, o.scale, o.originY, INK_S);
        } else {
          ctx.font = font(o.size, o.bold);
          ctx.textAlign = o.align;
          ctx.fillText(o.text, o.x, o.y);
        }
      }

      // A picture to share, rather than dots to print. Asked for separately so the printing path
      // below never changes shape -- and so the parity test, which only ever asks for dots, keeps
      // comparing exactly what the printer gets.
      if (payload.imageScale) {
        post({ ok: true, width: c.width, height: c.height, image: c.toDataURL('image/png') });
        return;
      }

      var px = ctx.getImageData(0, 0, W, H).data;
      var bpr = Math.ceil(W / 8);
      var bits = new Uint8Array(bpr * H);
      for (var yy = 0; yy < H; yy++) {
        for (var xx = 0; xx < W; xx++) {
          var p = (yy * W + xx) * 4;
          var lum = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
          if (px[p + 3] > 32 && lum < THRESHOLD) bits[yy * bpr + (xx >> 3)] |= (0x80 >> (xx & 7));
        }
      }

      post({ ok: true, width: W, height: H, data: b64(bits) });
    } catch (e) {
      post({ ok: false, error: String((e && e.message) || e) });
    }
  };

  post({ ok: true, ready: true });
})();
`;

export const RASTER_HTML =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>html,body{margin:0;padding:0;background:#fff}</style></head><body>' +
  '<script>' + RASTER_SCRIPT + '</script></body></html>';
