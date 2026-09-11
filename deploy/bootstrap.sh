#!/usr/bin/env bash
#
# Sets up a fresh Ubuntu 24.04 box to run Simple Sales Book, from nothing to serving over HTTPS.
#
# Run it once, as the ubuntu user, on a box that has an elastic IP and a hostname already
# pointing at it:
#
#   curl -fsSL https://raw.githubusercontent.com/Abhishekjohri1998/shridhar-kirana-store/main/deploy/bootstrap.sh | bash
#
# It asks for the three secrets rather than taking them on the command line, so they never appear
# in your shell history, in this repository, or in a chat window. Everything else it works out or
# installs.
#
# Safe to run again: every step checks whether it has already been done.

set -euo pipefail

REPO="${REPO:-https://github.com/Abhishekjohri1998/shridhar-kirana-store.git}"
APP_DIR="${APP_DIR:-/opt/shridhar}"
PORT="${PORT:-4000}"

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mxx\033[0m %s\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Run this as the ubuntu user, not root. It uses sudo where it needs to."

# ---------------------------------------------------------------- what it needs to know

# Every value can arrive in the environment instead of being typed, so this can be driven from
# a laptop as well as pasted into a terminal. Passed through the environment rather than as
# arguments on purpose: arguments are visible to anyone running `ps` on the box.
say "Where this box answers from"
HOSTNAME_IN="${APP_HOST:-}"
if [ -n "$HOSTNAME_IN" ]; then
  echo "    $HOSTNAME_IN"
else
  read -r -p "Hostname (e.g. shridhar-billing.duckdns.org): " HOSTNAME_IN
fi
[ -n "$HOSTNAME_IN" ] || die "A hostname is required: Caddy asks Let's Encrypt for a certificate in that name."

# Checked before anything is installed, because a certificate request against a name that does
# not point here burns one of a limited number of attempts.
say "Checking $HOSTNAME_IN points at this machine"
THIS_IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com || echo '')"
NAME_IP="$(getent hosts "$HOSTNAME_IN" | awk '{print $1}' | head -1 || echo '')"
if [ -z "$NAME_IP" ]; then
  die "$HOSTNAME_IN does not resolve yet. Point it at $THIS_IP and wait a minute, then run this again."
elif [ "$NAME_IP" != "$THIS_IP" ]; then
  die "$HOSTNAME_IN points at $NAME_IP, but this machine is $THIS_IP. Fix the DNS record first."
fi
echo "    $HOSTNAME_IN -> $THIS_IP, correct."

say "The secrets"
echo "    Written straight to $APP_DIR/server/.env (mode 600). Nothing is echoed."
MONGO_IN="${MONGO_URI:-}"
if [ -n "$MONGO_IN" ]; then
  echo "    Atlas connection string: supplied."
else
  read -r -s -p "MongoDB Atlas connection string: " MONGO_IN; echo
fi
[ -n "$MONGO_IN" ] || die "Without this the server quietly stores bills in a JSON file instead of Atlas."
case "$MONGO_IN" in
  mongodb+srv://*|mongodb://*) ;;
  *) die "That does not look like a connection string -- it should start with mongodb+srv://" ;;
esac

PIN_IN="${AUTH_PIN:-}"
if [ -n "$PIN_IN" ]; then
  echo "    Shop PIN: supplied."
else
  read -r -s -p "Shop PIN (the six digits the counter types): " PIN_IN; echo
fi
[ -n "$PIN_IN" ] || die "A PIN is required."
[ "$PIN_IN" != "1234" ] || die "1234 is the insecure default. Pick the shop's real PIN."

# Generated here rather than asked for: nobody needs to know it, and one typed by hand would be
# weaker than 48 random bytes.
JWT_IN="$(openssl rand -base64 48)"
echo "    JWT secret generated on this machine."

# ---------------------------------------------------------------- the machine

say "Updating packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

if ! sudo swapon --show | grep -q /swapfile; then
  # A t3.micro has 1 GB of RAM. Without swap the TypeScript and Vite builds are killed part way
  # through and leave a half-built client that the server reports as "Client build not found".
  say "Adding 2 GB of swap so the build cannot be killed for memory"
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "    Swap already present."
fi

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  say "Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
fi
echo "    node $(node -v), npm $(npm -v)"

