/**
 * Expo config plugin: the S Pen button, and opening WhatsApp straight into a customer's chat.
 *
 * Kept in the repo with no npm dependency of its own (it uses expo's bundled config-plugins).
 * `expo prebuild` runs it, so the APK build picks it up. It does three things to the generated
 * android project, each idempotent -- running it twice changes nothing the second time:
 *
 *  1. Writes a small native module (Kotlin) and a ReactPackage into the app's sources.
 *     - `penButton` events ({down: boolean}) through DeviceEventEmitter, from the stylus button
 *       (BUTTON_STYLUS_PRIMARY / BUTTON_SECONDARY) or the pen's eraser end (TOOL_TYPE_ERASER).
 *       React Native 0.79 on the old architecture never hands `buttons` to JavaScript, which is
 *       why build 47's JS-only attempt could not work.
 *     - `shareToWhatsApp(phone, fileUri, text)`: ACTION_SEND to com.whatsapp, then
 *       com.whatsapp.w4b, with the "jid" extra so the chat opens directly, the picture shared
 *       through expo-file-system's FileProvider. Rejects when neither is installed, so the app
 *       can fall back to the share sheet.
 *  2. Adds to MainActivity a dispatchTouchEvent / dispatchGenericMotionEvent hook that passes
 *     every motion event to the module first.
 *  3. Registers the package in MainApplication.
 *  4. Adds to MainActivity a dispatchKeyEvent hook for a hardware keyboard (build 59): Up, Down
 *     and Enter, while a text box has the cursor, go to JavaScript as `hwKey` events
 *     ({key: 'up' | 'down' | 'enter'}). React Native's TextInput never reports the arrows on
 *     Android. Up and Down are kept from the text box only while JavaScript says a suggestion
 *     list is open (`setSuggestOpen`); Enter always carries on to the box as before.
 */
const fs = require('fs');
const path = require('path');

const MARK = 'ShridharNativeModule.onMotion';
const PKG_MARK = 'ShridharNativePackage()';
const KEY_MARK = 'ShridharNativeModule.onKey';

/** Adds lines just inside the class's closing brace. */
function beforeClassEnd(src, block) {
  const end = src.lastIndexOf('}');
  if (end < 0) throw new Error('withStylus: MainActivity has no class body');
  return src.slice(0, end).replace(/\s*$/, '\n') + block + '}' + src.slice(end + 1);
}

/** The imports a hook needs, each once, under the package line. */
function addImports(src, lines) {
  let out = src;
  for (const line of lines) {
    if (!out.includes(line + '\n')) out = out.replace(/^(package [^\n]+\n)/m, '$1\n' + line + '\n');
  }
  return out;
}

/** MainActivity.kt with the hooks added. Each one is added only when it is not already there. */
function addToMainActivity(src, appPackage) {
  return addKeyHook(addMotionHook(src, appPackage), appPackage);
}

/** The keyboard hook, on its own mark, so an activity patched before build 59 gains it too. */
function addKeyHook(src, appPackage) {
  if (src.includes(KEY_MARK)) return src;
  const out = addImports(src, [
    'import android.view.KeyEvent',
    'import ' + appPackage + '.stylus.ShridharNativeModule',
  ]);
  const hook = [
    '',
    '  // withStylus: Up, Down and Enter from a hardware keyboard, for the suggestion list.',
    '  override fun dispatchKeyEvent(event: KeyEvent): Boolean {',
    '    if (' + KEY_MARK + '(event, currentFocus)) return true',
    '    return super.dispatchKeyEvent(event)',
    '  }',
    '',
  ].join('\n');
  return beforeClassEnd(out, hook);
}

function addMotionHook(src, appPackage) {
  if (src.includes(MARK)) return src;
  let out = src;
  const imports = [
    'import android.view.MotionEvent',
    'import ' + appPackage + '.stylus.ShridharNativeModule',
  ];
  for (const line of imports) {
    if (!out.includes(line)) out = out.replace(/^(package [^\n]+\n)/m,'$1\n' + line + '\n');
  }
  const hook = [
    '',
    '  // withStylus: the pen button and eraser end, read natively and sent to JavaScript.',
    '  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {',
    '    ' + MARK + '(ev)',
    '    return super.dispatchTouchEvent(ev)',
    '  }',
    '',
    '  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {',
    '    ' + MARK + '(ev)',
    '    return super.dispatchGenericMotionEvent(ev)',
    '  }',
    '',
  ].join('\n');
  return beforeClassEnd(out, hook);
}

/** MainApplication.kt with the package registered. Unchanged when it already is. */
function addToMainApplication(src, appPackage) {
  if (src.includes(PKG_MARK)) return src;
  const anchor = /(val packages = PackageList\(this\)\.packages[^\n]*\n)/;
  if (!anchor.test(src)) throw new Error('withStylus: cannot find the package list in MainApplication');
  return src.replace(anchor, '$1            packages.add(' + appPackage + '.stylus.' + PKG_MARK + ')\n');
}

