# Building the APK

Two ways to get an installable app. EAS is easier; the local build is the one that works when
EAS will not.

---

## The easy way: EAS

```bash
cd mobile
npx eas build --platform android --profile preview
```

Bump `android.versionCode` in `mobile/app.json` first — Android refuses to install a build whose
code is not higher than the installed one.

The free plan allows a limited number of Android builds a month and the limit is not announced
until you hit it. When it runs out, the error names the reset date and there is no way around it
on that account. That is what the local build is for.

**Read the end of the build log, not the exit code.** A cancelled or failed EAS build can still
leave the CLI exiting 0. Build 14 was cancelled mid-queue and reported as finished.

---

## The local way

```bash
bash mobile/build-apk.sh
```

About 45 minutes the first time — it downloads the NDK and CMake, roughly 3 GB — and a few
minutes after that. The APK lands at
`mobile/android/app/build/outputs/apk/release/app-release.apk`.

### What it needs, once

```bash
winget install EclipseAdoptium.Temurin.17.JDK
```

The Android SDK, unpacked anywhere (`C:\android-sdk` is what the script assumes):

```bash
sdkmanager --sdk_root=C:/android-sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

The NDK and CMake install themselves on the first build. Keep about 8 GB free; the C++ is built
for four architectures.

### The signing key

Generated once and then guarded, because Android will only accept an update signed by the same
key as the install it is replacing:

```bash
keytool -genkeypair -v -keystore shridhar-release.jks -alias shridhar \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep it **outside the repository** — this repository is public, and a keystore in it is a
keystore anyone can sign with. Then point Gradle at it in `mobile/android/gradle.properties`:

```properties
MYAPP_RELEASE_STORE_FILE=/absolute/path/to/shridhar-release.jks
MYAPP_RELEASE_KEY_ALIAS=shridhar
MYAPP_RELEASE_STORE_PASSWORD=...
MYAPP_RELEASE_KEY_PASSWORD=...
```

and make the release build use it, in `mobile/android/app/build.gradle` — a fresh prebuild ships
a release config that signs with the *debug* key, which is not something to hand a shop:

```groovy
signingConfigs {
    release {
        storeFile file(MYAPP_RELEASE_STORE_FILE)
        storePassword MYAPP_RELEASE_STORE_PASSWORD
        keyAlias MYAPP_RELEASE_KEY_ALIAS
        keyPassword MYAPP_RELEASE_KEY_PASSWORD
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
    }
}
```

`mobile/android/` is gitignored, so both of those edits are lost on a fresh `expo prebuild` and
have to be made again. The script refuses to build rather than quietly producing a debug-signed
APK.

**An EAS build and a local build are signed by different keys.** Moving between them forces the
shop to uninstall and reinstall, which loses any parked half-written bill on that device (bills
that have been printed live on the server and are safe). To avoid that, upload the local keystore
to EAS with `eas credentials` before building there again.

---

## The three things that went wrong the first time

Recorded because each one costs twenty to fifty minutes to rediscover.

**1. A backslash in `local.properties`.** It was written as `sdk.dir=C\:\android-sdk`. A Java
properties file treats a backslash as an escape character, so `\a` became `a` and Gradle read the
path as `C:android-sdk`. It failed 21 minutes in with *"The filename, directory name, or volume
label syntax is incorrect"*, which names neither the file nor the setting. Forward slashes avoid
the question entirely.

**2. Metro looked for the entry file in the wrong place.** `Unable to resolve module ./index.js
from D:\shridhar project/.` — the repo root, not `mobile/`.

**3. expo-updates looked for it in a third place.** `The resource
D:\shridhar project\mobile\mobile\index.js was not found` — the same answer, joined onto the app
directory instead of the repo root.

Two and three are one cause. `getMetroServerRoot` (`@expo/config/build/paths/paths.js`) returns
the **workspace root** for a monorepo, so the entry file resolves to `mobile/index.js` — a path
that is only correct relative to the repo root. Metro resolves it against the wrong base, and
expo-updates joins it onto `mobile/` and doubles the segment.

The switch that settles it, which that same function reads, is:

```bash
export EXPO_NO_METRO_WORKSPACE_ROOT=1
```

`build-apk.sh` sets it, and that is the only place it belongs. Saying the same thing in
`mobile/metro.config.js` with `server.unstable_serverRoot` was tried first and **breaks
`expo export` and `eas update`**: those run from the app directory, so pinning the root there
sends them looking for `mobile/mobile/index.js` -- the same doubled path, arrived at from the
other direction. The environment variable reaches `resolveAppEntry` and expo-updates as well as
Metro, which a config file cannot, and it is only set for the Gradle build that needs it.

EAS configures the equivalent itself, which is why the cloud builds never hit any of this.
