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
 *     list is open (`setSuggestOpen`). Enter is used up while a bill box says it owns it
 *     (`setTakeEnter`, build 62), so one press reaches JavaScript once and nothing else.
 *  5. Keyboard shortcuts (build 63): F1-F8, Ctrl+PageUp/PageDown, Alt+H/C, Ctrl+A/P/S and
 *     Ctrl+Shift+P go to JavaScript as `hwShortcut` events ({key, ctrl, shift, alt}) and are
 *     used up -- whatever has focus -- but only while JavaScript has switched them on
 *     (`setShortcuts`: 0 off, 1 the global ones -- F1, Alt+B, Alt+S (build 64) -- 2 those and
 *     the whole bill-screen list, with Ctrl+H since build 64). Any other screen or
 *     key is untouched. While a bill line box has the cursor (setTakeEnter) and shortcuts are
 *     at 2, Up and Down are kept from the box too, so JavaScript can move between lines.
 *     The list is the same as shared/src/shortcuts.ts; plugintest checks that.
 *  6. Before the keyboard (build 66). Samsung's keyboard opens its symbol panel on Alt+S, because
 *     a hardware key reaches the IME before the activity's dispatchKeyEvent. MainActivity now
 *     wraps the React root in ShridharKeyCatcher, whose dispatchKeyEventPreIme -- the first stage
 *     an app gets, ahead of the IME and the focused view -- hands live shortcuts to the module,
 *     which uses up the down, repeats and the matching up (even when Alt is let go first).
 *     dispatchKeyShortcutEvent / onKeyShortcut are taken too, for a chord Android routes as a
 *     menu shortcut. Alt+C (Customers) and F9 (Settings, for a keyboard that still takes
 *     Alt+S) are global from build 66.
 *  7. The unit list (build 67). While JavaScript says a line's unit list is open
 *     (`setUnitMenuOpen`, like setSuggestOpen), Left, Right, Enter and Escape go to JavaScript as
 *     `hwKey` 'left' | 'right' | 'enter' | 'escape' and are used up -- down, repeats and the
 *     matching up -- whatever has focus, at the pre-IME stage and again in dispatchKeyEvent.
 *  8. Stylus writing in the stock WebView (build 69). ShridharKeyCatcher keeps handwriting on for
 *     every WebView (Android 13+). No touch is ever used up by this plugin's code.
 *  9. Stylus writing in the app's own text boxes (build 76). The S Pen "stopped writing after some
 *     updates". Nothing here consumed a stylus event, but three things are now made certain:
 *     every EditText found at layout has setAutoHandwritingEnabled(true) (Android 13+), like the
 *     WebViews; the catcher never takes focus (FOCUS_AFTER_DESCENDANTS, not focusable) and passes
 *     every key that is not a live shortcut straight on; and onMotion / onKey can never throw
 *     into Android's dispatch (a React instance reloading after an update used to be the one
 *     moment an emit could fail). A shortcut whose up never arrived (focus lost mid-press) is
 *     forgotten when the window loses focus, so it cannot eat a later key.
 * 11. Build 81: refreshHandwriting also clears focus, then next frame refocuses, restartInput()s
 *     and re-enables handwriting (a tab switch restarting the IME was what fixed it). A stylus
 *     hover-enter or down over a shown WebView triggers the same, at most once every 2 s; the
 *     event is never used up.
 * 10. Stock tab handwriting refresh (build 79): `refreshHandwriting()` finds the WebView(s) under
 *     the root, switches handwriting on again and gives the shown one focus. The Stock screen calls
 *     it when the tab comes to the front and when the app resumes on Stock.
 */
const fs = require('fs');
const path = require('path');

const MARK = 'ShridharNativeModule.onMotion';
const PKG_MARK = 'ShridharNativePackage()';
const KEY_MARK = 'ShridharNativeModule.onKey';
const PREIME_MARK = 'ShridharKeyCatcher(this)';