function moduleSource(appPackage) {
  return `package ${appPackage}.stylus

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File

/** Written by mobile/plugins/withStylus.js. Edit the plugin, not this file. */
class ShridharNativeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  init { instance = this }

  override fun getName(): String = "ShridharNative"

  // Required by NativeEventEmitter on the JS side.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  /** JavaScript says whether a suggestion list is showing, so Up and Down belong to it. */
  @ReactMethod fun setSuggestOpen(open: Boolean) { suggestOpen = open }

  @ReactMethod
  fun shareToWhatsApp(phone: String, fileUri: String, text: String, promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "The app is not in front")
      return
    }
    val uri: Uri
    try {
      val parsed = Uri.parse(fileUri)
      val file = File(parsed.path ?: fileUri)
      uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".FileSystemFileProvider", file)
    } catch (e: Exception) {
      promise.reject("NO_FILE", e.message ?: "Cannot share that file")
      return
    }
    val digits = phone.filter { it.isDigit() }
    for (pkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        setPackage(pkg)
        putExtra(Intent.EXTRA_STREAM, uri)
        if (text.isNotEmpty()) putExtra(Intent.EXTRA_TEXT, text)
        if (digits.isNotEmpty()) putExtra("jid", digits + "@s.whatsapp.net")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      try {
        activity.startActivity(intent)
        promise.resolve(pkg)
        return
      } catch (e: ActivityNotFoundException) {
        // Try the next one.
      } catch (e: SecurityException) {
        // Try the next one.
      }
    }
    promise.reject("NO_WHATSAPP", "WhatsApp is not installed")
  }

  private fun emitKey(key: String) {
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putString("key", key)
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("hwKey", map)
  }

  private fun emit(down: Boolean) {
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putBoolean("down", down)
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("penButton", map)
  }

  companion object {
    @Volatile private var instance: ShridharNativeModule? = null
    @Volatile private var held = false
    @Volatile private var suggestOpen = false

    /**
     * Called by MainActivity for every key event. Up, Down and Enter from a hardware keyboard,
     * while a text box has focus, are sent to JavaScript on the way down. Returns true -- the
     * key is used up -- only for Up and Down while a suggestion list is open; everything else
     * goes on to the app exactly as before. The on-screen keyboard does not come through here.
     */
    @JvmStatic
    fun onKey(ev: KeyEvent, focus: View?): Boolean {
      if (focus !is EditText) return false
      val key = when (ev.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "enter"
        else -> return false
      }
      if (ev.action == KeyEvent.ACTION_DOWN) instance?.emitKey(key)
      return key != "enter" && suggestOpen
    }

    /** Called by MainActivity for every touch and hover event, before anything else sees it. */
    @JvmStatic
    fun onMotion(ev: MotionEvent) {
      if (ev.pointerCount < 1) return
      val tool = ev.getToolType(0)
      if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return
      val buttons = MotionEvent.BUTTON_STYLUS_PRIMARY or MotionEvent.BUTTON_SECONDARY
      val now = tool == MotionEvent.TOOL_TYPE_ERASER || (ev.buttonState and buttons) != 0
      // Only changes are sent. Lifting the pen is not a change: the button may still be held.
      if (now == held) return
      held = now
      instance?.emit(now)
    }
  }
}
`;
}

function packageSource(appPackage) {
  return `package ${appPackage}.stylus

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/** Written by mobile/plugins/withStylus.js. */
class ShridharNativePackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
    listOf(ShridharNativeModule(ctx))

  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;
}

/** Writes the two Kotlin files, only when their content differs. */
function writeSources(projectRoot, appPackage) {
  const dir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...appPackage.split('.'), 'stylus');
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    'ShridharNativeModule.kt': moduleSource(appPackage),
    'ShridharNativePackage.kt': packageSource(appPackage),
  };
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
    if (old !== body) fs.writeFileSync(file, body);
  }
}

function withStylus(config) {
  // Required here, not at the top, so the pure transforms above can be tested without expo.
  const { withDangerousMod, withMainActivity, withMainApplication } = require('expo/config-plugins');
  const appPackage = (config.android && config.android.package) || 'com.shridhar.billing';
  config = withDangerousMod(config, ['android', (cfg) => {
    writeSources(cfg.modRequest.projectRoot, appPackage);
    return cfg;
  }]);
  config = withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('withStylus: MainActivity must be Kotlin');
    cfg.modResults.contents = addToMainActivity(cfg.modResults.contents, appPackage);
    return cfg;
  });
  config = withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') throw new Error('withStylus: MainApplication must be Kotlin');
    cfg.modResults.contents = addToMainApplication(cfg.modResults.contents, appPackage);
    return cfg;
  });
  return config;
}

module.exports = withStylus;
module.exports.addToMainActivity = addToMainActivity;
module.exports.addToMainApplication = addToMainApplication;
module.exports.KEY_MARK = KEY_MARK;
module.exports.moduleSource = moduleSource;
module.exports.packageSource = packageSource;
