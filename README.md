# Simple Sales Book

Billing for Shridhar Kirani Stores.

A MERN billing app for a kirana counter. It replaces a handwritten slip: the shopkeeper writes or
taps items, quantities total themselves, and a receipt prints in the same shape as the paper one —
Kannada item names included, handwritten if that's quicker. Works on a phone, a tablet or a counter
PC from the same URL.

Built from two things the client supplied: a photo of the shop's paper slip (9/3/26), and a
three-page written spec.

```
   Shridhar Kirani Stores          Bill #14        04/09/26 4:46 pm
5  ಗಾಣದ ಎಣ್ಣೆ            550       Name                     Ramesh
5  ಮೆಣಸಿನಕಾಯಿ            615       Phone                9886012345
1  OT                     50      - - - - - - - - - - - - - - - -
1  J Pulse               155      5  ಗಾಣದ ಎಣ್ಣೆ                550
                       (1370)     1  ✎ (handwriting)            40
                                  1                             60
   Thank you, Visit again!        - - - - - - - - - - - - - - - -
   9/3/26 9:06 am                 TOTAL                        650
                                  Paid                         500
   the paper slip today           Balance                      150
```

## What the spec asked for, and where it lives

| From the note | Where it is |
| --- | --- |
| Receipt has two main columns: item description and price | [`shared/src/doc.ts`](shared/src/doc.ts) builds every receipt; price is right-aligned beside the description |
| **The item column must support handwriting**, because customers prefer regional language | [`InkPad.tsx`](client/src/components/InkPad.tsx) captures stylus strokes; they print as vectors |
| Regional language when typing, not just writing | The device keyboard works, and [`KannadaInput.tsx`](client/src/components/KannadaInput.tsx) transliterates `akki` into ಅಕ್ಕಿ for tablets with no Kannada layout installed |
| Price in digital format, used to compute the total | Digits only, validated server-side; the server recomputes every total |
| "Sometimes it should calculate the total of price entered without items" | A line may have no description at all — `Write / price`, leave both blank |
| Customer details at the top: name, contact no. | [`CustomerBar.tsx`](client/src/components/CustomerBar.tsx); they print above the item table |
| Those details should "appear in suggestion if they are already there" | Typing either field searches saved customers and offers them |
| Customer total transaction | Customers page: total billed, paid, balance, bill count, and their bills |
| Balance amount on the receipt, **optional** | A per-bill checkbox; the flag is stored so a reprint matches the original |
| Notification if a customer hasn't visited for a period | Customers page banner + a count on its tab. **In-app, not a phone push** — see below |
| 2-inch thermal printer via RawBT | One of three print paths; 58mm and 80mm rolls both supported. See Printing |

One deliberate difference: the spec's example writes the quantity inside the description
("1kg ಅಕ್ಕಿ"). The receipt keeps quantity in its own narrow column, because that is what the shop's
own paper slip does ("5 ಗಾಣ  550"). Handwritten lines can still include it in the writing.

## Stack

| Part | What |
| --- | --- |
| **M**ongoDB | Mongoose models for items, bills, customers, settings, and an atomic bill-number counter |
| **E**xpress | REST API on `/api`, PIN login with JWT, Zod validation on every request body |
| **R**eact | Vite + TypeScript, React Router, mobile-first CSS with no UI framework |
| **N**ode | One process serves the API and, in production, the built React app |

