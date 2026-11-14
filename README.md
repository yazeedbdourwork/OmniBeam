# OmniBeam

**Send files, photos and text from any device to any device, right in the browser.**
iPhone, Android, Windows, Mac, Linux and Chromebook. Encrypted end to end, free, no app and no sign-up.

**👉 Use it now: [omnibeam.site](https://omnibeam.site)** (nothing to install)

---

## Contents

1. [What OmniBeam is](#what-omnibeam-is)
2. [How it works](#how-it-works)
3. [Features](#features)
4. [Languages](#languages)
5. [Pages and addresses](#pages-and-addresses)
6. [Apps, extensions and tools](#apps-extensions-and-tools)
7. [Privacy and security](#privacy-and-security)
8. [Project layout](#project-layout)
9. [Run it locally](#run-it-locally)
10. [Deploy on cPanel](#deploy-on-cpanel)
11. [Environment variables](#environment-variables)
12. [Owner tools: stats, status and alerts](#owner-tools-stats-status-and-alerts)
13. [Tests](#tests)
14. [Credits](#credits)
15. [License](#license)

---

## What OmniBeam is

Most ways of moving a file between your own devices are slow or awkward: a cable that doesn't fit, an email to yourself with a size limit, or a cloud folder that has to upload everything first. OmniBeam sends files straight from one device to the other, so a photo from an iPhone lands on a Windows PC in seconds.

Because it runs in the browser, the same page works on every device. There is nothing to install and no account to create, so it also works on a friend's computer, a work laptop or a school Chromebook.

## How it works

1. **Open OmniBeam on both devices.** On the same Wi‑Fi they find each other automatically.
2. **On different networks, pair once.** Create a 6‑digit code or scan the QR code. Paired devices find each other from then on, on any network.
3. **Tap a device and choose files.** The other device accepts, and the files go straight across.

Under the hood, the browsers connect with **WebRTC** (peer to peer). The Node server only introduces the devices to each other (signaling over WebSocket, with an HTTP long‑poll fallback). When a direct connection can't be made (strict office network, VPN, symmetric NAT), traffic goes through a **TURN** server, and as a last resort through the OmniBeam server's own encrypted relay. In every case the data is encrypted end to end and nothing is stored.

## Features

### Sending
- Files of any type and size: photos and videos in full quality (including iPhone HEIC and 4K video), PDFs, Office documents, ZIPs and whole folders.
- No file size limit set by OmniBeam. In Chrome, Edge and Firefox large files are written straight to disk.
- Send many files at once, or add more while a transfer is running.
- Progress bar with percentage, speed, time left and the route used (direct Wi‑Fi, internet, or relay).
- Automatic resume: if a direct connection drops mid‑transfer, it carries on over the relay.
- **⚡ Faster Wi‑Fi transfers** option for direct local connections.
- **Original or Smaller photos** (2048 px), remembered per device. **Smaller videos** at 720p, or **Smallest** at 480p: made with the browser's own video encoder (WebCodecs, via Mediabunny), so a one-minute clip takes a few seconds; browsers without it fall back to playing and recording the video.
- iPhone HEIC photos can be saved as JPG on Windows and Android.
- Every transfer must be accepted on the receiving device (unless the sender is a Trusted device with Auto‑accept on).

### Chat with each device
- Messages, links and copied text are sent and read in a **chat** with each paired device.
- An incoming message opens its chat by itself with a short sound (and a buzz on phones). If you are busy, a banner shows instead: "Name: first words · Open chat".
- Notifications when the chat can't be seen; tapping one opens the chat.
- Speaker button to turn the message sound on or off (also in Settings → Message sound).
- **Clear chat** (bin button) removes that device's messages and file entries from this device only, with 6 seconds to Undo.
- Clipboard sync and secret notes.

### Connecting devices
- **Automatic discovery** on the same network.
- **Pair devices** with a 6‑digit code, a share link or a QR code. Works on any network.
- **Remembered devices**: they find you automatically wherever you are. Mark your own devices as **Trusted** so their files arrive without asking, with **Auto‑accept**, **Chat** and **Forget** on each row.
- **Public rooms** that any number of devices can join, optionally password protected.
- **Team rooms**: a fixed link for a family or office. Every device that opens it once stays in the room.

### When the other device isn't online
- **Share by link**: files are encrypted in the browser, uploaded, and anyone with the link can download them until it expires (up to 7 days by default, 30 days optional). Optional email of the link.
- **Request files**: make a link (or a "Send me files" box for your own website) that others use to upload files to you. Uploads are sealed to your device's key.

### More tools (More… menu)
- **Scan to PDF**: camera scan with edge detection, corner adjust, black and white, page reorder; the PDF is made in the browser.
- **Gallery** view for received photos, with Save all.
- **Send to Telegram** and a Telegram bot (@OmniBeamsend_bot) for sending and receiving files.
- **TV mode** at `/tv`: receive‑only screen with a big QR code, a photo slideshow (speed, shuffle, fade, slow zoom), a photo wall, video controls, background music, messages and links shown big, a clock screen saver, remote‑control (D‑pad) navigation, and a paired phone as the remote. Photos stay after a reload until Clear photos (`public/tv.js`).
- **Phone as a webcam or mic**: a phone streams its camera and/or microphone live to a computer (front/back camera, 720p/1080p, mic only). The computer can mirror it, pop it out into an "OmniBeam camera" window for OBS Window Capture (then OBS Virtual Camera for Zoom, Meet or Teams), and send the sound to any output such as a virtual audio cable. Encrypted WebRTC, nothing recorded (`public/webcam.js`, guide at `/use-phone-as-webcam`).
- **Event photo album**: one QR code for a wedding, a party or a class. Guests scan it (`/e/…`), add photos and videos with no app and see everyone's; the person who made it can print a poster with the QR code, stop new photos, delete any photo or the whole album, and Save all (ZIP on computers, the Photos share sheet 20 at a time on phones). Photos are made smaller (2048 px) unless the album is set to Original. Everything is encrypted in the browser with the key after `#`: the server stores only encrypted bytes. Albums last 1, 3, 7 or 30 days.
- **Share a folder / Browse files**: on a computer, pick a folder (⋯ menu → Share a folder) and tick which paired devices may look in it. On those devices, More… → Browse files shows the folder and its subfolders, with search; the files you pick come straight from the computer like any transfer (accepted without asking because you asked for them). Nothing is uploaded, the tab must stay open, names starting with "." are never shown. Chrome and Edge remember the folder (and ask again after a restart); other browsers keep it until the tab closes.

### Personal touches
- Rename each device and pick its picture.
- Light, dark or automatic theme.
- **Supporter codes**: people who donate get a code that adds a ♥ badge, 4 extra themes and 20 extra pictures.
- Installable as an app (PWA). On Android it appears in the Share menu; on Windows it can be added to the right‑click Send to menu.
- Works offline as an installed app shell and reloads itself after a new deploy.

## Languages

15 languages, each with its own address that is sent already translated (so search engines can index it):

| Code | Language | Address |
|---|---|---|
| en | English | `/` |
| ar | العربية (Arabic, right to left) | `/ar/` |
| fr | Français | `/fr/` |
| es | Español | `/es/` |
| tr | Türkçe | `/tr/` |
| de | Deutsch | `/de/` |
| pt | Português | `/pt/` |
| hi | हिन्दी | `/hi/` |
| id | Bahasa Indonesia | `/id/` |
| ru | Русский | `/ru/` |
| ja | 日本語 | `/ja/` |
| zh | 简体中文 | `/zh/` |
| ko | 한국어 | `/ko/` |
| it | Italiano | `/it/` |
| ur | اردو (Urdu, right to left) | `/ur/` |

The browser's language is picked automatically on the first visit and can be changed in the footer. Each home page has a one‑minute intro video in its own language.

## Pages and addresses

### Main pages
| Address | What it is |
|---|---|
| `/` and `/<lang>/` | The app (home page) |
| `/tv` | TV mode |
| `/d/…` | Download page for a shared link |
| `/r/…` | Request files (upload) page |
| `/e/…` | Event photo album (`?poster=1` prints its QR poster) |
| `/embed` | How to put a "Send me files" box on your website |
| `/status` | Sends to the admin panel's Status tab (the status page is owner‑only since 2026‑11‑12) |
| `/admin` | Owner‑only admin panel: stats and status in tabs (needs `STATS_KEY`; `/stats` opens it too) |
| `/amp/<lang>/<slug>` | AMP versions of the guide pages |
| `/sitemap.xml`, `/robots.txt`, `/llms.txt` | For search engines and AI crawlers |

### Guide pages (in every language, under `/pages/<lang>/` or `/<lang>/<slug>`)
- **How to use**, About, Privacy, Terms
- Device guides: iPhone to PC, PC to iPhone, iPhone to Android, Android to iPhone, Android to PC, Android to Mac, Mac and Windows, between computers, from Mac/Linux, from the Windows tray
- Tips: large files by link, large video without WhatsApp, photos and videos in full quality, share privately, fix slow transfers on the same Wi‑Fi, Wi‑Fi transfer vs cloud
- Comparisons and alternatives: OmniBeam vs AirDrop, PairDrop, Snapdrop, LocalSend; AirDrop for Windows, AirDrop alternatives, AirDrop not working, Quick Share, SHAREit and WeTransfer alternatives
- Embed guide

## Apps, extensions and tools

| Where | Link |
|---|---|
| Chrome Web Store | https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki |
| Microsoft Store (Windows app) | https://apps.microsoft.com/detail/9PLR2PMX3SQZ |
| Firefox add‑on | Package ready, awaiting upload to addons.mozilla.org |
| Android | Trusted Web Activity package `site.omnibeam.app` (built) |

Downloads served by the site (`public/tools/`):
- `omnibeam-windows.zip`: Windows tray app and right‑click Send to.
- `omnibeam-mac-linux.zip` and `omnibeam-send.js`: command‑line sender for Mac and Linux.
- `omnibeam-chrome.zip`: the browser extension, to install by hand.
- `omnibeam-wordpress.zip`: WordPress plugin with a shortcode and a block for the "Send me files" box.

Command line for developers (`cli/`, the npm package `omnibeam`, Node.js 22+, no dependencies):

```sh
npx omnibeam send build.zip      # to a phone or computer with OmniBeam open (or scan the QR code it prints)
npx omnibeam receive             # wait for files from another device
npx omnibeam link report.pdf     # an encrypted share link
npx omnibeam get <link>          # download a share link
```

Details in [cli/README.md](cli/README.md). It is not part of the website: the deploy only sends `server.js` and `public/`.

## Privacy and security

- Files are encrypted end to end on the sending device; only the receiving device can decrypt them.
- When devices can reach each other, files go directly between them. When they can't, the encrypted data passes through the server, which forwards it straight away and cannot read it.
- Nothing from a live transfer is saved on a server. Shared links and file requests are stored encrypted and deleted when they expire.
- Every transfer must be accepted on the receiving device.
- **App lock** (Settings → Privacy): an optional 4–8 digit PIN, and optionally fingerprint, face or Windows Hello (a passkey on that device), before OmniBeam opens; locks again after 0, 1, 5 or 15 minutes away. Only a salted PBKDF2 hash of the PIN is stored. It keeps people out of OmniBeam on a shared device; it doesn't encrypt the files stored there.
- **Move to a new phone** (Settings → Device): one backup file with the paired devices, name and picture, settings, pinned notes, chat text, clipboard history, groups and links, encrypted on the device with a PIN or password chosen for it (PBKDF2-SHA-256 600 000 rounds, AES-256-GCM). The App lock PIN is asked first when the lock is on. Open backup file on the new device merges it in and restarts. Received files aren't included.
- **Notification buttons**: Reply and Open chat on a message, Open link and Reply on a link, Save and Open chat on received files, Stop on Ring my device (Android and computers; iPhone shows none). Where the browser allows typing in the notification, the reply is sent without opening OmniBeam; elsewhere Reply opens the chat ready to type. No Reply or Save while App lock is on.
- **Keep history** (Settings → Privacy): received files and messages, the Sent list and clipboard history are deleted by themselves after 1 hour, 1 day, 7 days (default) or 30 days.
- Pairing codes are rate limited per network, and each code works for 2 devices only.
- Google Analytics and the Meta Pixel load only after the visitor presses **Allow** on the cookie banner.
- Visitor counting stores no IP addresses and no cookies.
- The `.htaccess` blocks every file outside `public/`, so `server.js` and the `data/` folder are never served.

## Project layout

```
OmniBeam/
├── server.js             Node server: static files, translated pages, signaling (/ws, /poll/*),
│                         relay, links, requests, stats, status, alerts, Telegram bot, minifier
├── service-worker.js     Service worker (served as /sw.js)
├── package.json          Scripts (start, test, deploy); no runtime dependencies
├── .htaccess             cPanel/Passenger setup + blocks everything outside public/
├── vendor/               Bundled ws (WebSocket) and terser (minifier), so no npm install is needed
├── cli/                  The command-line tool (npm package "omnibeam"): send, receive, link, get
├── public/               Everything the browser loads
│   ├── index.html        The app
│   ├── app.js            Main app logic (WebRTC, pairing, transfers, UI)
│   ├── chat.js           Per‑device chat
│   ├── media.js, scan.js, more.js, drop.js, get.js, put.js, request.js, share.js …
│   ├── style.css, pages.css, stats.css (admin panel)
│   ├── i18n.js + lang/   Translations (15 languages)
│   ├── pages/<lang>/     Guide pages
│   ├── media/            Intro videos and posters (videos live ONLY here)
│   ├── fonts/, store/, parts/, tools/, .well-known/
│   ├── manifest.webmanifest, icons, og.png
│   └── admin.html (admin panel; stats.html only sends old links there), drop.html, request.html, embed-box.html, 404.html
└── data/                 Created by the server at runtime (stats, links, keys). Never delete on deploy.
```

## Run it locally

Requires Node.js 18 or newer.

```bash
node server.js
# then open http://localhost:3000
```

No `npm install` is needed to run it (ws and terser are in `vendor/`). Use another port with `PORT=4556 node server.js`. Open the page in two browser windows or on two devices on the same network to try a transfer.

## Deploy on cPanel

1. Upload everything (server.js, service-worker.js, package.json, .htaccess, vendor/ and public/) into the cPanel app folder, keeping the same layout. Overwrite the old files.
2. **Do not delete the server's `data/` folder** (statistics, links and keys live there).
3. Never create a `media/` folder next to server.js: the `.htaccess` blocks it. Videos go in `public/media/`.
4. If cPanel's own `.htaccess` has different Passenger paths at the top, keep cPanel's lines.
5. **Setup Node.js App → Restart.**
6. Check: the live page shows `<meta name="omnibeam-build" content="…">` with the new build.

Cloudflare sits in front of the site. Files with `?v=` in their address are cached for a year at the edge and in the browser, so every change bumps its version number.

## Environment variables

Set these in **cPanel → Setup Node.js App → your app**. All are optional unless noted. Never put secret values in `server.js` or in this file.

### Core
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | Port to listen on (cPanel sets it) |
| `SITE_URL` | https://omnibeam.site | Canonical address |
| `DATA_DIR` | `./data` | Where stats, links and keys are kept |
| `RELAY` | on | `false` turns off the server relay fallback |
| `MINIFY` | on | `false` serves the original JS/CSS |

### Connections (TURN)
| Variable | Purpose |
|---|---|
| `CF_TURN_KEY_ID` + `CF_TURN_API_TOKEN` | Cloudflare Realtime TURN (in use) |
| `TURN_URL` + `TURN_USERNAME` + `TURN_CREDENTIAL` | Any TURN server with a fixed login |
| `TURN_URL` + `TURN_SECRET` | Own coturn with a shared secret |

### Share by link, requests and email
| Variable | Default | Purpose |
|---|---|---|
| `DROPS` | on | `false` turns off share by link |
| `DROP_MAX_MB` | 100 | Largest upload per link |
| `DROP_TOTAL_MB` | 1024 | Disk all links may use together |
| `DROP_MAX_HOURS` | 168 | Longest a link lives (720 adds a 30‑day option) |
| `REQUESTS` | on | `false` turns off Request files |
| `REQUEST_MAX_HOURS`, `REQUEST_UPLOADS_PER_LINK_DAY` | | Request limits |
| `ALBUMS` | on | `false` turns off event photo albums |
| `ALBUM_MAX_MB` | 1024 | All the photos of one album together |
| `ALBUM_TOTAL_MB` | 4096 | Disk all albums may use together |
| `ALBUM_ITEM_MB` | 60 | Largest single photo or video in an album |
| `RESEND_API_KEY` | | Resend.com key for emailing links (secret) |
| `EMAIL_FROM` | `OmniBeam <no-reply@omnibeam.site>` | Sender address |
| `EMAIL_PER_DAY`, `EMAIL_PER_IP_DAY` | | Email limits |

### Notifications
| Variable | Purpose |
|---|---|
| `PUSH` | `false` turns off web push |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Keep the push key pair when moving servers (made automatically otherwise) |
| `VAPID_SUBJECT` | Contact address for push services |

### Owner tools and alerts
| Variable | Purpose |
|---|---|
| `STATS_KEY` | Secret that unlocks the admin panel `/admin` (secret) |
| `STATUS_KEY` | Shared secret for the uptime Worker posting to `/api/status/checks` (secret) |
| `STATUS_EVERY_MIN` | How often the server checks itself |
| `VISITS` | `false` turns off visitor counting |
| `ALERT_EMAIL` | Address for problem alerts (`''` turns email alerts off) |
| `ALERT_TELEGRAM_TOKEN` | Telegram bot token for alerts, @OmniBeam_bot (secret) |
| `ALERT_TELEGRAM_CHAT` | Chat id (found automatically otherwise) |
| `ALERT_MIN`, `ALERT_WINDOW_MIN`, `ALERT_EVERY_MIN` | Spike rules |
| `INSTANT_ALERTS` | `telegram` (default), `email`, `both` or `off` |
| `INSTANT_EVERY_MIN`, `INSTANT_MAX_DAY`, `INSTANT_GATHER_MS` | Instant alert limits |
| `WEEKLY`, `WEEKLY_TO`, `WEEKLY_DAY`, `WEEKLY_HOUR`, `WEEKLY_TZ` | Weekly summary report |

### Telegram send/receive bot
| Variable | Purpose |
|---|---|
| `TG_BOT_TOKEN` | Token for @OmniBeamsend_bot (secret; the bot is off if unset) |
| `TG_BOT_NAME` | Override the bot's name |
| `TG_WEBHOOK`, `TG_API_BASE`, `TG_BOT_USE_ALERT_TOKEN` | Advanced options |

### Supporters, analytics and social
| Variable | Purpose |
|---|---|
| `SUPPORTER_KEY` | **Required for supporter codes.** Long random secret; set once and never change it, or every code stops working |
| `SUPPORT_URL` | Donation page for the ♥ Support link |
| `GA_ID` | Google Analytics ID (loads only after consent) |
| `FB_PIXEL_ID` | Meta Pixel ID (loads only after consent; `''` turns it off) |
| `SOCIAL_X`, `SOCIAL_INSTAGRAM`, `SOCIAL_LINKEDIN`, `SOCIAL_YOUTUBE`, `SOCIAL_FACEBOOK`, `SOCIAL_TIKTOK` | Footer icons and schema `sameAs` |

## Owner tools: stats, status and alerts

- **`/admin`** (enter `STATS_KEY`; the old `/stats` address opens it too): tabs for Overview (status line, main numbers, At a glance), Visitors, Transfers, Features (one list, most used first), Problems, Status (uptime, parts and incidents plus the TURN server) and Settings (alerts, weekly summary, supporter codes, backup). Covers visits, countries, pages, referrers, transfers per day, direct vs relay, success rate, feature counts (rings, links opened, send to all, invite cards, chats and pins, scans, smaller videos, Telegram, embed box, app lock), problem reports, supporter codes. Includes Clear with Undo, Save as PDF and a JSON backup.
- **Status** (admin panel → Status; `/status` sends there, nothing is public): the server checks itself every few minutes, and a Cloudflare Worker (`omnibeam-ping`) posts outside checks.
- **Telegram alerts** through @OmniBeam_bot: spikes in problem reports, crashed tabs, stuck transfers and new script errors, plus a weekly summary.

## Tests

End‑to‑end tests use Playwright:

```bash
npm install            # installs @playwright/test (dev only)
npm run test:setup     # downloads Chromium
npm test
```

## Credits

Created by **Yazeed Bdour**. © 2026 OmniBeam.Site
Facebook: https://www.facebook.com/omnibeamsite

## License

OmniBeam is free software under the [GNU General Public License v3.0](LICENSE) (GPL-3.0-or-later). You can use, change and share it, including running your own copy; if you share a changed version, share its source under the same license. Bundled third-party code keeps its own license: ws (MIT) and terser (BSD-2-Clause) in `vendor/`, qrcode-generator (MIT) in `public/qrcode.js` and `cli/lib/qrcode.js`, Mediabunny 1.63.0 (MPL-2.0, unchanged, source at https://github.com/Vanilagy/mediabunny) in `public/mediabunny.js`, and the Plus Jakarta Sans font (SIL OFL 1.1, `public/fonts/OFL.txt`).
