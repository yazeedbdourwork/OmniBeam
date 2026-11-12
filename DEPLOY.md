# Deploying OmniBeam to omnibeam.site (cPanel shared hosting)

> **Automatic updates from GitHub:** once the cPanel token is set up (10 minutes, see **AUTO-DEPLOY.md**), every
> change merged into `main` goes live by itself and the steps below are only needed as a fallback.

## Updating the site (every time you change something)
1. Optional but recommended: double-click **run-tests.cmd**. Every test should say "passed".
2. Double-click **deploy.cmd** (or run `npm run deploy`). It checks the files for mistakes, raises
   forgotten `?v=` numbers (otherwise browsers keep old files for a year), rebuilds the downloads in
   `public/tools/`, and makes two zips in the `deploy` folder:
   - `omnibeam-update.zip`: only the files changed since the last deploy (small, use this one),
   - `omnibeam-upload.zip`: everything (first time, or if unsure).
3. cPanel > **File Manager** > the `omnibeam` folder > **Upload** the zip > right-click it > **Extract**
   into the `omnibeam` folder itself (replace files) > delete the zip.
4. cPanel > **Setup Node.js App** > **Restart**.
5. Back in the deploy window press Enter (or run `npm run deploy:check`): it asks omnibeam.site which
   version it runs and says whether the new one is live. It then remembers this deploy, so the next
   update zip contains only newer changes.
6. Optional: double-click **live-check.cmd**. Two browsers on your PC use the real omnibeam.site: they check
   that the new files are live, open the pages in all 5 languages, send files directly and through the
   server, send a message, show a pairing QR code and make a share link (deleted after its first
   download). Every line should say "passed".

Nothing logs in to cPanel automatically and no password is stored. The first-time setup is below.

## 1. Check your host supports Node.js
Log in to cPanel and search for **"Setup Node.js App"** (under *Software*).
- Not there? Your plan can't run OmniBeam. Ask your host to enable Node.js, or move to a VPS.

## 2. Upload the files
1. cPanel → **File Manager** → go to your home folder (e.g. `/home/USERNAME/`), **not** `public_html`.
2. Create a folder `omnibeam`.
3. Upload `omnibeam-upload.zip` into it → right-click → **Extract**.
   You should now have `omnibeam/server.js`, `omnibeam/package.json`, `omnibeam/public/`, `omnibeam/vendor/`
   (directly inside `omnibeam`, not in an extra subfolder).

## 3. Create the Node.js app
cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | newest available (18 or higher) |
| Application mode | Production |
| Application root | `omnibeam` |
| Application URL | `omnibeam.site` (leave the path empty) |
| Application startup file | `server.js` |

Click **Create**, then **Restart**. (No need for *Run NPM Install* – the only library, `ws`, is bundled in `vendor/`.)

Optional – environment variables (same screen, *Add Variable*), for a TURN server: see step 6.

## 4. Turn on HTTPS
cPanel → **SSL/TLS Status** → select `omnibeam.site` and `www.omnibeam.site` → **Run AutoSSL**.
Then (if offered) cPanel → **Domains** → enable **Force HTTPS Redirect**.

## 5. Test
1. Open https://omnibeam.site on your computer and phone, both on the same Wi‑Fi.
2. They should see each other. Send a photo.
3. If the footer says **"Can't reach the OmniBeam server – retrying…"**, your host is blocking
   WebSockets. Ask support: *"Please enable WebSocket support for my Node.js app on omnibeam.site."*
   If they can't, you'll need a VPS (e.g. Hetzner, DigitalOcean) instead.
4. If devices on the same Wi‑Fi do **not** see each other (but pairing with a code works),
   the host isn't forwarding visitor IPs; ask support to pass the `X-Forwarded-For` header.