There is a phone app too — `mobile/`, React Native via Expo — which exists mainly because only a
native app can drive a Bluetooth Classic printer. See [The phone app](#the-phone-app).

`shared/` holds the money arithmetic, the receipt layout, the handwriting geometry, the field rules
and the Kannada translations, and the server, the browser and the phone all import it — so a total
can never mean two different things in two places.

## Running it

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

API on <http://localhost:4000>, app on <http://localhost:5173>. Default PIN `1234`
(`AUTH_PIN` in `server/.env`).

```bash
npm run mobile   # the phone app in Expo Go
npm run apk      # build an installable .apk (needs an Expo account)
```

```bash
npm test     # typecheck, then 606 checks: 284 field-rule, 48 translation,
             # 27 rasteriser-parity, 85 printer/Bluetooth, 6 seeding, 156 pipeline/API
npm run build && npm start     # production: one process on port 4000 serving API + app
```

### The database

**Paste the connection string into `MONGO_URI` in `server/.env` when you have it** and restart — the
app switches to MongoDB with no other change. Until then it keeps its data in
`server/.data/db.json` so you can build and demo without waiting; the server prints which one it is
using on startup, and `GET /api/health` reports it too. The JSON file is a development stand-in, not
something to run a shop on.

Both sit behind one interface in [`server/src/store/types.ts`](server/src/store/types.ts), so the
routes cannot tell them apart.

## Handwriting

The note says the shop writes item descriptions with a stylus on a Galaxy Tab S9 FE in Samsung
Notes, because Kannada is quicker to write than to type. So the app captures pen strokes rather
than asking for typing:

- **Vectors, not a picture.** The pen path is stored as coordinates, so the same handwriting is
  redrawn crisply on screen, at the print head's 384 dots, and at whatever a future printer wants.
  A flattened image could only ever be scaled.
- **Palm rejection.** Once a real pen is seen, touch events are treated as palm contact and
  ignored — you can rest your hand on the tablet while writing.
- **Undo per stroke**, a baseline to write along, and points clamped to the pad so a pen dragged
  off the edge cannot stretch the saved bounding box.
- Handwriting is scaled to a fixed row height on the receipt and capped in width, so a long bill
  stays a sensible length of roll.

A line can be a catalogue item, handwriting, or a bare price. All three can sit on one bill.

## Kannada support, end to end

Verified on paper, not just on screen. Kannada works in every place text can appear:

| Where | Verified |
| --- | --- |
| Item names | Typed, and printed on the slip |
| Handwritten descriptions | Pen strokes have no script, so anything written prints as written |
| Customer name | Stored, searched by Kannada prefix, printed at the top of the slip |
| Shop name and footer | Both save and print (ಧನ್ಯವಾದಗಳು, ಮತ್ತೆ ಬನ್ನಿ!) |
| Search | Matches Kannada as well as English, on both the bill and the items page |
| Line breaking | A long word too wide for the paper breaks where Kannada allows — see below |

**Line breaking was the subtle one.** A description that will not fit has to break somewhere, and
slicing by code unit is fine for Latin and wrong for Kannada: `ಇಪ್ಪತ್ತೈದು` cut in half gives
`ಇಪ್ಪತ` and `್ತೈದು`, and that second piece starts with a bare virama which prints as a stray mark.
`ಅಕ್ಕಿ` cut in the middle splits the ಕ್ಕ conjunct. The browser breaks correctly on its own, so this
made the on-screen preview and the paper disagree — the one thing the shared receipt model exists to
prevent. `shared/src/text.ts` now breaks at grapheme clusters, joining any cluster that ends in a
virama to the next so conjuncts stay whole.

**The interface is available in Kannada too.** Settings → ಭಾಷೆ / Language switches every button,
label and message, and the words printed on the slip with them — ಒಟ್ಟು for TOTAL, ಪಾವತಿ for Paid,
ಬಾಕಿ for Balance, ಹೆಸರು and ಫೋನ್ for the customer block. Item and customer names are never
translated: they print exactly as they were entered.

The choice is a shop setting rather than a per-device one, so it follows the shop to a new tablet,
and it is served from the cached settings so it still applies when the counter is offline.

**The Kannada wording needs a native reviewer.** It is mine, and I cannot check it. Run:

```bash
npm run i18n:review
```

That writes [`docs/kannada-review.md`](docs/kannada-review.md) — 189 interface strings and the 6
receipt labels, English beside Kannada, grouped by screen, with the receipt words first because
those are what the customer reads. Someone who reads Kannada can mark it up without opening any
code; corrections go into the `KN` block of `shared/src/i18n.ts` and the sheet is regenerated.

`npm run i18ntest` guards the pair: both languages carry the same keys, no placeholder like `{n}`
is lost in translation, no string was left as English by accident, every key is actually used, and
no slip label is long enough to push the amount off the paper.

## Typing Kannada

Handwriting needs none of this -- a pen stroke has no script, so anything the shopkeeper writes
prints exactly as written. Typed item names are the case that needs help: a name is typed once into
the catalogue and searched hundreds of times after, and a tablet that has never had Gboard's Kannada
layout added cannot produce ಅಕ್ಕಿ at all.

So the Kannada field takes input two ways. The device keyboard works directly (the field is marked
`lang="kn"`, which is what prompts an Indic keyboard where one exists). Underneath it, **"No Kannada
keyboard? Type in English letters"** opens a box where `akki` becomes ಅಕ್ಕಿ
and `sakkare` becomes ಸಕ್ಕರೆ as you type.

The scheme is the usual ITRANS one: doubled vowels are the long ones (`oo` -> ೋ), capitals are
the retroflex consonants (`T D N L` -> ಟ ಡ ಣ ಳ), `M` -> ಂ. No scheme guesses
every word -- `godhi` gives ಗೊಧಿ where the shop wants ಗೋಧಿ
from `gOdhi` -- which is exactly why the result is shown as it is built and stays editable. There
are 15 checks over the mapping in the test suite.

## Printing

The shop is buying Shreyans printers: the **SRS583 (58mm)** and an **80mm** unit. Neither product
page publishes the Bluetooth profile or the dot width, and those two facts decide which path works
— so rather than guess, all three paths are built and the app tells you which applies.

### Paper width

**Settings → Paper** switches between 58mm and 80mm. This is not cosmetic: 58mm prints 384 dots
across, 80mm prints 576. Get it wrong and the slip comes out half-width or clipped at the edge.
A dot is the same physical size on both (203 dpi), so text is not rescaled — the wider roll simply
fits more on a line.

### The three ways to print

| Path | Reaches | Needs |
| --- | --- | --- |
| **System print dialog** (default) | Every printer, Classic or BLE | Nothing. On the tablet this is where **RawBT** appears; on a PC it is the installed driver. Also saves as PDF. |
| **Serial port** | A **Bluetooth Classic** printer, directly | Chrome/Edge on a computer. Pair the printer in Windows Bluetooth settings — that creates an outgoing COM port — then pick it in Settings. |
| **Bluetooth Low Energy** | A **BLE** printer, directly | Chrome, https or localhost. No pairing; the browser finds the printer. |

**Why the serial path exists.** A browser cannot open a Bluetooth SPP/RFCOMM socket — that is a
hard limitation of every browser, not something code can work around. But it does not need to: once
Windows has paired a Classic printer it exposes it as a COM port, and Web Serial can open that port
and write ESC/POS straight down it. So a Classic printer *can* be driven directly, from a PC.
Android has no Web Serial, so a tablet with a Classic printer uses RawBT through the print dialog.

**Which one for these printers?** Pair the printer, then try in this order:

1. **BLE** — Settings → Direct over Bluetooth Low Energy → Connect printer. If the printer appears
   and connects, use this. The app searches the service UUIDs these generic units use and picks
   whichever characteristic is writable, rather than requiring one fixed UUID.
2. If connecting fails with "no printer service the browser is allowed to use", it is Classic-only.
   On a PC use **Serial port**; on the tablet use the **system dialog** with RawBT.

The baud rate under the serial path only matters for a cabled serial printer — a Bluetooth COM port
ignores it. 9600 is the usual default; change it if the slip prints garbled.

### Kannada on the direct paths

For both direct paths the receipt is drawn to a canvas and thresholded to one bit per dot, because
cheap ESC/POS printers carry code pages for Latin, Cyrillic and CJK and none of them can render
Kannada as text. The browser can, so it draws and we send dots. Handwriting goes down the same
route. The system dialog needs none of this — the browser is already doing the rendering.

### Setting up

1. Pair the printer (or install it), and set the roll width in **Settings → Paper**.
2. Pick a path and connect.
3. **Settings → Test print.** The test slip bills 5 + 5 + 1 + 1 of the four items off the shop's own
   receipt. If it reads **1370**, the Kannada is legible and the dashed lines reach both edges of
   the paper, the setup is right. If the lines stop short of the edge, the paper setting is wrong.

## The phone app

`mobile/` is a React Native app (Expo) that does the same job as the web app, plus the one thing a
web app cannot do: it speaks **Bluetooth Classic** directly. That is the gap worth closing — most
portable thermal printers, the SRS583 among them, are Classic/SPP, and no browser on Android can
open an SPP socket. From the phone there is no RawBT and no computer in between.

It is not a wrapper around the website. The screens are native, but everything that decides what a
receipt *says* comes out of `shared/`: the money arithmetic, the receipt layout, the field rules,
the Kannada translations, the handwriting geometry. A bill written on the phone and the same bill
written at the counter are the same bill.

| | Web app | Phone app |
| --- | --- | --- |
| Bluetooth Classic printer, directly | PC only, through a COM port | **yes, from the phone itself** |
| BLE printer | yes | through the same Classic path, if the printer does both |
| System print dialog / RawBT | yes | not needed |
| Handwriting | pointer events on a canvas | touch and stylus, `react-native-svg` |
| Kannada | yes | yes, and the phone's own Kannada keyboard as well |

### The server address

The web app is served by the process it talks to, so it never had to ask. A phone is a different
machine, where `localhost` means the phone. So the first screen asks once and remembers:

```
192.168.1.5:4000
```

— the counter PC's LAN address and the API port, with both devices on the shop wifi (`ipconfig` on
the PC gives you the address). `http://` is filled in if you leave it off, and the address is
checked against `/api/health` before it is saved. Once the server is hosted somewhere this becomes
the hosted URL and the wifi stops mattering.

