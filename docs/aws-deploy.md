# Putting Simple Sales Book on AWS

A runbook for moving the shop off the laptop-plus-tunnel arrangement and onto an address that
stays the same. Follow it top to bottom; every command is meant to be pasted as written except
where a value in `ANGLE BRACKETS` has to be yours.

Where this ends up: one small Ubuntu machine on EC2 with a fixed IP, running the Express server
behind Caddy, which gets and renews the HTTPS certificate on its own. MongoDB stays on Atlas —
there is no reason to run a database on this box and every reason not to. The React app is served
by the same server on the same address, so there is one URL for the shop to remember and none of
it needs CORS.

Roughly ₹0/month for the first twelve months on a new AWS account (t3.micro free tier), then
about ₹700–900/month. The hostname is free.

---

## Step 0 — What you need before you start

- **A hostname.** Not optional, but it does not have to cost anything. Android has blocked
  cleartext HTTP since API 28, and the app forces `https://` for any public hostname
  (`shared/src/serverUrl.ts`); HTTPS needs a certificate, and a certificate needs a name that
  resolves publicly. This runbook uses a free **DuckDNS** subdomain, set up in Step 5 — the shop
  types it once in Settings and never sees it again, which is all it is for.

  `shridhargeneralstores.com` was considered and is **not registered** (the lookup returns
  NXDOMAIN), so it would have to be bought first. Nothing here stops you doing that later: if the
  shop ever wants a website or email on its own name, buy it then, add an A record beside the
  others, and change the address in Settings on the two devices. Everything else stays as it is.
- **An AWS account** with billing set up.
- **The Atlas connection string** — rotated first, see Step 1.
- **A new JWT secret.** Generate it on your own machine and keep it out of chat:
  ```bash
  openssl rand -base64 48
  ```
- **The shop's PIN** (currently the six digits the shop already uses).
- **An SSH client.** Windows has one built in; `ssh` in PowerShell or Git Bash works.

Throughout, this runbook uses `shridhar-billing.duckdns.org` for the hostname and
`/opt/shridhar` for the directory on the server. If you pick a different DuckDNS name in Step 5,
substitute it everywhere — including in the Caddyfile, which is the one place where a wrong
hostname fails in a confusing way.

---

## Step 1 — Rotate the Atlas password and scope the user (do this first)

The current password was pasted into a chat window in plain text, so treat it as public.

1. Atlas → **Database Access** → the `<ATLAS-USER>` row → **Edit**.
2. **Edit Password** → **Autogenerate Secure Password** → copy it somewhere safe (a password
   manager, not a chat window) → **Update User**.
3. While you are there, change **Database User Privileges** from `readWriteAnyDatabase` to
   **Specific Privileges**: role `readWrite`, database `simple-sales-book`. A leaked credential
   that can only touch one database is a much smaller problem.
4. Build the new connection string — same as the old one with the new password and the database
   name on the end:
   ```
   mongodb+srv://<ATLAS-USER>:<NEW-PASSWORD>@<YOUR-CLUSTER>.mongodb.net/simple-sales-book?retryWrites=true&w=majority
   ```

Anything still running with the old password stops working at this point. That is fine — the
laptop server is already down.

---

## Step 2 — Launch the EC2 instance

EC2 → **Launch instance**.

| Field | Value |
| --- | --- |
| Name | `shridhar-billing` |
| AMI | **Ubuntu Server 24.04 LTS**, 64-bit (x86) |
| Instance type | **t3.micro** (free tier eligible). If your free tier is used up, `t4g.small` on Arm is cheaper — pick the **Arm** Ubuntu AMI if you do |
| Key pair | **Create new key pair** → RSA, `.pem` → it downloads once, keep it |
| Storage | 20 GiB, gp3 |

Under **Network settings** → **Edit** → create a security group with exactly three inbound rules:

| Type | Port | Source | Why |
| --- | --- | --- | --- |
| SSH | 22 | **My IP** | so only you can log in |
| HTTP | 80 | Anywhere `0.0.0.0/0` | Caddy needs it to get the certificate |
| HTTPS | 443 | Anywhere `0.0.0.0/0` | the app itself |

Do **not** open 4000. Nothing outside the box should reach the Node server directly.

Launch it.

---

## Step 3 — Give it an address that never changes

A stopped-and-started instance gets a new public IP, which would put you right back where the
tunnel left you.

