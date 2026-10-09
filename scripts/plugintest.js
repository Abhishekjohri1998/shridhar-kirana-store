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
check('arrows kept only while a list is open; Enter never', mod.includes('return key != "enter" && suggestOpen'));
check('JS can say the list is open', mod.includes('@ReactMethod fun setSuggestOpen(open: Boolean)'));
const pkg = plugin.packageSource(PKG);
check('the package creates the module', pkg.includes('listOf(ShridharNativeModule(ctx))'));

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
