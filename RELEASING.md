# Releasing an update

Everything builds locally on this Mac -- no Expo build quota, no cloud, no cost.
The toolchain (JDK 17 in `~/android-toolchain/`, Android SDK in `~/Library/Android/sdk`)
was installed per-user in Sep 2026 and needs no sudo to maintain.

## The short version

```bash
scripts/release.sh 1.0.1
```

That bumps the version, builds the signed APK (~3 min after the first build), verifies the
signature, and -- after asking -- publishes it to GitHub Releases. The download link it
prints is what you share; the client installs it OVER the old app and keeps all data
(bills, items, history live in AsyncStorage, which survives updates).

## What must never be lost

`credentials/kirana-release.keystore` + `credentials/keystore.properties` (gitignored on
purpose -- this repo is public). Android only accepts updates signed by the same key: if the
keystore is lost, every shop phone has to uninstall (losing local data) and reinstall.
**Keep a copy outside this laptop.**

## Rules that keep updates safe

- **Never lower `versionCode`.** The script always bumps it by one; Android refuses
  downgrades.
- **Changed `app.json` (permissions, app name, icon)?** You must regenerate the native
  project: `npx expo prebuild --platform android`. If you use `--clean`, it wipes
  `android/app/build.gradle` including the release signing block -- re-add it (below)
  before building, or `scripts/release.sh` will refuse to run.
- **JS/TS-only changes** (screens, receipt layout, items logic) need no prebuild --
  just run the release script.
- Run `npm test` before releasing; the selftest catches receipt/ESC-POS regressions.

## The signing block (re-add after `prebuild --clean`)

In `android/app/build.gradle`, inside `signingConfigs { }`:

```groovy
release {
    def ksProps = new Properties()
    def ksFile = file('../../credentials/keystore.properties')
    if (ksFile.exists()) {
        ksFile.withInputStream { ksProps.load(it) }
        storeFile file(ksProps.getProperty('storeFile'))
        storePassword ksProps.getProperty('storePassword')
        keyAlias ksProps.getProperty('keyAlias')
        keyPassword ksProps.getProperty('keyPassword')
    }
}
```

and in `buildTypes.release`, change `signingConfig signingConfigs.debug` to
`signingConfig signingConfigs.release`.

## Hosting

Current: GitHub Releases on `Abhishekjohri1998/shridhar-kirana-store` -- free, permanent,
HTTPS, no server. v1.0.0 direct link:
https://github.com/Abhishekjohri1998/shridhar-kirana-store/releases/download/v1.0.0/kirana-billing-v1.0.0.apk

Optional AWS mirror (S3 + CloudFront + the branded page in `deploy/index.html`) was
prepared but never deployed -- it still needs `aws configure --profile kirana` with an IAM
access key on this machine.