## 6. (Recommended) Your own TURN server
When two devices can't connect directly (phone on mobile data, strict office or hotel networks),
OmniBeam falls back to sending through your cPanel server, which is slower and uses your hosting
bandwidth. A TURN server is a fast middleman built for exactly this. The files stay end-to-end
encrypted (WebRTC), so the TURN provider can't read them. Shared hosting can't run one, so use a
hosted one. Pick **one** of these:

### Option A: Cloudflare Realtime TURN (recommended: 1,000 GB a month free)
Price: free for the first 1,000 GB each month, then $0.05 per GB. Needs a free Cloudflare account
(a payment card may be asked for).
1. Sign in at https://dash.cloudflare.com (create a free account if you don't have one).
2. In the left menu open **Realtime** (sometimes listed under *Calls*), then **TURN Server**, then **Create**.
3. Give it a name (e.g. `omnibeam`) and create it. Cloudflare shows a **Turn Token ID** and an
   **API Token**. Copy both now: the API token is only shown once.
4. In cPanel > Setup Node.js App > your app, add two environment variables:
   ```
   CF_TURN_KEY_ID=<the Turn Token ID>
   CF_TURN_API_TOKEN=<the API Token>
   ```
5. **Save**, then **Restart**.

server.js asks Cloudflare for short-lived logins itself, so nothing secret reaches the browser.

### Option B: Metered.ca (500 MB a month free, no card)
Fine for trying it out; paid plans start at $99/month, so Cloudflare is far cheaper for real use.
1. Sign up at https://www.metered.ca/stun-turn and create a TURN app (e.g. `omnibeam.metered.live`).
2. In the dashboard copy the app's domain and its **API key**.
3. Add `METERED_DOMAIN=omnibeam.metered.live` and `METERED_API_KEY=<key>`, Save, Restart.

### Option C: your own coturn on a small VPS (about $4-6/month, unlimited within the VPS traffic)
Only if you already run a VPS. Install coturn with `use-auth-secret` and `static-auth-secret=<long secret>`,
open UDP/TCP 3478 and 443, then set
`TURN_URL=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:443?transport=tcp` and `TURN_SECRET=<the same secret>`.

(A fixed login from any provider also works: `TURN_URL` + `TURN_USERNAME` + `TURN_CREDENTIAL`.)

### Check that it works
Open `https://omnibeam.site/stats`, enter your stats key and scroll to **TURN server**. It shows which
provider is set up and whether getting a login worked. Press **Test TURN from this browser**: "TURN works"
means browsers can reach it. Afterwards the chart shows how many transfers went through TURN.

## Server relay (fallback)
If two devices can't connect directly (no TURN server, strict NAT, VPN), OmniBeam sends the file
through your server instead ("Sending via server…"). This uses your hosting bandwidth.
To turn it off, add the environment variable `RELAY=false` and restart.

## Updating later
Upload the changed files over the old ones in `omnibeam/` and click **Restart** in Setup Node.js App.