command -v git >/dev/null || sudo apt-get install -y -qq git
sudo apt-get install -y -qq unattended-upgrades

# ---------------------------------------------------------------- the application

if [ -d "$APP_DIR/.git" ]; then
  say "Updating the code already in $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  say "Fetching the code into $APP_DIR"
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER:$USER" "$APP_DIR"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

say "Writing $APP_DIR/server/.env"
umask 077
cat > "$APP_DIR/server/.env" <<ENVFILE
NODE_ENV=production
PORT=$PORT
MONGO_URI=$MONGO_IN
JWT_SECRET=$JWT_IN
AUTH_PIN=$PIN_IN
CORS_ORIGIN=https://$HOSTNAME_IN
ENVFILE
chmod 600 "$APP_DIR/server/.env"
umask 022
unset MONGO_IN JWT_IN PIN_IN

say "Installing dependencies and building (a few minutes on a small box)"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build

[ -f "$APP_DIR/server/dist/index.js" ] || die "The server did not build."
[ -f "$APP_DIR/client/dist/index.html" ] || die "The web app did not build -- check for an out-of-memory kill above."

# ---------------------------------------------------------------- keeping it running

say "Installing the service"
sudo tee /etc/systemd/system/shridhar.service >/dev/null <<UNIT
[Unit]
Description=Simple Sales Book
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
# This directory matters twice over: dotenv reads .env from here, and the server looks for the
# built web app at ../../client/dist relative to its own compiled files.
WorkingDirectory=$APP_DIR/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now shridhar
sudo systemctl restart shridhar
sleep 4

say "Checking the server came up against Atlas"
HEALTH="$(curl -fsS --max-time 10 "http://localhost:$PORT/api/health" || echo '')"
echo "    $HEALTH"
case "$HEALTH" in
  *'"storage":"mongo"'*) echo "    Connected to Atlas." ;;
  *'"storage":"file"'*)
    die "The server is storing bills in a JSON FILE, not Atlas. The connection string is wrong, or
    Atlas Network Access does not list this machine's IP ($THIS_IP). Fix it, then:
      nano $APP_DIR/server/.env && sudo systemctl restart shridhar" ;;
  *) die "No answer from the server. Look at: sudo journalctl -u shridhar -n 50 --no-pager" ;;
esac

# ---------------------------------------------------------------- HTTPS

if ! command -v caddy >/dev/null; then
  say "Installing Caddy, which gets and renews the certificate by itself"
  sudo apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq caddy
fi

say "Pointing Caddy at the app"
sudo tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$HOSTNAME_IN {
	reverse_proxy 127.0.0.1:$PORT

	# A bill of forty handwritten lines is a few hundred kilobytes of stroke coordinates. The
	# server itself caps a request body at 256 KB; keep the proxy well clear of that.
	request_body {
		max_size 2MB
	}

	encode gzip
	log {
		output file /var/log/caddy/access.log
	}
}
CADDY

sudo systemctl restart caddy
say "Waiting for the certificate"
for i in $(seq 1 20); do
  if curl -fsS --max-time 10 "https://$HOSTNAME_IN/api/health" >/dev/null 2>&1; then break; fi
  sleep 6
done

PUBLIC="$(curl -fsS --max-time 15 "https://$HOSTNAME_IN/api/health" || echo '')"
if [ -z "$PUBLIC" ]; then
  warn "The site is not answering over HTTPS yet. Caddy may still be working; check with:
    sudo journalctl -u caddy -n 40 --no-pager
  The usual causes are port 443 closed in the security group, or DNS not yet settled."
  exit 1
fi

cat <<DONE

  ------------------------------------------------------------------
   Live at  https://$HOSTNAME_IN
   Health   $PUBLIC

   It starts on boot, restarts if it crashes, and renews its own
   certificate. The laptop is no longer part of the arrangement.

   Next:
     - Open https://$HOSTNAME_IN and sign in with the shop PIN.
     - Add EC2_HOST and EC2_SSH_KEY to the repository's GitHub
       secrets, and pushes to main will deploy themselves.

   Logs:  sudo journalctl -u shridhar -f
  ------------------------------------------------------------------

DONE
