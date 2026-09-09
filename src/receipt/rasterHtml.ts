/**
 * Cheap 58mm ESC/POS printers carry code pages for Latin, Cyrillic and CJK -- none of them can
 * render Kannada as text. So we don't send text at all: we draw the whole receipt onto a canvas
 * (where Android's own Noto Sans Kannada does the shaping correctly), threshold it to 1 bit per
 * dot, and send it as an ESC/POS raster image. Same trick every Indic-language POS app uses.
 *
 * This page runs inside a hidden WebView. Call window.__render(jsonString); it replies through
 * window.ReactNativeWebView.postMessage with { ok, width, height, data } where data is base64
 * packed bits, MSB first, 1 = black dot.
 */
export const RASTER_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:#fff}</style></head>
<body><script>
(function(){
  var FONT = '"Noto Sans Kannada","Noto Serif Kannada","Noto Sans",sans-serif';
  var PAD = 4;
  var ITEM = 24;

  function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function font(size, bold){ return (bold ? 'bold ' : '') + size + 'px ' + FONT; }
  function lh(size){ return Math.round(size * 1.5); }

  function b64(u8){
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }

  var meas = document.createElement('canvas').getContext('2d');

  function wrapText(text, size, bold, maxW){
    meas.font = font(size, bold);
    var words = String(text == null ? '' : text).split(/\s+/).filter(function(w){ return w.length; });
    if (!words.length) return [''];
    var lines = [], cur = words[0];
    for (var i = 1; i < words.length; i++){
      var t = cur + ' ' + words[i];
      if (meas.measureText(t).width <= maxW) cur = t; else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    var out = [];
    for (var j = 0; j < lines.length; j++){
      var s = lines[j];
      while (meas.measureText(s).width > maxW && s.length > 1){
        var k = s.length;
        while (k > 1 && meas.measureText(s.slice(0, k)).width > maxW) k--;
        out.push(s.slice(0, k));
        s = s.slice(k);
      }
      out.push(s);
    }
    return out;
  }

  window.__render = function(json){
    try {
      var doc = JSON.parse(json);
      var W = doc.width || 384;
      var ops = [], y = 0, i, n;

      for (var r = 0; r < doc.rows.length; r++){
        var row = doc.rows[r];

        if (row.t === 'space'){ y += row.h; continue; }

        if (row.t === 'sep'){
          y += 6; ops.push({ op: 'dash', y: y }); y += 10; continue;
        }

        if (row.t === 'center'){
          var cs = row.size || 22;
          var cl = wrapText(row.text, cs, !!row.bold, W - 2 * PAD);
          for (i = 0; i < cl.length; i++){
            ops.push({ op: 'text', text: cl[i], x: W / 2, y: y, size: cs, bold: !!row.bold, align: 'center' });
            y += lh(cs);
          }
          continue;
        }

        if (row.t === 'kv'){
          var ks = row.size || 22;
          ops.push({ op: 'text', text: row.left, x: PAD, y: y, size: ks, bold: !!row.bold, align: 'left' });
          ops.push({ op: 'text', text: row.right, x: W - PAD, y: y, size: ks, bold: !!row.bold, align: 'right' });
          y += lh(ks);
          continue;
        }

        if (row.t === 'item'){
          meas.font = font(ITEM, false);
          var amtW = meas.measureText(row.amount).width;
          var nameX = PAD + 44;
          var nameMax = Math.max(40, (W - PAD - amtW - 12) - nameX);
          var nl = wrapText(row.name, ITEM, false, nameMax);
          ops.push({ op: 'text', text: row.qty, x: PAD, y: y, size: ITEM, bold: false, align: 'left' });
          ops.push({ op: 'text', text: row.amount, x: W - PAD, y: y, size: ITEM, bold: false, align: 'right' });
          for (n = 0; n < nl.length; n++){
            ops.push({ op: 'text', text: nl[n], x: nameX, y: y, size: ITEM, bold: false, align: 'left' });
            y += lh(ITEM);
          }
          if (row.note){
            ops.push({ op: 'text', text: row.note, x: nameX, y: y, size: 18, bold: false, align: 'left' });
            y += lh(18);
          }
          y += 4;
          continue;
        }
      }

      var H = Math.max(1, Math.ceil(y));
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';

      for (i = 0; i < ops.length; i++){
        var o = ops[i];
        if (o.op === 'dash'){
          for (var x = PAD; x < W - PAD; x += 8) ctx.fillRect(x, o.y, 4, 2);
        } else {
          ctx.font = font(o.size, o.bold);
          ctx.textAlign = o.align;
          ctx.fillText(o.text, o.x, o.y);
        }
      }

      var px = ctx.getImageData(0, 0, W, H).data;
      var bpr = Math.ceil(W / 8);
      var bits = new Uint8Array(bpr * H);
      for (var yy = 0; yy < H; yy++){
        for (var xx = 0; xx < W; xx++){
          var p = (yy * W + xx) * 4;
          var lum = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
          if (px[p + 3] > 32 && lum < 170) bits[yy * bpr + (xx >> 3)] |= (0x80 >> (xx & 7));
        }
      }

      post({ ok: true, width: W, height: H, data: b64(bits) });
    } catch (e){
      post({ ok: false, error: String((e && e.message) || e) });
    }
  };

  post({ ok: true, ready: true });
})();
</script></body></html>`;