1. EC2 → **Elastic IPs** → **Allocate Elastic IP address** → **Allocate**.
2. Select it → **Actions** → **Associate Elastic IP address** → choose the `shridhar-billing`
   instance → **Associate**.
3. Write the IP down. This runbook calls it `<ELASTIC-IP>`.

An Elastic IP is free while it is attached to a running instance, and charged if you leave it
allocated to nothing.

---

## Step 4 — Lock Atlas to that one address

Atlas → **Network Access**.

1. **Add IP Address** → enter `<ELASTIC-IP>/32` → comment "AWS billing server" → **Confirm**.
2. **Delete** the `0.0.0.0/0` entry.

Your own laptop will now be refused by Atlas. If you need to connect from it for maintenance, add
your own IP temporarily and remove it afterwards.

---

## Step 5 — Claim the free hostname and point it at the box

1. Go to **https://www.duckdns.org** and sign in with Google, GitHub or Reddit. There is no
   password to remember and nothing to pay.
2. In the **domains** box type `shridhar-billing` and press **add domain**. If it is taken, try
   `shridhar-kirani` or `shridhar-billing-ks`. You now own `shridhar-billing.duckdns.org` for as
   long as you use it.
3. In the **current ip** field for that row, put your `<ELASTIC-IP>` and press **update ip**.
4. Copy the **token** shown at the top of the page and keep it with your other credentials. You
   need it only if the IP ever changes — see the note below.

Then wait for it to resolve, and check from your own machine:

```bash
nslookup shridhar-billing.duckdns.org 1.1.1.1
```

**Do not go on to Caddy until this returns your Elastic IP.** Caddy asks Let's Encrypt to verify
the name by connecting to it, and there are rate limits on failed attempts — `duckdns.org` is a
shared domain, so burning attempts is worth avoiding.

### About the IP changing

It should not. An Elastic IP stays yours until you release it, which is the whole reason for
Step 3, so there is no need for the usual DuckDNS updater cron job. Should you ever rebuild the
box on a different address, one command re-points it:

```bash
curl "https://www.duckdns.org/update?domains=shridhar-billing&token=<YOUR-TOKEN>&ip=<NEW-IP>"
```

It answers with `OK` or `KO`.

---

## Steps 6 to 12 — one command

Everything from here to a working HTTPS site is in `deploy/bootstrap.sh`. SSH in and run it:

```bash
ssh -i "C:/path/to/your-key.pem" ubuntu@<ELASTIC-IP>
```

```bash
curl -fsSL https://raw.githubusercontent.com/Abhishekjohri1998/shridhar-kirana-store/main/deploy/bootstrap.sh | bash
```

It asks for two things — the Atlas connection string and the shop's PIN — and generates the JWT
secret itself. They are typed, not echoed, and go straight into `server/.env` with mode 600, so
they never reach the repository or a shell history.

Then it adds swap, installs Node 22, clones the code, builds it, installs the systemd service,
installs Caddy, and waits for the certificate. It checks the hostname resolves to this machine
*before* installing anything, because a certificate request against a name that points elsewhere
burns one of a limited number of attempts. It refuses to finish unless `/api/health` says
`"storage":"mongo"` — a `"file"` answer means the shop would be billing into a JSON file nobody
backs up.

Safe to run twice: every step checks whether it has already been done.

The rest of this document is what the script does, step by step, for when something needs
unpicking by hand.

---

## Step 6 — Log in and prepare the machine

```bash
ssh -i "C:/path/to/your-key.pem" ubuntu@<ELASTIC-IP>
```

If Windows refuses the key as "too open", right-click the `.pem` → Properties → Security →
Advanced → Disable inheritance → remove everyone except your own user.

Then, on the server:

```bash
sudo apt update && sudo apt upgrade -y
```

**Add swap.** A t3.micro has 1 GB of RAM, and the TypeScript and Vite builds will run out of it
and be killed. Two gigabytes of swap costs nothing and makes the build reliable:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