### Printing from the phone

Pair the printer in **Android's own Bluetooth settings first** — the app lists paired devices, it
does not pair them. Then **Settings → Connect printer**, choose it, and **Test print**: the same
1370 slip as on the web, so a wrong total or unreadable Kannada points at the setup rather than the
app.

[`scripts/printertest.js`](scripts/printertest.js) drives this whole path against a fake printer:
it asserts the phone and the counter PC emit **the same ESC/POS bytes** for the same receipt, that
the stream parses as valid ESC/POS with every dot row in a band, and that the Bluetooth transport
delivers all of it in order when the printer is already connected, refuses a write, drops the
socket mid-slip, or was never paired. What no test here can prove is that a Shreyans SRS583 likes
those bytes — that needs paper.

Kannada still cannot be sent as text, so the receipt is rasterised to dots exactly as on the web.
A phone has no canvas outside a WebView, so the rasteriser runs as an injected script inside an
invisible 1×1 WebView ([`RasterBridge.tsx`](mobile/src/print/RasterBridge.tsx)), fed every
measurement from `shared/` so the page holds the algorithm and none of the numbers. Because that
algorithm is the one piece of layout logic that had to be written twice,
[`scripts/rastertest.js`](scripts/rastertest.js) runs both copies against the same fake canvas and
compares the packed bits, dot for dot, over nine receipts — 58mm and 80mm, handwriting, Kannada
slip labels, a part payment, a bare price with no description, and a long Kannada word that has to
break. A slip printed from the phone is the same paper as one printed at the counter, or that test
fails.