/** The chords live from shortcut level 1 (every screen). Keep in step with SHORTCUTS' global ones. */
const GLOBAL_CHORDS = ['F1', 'Alt+B', 'Alt+S', 'F9', 'Alt+C'];

/** The chords used up at shortcut level 2 only. Keep in step with SHORTCUTS. */
const BILL_CHORDS = [
  'Ctrl+PageUp', 'Ctrl+PageDown', 'Alt+H', 'F2', 'Shift+F2', 'F3', 'F4', 'F5', 'F6',
  'F7', 'F8', 'Ctrl+H', 'Ctrl+A', 'Ctrl+P', 'Ctrl+S', 'Ctrl+Shift+P', 'F10',
];

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
  return addPreImeHook(addKeyHook(addMotionHook(src, appPackage), appPackage), appPackage);
}

/**
 * Build 66: the React root goes inside ShridharKeyCatcher, so shortcuts are taken before the
 * keyboard app (IME) sees them; and Android's key-shortcut path is taken as well.
 */
function addPreImeHook(src, appPackage) {
  if (src.includes(PREIME_MARK)) return src;
  const out = addImports(src, [
    'import android.view.KeyEvent',
    'import android.view.View',
    'import android.view.ViewGroup',
    'import android.widget.FrameLayout',
    'import ' + appPackage + '.stylus.ShridharKeyCatcher',
    'import ' + appPackage + '.stylus.ShridharNativeModule',
  ]);
  const hook = [
    '',
    '  // withStylus: shortcuts before the keyboard app sees them (Samsung takes Alt+S otherwise).',
    '  override fun setContentView(view: View?) {',
    '    if (view == null || view is ShridharKeyCatcher) {',
    '      super.setContentView(view)',
    '      return',
    '    }',
    '    (view.parent as? ViewGroup)?.removeView(view)',
    '    val catcher = ' + PREIME_MARK,
    '    catcher.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))',
    '    super.setContentView(catcher)',
    '  }',
    '',
    '  override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean {',
    '    if (ShridharNativeModule.onShortcut(event)) return true',
    '    return super.dispatchKeyShortcutEvent(event)',
    '  }',
    '',
    '  override fun onKeyShortcut(keyCode: Int, event: KeyEvent): Boolean {',
    '    if (ShridharNativeModule.onShortcut(event)) return true',
    '    return super.onKeyShortcut(keyCode, event)',
    '  }',
    '',
  ].join('\n');
  return beforeClassEnd(out, hook);
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
  const chords = BILL_CHORDS.map((c) => '"' + c + '"').join(', ');
  const globals = GLOBAL_CHORDS.map((c) => '"' + c + '"').join(', ');
  return `package ${appPackage}.stylus

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.text.InputType
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.EditText
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
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

  /** JavaScript says a bill box has the cursor, so a hardware Enter is its alone (build 62). */
  @ReactMethod fun setTakeEnter(on: Boolean) { takeEnter = on }

  /** JavaScript says which shortcuts are live: 0 none, 1 F1 alone, 2 the bill screen's (build 63). */
  @ReactMethod fun setShortcuts(level: Int) { shortcutLevel = level }

  /** JavaScript says a line's unit list is open, so Left, Right, Enter and Escape are its (build 67). */
  @ReactMethod fun setUnitMenuOpen(open: Boolean) { unitMenuOpen = open }

  /**
   * Build 79: the Stock tab came to the front (or the app did, on Stock). The WebView was laid out
   * hidden, so the S Pen would not write until Billing and back. Every WebView under the root gets
   * handwriting on again and the focus, on the UI thread. Never throws.
   */
  @ReactMethod fun refreshHandwriting() {
    val activity = currentActivity ?: return
    UiThreadUtil.runOnUiThread {
      try {
        val root = activity.window?.decorView ?: return@runOnUiThread
        refreshWebViews(root)
      } catch (e: Throwable) { }
    }
  }

  /**
   * Build 81: a tab switch restarts the IME connection, and that is what made the pen write.
   * The shown WebView loses focus, then on the next frame takes it back, the IME connection is
   * restarted and handwriting is switched on again. Hidden WebViews only get handwriting on.
   */
  private fun refreshWebViews(v: View) {
    if (v is WebView) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) v.setAutoHandwritingEnabled(true)
        if (v.isShown) kick(v)
      } catch (e: Throwable) { }
      return
    }
    if (v is ViewGroup) for (i in 0 until v.childCount) refreshWebViews(v.getChildAt(i))
  }

  private fun kick(web: WebView) {
    web.clearFocus()
    web.postOnAnimation {
      try {
        web.requestFocus()
        val imm = web.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.restartInput(web)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) web.setAutoHandwritingEnabled(true)
      } catch (e: Throwable) { }
    }
  }

  /** Is (x, y) in window coordinates over a shown WebView? */
  private fun webViewAt(v: View, x: Float, y: Float): Boolean {
    if (!v.isShown) return false
    if (v is WebView) {
      val loc = IntArray(2)
      v.getLocationInWindow(loc)
      return x >= loc[0] && x < loc[0] + v.width && y >= loc[1] && y < loc[1] + v.height
    }
    if (v is ViewGroup) for (i in 0 until v.childCount) if (webViewAt(v.getChildAt(i), x, y)) return true
    return false
  }

  /** Build 81: the pen came near or down over a WebView -- kick it, at most once every 2 s. */
  internal fun penOverWeb(x: Float, y: Float) {
    val activity = currentActivity ?: return
    val root = activity.window?.decorView ?: return
    val now = android.os.SystemClock.uptimeMillis()
    if (now - lastKick < KICK_GAP_MS) return
    if (!webViewAt(root, x, y)) return
    lastKick = now
    refreshWebViews(root)
  }

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

  private fun emitShortcut(key: String, ctrl: Boolean, shift: Boolean, alt: Boolean) {
    if (!ctx.hasActiveReactInstance()) return
    val map = Arguments.createMap()
    map.putString("key", key)
    map.putBoolean("ctrl", ctrl)
    map.putBoolean("shift", shift)
    map.putBoolean("alt", alt)
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("hwShortcut", map)
  }

  private fun emit(down: Boolean) {
    if (!ctx.hasActiveReactInstance()) return
    try {
      val map = Arguments.createMap()
      map.putBoolean("down", down)
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("penButton", map)
    } catch (e: Exception) {
      // The React instance is reloading (an update): the pen button event is simply dropped.
    }
  }

  companion object {
    @Volatile private var instance: ShridharNativeModule? = null
    /** Build 81: the stylus WebView kick runs at most once in this many ms. */
    const val KICK_GAP_MS = 2000L
    private var lastKick = 0L
    @Volatile private var held = false
    @Volatile private var suggestOpen = false
    @Volatile private var takeEnter = false
    @Volatile private var shortcutLevel = 0
    @Volatile private var unitMenuOpen = false
    /** Keys whose down was used up as a shortcut: their up is used up too, Alt held or not. */
    private val takenDown = java.util.Collections.synchronizedSet(HashSet<Int>())

    private val GLOBAL_CHORDS = setOf(${globals})
    private val BILL_CHORDS = setOf(${chords})

    /** The shortcut key's name, as shared/src/shortcuts.ts spells it, or null. */
    @JvmStatic
    fun shortcutKey(code: Int): String? = when (code) {
      KeyEvent.KEYCODE_F1 -> "F1"
      KeyEvent.KEYCODE_F2 -> "F2"
      KeyEvent.KEYCODE_F3 -> "F3"
      KeyEvent.KEYCODE_F4 -> "F4"
      KeyEvent.KEYCODE_F5 -> "F5"
      KeyEvent.KEYCODE_F6 -> "F6"
      KeyEvent.KEYCODE_F7 -> "F7"
      KeyEvent.KEYCODE_F8 -> "F8"
      KeyEvent.KEYCODE_F9 -> "F9"
      KeyEvent.KEYCODE_F10 -> "F10"
      KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
      KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
      KeyEvent.KEYCODE_H -> "H"
      KeyEvent.KEYCODE_B -> "B"
      KeyEvent.KEYCODE_C -> "C"
      KeyEvent.KEYCODE_A -> "A"
      KeyEvent.KEYCODE_P -> "P"
      KeyEvent.KEYCODE_S -> "S"
      else -> null
    }

    /** Ctrl, Shift, Alt, key -- always in that order, as chordOf() builds it in JavaScript. */
    @JvmStatic
    fun chord(key: String, ctrl: Boolean, shift: Boolean, alt: Boolean): String =
      (if (ctrl) "Ctrl+" else "") + (if (shift) "Shift+" else "") + (if (alt) "Alt+" else "") + key

    /** Whether this chord is a live shortcut at this level. */
    @JvmStatic
    fun isShortcut(chord: String, level: Int): Boolean {
      if (level <= 0) return false
      if (chord in GLOBAL_CHORDS) return true
      return level >= 2 && chord in BILL_CHORDS
    }

    /**
     * A shortcut, whatever has focus: emitted once per press and used up -- down, repeats and
     * up -- so the text box, the WebView or Android never also act on it.
     */
    @JvmStatic
    fun onShortcut(ev: KeyEvent): Boolean {
      // The up of a key whose down was a shortcut -- even when Alt or Ctrl was let go first.
      if (ev.action == KeyEvent.ACTION_UP && takenDown.remove(ev.keyCode)) return true
      val level = shortcutLevel
      if (level <= 0) return false
      val key = shortcutKey(ev.keyCode) ?: return false
      val c = chord(key, ev.isCtrlPressed, ev.isShiftPressed, ev.isAltPressed)
      if (!isShortcut(c, level)) return false
      if (ev.action == KeyEvent.ACTION_DOWN) {
        takenDown.add(ev.keyCode)
        if (ev.repeatCount == 0) instance?.emitShortcut(key, ev.isCtrlPressed, ev.isShiftPressed, ev.isAltPressed)
      }
      return true
    }

    /**
     * The unit list F6 opened (build 67): Left and Right move along its chips, Enter picks, Escape
     * closes -- in JavaScript. Emitted on the way down (the arrows on repeats too) and used up
     * whole; the up is taken through takenDown, so it is used up even after Enter or Escape has
     * closed the list, and never reaches the text box as a stray Enter.
     */
    @JvmStatic
    fun onUnitMenu(ev: KeyEvent): Boolean {
      if (!unitMenuOpen) return false
      val key = when (ev.keyCode) {
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "enter"
        KeyEvent.KEYCODE_ESCAPE -> "escape"
        else -> return false
      }
      if (ev.action == KeyEvent.ACTION_DOWN) {
        takenDown.add(ev.keyCode)
        if (ev.repeatCount == 0 || key == "left" || key == "right") instance?.emitKey(key)
      }
      return true
    }

    /**
     * Called by MainActivity for every key event. Up, Down and Enter from a hardware keyboard,
     * while a text box has focus, are sent to JavaScript on the way down. Returns true -- the
     * key is used up -- for Up and Down while a suggestion list is open, and for Enter (down,
     * repeats and up) while JavaScript has said a bill box owns it (setTakeEnter).
     *
     * Enter used to carry on to the EditText as well. Android's TextView then ran its own Enter:
     * an editor action (React Native's onSubmitEditing) on the way down AND again on the way
     * up, and for a single-line box a focus search downwards -- which from the name box lands
     * on the price. With the JavaScript pick finishing a moment later, the cursor ended up in
     * the price box. Now one press is one "enter" event and nothing else.
     * The on-screen keyboard does not come through here.
     */
    @JvmStatic
    fun onKey(ev: KeyEvent, focus: View?): Boolean {
      if (onShortcut(ev)) return true
      if (onUnitMenu(ev)) return true
      if (focus !is EditText) return false
      val key = when (ev.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "enter"
        else -> return false
      }
      if (key == "enter") {
        val multiLine = (focus.inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0
        if (!takeEnter || multiLine) {
          if (ev.action == KeyEvent.ACTION_DOWN && ev.repeatCount == 0) instance?.emitKey(key)
          return false
        }
        if (ev.action == KeyEvent.ACTION_DOWN && ev.repeatCount == 0) instance?.emitKey(key)
        return true
      }
      if (ev.action == KeyEvent.ACTION_DOWN) instance?.emitKey(key)
      // A bill line box with shortcuts on: the arrows move between lines, in JavaScript.
      return suggestOpen || (shortcutLevel >= 2 && takeEnter)
    }

    /** Called by MainActivity for every touch and hover event, before anything else sees it. */
    @JvmStatic
    fun onMotion(ev: MotionEvent) {
      // Read-only: the event is never changed or used up, and nothing here may throw into dispatch.
      try { observeMotion(ev) } catch (e: Exception) { /* never break the pen over a button event */ }
    }

    /** Forget shortcut downs whose up never came (the window lost focus mid-press). */
    @JvmStatic
    fun clearTaken() { takenDown.clear() }

    private fun observeMotion(ev: MotionEvent) {
      if (ev.pointerCount < 1) return
      val tool = ev.getToolType(0)
      if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return
      // Build 81: pen hover-enter or pen down over a WebView restarts its IME (throttled).
      val act = ev.actionMasked
      if (tool == MotionEvent.TOOL_TYPE_STYLUS && (act == MotionEvent.ACTION_HOVER_ENTER || act == MotionEvent.ACTION_DOWN)) {
        try { instance?.penOverWeb(ev.rawX, ev.rawY) } catch (e: Throwable) { }
      }
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

import android.content.Context
import android.os.Build
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
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

/**
 * Written by mobile/plugins/withStylus.js (build 66). MainActivity puts the React root inside
 * this, so a live shortcut is taken at the pre-IME stage -- before the keyboard app (Samsung's
 * opens its symbol panel on Alt+S) or the focused text box can act on it.
 */
class ShridharKeyCatcher(context: Context) : FrameLayout(context) {
  override fun dispatchKeyEventPreIme(event: KeyEvent): Boolean {
    if (ShridharNativeModule.onShortcut(event)) return true
    if (ShridharNativeModule.onUnitMenu(event)) return true
    return super.dispatchKeyEventPreIme(event)
  }

  /*
   * Stylus writing in a WebView's text boxes (build 69: the stock app inside the billing app).
   *
   * Nothing here or in onMotion ever uses up a touch: every event goes on to super, and
   * react-native-webview's own view only asks its parents not to intercept. What is done here:
   * handwriting is kept switched on for every WebView (View.setAutoHandwritingEnabled, Android
   * 13+), checked on each layout, so a stylus stroke in a focused web text box can start
   * Android's stylus handwriting wherever the installed WebView supports it.
   */
  /*
   * Build 76: the app's own text boxes too. Every EditText (React Native's TextInput) found at
   * layout gets setAutoHandwritingEnabled(true), so a stylus stroke on it starts handwriting
   * whatever a library or a theme set. The catcher itself never takes focus: it must stay a
   * transparent wrapper, or a focused text box could lose the focus handwriting starts from.
   */
  init {
    isFocusable = false
    isFocusableInTouchMode = false
    descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    viewTreeObserver.addOnGlobalLayoutListener { enableHandwriting(this) }
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) ShridharNativeModule.clearTaken()
  }

  private fun enableHandwriting(v: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (v is WebView || v is EditText) {
      if (!v.isAutoHandwritingEnabled) v.setAutoHandwritingEnabled(true)
      return
    }
    if (v is ViewGroup) for (i in 0 until v.childCount) enableHandwriting(v.getChildAt(i))
  }
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
module.exports.PREIME_MARK = PREIME_MARK;
module.exports.BILL_CHORDS = BILL_CHORDS;
module.exports.GLOBAL_CHORDS = GLOBAL_CHORDS;
module.exports.moduleSource = moduleSource;
module.exports.packageSource = packageSource;
