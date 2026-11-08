import { useMemo } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { C, R } from '../theme';

/**
 * A button that opens Android's own file picker and hands back the chosen file's text.
 *
 * The app has no document picker of its own and takes on no new native module for one: the
 * WebView it already carries (Stock, the raster printer) answers an HTML file input with the
 * system picker, and reads the file there. The text comes back over postMessage as
 * `F<name>\n<text>` -- one prefix and no second layer of JSON escaping over a file that is JSON
 * already -- or `E` when the file could not be read.
 */
export function BackupPicker({
  label, onPicked, onError, disabled,
}: {
  label: string;
  onPicked: (file: { name: string; text: string }) => void;
  onError: () => void;
  disabled?: boolean;
}) {
  const html = useMemo(() => pickerHtml(label), [label]);

  const onMessage = (e: WebViewMessageEvent) => {
    const data = e.nativeEvent.data;
    if (!data || data[0] !== 'F') {
      onError();
      return;
    }
    const cut = data.indexOf('\n');
    if (cut < 0) {
      onError();
      return;
    }
    onPicked({ name: data.slice(1, cut), text: data.slice(cut + 1) });
  };

  return (
    <View style={{ height: 56, opacity: disabled ? 0.5 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

function pickerHtml(label: string): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">'
    + '<style>html,body{margin:0;padding:0;background:transparent;font-family:sans-serif}'
    + 'label{display:block;box-sizing:border-box;height:52px;line-height:50px;margin:2px 0;border-radius:' + R.md + 'px;'
    + 'border:1px solid ' + C.lineStrong + ';background:' + C.card + ';color:' + C.ink + ';'
    + 'text-align:center;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'input{display:none}</style></head><body>'
    + '<label>' + escapeHtml(label) + '<input id="f" type="file"></label>'
    + '<script>document.getElementById("f").addEventListener("change",function(e){'
    + 'var f=e.target.files&&e.target.files[0];if(!f)return;var r=new FileReader();'
    + 'r.onload=function(){window.ReactNativeWebView.postMessage("F"+String(f.name).replace(/\\n/g," ")+"\\n"+String(r.result));e.target.value="";};'
    + 'r.onerror=function(){window.ReactNativeWebView.postMessage("E");e.target.value="";};'
    + 'r.readAsText(f);});</script></body></html>';
}