## Share by link, stats page, security headers (added 2026-10-26)
- **Admin panel** (`/admin`, the old `/stats` address opens it too): set the environment variable `STATS_KEY` to a long secret, Restart, then open `https://omnibeam.site/admin` and type that key. Without `STATS_KEY` the panel stays locked. Sections: Overview, Visitors, Transfers, Features, Problems, Status (same numbers as the public `/status` page, plus the TURN server) and Settings (alerts, weekly summary, supporter codes, backup).
- **Share by link** stores encrypted files in `data/drops/` next to server.js (created automatically). Limits: `DROP_MAX_MB` (default 100 per link), `DROP_TOTAL_MB` (default 1024 for all links), `DROP_MAX_HOURS` (default 72). Set `DROPS=false` to turn the feature off. Expired links are deleted every 5 minutes.
- **Visitors on /stats** (since 30 Oct 2026): every page loads `/visit.js`, which counts the visit (country from Cloudflare's CF-IPCountry header, page, source, device, browser, language) and how long the page stays open. No cookies, no addresses saved; people who pressed "No thanks" and devices opened once with `?analytics=off` are not counted. Bots and headless browsers are skipped. Set `VISITS=false` to turn it off. Keep Cloudflare's IP Geolocation on (Network tab, on by default) or every country shows as Unknown.
- Daily counts are kept in `data/stats.json`. Don't delete the `data/` folder when uploading.
- Security headers (CSP, HSTS) are sent by server.js. If you add a new outside script or image host, add it to the CSP in `securityHeaders()`.

## Problem reports and the Windows tray app (added 2026-10-26)
- **Problem reports**: when a transfer fails, a direct connection doesn't work, a shared link breaks or a script error happens, the page sends a short note to `/api/report`. They appear on `/stats` under **Problems** (kept in `data/errors.json`, newest 300). File names, addresses and long numbers are removed before saving. No setting needed.
- **Windows tray app**: the download is `public/tools/omnibeam-windows.zip` (built from the `tools/` folder). If you change anything in `tools/`, rebuild the ZIP.
- No new environment variables are required. TURN (step 6) is optional.

## Walkthrough, QR pairing, notifications, iPhone Shortcut, Chrome extension (added 2026-10-27)
Nothing to set up for these: upload as usual (server.js and public/ both changed) and Restart.
- **Notifications** need a key pair ("VAPID keys"). The server makes one by itself on the first start and keeps it in
  `data/push-keys.json`. Keep that file when you move the site, or devices must turn notifications on again.
  Optional environment variables in Setup Node.js App: `VAPID_SUBJECT` (a contact for Apple/Google/Mozilla, e.g.
  `mailto:you@example.com`; default is the site address), `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (use your own
  pair instead of the file), `PUSH=false` (turn notifications off). On iPhone and iPad notifications only work in
  OmniBeam added to the Home Screen, on iOS 16.4 or later.
- **iPhone Shortcut** (removed from the site on 2026-11-03, off unless `INBOX=true`) uploads files to `/api/inbox/<key>`; they wait in `data/inbox/` until the device picks them up
  (then they're deleted), at most 24 hours. Optional: `INBOX=false`, `INBOX_MAX_MB` (default 200),
  `INBOX_TOTAL_MB` (default 1024), `INBOX_HOURS` (default 24). If uploads over a few MB fail, the host may limit
  request sizes (LiteSpeed "Max Request Body Size"); ask your host to raise it.
- **Chrome extension**: the code is in `tools/omnibeam-chrome/`; deploy.cmd zips it to
  `public/tools/omnibeam-chrome.zip`, which Settings links to. Install steps are in its README.txt.

## Offline app, problem-report alerts, comparison pages, 4 new languages (added 2026-10-27)
- **Offline app** (`service-worker.js`, next to server.js, sent as /sw.js; it must not be in public/, because the host's web server sends files in public/ itself, without the version): the server writes the current site version into it every time it is sent, and sends sw.js with `Cache-Control: no-cache, no-store`. Every deploy therefore installs a new service worker with a new cache and deletes the old one. Pages are always asked from the network first (the saved copy is used only offline or after 3 seconds), so a deploy shows at once. Nothing to do on deploy besides the usual Restart; purging Cloudflare after a deploy is still good practice.
- **Alerts when problem reports spike**: set these environment variables in the cPanel Node.js app (Setup Node.js App → Environment variables), then Restart:
  - `ALERT_EMAIL`: where to send the email (sent with the host's sendmail). Defaults to yazeedbdourwork@gmail.com in server.js; set it to an empty value to turn email off.
  - `ALERT_TELEGRAM_TOKEN`: a bot token from @BotFather, only if you want Telegram. Never put the token in a file. After setting it, send any message to your bot once; OmniBeam finds the chat by itself.
  - Optional: `ALERT_MIN` (default 10 reports), `ALERT_WINDOW_MIN` (default 15 minutes), `ALERT_EVERY_MIN` (default 60 minutes between alerts).
  - Check it on `/stats` → Alerts → Send a test alert.
- **Comparison pages**: `/compare` and `/omnibeam-vs-airdrop`, `-snapdrop`, `-pairdrop`, `-localsend`, in every language (`public/pages/<lang>/`, kind `compare`).
- **Languages**: German (de), Portuguese (pt), Hindi (hi) and Indonesian (id) added: `public/lang/<code>.js` for the app, `public/pages/<code>/` for the guides.

## Transfers that continue by themselves, "file intact" check, accessibility, Firefox, Support link (added 2026-10-28)
- **Continue after a dropped connection**: when a phone switches networks or the server restarts mid-transfer, the sender keeps the files (its page must stay open) and, when the other device shows up again within 10 minutes, the transfer continues from where it stopped without asking again. A random secret per transfer makes sure only the device that was receiving can pick it up. Nothing to set up.
- **File intact check**: the sender works out a CRC-32 checksum of every file and the receiver checks what it saved against it. Received files show "✓ Intact" (or "⚠ Damaged: ask for it again", which also goes to the Problems list on /stats). Both devices need this version; with an older one there is simply no badge.
- **Accessibility**: device cards have a real button (the avatar) for the keyboard and screen readers, every dialog is announced by its title, a clear focus ring, less motion for people who ask for it, and darker grey and purple text so it is readable (WCAG AA contrast). The purple is a little darker on light backgrounds.
- **Firefox extension**: `node tools/deploy.js --store` (and every normal deploy) now also makes `deploy/omnibeam-firefox.zip`. Upload it at https://addons.mozilla.org/developers/ (free account) → Submit a New Add-on → "On this site" → the zip. Choose Firefox for desktop only. Add-on id `omnibeam@omnibeam.site`, needs Firefox 140 or newer. Data collection: none.
- **Support OmniBeam**: put your donation page (Ko-fi, Buy Me a Coffee, PayPal.me…, starting with https://) in the `SUPPORT_URL` environment variable in cPanel (Setup Node.js App → Environment variables), then Restart. A "Support OmniBeam" item appears in the ⋯ menu and a "♥ Support" link in the footer; after a visitor's 5th send they see one short thank-you note mentioning it, once. Empty: everything stays hidden.
- Not changed: several data channels per transfer were measured and gave no speed-up (one channel already fills the link), so transfers still use one.

## Email by OmniBeam, clipboard history, auto-send a folder, big-file mode, weekly summary, 5 landing pages (added 2026-11-02)
- **Email the link (Resend)**: when someone types an email address in *Send to* in the link window, the server sends the link from `no-reply@omnibeam.site`. Without a key it falls back to the old way (the person's mail app opens).
  1. Make a free account at https://resend.com and add the domain `omnibeam.site` (Domains → Add domain).
  2. Resend shows DNS records (an MX + TXT for a `send` subdomain, and a DKIM TXT `resend._domainkey`). Add exactly those in Cloudflare → DNS. Do **not** change the existing MX records of `omnibeam.site` itself and do not turn on Cloudflare Email Routing.
  3. When Resend says *Verified*, make an API key (API Keys → Create, permission "Sending access").
  4. In cPanel → Setup Node.js App → Environment variables add `RESEND_API_KEY` = the key (never put it in a file), then Restart.
  - Optional: `EMAIL_FROM` (default `OmniBeam <no-reply@omnibeam.site>`), `EMAIL_PER_IP_DAY` (default 10), `EMAIL_PER_DAY` (default 90, the site total; Resend's free plan allows 100 a day), `EMAIL_PER_LINK` (default 3).
  - The link (with its key) passes through the server once to be emailed, and is not kept. A PIN is never in the email.
- **Clipboard history**: the last 20 texts sent or received with Clipboard sync, in History → Clipboard (Copy / Send again / Delete). Kept only on the device; can be turned off in Settings. Nothing to set up.
- **Auto-send a folder** (Settings): on a computer with Chrome or Edge, or the Microsoft Store app, choose a folder and a paired device. Every new file put in the folder is sent by itself while OmniBeam is open (it waits until a file stops growing). Files already in the folder are not sent. On the phone, turn on Auto-accept for the computer in the Link window. Nothing to set up on the server.
- **Big-file mode**: files of 1 GB and more are sent in 16 MB pieces, each with its own checksum; the receiver checks every piece and only a damaged piece is sent again. The receiver first checks it has enough free space. Both devices need this version (older ones simply use the normal way).
- **Weekly summary**: every Monday 09:00 (Amman time) the server sends last week's numbers (visitors, transfers, success rate, links, emails, top countries/pages/sources) to Telegram (`ALERT_TELEGRAM_TOKEN`, as for alerts) and/or email (`ALERT_EMAIL`, sent with Resend when `RESEND_API_KEY` is set). Try it on `/stats` → Weekly summary → Send a test now.
  - Optional: `WEEKLY=false` (off), `WEEKLY_TO` = `both` (default), `telegram` or `email`, `WEEKLY_DAY` (0 = Sunday … 1 = Monday, default 1), `WEEKLY_HOUR` (default 9), `WEEKLY_TZ` (default `Asia/Amman`).
- **Landing pages**: `/send-files-iphone-to-android`, `/quick-share-alternative`, `/wetransfer-alternative`, `/share-files-mac-and-windows`, `/shareit-alternative`, in all 9 languages (`public/pages/<lang>/`). They appear on the guides page and in the sitemap by themselves.

## Photo, voice note, screen sharing, secret notes, previews, ready-made iPhone Shortcut (added 2026-11-02)
Upload `deploy\omnibeam-review-upload.zip` (it replaces omnibeam-six-picks-upload.zip: it has everything from it too), extract it over the app folder, Restart.
- **More… on a device** (hover a device, or long-press it on a phone): Files, Folder, Message, Take a photo (camera in the page, "Document scan" for black-and-white pages), Voice note (hold the round button), Share my screen (computers only; any device can watch), Secret note (shown once, never kept), Test speed. Code in `public/media.js`, loaded the first time one is used.
- **Screen sharing** goes device to device like transfers. When a direct route isn't possible it needs the TURN server (Cloudflare TURN, already set up). Nothing goes through the OmniBeam server relay.
- **Secret note by link**: Share files by link → "Secret note instead". The link opens once; the text is encrypted in the browser.
- **Preview** buttons in Received files and History for PDF, text and code (pictures, video and audio already played there).
- **⚡ Faster Wi-Fi** now shows a small window explaining the microphone before Safari asks.
- **Lighter home page**: Help, Terms, Privacy and About are no longer inside the home page. They come from `/info-dialogs?lang=xx` (made from `public/parts/info.html`) the first time one is opened.
- **Screen stays on** during a link upload too (it already did during transfers and shrinking).
- **iPhone Shortcut removed (2026-11-03)**: the Settings section, the setup window, the Help item and the Privacy section are gone, and the server's Shortcut inbox (`/api/inbox/…`) is off. `SHORTCUT_URL` is no longer used; delete it in cPanel if you added it. To bring the inbox back, set `INBOX=true` (the setup window itself would need to be added again).
- /stats has three new tiles: Secret notes, Camera and voice, Screen sharing (with file previews).

## Request files by link (added 2026-11-03)
Upload `deploy\omnibeam-request-upload.zip`, extract it over the app folder, Restart, then Cloudflare → Purge everything.
- **⋯ menu → Request files**: makes a link `omnibeam.site/r/<id>#<key>` (optional "what do you need" text, 1 hour to 7 days, upload limit, PIN). Anyone opens it in any browser, with no app or pairing, picks files and taps Send (`public/request.html` + `public/put.js`). The files arrive on the device that made the link, in Received files.
- End-to-end encrypted like share links: the key is after `#`. Each upload gets its own key, sealed with the link's key. Uploads are stored in `data/drops/` (same size limit `DROP_MAX_MB` and disk budget `DROP_TOTAL_MB` as share links), only the requesting device can download them (`X-Request-Token`), and each is deleted from the server as soon as that device has it. Unclaimed files are deleted after `DROP_MAX_HOURS` (7 days). The links themselves are in `data/requests/`.
- If OmniBeam is closed on the requesting device, the files wait and arrive when it opens; with notifications on it gets one ("Files arrived on your request link").
- Optional: `REQUESTS=false` turns it off. Limits: 20 new request links and 30 uploads per network per hour.
- /stats has a new tile: Request links (made, uploads received, size).

## TV mode and automatic error reports (added 2026-11-03)

- **TV mode**: `omnibeam.site/tv` (and `/ar/tv`, `/fr/tv`…), also in the ⋯ menu. Open it in a smart TV's browser: it shows a big QR code. A phone scans it with its camera, OmniBeam opens there already paired with the TV, and the phone taps the TV and picks photos/videos. The TV only receives; files from paired phones are taken without asking (pairing needs the QR on the TV screen), and photos/videos play as a full-screen slideshow (8 s per photo; remote: ◀ ▶ browse, OK pause, Back to the QR code). Other files are kept in Received files. The page is not indexed (noindex). Nothing to set up.
- **Error reports**: a browser tab that crashed while OmniBeam was on screen (seen when the tab opens again) and a transfer with no progress for 30 seconds are reported like other problems. `/stats` has a new **Crashes and stuck transfers** section.
- **Telegram for each one**: crashes, stuck transfers and script errors not seen in the last 7 days go to Telegram as they happen, through the same bot as the alerts. **This needs `ALERT_TELEGRAM_TOKEN` in cPanel** (the @OmniBeam_bot token; the uptime Worker's secret does not count, the Node app needs its own copy), then Restart and press **Send a test alert** on `/stats`. Optional: `INSTANT_ALERTS=off` (or `email`/`both`), `INSTANT_EVERY_MIN=10` (at most one message per 10 minutes, a burst is gathered into one), `INSTANT_MAX_DAY=30`. The same device and kind is sent at most once an hour.
- **TV PIN (optional)**: the TV screen has **Set a PIN** (4–8 digits, kept only on the TV). Phones must type it after scanning the QR code; the PIN is mixed into the pairing proof and never sent. With a PIN on, the TV declines files from unpaired phones (no ask), 5 wrong tries replace the QR code, and setting or changing the PIN unpairs all phones.

## iPhone screen off, faster first visit (added 2026-11-04)
Upload `deploy\omnibeam-speed-screen-upload.zip` (it replaces omnibeam-tv-reports-upload.zip: it has everything from it too), extract it over the app folder, Restart, then Cloudflare → Purge everything. Nothing to set up. The zip has `DEPLOY-speed-screen.txt` with the same notes.
- **iPhone screen turns off during a transfer**: an iPhone stops a web page as soon as its screen turns off (no website can keep running then). The iPhone now tells the other device when its screen turns off, and that device pauses the transfer cleanly ("Paused: the screen of X turned off. It continues by itself when X is back", "Resuming…" on the card) instead of sending into a dying connection or showing an error. When the screen is back, the phone checks its connection at once and the transfer continues from where it stopped, by itself, within a few seconds, in both directions, direct and through the server. Repeated screen-offs keep working (only breaks without any progress count towards giving up), and paused transfers wait up to 30 minutes (was 10).
- **Page thrown away by Safari while the screen was off**: a phone that was receiving continues where it stopped after the reload (the part that arrived is saved when the screen turns off, and in 8 MB steps while receiving). A phone that was sending shows "The transfer to X stopped when the screen turned off. Pick the same files again to continue where it stopped." Picking them sends only the rest, and the other device takes it without asking again.
- **Screen kept on** where the Wake Lock API is missing or doesn't work (iPhone home-screen apps before iOS 18.4, iOS before 16.4): a 1 KB silent video plays (invisible) while a transfer runs.
- **Settings → Screen off (iPhone) → "Keep transfers going with the screen off (iPhone, experimental)"**, off by default, shown only on iPhone/iPad: plays a near-silent sound during transfers, with "OmniBeam · Sending N file(s)" on the lock screen, which may keep Safari running with the screen off. It pauses music that is playing. Not tested on a real iPhone yet.
- **Faster first visit**: pages and scripts are sent with brotli (about 15% smaller than gzip; browsers without it still get gzip), and app.js and the language file are fetched early (`<link rel="preload">`, kept in step with the script's version by the server). The server also stops reading relayed data from a sender while the receiver's connection has more than 8 MB waiting (memory stays low; same speed).
- **Tests**: `tests/screen-lock.test.js` (the screen-lock simulation; `/__test/socket` in server.js only works with NODE_ENV=test on localhost) and `tests/load.test.js`. Measuring tools: `tools/perf/page-load.js`, `sizes.js`, `transfer-speed.js`.

## App folder closed, 1-year cache, new notification keys (added 2026-11-04)
The web server's folder for omnibeam.site is the app folder itself, so LiteSpeed sent any file in it (server.js, stderr.log, DEPLOY notes, data/ with the notification keys and statistics) and sent public/ files itself with a 4-hour cache. Fix: replace the app folder's `.htaccess` with `deploy\htaccess-full.txt` (the CLOUDLINUX PASSENGER block unchanged, `Options -Indexes`, then `deploy\htaccess-omnibeam.txt`; the old file also had leftovers of a WordPress site, kept in `deploy\htaccess-old-backup.txt`; make `.htaccess.bak` first). It refuses every existing file or folder outside public/ (except .well-known/ for AutoSSL), gives `?v=` files `Cache-Control: public, max-age=31536000, immutable` and unversioned scripts/styles `no-cache`, and sends the manifest as application/manifest+json. Undo: rename .htaccess.bak back to .htaccess. Then upload `deploy\omnibeam-cache-fix-upload.zip` (app.js v60: a device with notifications on replaces a subscription made with an old server key by itself), delete `data/push-keys.json` and `data/push.json`, Restart, and purge Cloudflare. Step by step: `deploy\DEPLOY-cache-fix.txt`. Checked by two tests at the end of `tests/live-full.check.js`. Keep this in mind for new files: anything put in the app folder outside public/ is refused by the web server, and only Node routes or public/ files reach visitors.
- **Update (same day):** the .htaccess blocking works, but LiteSpeed ignores its cache lines for the files it sends from public/ (`Header ... env=` never applies there; the manifest type does). The 1-year cache for `?v=` files is set by a Cloudflare Cache Rule instead: `deployCLOUDFLARE-cache-rule.txt`. Unversioned scripts keep Cloudflare's 4-hour browser TTL (pages never load them).

## Five upgrades: faster load, intro video, status page, website box, Telegram bot (added 2026-11-05)
Upload `deploy\omnibeam-upgrades-1105-upload.zip` (it replaces omnibeam-v62-null-fix-upload.zip and omnibeam-seo-1104-upload.zip: it has everything from both). Step by step, with the files to delete on the server and the Cloudflare and BotFather steps: `deploy\DEPLOY-upgrades-1105.txt`. Phone and TV checklist: `device-test-1105.md`.
- **Faster load**: LiteSpeed sends the files in public/ itself, so the server's minifier never ran for them. The upload zip now holds **minified** scripts and styles (`tools/minify.js`, used by `tools/build-upload.js` and `tools/deploy.js`; the files in this folder stay readable): app.js 276 KB → 159 KB, 66 KB → 42 KB over the wire. Pre-compressed .br files would not help (LiteSpeed doesn't send them for a plain request and Cloudflare compresses anyway). **Google Analytics** (gtag.js) is now fetched only after the visitor pressed Allow (now or on an earlier visit), and then only when the page is idle or at the first tap/scroll/key; the page view is queued right before, after the consent update, so it is not lost. Before a choice nothing at all goes to Google (it used to send cookieless pings). The **jump of the home card on /ar/** (CLS 0.14 on a slow phone) came from the "♥ Support" link that app.js showed in the footer, which made the footer a line taller; the server now puts the Support links in the page from the start (same look). Build a zip with `node tools/build-upload.js <name>`.
- **Intro video on the home page**: in the learn section, "OmniBeam in 1 minute": a lazy poster image (`intro-<lang>.webp`) with the length read from the video file; the video (`intro-<lang>.mp4`) is only fetched when pressed and plays in the same 16:9 box. VideoObject in the JSON-LD of every home page. Subtitles: none exist yet; put `public/media/intro-<lang>.vtt` (WebVTT) there and Restart, and they are used and listed automatically.
- **Status page** `/status` (and `/<lang>/status`, linked in every footer, `noindex`, not in the sitemap; JSON at `/api/status`): "All systems working" or what isn't, uptime of the last 30 days, recent incidents. Sources: the uptime Worker POSTs each check to `/api/status/checks` with `STATUS_KEY` (keeps checks it couldn't send while the site was down), and the server's own checks every 5 minutes (TURN logins, link storage, the Telegram bot). Data in `data/status.json`. Needs `STATUS_KEY` in cPanel and as a Worker secret, and the new `tools/uptime-worker.js` code in the Worker.
- **"Send me files" box for websites**: Request files → `1 year (for a website)` → **Put this on your website** gives an `<iframe>` code with a visible "Powered by OmniBeam" link. The box is `/embed/r/<id>?lang=xx#<key>.<public key>` (`public/embed-box.html` + put.js); only this address may be framed by other sites (`frame-ancestors *`, no X-Frame-Options); every other page keeps `frame-ancestors 'none'`. Because the code is public, every new request link also gets an ECDH key pair whose private key stays on the device: uploads through the box are sealed to the public key (`x1.` boxes), so neither the server nor someone reading the page source can open them. Limits: the usual per network, plus `REQUEST_UPLOADS_PER_LINK_DAY` (100). Request links can now work up to `REQUEST_MAX_HOURS` (8760 = 1 year); uploaded files are still deleted after `DROP_MAX_HOURS`. Guide: `/embed` in 9 languages.
- **Telegram bot** (off until `TG_BOT_TOKEN` is set; or `TG_BOT_USE_ALERT_TOKEN=true` to use the alert bot @OmniBeam_bot, then also set `ALERT_TELEGRAM_CHAT`): Settings → Telegram → Link Telegram makes a 1-year request link of its own and a one-time `t.me/<bot>?start=<code>` link. Files, photos, videos, voice notes and text sent to the bot arrive on that device through the request-link storage (the server downloads them from Telegram, max 20 MB, and seals them to the device's public key; **not end-to-end**: Telegram and the server see them in transit). ⋯ → Send to Telegram sends files (max 50 MB) and text to the chat (not stored). Webhook `https://omnibeam.site/api/tg/<secret from the token>` with Telegram's secret_token header, set by the app at every start (`TG_WEBHOOK=off` to do it by hand). Links in `data/telegram.json`. Commands for BotFather are in the deploy notes.
- **Tests**: `tests/upgrades-1105.test.js` (a fake Telegram API on port 3998, extra servers on 3992–3995). The test config now also clears `errors.json` before a run. Measuring: `tools/perf/cls.js` (CLS, LCP, TBT on slow 4G + 4x CPU).
