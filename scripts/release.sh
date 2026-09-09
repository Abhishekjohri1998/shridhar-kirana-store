#!/usr/bin/env bash
#
# Build and publish a new version of Kirana Billing, entirely on this machine.
#
#   scripts/release.sh 1.0.1
#
# Does: bump versionCode/versionName -> gradle release build -> verify signature
# -> ask before publishing to GitHub Releases. No Expo quota, no cloud build.
#
# Needs (all already installed by the initial setup):
#   - JDK 17 in ~/android-toolchain/          - Android SDK in ~/Library/Android/sdk
#   - signing keystore in credentials/        - gh CLI logged in (gh auth status)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="${1:?usage: scripts/release.sh <version, e.g. 1.0.1>}"
GRADLE_FILE="$ROOT/android/app/build.gradle"
REPO="Abhishekjohri1998/shridhar-kirana-store"

export JAVA_HOME="${JAVA_HOME:-$(ls -d "$HOME"/android-toolchain/jdk-17*/Contents/Home | head -1)}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

# -- sanity ---------------------------------------------------------------------
[ -f "$ROOT/credentials/kirana-release.keystore" ] || { echo "FATAL: credentials/kirana-release.keystore is missing. Restore it from backup -- a new keystore cannot update installed phones."; exit 1; }
grep -q "signingConfigs.release" "$GRADLE_FILE" || { echo "FATAL: android/app/build.gradle lost its release signing block (did 'expo prebuild --clean' run?). See RELEASING.md to re-add it."; exit 1; }

# -- bump versions --------------------------------------------------------------
CUR_CODE=$(grep -m1 'versionCode ' "$GRADLE_FILE" | tr -dc '0-9')
NEW_CODE=$((CUR_CODE + 1))
sed -i '' "s/versionCode $CUR_CODE/versionCode $NEW_CODE/" "$GRADLE_FILE"
sed -i '' "s/versionName \"[^\"]*\"/versionName \"$VER\"/" "$GRADLE_FILE"
node -e "
  const fs = require('fs'), p = '$ROOT/app.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.expo.version = '$VER'; j.expo.android.versionCode = $NEW_CODE;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"
echo "version $VER (versionCode $CUR_CODE -> $NEW_CODE)"

# -- build ----------------------------------------------------------------------
( cd "$ROOT/android" && ./gradlew :app:assembleRelease )
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"

# -- verify the signature is the shop keystore, not a debug key -----------------
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | tail -1)
"$BT/apksigner" verify --print-certs "$APK" | grep -q "CN=Kirana Billing" \
  || { echo "FATAL: APK is not signed with the Kirana keystore"; exit 1; }

OUT="$ROOT/deploy/kirana-billing-v$VER.apk"
mkdir -p "$ROOT/deploy" && cp "$APK" "$OUT"
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
echo; echo "built:  $OUT"; echo "sha256: $SHA"; echo

# -- publish (asks first) -------------------------------------------------------
read -r -p "Publish v$VER to GitHub Releases now? [y/N] " GO
[ "${GO:-n}" = "y" ] || { echo "Not published. Re-run when ready."; exit 0; }
gh release create "v$VER" "$OUT" --repo "$REPO" \
  --title "Kirana Billing v$VER" \
  --notes "Signed release APK. Install over the old version -- bills, items and history are kept.

SHA-256: \`$SHA\`"
echo; echo "Live: https://github.com/$REPO/releases/download/v$VER/kirana-billing-v$VER.apk"