**Install Node 22 LTS** (not Ubuntu's, which is too old) and git:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v && npm -v
```

**Turn on unattended security updates:**

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Step 7 — Get the code onto the server

The repository is local-only — there is no remote — so pick one of these.

### Option A (recommended): a private GitHub repository

Future updates then become one `git pull`. On **your machine**:

```bash
cd "D:/shridhar project"
gh repo create shridhar-billing --private --source=. --remote=origin --push
```

On the **server**, create a deploy key and give GitHub the public half:

```bash
ssh-keygen -t ed25519 -C "shridhar-billing-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Copy that line into GitHub → your repo → **Settings** → **Deploy keys** → **Add deploy key**
(read-only is enough). Then:

```bash
sudo mkdir -p /opt/shridhar && sudo chown ubuntu:ubuntu /opt/shridhar
git clone git@github.com:<YOUR-USER>/shridhar-billing.git /opt/shridhar
```

### Option B: copy a tarball up

On **your machine**:

```bash
cd "D:/shridhar project"
git archive --format=tar.gz -o /tmp/shridhar.tar.gz HEAD
scp -i "C:/path/to/your-key.pem" /tmp/shridhar.tar.gz ubuntu@<ELASTIC-IP>:/tmp/
```

On the **server**:

```bash
sudo mkdir -p /opt/shridhar && sudo chown ubuntu:ubuntu /opt/shridhar
tar -xzf /tmp/shridhar.tar.gz -C /opt/shridhar
```

Either way, `git archive`/`git clone` carries only committed files — `.env` is not among them,
which is the point. You write the production one by hand in the next step.

---

## Step 8 — Write the production environment file

```bash
cd /opt/shridhar/server
nano .env
```

```ini
NODE_ENV=production
PORT=4000
MONGO_URI=mongodb+srv://<ATLAS-USER>:<NEW-PASSWORD>@<YOUR-CLUSTER>.mongodb.net/simple-sales-book?retryWrites=true&w=majority
JWT_SECRET=<THE 48-BYTE STRING FROM STEP 0>
AUTH_PIN=<THE SHOP’S PIN>
CORS_ORIGIN=https://shridhar-billing.duckdns.org
```

```bash
chmod 600 .env
```

Notes on these, from `server/src/env.ts`:

- Leaving `MONGO_URI` empty is not a harmless mistake: the server silently falls back to a JSON
  file in `server/.data/` and the shop bills into a file nobody backs up. It warns on startup —
  read the log in Step 11.
- `JWT_SECRET` signs every login. Changing it later signs out every device at once, which is
  exactly how you revoke a lost tablet.
- `CORS_ORIGIN` barely matters here because the app is served from the same origin, but set it
  anyway so a stray browser elsewhere cannot call the API.

---

## Step 9 — Install and build

```bash
cd /opt/shridhar
npm ci
npm run build
```

`npm run build` builds `shared`, then the server, then the React app. It takes a few minutes on a
t3.micro. The server serves the React build from `<repo>/client/dist`, resolved relative to its
own compiled path — which is why the whole repository lives on the box rather than just the server
folder.

Check the build produced both halves:

```bash
ls -la /opt/shridhar/server/dist/index.js /opt/shridhar/client/dist/index.html
```

---

## Step 10 — Run it as a service

So it starts on boot and restarts if it falls over.

```bash
sudo nano /etc/systemd/system/shridhar.service
```

```ini
[Unit]
Description=Simple Sales Book
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
# The working directory matters twice over: dotenv reads .env from here, and the server finds the
# React build at ../../client/dist relative to its own compiled files.
WorkingDirectory=/opt/shridhar/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shridhar
sudo systemctl status shridhar --no-pager
```

---

## Step 11 — Check it before putting a certificate in front of it

```bash
curl -s localhost:4000/api/health
```

You want exactly this:

```json
{"ok":true,"storage":"mongo"}
```

If it says `"storage":"file"`, the `MONGO_URI` is wrong or Atlas is refusing the connection — go
back to Steps 1, 4 and 8. Do not carry on; the shop would be billing into a file.

Read the startup log for the warnings the server shouts on purpose:

```bash
sudo journalctl -u shridhar -n 40 --no-pager
```

Any line about `JWT_SECRET is unset` or `AUTH_PIN is still 1234` means the `.env` is not being
read.

---

## Step 12 — Caddy, for HTTPS that renews itself

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the whole file with:

```caddyfile
shridhar-billing.duckdns.org {
	reverse_proxy 127.0.0.1:4000

	# A bill with forty handwritten lines is a few hundred kilobytes of stroke coordinates.
	# The server itself caps a request body at 256 KB; keep the proxy well clear of that.
	request_body {
		max_size 2MB
	}

	encode gzip
	log {
		output file /var/log/caddy/access.log
	}
}
```

```bash
sudo systemctl restart caddy
sudo systemctl status caddy --no-pager
```

Caddy now fetches a Let's Encrypt certificate on its own and renews it for as long as it runs. If
it fails, the reason is in `sudo journalctl -u caddy -n 50 --no-pager` — almost always DNS not yet
pointing at the box (Step 5).

---

## Step 13 — Confirm from outside

From your own machine, not the server:

```bash
curl -s https://shridhar-billing.duckdns.org/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://shridhar-billing.duckdns.org/
```

Expect `{"ok":true,"storage":"mongo"}` and `200`. Then open
`https://shridhar-billing.duckdns.org` in a browser and sign in with the PIN.

An unauthenticated API call must be refused — check that the door is actually locked:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://shridhar-billing.duckdns.org/api/settings
```

`401` is the right answer.

---

## Step 14 — Point the shop's devices at it

- **Tablet and phone:** Settings → **Change server** → enter `https://shridhar-billing.duckdns.org` →
  sign in with the PIN. The app normalises the address itself, so with or without the `https://`
  both work.
- **Counter PC:** just open `https://shridhar-billing.duckdns.org` in the browser and bookmark it.

Nothing about the app build changes, and over-the-air updates keep working exactly as before —
the server address is stored on the device, not baked into the APK.

---

## Running it from here

**Deploying a change** (Option A from Step 7):

```bash
cd /opt/shridhar
git pull
npm ci
npm run build
sudo systemctl restart shridhar
curl -s localhost:4000/api/health
```

About ten seconds of downtime while it restarts. Do it outside shop hours.

**Watching it:**

```bash
sudo journalctl -u shridhar -f          # the server, live
sudo journalctl -u shridhar -n 100      # the last hundred lines
sudo tail -f /var/log/caddy/access.log  # requests arriving
systemctl status shridhar caddy         # both services at a glance
```

**Backups.** The data lives in Atlas, so Atlas is what needs backing up. On the M0 free tier there
are no automatic backups — take a manual dump somewhere safe on a schedule, or move to M2/M10
where snapshots are included. This is the one remaining single point of failure and it is worth
spending a few dollars a month on.

**Cost.** t3.micro is free for twelve months on a new account, then roughly $8–10/month; the
Elastic IP is free while attached; the DuckDNS name and the certificate are free; outbound traffic
for a shop this size is pennies. Budget ₹0 for the first year and about ₹1,000/month after it.

The twelve-month mark is worth a calendar reminder — the free tier ends quietly and the first
real bill is the notification.

---

## Things worth knowing before they bite

- **The PIN is the only lock on the door.** Anyone with the URL and six digits is in. It is fine
  for a shop counter and it is not fine as the internet's only obstacle — if you ever want it
  tighter, the honest next step is per-device tokens rather than a longer PIN.
- **A handwritten bill is large.** The server caps a request body at 256 KB
  (`server/src/index.ts`). Forty ink lines at three to four kilobytes each gets within sight of
  that. If a very long bill ever fails to save, that limit is the first thing to raise.
- **Restarting is not zero-downtime.** A single instance means a restart is a gap. For a shop
  that is fine; just do not deploy mid-afternoon.
- **The old tunnel is dead once you finish this.** Delete `scripts/CURRENT-TEST-URL.txt`, and stop
  starting `cloudflared` — a second live copy of the server pointing at the same Atlas database is
  a good way to get confused about which one the shop is using.

## If it goes wrong

| Symptom | First thing to check |
| --- | --- |
| Browser cannot reach the site at all | Security group has 443 open; `systemctl status caddy` |
| Certificate error | `journalctl -u caddy`; DNS actually resolving to the Elastic IP |
| Site loads, "Client build not found" | `npm run build` did not finish — look for an out-of-memory kill, and check the swap from Step 6 |
| Health says `"storage":"file"` | `MONGO_URI` wrong, or Atlas Network Access does not list the Elastic IP |
| App on the tablet says it cannot reach the server | Address typed with `http://`; or DNS not yet propagated on the shop's network — try mobile data to tell the two apart |
| Everything worked, now 502 | `systemctl status shridhar`; `journalctl -u shridhar -n 50` |