### Building the .apk

Two routes, both already configured. The app cannot be built on a machine with no Android
toolchain, which is why there is no `.apk` in this repo — the machine it was written on has no
Java, no Gradle and no Android SDK.

**Expo cloud build — nothing to install locally:**

```bash
npx eas login
```

```bash
npm run apk
```

A free Expo account is enough. It uploads the project, builds on Expo's Android machines and hands
back a download link; open that on the phone and install it. Ten to twenty minutes, most of it
queueing.

**This has to be a git repository, and that is not a formality.** eas-cli finds the repository root
and uploads from there; without one it falls back to the current directory, which is `mobile/` —
and an archive of `mobile/` alone has no `shared/` in it and no lockfile beside it. The build then
fails in its first ten seconds, with yarn asking the public npm registry for `@shridhar/shared` and
being told it does not exist. Do **not** set `EAS_NO_VCS=1` to get past the warning; that is what
causes it.

Two things follow from the upload being the whole workspace: the root `package-lock.json` travels
with it, so EAS uses npm, which understands workspaces (with no lockfile it reaches for yarn, which
here does not) — and `shared/dist`, being gitignored, is rebuilt in the cloud by `shared`'s own
`prepare` script during install. `npm ci` on a wiped tree reproduces that step exactly, if you want
to check it before spending a build.

**Local build — needs JDK 17 and the Android SDK (~3 GB):**

```bash
npm run apk:local --workspace @shridhar/mobile
```

What *has* been verified without a toolchain is that the app compiles and bundles:
`npx expo export --platform android` turns all 738 modules into a 2.25 MB Hermes bundle, so a build
has nothing left to discover except signing.

To try the app before building anything, `npm run mobile` and scan the QR code with **Expo Go** —
everything works there except Bluetooth printing, which needs the native module and so needs a real
build.

## Bugs found by testing, and fixed

Driving the real app rather than only reading it found twelve defects. None of these would have shown
up in a typecheck.

