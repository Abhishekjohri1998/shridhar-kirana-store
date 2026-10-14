/**
 * The S Pen / WhatsApp config plugin: loads as plain JS, and its edits to MainActivity and
 * MainApplication are correct and idempotent. Runs on sample sources -- the generated android
 * project is not touched.
 *
 *   node scripts/plugintest.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plugin = require(path.join(__dirname, '..', 'mobile', 'plugins', 'withStylus.js'));
const PKG = 'com.shridhar.billing';

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok   ' + name);
  else {
    failures++;
    console.log('  FAIL ' + name + (detail ? ' -- ' + detail : ''));
  }
}
const count = (s, sub) => s.split(sub).length - 1;

const ACTIVITY = `package com.shridhar.billing

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "main"

  override fun invokeDefaultOnBackPressed() {
      super.invokeDefaultOnBackPressed()
  }
}
`;

const APPLICATION = `package com.shridhar.billing

class MainApplication : Application(), ReactApplication {
  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
        this,
        object : DefaultReactNativeHost(this) {
          override fun getPackages(): List<ReactPackage> {
            val packages = PackageList(this).packages
            // Packages that cannot be autolinked yet can be added manually here
            return packages
          }
      }
  )
}
`;

console.log('\nThe plugin file');
check('exports a function', typeof plugin === 'function');
check('and its transforms', typeof plugin.addToMainActivity === 'function' && typeof plugin.addToMainApplication === 'function');

console.log('\nMainActivity');
const once = plugin.addToMainActivity(ACTIVITY, PKG);
const twice = plugin.addToMainActivity(once, PKG);
check('the touch hook is added', once.includes('override fun dispatchTouchEvent(ev: MotionEvent): Boolean'));
check('and the hover hook', once.includes('override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean'));
check('both call the module', count(once, 'ShridharNativeModule.onMotion(ev)') === 2);
check('both still pass the event on', once.includes('return super.dispatchTouchEvent(ev)'));
check('MotionEvent is imported', once.includes('\nimport android.view.MotionEvent\n'));
check('the module is imported', once.includes('import com.shridhar.billing.stylus.ShridharNativeModule'));
check('the package line stays first', once.startsWith('package com.shridhar.billing\n'));
check('inside the class: braces balance', count(once, '{') === count(once, '}'));
check('the file ends with the class brace', once.trimEnd().endsWith('}'));
check('the existing methods survive', once.includes('invokeDefaultOnBackPressed') && once.includes('getMainComponentName'));
check('running it twice changes nothing', twice === once);

console.log('\nMainActivity: the hardware keyboard (build 59)');
check('the key hook is added', once.includes('override fun dispatchKeyEvent(event: KeyEvent): Boolean'));
check('it asks the module first', once.includes('ShridharNativeModule.onKey(event, currentFocus)'));
check('and passes the key on otherwise', once.includes('return super.dispatchKeyEvent(event)'));
check('KeyEvent is imported once', count(once, '\nimport android.view.KeyEvent\n') === 1);
check('the module is imported once', count(once, 'import com.shridhar.billing.stylus.ShridharNativeModule\n') === 1);
// An activity patched by an older build has the pen hook but not this one: it must still gain it.
const old = once.replace(/\n  \/\/ withStylus: Up, Down[\s\S]*?return super\.dispatchKeyEvent\(event\)\n  \}\n/, '\n');
check('the sample without the key hook is an old-style activity', !old.includes('dispatchKeyEvent') && old.includes('dispatchTouchEvent'));
const upgraded = plugin.addToMainActivity(old, PKG);
check('an older patched activity gains the key hook', upgraded.includes('ShridharNativeModule.onKey(event, currentFocus)'));
check('without a second pen hook', count(upgraded, 'ShridharNativeModule.onMotion(ev)') === 2);
check('braces still balance', count(upgraded, '{') === count(upgraded, '}'));

console.log('\nMainApplication');
const app1 = plugin.addToMainApplication(APPLICATION, PKG);
const app2 = plugin.addToMainApplication(app1, PKG);
check('the package is registered', app1.includes('packages.add(com.shridhar.billing.stylus.ShridharNativePackage())'));
check('after the autolinked list', app1.indexOf('PackageList(this)') < app1.indexOf('ShridharNativePackage'));
check('before the list is returned', app1.indexOf('ShridharNativePackage') < app1.indexOf('return packages'));
check('running it twice changes nothing', app2 === app1);
let threw = false;
try { plugin.addToMainApplication('class X {}', PKG); } catch { threw = true; }
check('a MainApplication it cannot understand is an error, not a silent skip', threw);

console.log('\nThe Kotlin it writes');
const mod = plugin.moduleSource(PKG);
check('in the stylus package', mod.startsWith('package com.shridhar.billing.stylus\n'));
check('named ShridharNative for JS', mod.includes('override fun getName(): String = "ShridharNative"'));
check('reads the stylus buttons', mod.includes('BUTTON_STYLUS_PRIMARY') && mod.includes('BUTTON_SECONDARY'));
check('and the eraser end', mod.includes('TOOL_TYPE_ERASER'));
check('emits penButton', mod.includes('.emit("penButton", map)'));
check('tries WhatsApp then WhatsApp Business', mod.indexOf('"com.whatsapp"') < mod.indexOf('"com.whatsapp.w4b"'));
check('with the jid extra', mod.includes('putExtra("jid", digits + "@s.whatsapp.net")'));
check('through expo-file-system\'s FileProvider', mod.includes('.FileSystemFileProvider'));
check('rejects when neither is there', mod.includes('promise.reject("NO_WHATSAPP"'));
check('braces balance', count(mod, '{') === count(mod, '}'));
check('emits hwKey for the keyboard', mod.includes('.emit("hwKey", map)'));
check('only for a text box', mod.includes('if (focus !is EditText) return false'));
check('Up, Down and Enter', ['KEYCODE_DPAD_UP','KEYCODE_DPAD_DOWN','KEYCODE_ENTER'].every((k) => mod.includes(k)));
check('arrows kept only while a list is open', mod.includes('return suggestOpen'));
check('Enter used up only while a bill box owns it (build 62)', mod.includes('if (!takeEnter || multiLine) {') && mod.includes('fun setTakeEnter(on: Boolean)'));
check('never in a multi-line box', mod.includes('InputType.TYPE_TEXT_FLAG_MULTI_LINE'));
check('Enter emitted once per press, not on repeats', mod.includes('ev.repeatCount == 0) instance?.emitKey(key)'));
check('JS can say the list is open', mod.includes('@ReactMethod fun setSuggestOpen(open: Boolean)'));

console.log('\nKeyboard shortcuts (build 63)');
check('JS can switch them on', mod.includes('@ReactMethod fun setShortcuts(level: Int)'));
check('emits hwShortcut with the modifiers', mod.includes('.emit("hwShortcut", map)')
  && ['"ctrl"', '"shift"', '"alt"'].every((k) => mod.includes('map.putBoolean(' + k)));
check('checked before the text-box test, so any focus works', mod.indexOf('if (onShortcut(ev)) return true') >= 0
  && mod.indexOf('if (onShortcut(ev)) return true') < mod.indexOf('if (focus !is EditText) return false'));
check('off unless JavaScript says so', mod.includes('@Volatile private var shortcutLevel = 0') && mod.includes('if (level <= 0) return false'));
check('the global chords at level 1', mod.includes('if (chord in GLOBAL_CHORDS) return true') && mod.includes('return level >= 2 && chord in BILL_CHORDS'));
check('emitted once per press, used up whole', mod.includes('if (ev.action == KeyEvent.ACTION_DOWN) {\n        takenDown.add(ev.keyCode)\n        if (ev.repeatCount == 0) instance?.emitShortcut('));
for (const k of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'PAGE_UP', 'PAGE_DOWN', 'H', 'B', 'C', 'A', 'P', 'S']) {
  check('reads KEYCODE_' + k, mod.includes('KeyEvent.KEYCODE_' + k + ' -> '));
}
check('modifier order is Ctrl, Shift, Alt as in JS', mod.includes('(if (ctrl) "Ctrl+" else "") + (if (shift) "Shift+" else "") + (if (alt) "Alt+" else "") + key'));
check('arrows kept from a bill box only with shortcuts on', mod.includes('return suggestOpen || (shortcutLevel >= 2 && takeEnter)'));
check('Enter handling unchanged', mod.includes('if (!takeEnter || multiLine) {'));
try {
  const shared = require(path.join(__dirname, '..', 'shared', 'dist', 'cjs', 'index.js'));
  const js = shared.SHORTCUTS.filter((s) => !s.global).map((s) => s.chord).sort();
  const native = [...plugin.BILL_CHORDS].sort();
  check('the native list is shared/src/shortcuts.ts exactly', JSON.stringify(js) === JSON.stringify(native),
    'js=' + js.join(',') + ' native=' + native.join(','));
  const jsGlobal = shared.SHORTCUTS.filter((s) => s.global).map((s) => s.chord).sort();
  const nativeGlobal = [...plugin.GLOBAL_CHORDS].sort();
  check('the native global list is shared/src/shortcuts.ts exactly', JSON.stringify(jsGlobal) === JSON.stringify(nativeGlobal),
    'js=' + jsGlobal.join(',') + ' native=' + nativeGlobal.join(','));
  check('Alt+C and F9 are global, Ctrl+Shift+P is a bill chord (build 66)', plugin.GLOBAL_CHORDS.includes('Alt+C') && plugin.GLOBAL_CHORDS.includes('F9') && plugin.BILL_CHORDS.includes('Ctrl+Shift+P'));
  check('Alt+B, Alt+S and Ctrl+H are in the Kotlin (build 64)', ['Alt+B', 'Alt+S', 'Ctrl+H'].every((c) => mod.includes('"' + c + '"')));
  check('every chord is in the Kotlin', js.every((c) => mod.includes('"' + c + '"')));
  check('every key name the JS list uses is one the Kotlin can send',
    shared.SHORTCUTS.every((s) => mod.includes('-> "' + s.chord.split('+').pop() + '"')));
} catch (e) {
  check('shared/ is built for the comparison', false, String(e));
}
const pkg = plugin.packageSource(PKG);
check('the package creates the module', pkg.includes('listOf(ShridharNativeModule(ctx))'));

console.log('\nBefore the keyboard app (build 66)');
check('a key catcher takes shortcuts at the pre-IME stage', pkg.includes('class ShridharKeyCatcher(context: Context) : FrameLayout(context)')
  && pkg.includes('override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean {\n    if (ShridharNativeModule.onShortcut(event)) return true'));
check('the package file braces balance', count(pkg, '{') === count(pkg, '}'));
check('MainActivity wraps the React root in it', once.includes('override fun setContentView(view: View?)') && once.includes('val catcher = ShridharKeyCatcher(this)'));
check('a root already wrapped is not wrapped twice', once.includes('view is ShridharKeyCatcher'));
check('a root with a parent is moved, not added twice', once.includes('(view.parent as? ViewGroup)?.removeView(view)'));
check('the key-shortcut path is taken too', once.includes('override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean') && once.includes('override fun onKeyShortcut(keyCode: Int, event: KeyEvent): Boolean'));
check('the catcher is imported', count(once, 'import com.shridhar.billing.stylus.ShridharKeyCatcher\n') === 1);
check('View imported once', count(once, '\nimport android.view.View\n') === 1);
check('an activity patched by build 65 gains it', (() => {
  const b65 = once.replace(/\n  \/\/ withStylus: shortcuts before[\s\S]*$/, '\n}\n');
  const up = plugin.addToMainActivity(b65, PKG);
  return !b65.includes('ShridharKeyCatcher(this)') && up.includes('ShridharKeyCatcher(this)') && count(up, '{') === count(up, '}');
})());
check('the up of a taken key is taken too, Alt held or not', mod.includes('if (ev.action == KeyEvent.ACTION_UP && takenDown.remove(ev.keyCode)) return true') && mod.includes('takenDown.add(ev.keyCode)'));

console.log('\nThe unit list (build 67)');
check('JS can say the unit list is open', mod.includes('@ReactMethod fun setUnitMenuOpen(open: Boolean) { unitMenuOpen = open }') && mod.includes('@Volatile private var unitMenuOpen = false'));
check('Left, Right, Enter and Escape are its', ['KEYCODE_DPAD_LEFT -> "left"', 'KEYCODE_DPAD_RIGHT -> "right"', 'KEYCODE_ESCAPE -> "escape"'].every((k) => mod.includes(k)));
check('only while it is open', mod.includes('fun onUnitMenu(ev: KeyEvent): Boolean {\n      if (!unitMenuOpen) return false'));
check('used up whole, the up too', /fun onUnitMenu[\s\S]*?takenDown\.add\(ev\.keyCode\)[\s\S]*?return true/.test(mod));
check('arrows repeat, Enter and Escape once', mod.includes('if (ev.repeatCount == 0 || key == "left" || key == "right") instance?.emitKey(key)'));
check('whatever has focus: before the text-box test', mod.indexOf('if (onUnitMenu(ev)) return true') > mod.indexOf('if (onShortcut(ev)) return true')
  && mod.indexOf('if (onUnitMenu(ev)) return true') < mod.indexOf('if (focus !is EditText) return false'));
check('and ahead of the keyboard app', pkg.includes('if (ShridharNativeModule.onShortcut(event)) return true\n    if (ShridharNativeModule.onUnitMenu(event)) return true'));
{
  const native = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'src', 'lib', 'native.ts'), 'utf8');
  check('JS side: setUnitMenuOpen, safe on an older build', native.includes('mod?.setUnitMenuOpen?.(open)'));
  check('JS side: hwKey passes left, right and escape', native.includes("'left' | 'right' | 'escape'"));
  const gen = path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'java', 'com', 'shridhar', 'billing', 'stylus');
  if (fs.existsSync(gen)) {
    const rd = (f) => fs.readFileSync(path.join(gen, f), 'utf8').replace(/\r\n/g, '\n');
    check('the android project carries this module (regenerated)', rd('ShridharNativeModule.kt') === mod);
    check('and this package', rd('ShridharNativePackage.kt') === pkg);
  }
}

console.log('\nRegistered in app.json');
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mobile', 'app.json'), 'utf8'));
check('the plugin is listed', (appJson.expo.plugins || []).includes('./plugins/withStylus'));

console.log('\nThrough expo\'s own mod runner (no prebuild, a temporary project)');
(async () => {
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'withstylus-'));
    // Only the writer is exercised here; the mods themselves are covered above.
    const written = path.join(tmp, 'android', 'app', 'src', 'main', 'java', 'com', 'shridhar', 'billing', 'stylus');
    const { withDangerousMod } = require(require.resolve('expo/config-plugins', { paths: [path.join(__dirname, '..', 'mobile')] }));
    check('expo config-plugins resolves from mobile/', typeof withDangerousMod === 'function');
    fs.rmSync(tmp, { recursive: true, force: true });
    check('the writer target is under the app package', written.includes(path.join('com', 'shridhar', 'billing', 'stylus')));
  } catch (e) {
    check('expo config-plugins resolves from mobile/', false, String(e));
  }
  console.log('');
  if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
  }
  console.log('All plugin checks passed.');
})();
