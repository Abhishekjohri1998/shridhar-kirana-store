# Simple Sales Book (billing): notes for Claude

This folder is the **billing app** for Shridhar Kirani Stores, a Kannada kirana shop. It is the
only place billing APKs and over-the-air updates are built from.

- Android package `com.shridhar.billing`, app name "Simple Sales Book".
- npm workspaces: `shared/` (receipt, i18n, rules), `server/` (Express + Mongo), `client/`
  (web), `mobile/` (Expo APK).
- It is **live**: `https://3.111.82.220.sslip.io` on EC2, with its data in MongoDB Atlas. The box
  pulls `main` every five minutes and rebuilds itself.

## Not this folder

The stock / inventory system is a **separate project** in `D:\Shridhar\stock-app`, with its own
repo (`Abhishekjohri1998/shridhar-stock`), server and website (no APK of its own). It only
*reads* bills from this server.

The tablet app has a **Billing | Stock** switch in its header (build 50). The Stock side is
`mobile/src/screens/StockScreen.tsx`: a WebView of the stock *website* (`extra.stockUrl` in
`app.json`), nothing more. **Never add inventory, stock or catalogue code here**, and never edit
this folder from the stock project. The client asked for the two codebases to stay apart.

## Rules that have cost real time before

- **Never write test data to the live Atlas database.** The shop bills on it. Test against a
  scratch server on the JSON file store, then delete `server/.data`:
  `cd server && MONGO_URI= PORT=4100 AUTH_PIN=246810 JWT_SECRET=scratch node dist/index.js`.
  Read-only GETs against the live server are fine.
- **The APK is built locally, in the foreground:** `bash mobile/build-apk.sh`, with a 10-minute
  tool timeout. A backgrounded build gets killed.
  - Bump `android.versionCode` in `mobile/app.json` first.
  - The first build after a folder move or a cache clean recompiles native code, about 25
    minutes.
- **The signing key** is `C:\Users\hp\.keystores\shridhar-release.jks`. Its passwords are only in
  the gitignored `mobile/android/gradle.properties`. Never put either in the repo, which is
  public.
- **Over-the-air updates go to the `preview` channel:** `cd mobile && npx eas update --branch
  preview`. If Metro says "dependencies is not iterable", clear its cache and use
  `--clear-cache`.
- **Push with `git push origin master:main`.** The local branch is `master`.
- **Every receipt change must keep the printers in step.** There are four renderers: two
  printers and two previews. `npm test` includes the dot-for-dot raster parity check.
- **Heredocs eat backslashes.** For edit scripts, write a file with the Write tool and run it.
- Don't sign in to the owner's AWS or Expo accounts, and don't write AWS keys into config.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Checks

`npm test` covers typecheck, field rules, i18n, raster parity, printer, schema and the API against
a file store.