**Money and data correctness**

1. **The same customer was stored twice when a country code was typed.** `9886012345` and
   `+91 98860 12345` became two records, so one person's khata split across both and neither
   balance was right. Phone numbers now fold to one canonical form (country code and trunk zero
   removed) in `shared/src/phone.ts`, used by the browser and the server so they cannot disagree.
2. **A part payment was silently discarded by switching tabs.** `paid` and `showBalance` were local
   to the Bill page, which React unmounts on navigation — entering "paid 200", glancing at Settings
   and coming back recorded the bill as paid in full and printed no balance. Both now live in the
   shared bill draft next to the cart and the customer.
3. **Every numeric field went through `Number()`**, which accepts things nobody means: `1e3` became
   1000, `0x1f` became 31, and `''` and `' '` both became 0. All field rules now live in
   `client/src/lib/fields.ts` behind a strict decimal parser, with 248 checks over them.

**Things that looked like they worked**

4. **Strokes made in quick succession overwrote each other.** `finishStroke` read the stroke list
   out of its render closure, so two pen-ups in one React batch kept only the last — handwriting
   arrived as a single squiggle. Kannada is a lot of short strokes, so this broke the headline
   feature. The list now lives in a ref that state only mirrors for repaints.
5. **The customer search ignored the name whenever the query had no digits.** The phone clause was
   `phone.includes(query.replace(/\D/g,''))`, which for a letters-only query is `includes('')` —
   true for every string. Searching a name that matched nobody listed everybody.
6. **A wrong PIN reported "Your session has expired."** The API client rewrote every 401, including
   the login route's, where 401 means the PIN was wrong. It now lets that one through.
7. **Clearing the shop name did nothing at all** — no save, no error, and the field left blank while
   the real setting kept the old name. It now refuses the change and puts the name back.

**Layout and printing**

8. **The receipt preview overflowed its paper by one padding**, clipping the amount column —
   "123" printed as "12". The element being measured also carried the `max-width` derived from that
   measurement, so the two fed each other and never converged. Measuring and sizing are now on
   separate elements. Worst on the 80mm roll, which is what surfaced it.
9. **Bluetooth printing stalled when the tab went to the background.** Chunks were paced with
   `setTimeout`, which browsers throttle to about a second once the tab is not in front; a receipt
   took minutes or stopped halfway. Acknowledged GATT writes give real backpressure, so those are
   preferred now and the timer is only a fallback.
10. **A first boot interrupted part-way left the shop permanently half-stocked.** The starter
    catalogue was written one item at a time; a restart after the fourth left four items on disk,
    and because the "is this shop empty?" check then passed, the other twenty were never written.
    Seeding is now a single write, so the outcome is all of them or none — and none is retried on
    the next boot. `npm run seedtest` covers it.
11. **Long Kannada words broke mid-conjunct on paper.** The print rasteriser sliced over-long
    words by code unit, leaving a fragment starting with a bare virama. Now broken at grapheme
    clusters, with conjuncts kept whole.
12. **The wait before `window.print()` could hang forever.** `requestAnimationFrame` never fires in
    a background tab, so the print was lost silently and the button stuck on "Printing". Both the
    font wait and the frame wait are now capped.

## Two honest gaps

**The "notification" is in-app, not a push.** Customers who have bought before but not been in for
N days (Settings, default 30) are listed on the Customers page with a count badge on its tab. That
is a list the shopkeeper sees when they open the app — not a notification that arrives on their
phone while it is closed. Real push needs a service worker, VAPID keys, a stored subscription per
device and a server-side scheduler to fire it; the data and the endpoint
(`GET /api/customers/inactive`) are already there, so it is additive work rather than a rewrite.

**A bill cannot be recorded while the counter has no network.** This is a web app talking to a
database. The item list and shop name are cached in the browser, so the billing screen still draws
and says plainly what is wrong, but saving needs the server. A kirana counter does lose its
connection. The fix is a queue in the browser that holds finished bills and posts them when the
network returns — bill numbering would have to move off the server counter to make that work, so it
is a real piece of work rather than a flag to flip.

## API

