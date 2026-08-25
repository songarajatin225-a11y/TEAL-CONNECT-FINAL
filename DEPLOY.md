# Deploying to your own server

The app is static files. A Supabase project holds the database and the
authentication server; this machine serves the files and terminates TLS.
Nothing here holds a secret, and there is no database to run or back up on it.

Set up Supabase first — [BACKEND.md](BACKEND.md).

**You will need:** a VPS running a recent Ubuntu or Debian, a domain pointing
at its IP, and Docker.

---

## 1. The server

```sh
ssh root@YOUR-SERVER

apt update && apt upgrade -y
apt install -y ca-certificates curl git

# Docker, from Docker's own repository — the distribution packages lag.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Deploy as a normal user rather than root:

```sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

### Firewall

Only SSH and HTTPS need to be reachable. The app container binds to
`127.0.0.1`, so it is not exposed even before this.

```sh
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp     # certificate renewal only; redirects to 443
ufw allow 443/tcp
ufw --force enable
```

## 2. The app

```sh
su - deploy
git clone https://github.com/songarajatin225-a11y/teal-connect-final.git
cd teal-connect-final

cp .env.example .env
nano .env          # SUPABASE_URL and SUPABASE_ANON_KEY, from BACKEND.md

docker compose up -d --build
curl -s localhost:8080/healthz     # → ok
```

The container writes `config.json` from those two variables at start-up, which
is what makes one image usable for staging and production without a rebuild.

Use the **anon** key. `docker-entrypoint.sh` refuses to start if it is given a
service_role key — that file is downloaded by every browser.

## 3. TLS and the domain

Point an `A` record at the server's IP and wait for it to resolve
(`dig +short leads.example.com`) before asking for a certificate — Let's
Encrypt validates over HTTP and will fail otherwise.

```sh
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/leadconnect`:

```nginx
server {
  listen 80;
  server_name leads.example.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/leadconnect /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d leads.example.com
```

Certbot rewrites that file to serve TLS and redirect port 80. Renewal is
installed as a timer; confirm it with `sudo certbot renew --dry-run`.

Open `https://leads.example.com` and sign in with an account from the seed run.

## 4. Check it is actually working

```sh
# Serving, and pointing at the right project
curl -s https://leads.example.com/config.json

# Security headers present
curl -sI https://leads.example.com | grep -i "content-security-policy\|strict-transport"

# The service_role key is not being served — this must print nothing
curl -s https://leads.example.com/config.json | grep -i service_role
```

In the browser: sign in, capture a lead, and confirm the topbar says **Synced**.
Then open the same URL on a second device and check the lead is there. That is
the thing the old build could not do.

## Updating

```sh
cd ~/teal-connect-final
git pull
docker compose up -d --build
```

Nothing is lost: the database is in Supabase, and anything queued on a device
is in that browser's storage. If a migration ships with the release, apply it
in the Supabase SQL editor **before** rebuilding, so the new schema is in place
when the new client asks for it.

Roll back with `git checkout <previous-tag> && docker compose up -d --build`.
Rolling a migration back is harder — take a backup before applying one.

## Keeping it running

```sh
docker compose ps
docker compose logs -f app
docker compose restart app
```

The container restarts on failure and on boot (`restart: unless-stopped`), and
has a healthcheck so a wedged nginx is replaced rather than left in place. Logs
are capped at 3 × 10 MB.

Unattended security updates are worth having:

```sh
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

## When something is wrong

**"This deployment is set to use a Supabase backend, but config.json has no
project URL or key."** `.env` is missing or empty. Check
`docker compose exec app cat /run/leadconnect/config.json`.

**Sign-in says the email and password do not match.** Confirm the account
exists under Authentication → Users in Supabase. Passwords are only shown by
`seed.mjs` at creation; reset from the dashboard if lost.

**"Your sign-in worked, but no LeadConnect profile is linked to it."** The auth
account exists but its `profiles` row does not, or `auth_user_id` is not set.
Re-run `node supabase/seed.mjs` — it repairs the link and does not create a
second account.

**Signed in, but every screen is empty.** Row-level security is doing its job
and the caller owns nothing. Check `profiles.role` and `profiles.active` for
that user, and that `leads.owner_id` matches their profile id.

**The topbar is stuck on a waiting count.** Writes are being rejected. Open the
browser console: a `42501` is row-level security refusing the write, which
usually means the signed-in user is not who you think they are. The work is
safe on the device in the meantime.

**A browser is running old code after an update.** Nothing is cached
immutably, so a reload should be enough. If a service worker is holding on,
DevTools → Application → Service Workers → Unregister, then reload.

## What this does not do

Worth being straight about, so nobody discovers it during an event:

- **No staging environment.** Bring up a second container with a second
  Supabase project and `ENVIRONMENT_LABEL=Staging`, which puts a badge in the
  topbar so nobody demos against production by mistake.
- **No CI.** `tools/smoke.js`, `tools/a11y.js`, `tools/server-mode.js` and
  `supabase/tests/run.sh` all run offline and exit non-zero on failure, so they
  are ready to wire into an action when you want one.
- **No log aggregation or uptime alerting.** `docker compose logs` on one
  machine is the whole story. If this becomes something an exhibition depends
  on, an uptime check against `/healthz` is the first thing to add.
- **Backups are Supabase's**, and on the free plan that means none. See the
  backup section of [BACKEND.md](BACKEND.md) before an event.
