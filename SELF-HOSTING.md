# Self-hosting OmniBeam with Docker

Run your own OmniBeam: the same server and site as omnibeam.site, on your own machine, home server or VPS.
Files still go straight between devices (WebRTC) and are end-to-end encrypted. Your server only introduces the
devices to each other, and relays the data (still encrypted) when a direct connection can't be made.

## Quick start

```bash
git clone https://github.com/yazeedbdourwork/OmniBeam.git
cd OmniBeam
docker compose up -d
```

Open <http://localhost:3000>. Open it in a second browser window and the two show up as devices.

Without Compose:

```bash
docker build -t omnibeam .
docker run -d --name omnibeam --restart unless-stopped \
  -p 3000:3000 -v omnibeam-data:/data \
  -e SITE_URL=https://beam.example.com \
  omnibeam
```

## You need HTTPS for other devices

Browsers only give a page its full set of features (encryption keys, notifications, camera for QR codes, the
offline app) on `https://` or on `localhost`. A phone opening `http://192.168.1.20:3000` sees the devices but some
features won't work. So put OmniBeam behind a reverse proxy with a certificate.

### Caddy (gets a certificate for you)

`docker-compose.yml` next to a `Caddyfile`:

```yaml
services:
  omnibeam:
    build: .
    restart: unless-stopped
    volumes: [omnibeam-data:/data]
    environment:
      SITE_URL: "https://beam.example.com"
      NODE_ENV: "production"      # safe here: Caddy always sends X-Forwarded-For
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile, caddy-data:/data]
volumes:
  omnibeam-data:
  caddy-data:
```

```
beam.example.com {
  reverse_proxy omnibeam:3000
}
```

WebSockets (`/ws`) pass through Caddy without extra settings.

### nginx

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 1h;
  client_max_body_size 200m;   # share-by-link uploads; match DROP_MAX_MB
}
```

## How devices find each other

Devices that connect from the same public address (the same home Wi-Fi) see each other automatically. Devices on
different networks pair once with a 6-digit code or QR code.

- **Your proxy must send `X-Forwarded-For`** (Caddy does by default, nginx needs the line above). Otherwise every
  visitor looks like they come from the proxy and everyone sees everyone.
- `NODE_ENV=production` makes the server put each visitor in their own room when that header is missing. Use it
  behind a proxy. Leave it unset (the image default) when you open the container's port directly on your LAN.

## Your data

Everything the server keeps is in the `/data` volume: share-by-link files (encrypted), request links, push
notification keys, stats, pairings for push, the Telegram bot state. Back it up by copying the volume:

```bash
docker run --rm -v omnibeam-data:/data -v "$PWD":/backup alpine tar czf /backup/omnibeam-data.tgz -C /data .
```

Delete the volume and the server starts fresh (it makes new push keys; browsers resubscribe by themselves).

## Settings

Set these with `-e NAME=value` or under `environment:` in `docker-compose.yml`. All are optional.
The full list with every detail is in [README.md](README.md#environment-variables).

| Variable | What it does |
|---|---|
| `SITE_URL` | The address people open, e.g. `https://beam.example.com`. Used in share links, QR codes and the sitemap. |
| `PORT` | Port inside the container (default 3000). |
| `STATS_KEY` | A long random password that opens the owner pages `/stats` and `/status`. Empty: they stay off. |
| `TURN_URL` + `TURN_USERNAME` + `TURN_CREDENTIAL` | A TURN server with a fixed login, for devices that can't connect directly. |
| `TURN_URL` + `TURN_SECRET` | Your own coturn with `use-auth-secret`; short-lived logins are made by the server. |
| `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` | Cloudflare Realtime TURN. |
| `RELAY=false` | Turn off relaying through your server (then devices that can't connect directly can't send). |
| `DROPS=false` | Turn off share by link. `DROP_MAX_MB` (100), `DROP_TOTAL_MB` (1024), `DROP_MAX_HOURS` set its limits. |
| `REQUESTS=false` | Turn off "request files" links. |
| `PUSH=false` | Turn off push notifications. |
| `GA_ID`, `FB_PIXEL_ID` | Your own Google Analytics / Meta Pixel ID. Off in the image. |
| `SUPPORT_URL` | Your donation page (https://…) for the Support links. Off in the image. |
| `ALERT_EMAIL`, `ALERT_TELEGRAM_TOKEN` + `ALERT_TELEGRAM_CHAT` | Alerts when something breaks. Off in the image. |

### Without TURN

That's fine for most people. When two devices can't connect directly, OmniBeam sends through your server instead
(still encrypted end to end). It uses your server's bandwidth, so on a small VPS with a monthly limit, consider a
TURN server or `RELAY=false`.

### Your own TURN server (coturn)

```yaml
  coturn:
    image: coturn/coturn
    network_mode: host
    command: >
      -n --listening-port=3478 --use-auth-secret --static-auth-secret=CHANGE_ME
      --realm=beam.example.com --no-cli --no-tls --no-dtls
```

Then on the omnibeam service: `TURN_URL: "turn:beam.example.com:3478"` and `TURN_SECRET: "CHANGE_ME"`.
Open UDP and TCP port 3478 (and the relay port range, 49152-65535 UDP by default) in your firewall.

## Updating

```bash
git pull
docker compose up -d --build
```

Open tabs reload by themselves when they notice the new version.

## Health check

The image checks `GET /config.json` every 30 seconds; `docker ps` shows `healthy` when the server answers.
