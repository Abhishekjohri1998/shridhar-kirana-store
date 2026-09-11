#!/usr/bin/env bash
#
# Builds a signed release APK on this machine, without EAS.
#
#   bash mobile/build-apk.sh
#
# EAS is still the easier path when its monthly quota allows it. This exists because the quota
# ran out on the day the shop needed a build, and because a project should not be unable to
# produce its own artifact.
#
# What it needs, once:
#   - JDK 17            winget install EclipseAdoptium.Temurin.17.JDK
#   - Android SDK       platform-tools, platforms;android-35, build-tools;35.0.0
#                       (the NDK and CMake install themselves on the first build, ~3 GB)
#   - a keystore        see docs/building-the-apk.md
#
# About 45 minutes the first time, a few minutes after that.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

JAVA_HOME="${JAVA_HOME:-/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot}"
ANDROID_HOME="${ANDROID_HOME:-/c/android-sdk}"
export JAVA_HOME ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

[ -x "$JAVA_HOME/bin/java" ] || { echo "No JDK at $JAVA_HOME -- set JAVA_HOME."; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "No Android SDK at $ANDROID_HOME -- set ANDROID_HOME."; exit 1; }

# The one that took three attempts to find.
#
# Expo treats the workspace root as the root every path is named against, so the app's entry file
# comes out as `mobile/index.js`. Metro then looks for it at the repo root and expo-updates joins
# it onto the app directory and looks for mobile/mobile/index.js -- two different wrong answers
# from one shared assumption. This makes all of them agree that mobile/ is the root.
export EXPO_NO_METRO_WORKSPACE_ROOT=1

[ -d android ] || npx expo prebuild --platform android --no-install

# Written with forward slashes on purpose: a .properties file treats a backslash as an escape,
# so sdk.dir=C\:\android-sdk is read as C:android-sdk and the build dies twenty minutes later
# saying "The filename, directory name, or volume label syntax is incorrect".
printf 'sdk.dir=%s\n' "$(cd "$ANDROID_HOME" && pwd -W 2>/dev/null || echo "$ANDROID_HOME")" > android/local.properties

grep -q MYAPP_RELEASE_STORE_FILE android/gradle.properties 2>/dev/null || {
  echo "No signing key configured. See docs/building-the-apk.md -- android/ is gitignored,"
  echo "so the keystore path and passwords have to be put back after a fresh prebuild."
  exit 1
}

cd android
./gradlew assembleRelease --no-daemon

APK="$HERE/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || { echo "Gradle finished but produced no APK."; exit 1; }

echo
echo "  $APK"
echo "  $(du -h "$APK" | cut -f1)"
"$ANDROID_HOME/build-tools/35.0.0/apksigner.bat" verify --print-certs "$APK" 2>/dev/null \
  | grep "certificate DN" | head -1
echo
