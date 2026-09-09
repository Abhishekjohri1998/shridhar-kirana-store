# Kirana Billing

An Android billing app for a kirana counter. It replaces a handwritten slip: the shopkeeper taps
items, quantities total themselves, and a 58mm Bluetooth thermal printer prints a receipt in the
same shape as the paper one — Kannada item names included.

Built from the client's existing receipt (Shridhar Kirani Stores, 9/3/26): a pre-printed header and
footer with four lines and a circled total written in by hand.

```
   Shridhar Kirani Stores          Bill #42        03/09/26 9:06 am
5  ಗಾಣದ ಎಣ್ಣೆ            550       - - - - - - - - - - - - - - - -
5  ಮೆಣಸಿನಕಾಯಿ            615      5  ಗಾಣದ ಎಣ್ಣೆ                550
1  OT                     50      5  ಮೆಣಸಿನಕಾಯಿ                615
1  J Pulse               155      1  OT                         50
                       (1370)     1  J Pulse                   155
                                  - - - - - - - - - - - - - - - -
   Thank you, Visit again!        TOTAL                       1370
   9/3/26 9:06 am                 - - - - - - - - - - - - - - - -
                                    Thank you, Visit again!
   the paper slip today               what the app prints
```

## What it does

- **Bill tab** — search items in English or Kannada, tap to add, `+`/`−` for quantity, tap the
  quantity to type a decimal for weighed goods (1.5 kg). `+` on the search bar bills a one-off item
  that isn't in the list. Preview shows the slip before printing.
- **Items tab** — the shop's goods and rates. Editing a rate never rewrites a bill already printed;
  every bill keeps its own copy of the names and rates it was made with.
- **History tab** — every bill, with today's takings at the top and a **Print again** button. If a
  print fails, the bill is already saved: reprint it from here.
- **Settings tab** — shop name and footer line as they print, and the printer to use.

Everything is stored on the phone. No account, no server, no internet — a kirana counter cannot
stop billing because the network is down.

### Deliberately not in v1

Credit khata (udhaar), stock tracking and monthly reports were scoped out. `src/store/store.tsx` is
where they'd hook in. (History does show a running total for today, because the shopkeeper needs
one number to count the cash drawer against.)

## Running it

```bash
npm install
npm test          # typecheck + the receipt self-test, no device needed
```

Bluetooth printing needs real native code, so **Expo Go will not print** — it will still bill and
preview, which is enough to demo the flow. For a printing build:

```bash
npx expo prebuild --platform android
npx expo run:android          # a phone plugged in over USB
```

Or an installable APK to hand the client, with no Android Studio on your machine:

```bash
npx eas build -p android --profile preview
```

## Setting up the printer

1. Turn the thermal printer on and pair it in **Android Settings → Bluetooth**, not in the app.
   Most take `0000` or `1234` as the PIN.
2. In the app: **Settings → Choose printer**, pick it from the paired list.
3. **Settings → Test print.** The test slip bills 5 + 5 + 1 + 1 of the four items off the shop's own
   receipt. If it reads **1370** and the Kannada is legible, the setup is right.

### Two things worth knowing before you buy a printer

**Kannada is printed as an image, not as text.** Cheap ESC/POS printers carry code pages for Latin,
Cyrillic and CJK — none of them can render Kannada. So the app draws the whole receipt onto a canvas
(where Android's Noto Sans Kannada shapes it correctly), thresholds it to one bit per dot, and sends
it as an ESC/POS raster. That is how every Indic-language POS app does it. It also means the receipt
is a little slower to print than plain text, and that the printer's own font settings are irrelevant.

**Check whether the printer is Bluetooth Classic or BLE.** This app talks Bluetooth Classic (SPP),
which covers the great majority of ₹1,200–2,000 Indian pocket printers. Some newer ones are
Bluetooth Low Energy only and will pair but never print. If that happens, the whole fix lives in
[`src/printer/bluetooth.ts`](src/printer/bluetooth.ts) — swap the transport for a BLE one; nothing
above it changes. **Ask the seller which one it is before buying.**

## Before going live

The four Kannada names in [`src/data/seedItems.ts`](src/data/seedItems.ts) were read off the photo of
the paper slip and are a **best guess at the handwriting** — confirm them with the shopkeeper. Their
rates are exact (550 ÷ 5 = 110, 615 ÷ 5 = 123, 50, 155). Everything after those four is ordinary
kirana stock at placeholder rates, there only so the app isn't empty on day one; the shopkeeper
replaces it from the Items tab.

Also worth doing: set the real shop name and footer in Settings, and print a few bills on paper to
check the Kannada is readable at 58mm before the client's staff rely on it.

## How it fits together

```
src/receipt/doc.ts          the one description of what a receipt looks like
        |                   (rows: shop name, item lines, total, footer)
        +---> components/ReceiptPreview.tsx    the same rows, on screen
        +---> receipt/rasterHtml.ts            the same rows, drawn on a canvas in a
              receipt/RasterBridge.tsx         hidden WebView, returned as packed bits
                    |
              printer/escpos.ts                bits -> GS v 0 raster commands, in 64-row bands
                    |
              printer/bluetooth.ts             chunked writes over Bluetooth Classic
```

The preview and the paper render from the same document, which is what keeps the preview honest.

`npm run selftest` exercises that pipeline against a fake canvas: totals, wrapping, bit packing and
the ESC/POS framing. It cannot tell you whether the glyphs look right — only paper can.

## Notes

- Bills are kept for reprinting, capped at the most recent 300 (`HISTORY_LIMIT` in
  `src/store/store.tsx`).
- Money goes through `src/lib/money.ts` everywhere, so a line total and the grand total can never
  disagree by a stray fraction of a paisa.
- The repo is `git init`-ed but has no commits yet. Git on this machine reports "dubious ownership"
  for the folder; `git config --global --add safe.directory 'D:/Startup Abhishek/kirana-billing'`
  clears it.
"# shridhar-kirana-store" 