Everything except `/api/health` and `/api/auth/login` needs `Authorization: Bearer <token>`.

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/auth/login` | `{ pin }` → `{ token }`, valid 30 days |
| `GET` | `/api/health` | `{ ok, storage: "mongo" \| "file" }` |
| `GET` `POST` | `/api/items` | List, or create (id derived from the name if omitted) |
| `PUT` `DELETE` | `/api/items/:id` | Edit or remove |
| `GET` `PUT` | `/api/settings` | Shop name, footer, print rates, quiet-days window |
| `GET` `POST` | `/api/customers` | List with running totals, or create/merge |
| `GET` | `/api/customers/search?q=` | Prefix match on name or number — the suggestions |
| `GET` | `/api/customers/inactive` | `{ days, customers }` — the quiet list |
| `GET` | `/api/customers/:id` | The customer plus their bills |
| `PUT` `DELETE` | `/api/customers/:id` | Edit or remove |
| `GET` | `/api/bills?limit=&customerId=` | Newest first |
| `GET` | `/api/bills/:no` | One bill |
| `POST` | `/api/bills` | `{ lines, customerId?, paid?, showBalance? }`. **The server assigns the number and computes the total and the balance** — figures sent by the browser are ignored |
| `GET` | `/api/summary/today` | `{ count, total }` |

Bills store their own copy of every name, stroke, rate and customer detail, so editing an item or
renaming a customer never rewrites a bill that has already been printed.

A customer's running figures live on their record and move when a bill is written; if the bill
insert then fails, the move is rolled back. That is safe because bills are never edited or deleted
in this app — if that ever changes, the totals would need recomputing from the bills instead.

## How the receipt fits together

```
shared/src/doc.ts           the one description of what a receipt looks like
      |                     (shop name, customer, item/ink lines, total, paid, balance, footer)
      +--> components/ReceiptView.tsx   the same rows on screen, and through a portal
      |                                 into #print-root, on paper (handwriting as SVG)
      +--> print/raster.ts              the same rows drawn on a canvas, thresholded to dots
                  |
            print/escpos.ts             dots -> GS v 0 raster commands, in 64-row bands
                  |
            print/bluetooth.ts          chunked GATT writes to a BLE printer
```

`npm run selftest` exercises that pipeline against a fake canvas — including handwriting geometry
and that an ink row actually puts dots on the page — then boots the real server against the JSON
store and drives the API: auth, validation, stroke limits, bill numbering, server-side totals,
customer merging by phone, balances accumulating across bills, and the quiet-customer window. It
cannot tell you whether the Kannada glyphs look right; only paper can.

## Before going live

1. **Confirm the four Kannada names.** The first four items in
   [`server/src/seed.ts`](server/src/seed.ts) were read off the photo of the paper slip and are a
   **best guess at the handwriting** — I read them as ಗಾಣದ ಎಣ್ಣೆ and ಮೆಣಸಿನಕಾಯಿ. Their rates are
   exact (550 ÷ 5 = 110, 615 ÷ 5 = 123, 50, 155). Everything after those four is ordinary kirana
   stock at placeholder rates, there only so the app isn't empty on day one.
2. **Change `AUTH_PIN` and set a long random `JWT_SECRET`** in the production `server/.env`. Both
   were changed for this development machine on 2026-09-05, but `.env` is gitignored and does not
   travel -- the deployed server needs its own, generated fresh:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   The server prints a warning every boot while either is still at its default. Rotating
   `JWT_SECRET` signs every phone and tablet out at once, which is how a lost device is revoked.
3. **Set `CORS_ORIGIN`** to the real site once hosted, and serve over https — Web Bluetooth and
   saved logins both need a secure context.
4. **Write a few bills by hand on the tablet and print them**, to check the handwriting is legible
   at 58mm before the staff rely on it.
5. **On the phone app, set the server address to the hosted URL** rather than a LAN address, or it
   stops working the moment the phone leaves the shop wifi.

## Notes

- Money goes through [`shared/src/money.ts`](shared/src/money.ts) everywhere, so a line total and
  the grand total can never disagree by a stray fraction of a paisa.
- Bill numbers come from an atomic `$inc` on a counter document, so two tills cannot take the same
  number.
- A customer is matched by phone number on save, so re-entering a regular at the counter updates
  them instead of creating a duplicate.
- `shared` ships both CommonJS and ESM builds — the Node server requires the former, Vite needs the
  latter to name-import.
- The waits before `window.print()` are capped on purpose: `requestAnimationFrame` never fires while
  a tab is in the background, and an uncapped wait loses the print silently.
