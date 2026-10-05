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
 */
const fs = require('fs');
const path = require('path');

const MARK = 'ShridharNativeModule.onMotion';
const PKG_MARK = 'ShridharNativePackage()';

/** MainActivity.kt with the hook added. Unchanged when it is already there. */
function addToMainActivity(src, appPackage) {
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
  const end = out.lastIndexOf('}');
  if (end < 0) throw new Error('withStylus: MainActivity has no class body');
  return out.slice(0, end).replace(/\s*$/, '\n') + hook + '}' + out.slice(end + 1);
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
import android.view.MotionEvent
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

  private fun emit(down: Boolean) {
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putBoolean("down", down)
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("penButton", map)
  }

  companion object {
    @Volatile private var instance: ShridharNativeModule? = null
    @Volatile private var held = false

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
module.exports.moduleSource = moduleSource;
module.exports.packageSource = packageSource;
