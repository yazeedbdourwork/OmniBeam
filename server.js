// OmniBeam signaling server.
// Serves the static frontend and relays WebRTC signaling messages between peers.
// Files normally go peer-to-peer over WebRTC; only when that fails are they relayed through here (see RELAY).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
// ws is bundled in ./vendor so the app runs without `npm install` (handy on cPanel hosting)
const { WebSocketServer } = require('./vendor/ws');
const { EventEmitter } = require('events');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Relay fallback: when a direct WebRTC connection can't be made (no TURN, strict NAT, VPN), files are
// sent through this server instead. Uses the server's bandwidth; set RELAY=false to turn it off.
const RELAY = process.env.RELAY !== 'false';
// Google Analytics measurement ID (looks like G-ABC123XYZ). Put it between the quotes below, or set the
// GA_ID environment variable in cPanel. Leave it empty to turn visitor statistics off. Visitors are asked
// first (public/consent.js); nothing is loaded from Google until they allow it.
const GA_ID = (process.env.GA_ID ?? 'G-XCPM5D8NQC').trim();
// "Support OmniBeam": your donation page (Ko-fi, Buy Me a Coffee, PayPal.me…), starting with https://. Put it between
// the quotes below or set SUPPORT_URL in cPanel. Empty: the Support links stay hidden.
const SUPPORT_URL = (() => {
  const url = (process.env.SUPPORT_URL ?? 'https://paypal.me/Ymb1988').trim();
  if (url && !/^https:\/\/[^\s"'<>]+$/.test(url)) { console.warn(`SUPPORT_URL "${url}" must start with https://; the Support links are off`); return ''; }
  return url;
})();
// OmniBeam's own social media pages. Put each full address (https://…) between the quotes, or set the environment
// variable in cPanel (SOCIAL_X, SOCIAL_INSTAGRAM, SOCIAL_LINKEDIN, SOCIAL_YOUTUBE, SOCIAL_FACEBOOK, SOCIAL_TIKTOK).
// Each one that is set gets an icon in the home page footer and is listed for search engines (Organization sameAs).
const SOCIAL = Object.entries({
  X: process.env.SOCIAL_X || '',
  Instagram: process.env.SOCIAL_INSTAGRAM || '',
  LinkedIn: process.env.SOCIAL_LINKEDIN || '',
  YouTube: process.env.SOCIAL_YOUTUBE || '',
  Facebook: process.env.SOCIAL_FACEBOOK ?? 'https://www.facebook.com/omnibeamsite',
  TikTok: process.env.SOCIAL_TIKTOK || '',
}).map(([name, url]) => [name, url.trim()]).filter(([name, url]) => {
  if (!url) return false;
  if (/^https:\/\/[^\s"'<>]+$/.test(url)) return true;
  console.warn(`SOCIAL_${name.toUpperCase()} "${url}" must start with https://; left out`);
  return false;
});
// Meta (Facebook) Pixel ID, only needed for Facebook/Instagram ads: the number from Meta Events Manager, between the
// quotes or as FB_PIXEL_ID in cPanel. Like Google Analytics, it only loads after the visitor presses Allow.
const FB_PIXEL_ID = (() => {
  const id = (process.env.FB_PIXEL_ID ?? '1146646898302082').trim(); // "OmniBeam Pixel" in Meta Events Manager; set FB_PIXEL_ID to '' to turn it off
  if (id && !/^\d{6,20}$/.test(id)) { console.warn(`FB_PIXEL_ID "${id}" should be only digits; the pixel is off`); return ''; }
  return id;
})();
// Owner-only statistics at omnibeam.site/stats (visits, transfers per day, direct vs relay). Put a long secret
// of your own between the quotes below, or set the STATS_KEY environment variable in cPanel, then open /stats and
// type it in. Leave it empty to turn the stats page off. Counting happens either way (numbers only, no IPs).
const STATS_KEY = (process.env.STATS_KEY || '').trim();
// Visitors on /stats (how many, which country, how long they stay, which pages, where they came from): every page
// loads /visit.js, which tells the server when it opens and how long it stays open. No cookies, nothing stored in the
// browser; the country comes from Cloudflare (CF-IPCountry) and the address itself is never saved. Visitors who chose
// "No thanks" on the cookie banner, and the owner's devices (?analytics=off), are not counted. VISITS=false turns it off.
const VISITS = process.env.VISITS !== 'false';
// Alerts when problem reports spike (the Problems list on /stats), so you hear about it without looking.
// By email: put your address between the quotes below or set ALERT_EMAIL in cPanel; it is sent with the host's
// own mail program (sendmail), so there is nothing else to set up. Check the spam folder for the first one.
// By Telegram: make a bot with @BotFather, set ALERT_TELEGRAM_TOKEN in cPanel (never in this file), send your bot
// any message, then press "Send a test alert" on /stats: the chat is found and remembered by itself
// (or set ALERT_TELEGRAM_CHAT). Optional: ALERT_MIN=10 reports within ALERT_WINDOW_MIN=15 minutes, and at
// least 3 times the usual number, from 2+ networks, count as a spike; ALERT_EVERY_MIN=60 at most one alert.
const ALERT_EMAIL = (process.env.ALERT_EMAIL ?? 'yazeedbdourwork@gmail.com').trim(); // set ALERT_EMAIL to '' to turn email alerts off
const ALERT_TELEGRAM_TOKEN = (process.env.ALERT_TELEGRAM_TOKEN || '').trim();
const ALERT_MIN = Number(process.env.ALERT_MIN) || 10;
const ALERT_WINDOW = (Number(process.env.ALERT_WINDOW_MIN) || 15) * 60 * 1000;
const ALERT_EVERY = (Number(process.env.ALERT_EVERY_MIN) || 60) * 60 * 1000;
// Instant alerts, one by one (not only spikes): a browser tab that crashed while OmniBeam was open, a transfer
// that got stuck (no progress for 30 seconds), and a script error not seen in the last 7 days. They go to
// Telegram (ALERT_TELEGRAM_TOKEN, the same bot as above), gathered for a minute so a burst is one message, at most
// one message every INSTANT_EVERY_MIN=10 minutes and INSTANT_MAX_DAY=30 a day, and the same device
// (network) at most once an hour per kind. INSTANT_ALERTS=off turns them off; =email or =both also emails.
const INSTANT_ALERTS = (process.env.INSTANT_ALERTS || 'telegram').trim().toLowerCase();
const INSTANT_EVERY = (Number(process.env.INSTANT_EVERY_MIN) || 10) * 60 * 1000;
const INSTANT_MAX_DAY = Number(process.env.INSTANT_MAX_DAY) || 30;
// Share by link: files are encrypted in the browser, uploaded here, and anyone with the link can download them
// until it expires. Uses the host's disk, so it has limits (environment variables in cPanel, all optional):
//   DROPS=false          turn the feature off
//   DROP_MAX_MB=100      largest upload per link, in MB
//   DROP_TOTAL_MB=1024   all links together may use at most this much disk
//   DROP_MAX_HOURS=168   longest a link can stay available (7 days; 720 also offers 30 days)
const DROPS = process.env.DROPS !== 'false';
const DROP_MAX_MB = Number(process.env.DROP_MAX_MB) || 100;
const DROP_TOTAL_MB = Number(process.env.DROP_TOTAL_MB) || 1024;
const DROP_MAX_HOURS = Number(process.env.DROP_MAX_HOURS) || 168;
// Notifications while OmniBeam is closed (web push). The server signs them with its own key pair ("VAPID"),
// made automatically on the first start and kept in data/push-keys.json. Optional environment variables:
//   PUSH=false                   turn notifications off
//   VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY   use this key pair instead (e.g. to keep it when moving to a new
//                                server: copy them from data/push-keys.json). Changing keys turns off every
//                                device's notifications until it turns them on again.
//   VAPID_SUBJECT                a contact address for the push services, e.g. mailto:you@example.com
//                                (default: the site's address)
const PUSH = process.env.PUSH !== 'false';
const PUSH_SUBJECT = (process.env.VAPID_SUBJECT || '').trim();
// iPhone Shortcut: files shared to the Shortcut are uploaded to /api/inbox/<key> and wait here until OmniBeam on the
// device that made that key picks them up (then they're deleted). Optional environment variables:
//   INBOX=false          turn it off
//   INBOX_MAX_MB=200     largest upload, in MB
//   INBOX_TOTAL_MB=1024  all waiting files together may use at most this much disk
//   INBOX_HOURS=24       files nobody picks up are deleted after this many hours
const INBOX = process.env.INBOX === 'true'; // the iPhone Shortcut was taken off the site on 2026-11-03: off unless INBOX=true
const INBOX_MAX_MB = Number(process.env.INBOX_MAX_MB) || 200;
const INBOX_TOTAL_MB = Number(process.env.INBOX_TOTAL_MB) || 1024;
const INBOX_HOURS = Number(process.env.INBOX_HOURS) || 24;
// Statistics and uploaded links are kept here (created automatically; not inside public/, so never served as is)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_SECRET_ROOMS = 50;
// Pairing codes are only 6 digits, so limit how many a network may try, and allow 2 devices per code
const CODE_ATTEMPTS = 10;
const MAX_PUBLIC_ROOM = 50;
const CODE_WINDOW = 10 * 60 * 1000;
const codeAttempts = new Map(); // network room -> timestamps of recent join-code attempts
function allowCodeAttempt(key) {
  const now = Date.now();
  const recent = (codeAttempts.get(key) || []).filter((t) => now - t < CODE_WINDOW);
  if (recent.length >= CODE_ATTEMPTS) {
    codeAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  codeAttempts.set(key, recent);
  return true;
}
// Fingerprint of the frontend files. Sent to browsers so tabs left open (e.g. on a phone) reload
// themselves after an update instead of running old code.
const BUILD = crypto.createHash('sha256')
  .update(['index.html', 'app.js', 'style.css'].map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f))).join('\n'))
  .digest('hex').slice(0, 12);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.mp3': 'audio/mpeg',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.svg', '.json', '.webmanifest', '.xml', '.txt']);

// ---------- Smaller CSS and JavaScript ----------
// Visitors get minified copies of public/*.css and public/*.js (the files in the folder stay readable for editing).
// CSS is minified here; JavaScript by Terser (vendor/terser) in a separate thread, once per file version, and kept in
// data/min/ so a restart doesn't redo it. Until a file's copy is ready (a few seconds after the first start of a
// new deploy), the original is sent. MINIFY=false turns this off.
const MINIFY = process.env.MINIFY !== 'false';
const minified = new Map(); // sha1 of the original file -> minified Buffer
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
// Comments and spaces out, with strings and url(…) left exactly as they are. Spaces around + and - stay (calc()).
function minifyCss(css) {
  const keep = [];
  const out = String(css)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\)/g, (m) => `\u0000${keep.push(m) - 1}\u0000`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[i]);
}
function minifyAll() {
  if (!MINIFY) return;
  const dir = path.join(DATA_DIR, 'min');
  const todo = [];
  const wanted = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // tools/ holds downloads people run themselves: sent as they are
      if (e.isDirectory()) { if (!['tools', 'media', 'pages', 'store'].includes(e.name)) walk(p); continue; }
      const ext = path.extname(e.name);
      if (ext !== '.js' && ext !== '.css') continue;
      if (e.name === 'mediabunny.js') continue; // already minified, keeps its licence notice (MPL-2.0)
      const src = fs.readFileSync(p);
      const key = sha1(src);
      wanted.add(key + ext);
      const saved = path.join(dir, key + ext);
      if (ext === '.css') { minified.set(key, Buffer.from(minifyCss(src))); continue; }
      if (fs.existsSync(saved)) minified.set(key, fs.readFileSync(saved));
      else todo.push({ key, ext, code: src.toString('utf8'), name: path.relative(PUBLIC_DIR, p) });
    }
  };
  try {
    walk(PUBLIC_DIR);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (!wanted.has(f)) fs.rmSync(path.join(dir, f), { force: true });
  } catch (err) {
    return console.error('Minifying: could not read the files', err.message);
  }
  if (!todo.length) return;
  const { Worker } = require('worker_threads');
  const worker = new Worker(`
    const { parentPort, workerData } = require('worker_threads');
    const terser = require(workerData.terser);
    (async () => {
      for (const job of workerData.todo) {
        try {
          const r = await terser.minify(job.code, { compress: { passes: 2 }, mangle: true, format: { comments: false } });
          parentPort.postMessage({ key: job.key, ext: job.ext, code: r.code });
        } catch (err) {
          parentPort.postMessage({ key: job.key, name: job.name, error: err.message });
        }
      }
    })();
  `, { eval: true, workerData: { todo, terser: path.join(__dirname, 'vendor', 'terser') }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  worker.on('message', (m) => {
    if (m.error || !m.code) return console.warn(`Minifying ${m.name} failed (sending it as it is): ${m.error}`);
    const buf = Buffer.from(m.code);
    minified.set(m.key, buf);
    fs.writeFile(path.join(dir, m.key + m.ext), buf, () => {});
  });
  worker.on('error', (err) => console.error('Minifying stopped:', err.message));
  worker.unref();
}

// ---------- Pages ----------
// The site's public address, used to send visitors on www. or /index.html to one canonical URL
const SITE_URL = (process.env.SITE_URL || 'https://omnibeam.site').replace(/\/$/, '');
// Translations shared with the browser (public/i18n.js and public/lang/). Each language other than English gets
// its own address (/ar/, /fr/, /de/, /hi/…) that is sent already translated, so search engines can index it.
const LANGS = require('./public/i18n.js');
const PAGE_LANGS = Object.keys(LANGS).filter((l) => l !== 'en');
const OG_LOCALE = { en: 'en_US', ar: 'ar_AR', fr: 'fr_FR', es: 'es_ES', tr: 'tr_TR', de: 'de_DE', pt: 'pt_BR', hi: 'hi_IN', id: 'id_ID',
  ru: 'ru_RU', ja: 'ja_JP', zh: 'zh_CN', ko: 'ko_KR', it: 'it_IT', ur: 'ur_PK' };
// Cache version for the language files, from their content, so browsers load a new one after a deploy
const LANG_VERSION = crypto.createHash('sha1')
  .update(PAGE_LANGS.map((l) => fs.readFileSync(path.join(PUBLIC_DIR, 'lang', l + '.js'))).join('\n'))
  .digest('hex').slice(0, 8);

const decodeHtml = (t) => t.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0' })[e]);
const encodeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const normText = (t) => t.replace(/\s+/g, ' ').trim();

// When GA_ID is set, Google's tag goes at the top of every page (right after <meta charset>, which must come first)
// in Google's "consent mode". Google's script (gtag.js, about 150 KB) is only fetched after the visitor pressed Allow
// on the banner (public/consent.js), now or on an earlier visit, and then only once the page is idle or the visitor
// first taps, scrolls or types, so it never competes with OmniBeam's own files on a phone. Until they choose, and
// after "No thanks" (or ?analytics=off on the owner's devices), nothing at all is sent to Google.
// No page view is lost: the "config" command (which sends the page_view) is queued right before the script is added,
// after the consent update, so Google gets it with cookies allowed as soon as its script runs.
const GA_OK = /^G-[A-Z0-9]+$/i.test(GA_ID);
if (GA_ID && !GA_OK) console.warn(`GA_ID "${GA_ID}" doesn't look like a Google Analytics ID (G-XXXXXXX); statistics are off`);
const GA_TAG = GA_OK ? `<!-- Google tag (gtag.js) -->
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    (function () {
      var choice = null;
      try { choice = localStorage.getItem('omnibeam-analytics'); } catch (e) {}
      if (/[?&]analytics=off\\b/.test(location.search)) choice = 'off';
      if (choice === 'no' || choice === 'off') window['ga-disable-${GA_ID}'] = true;
      gtag('consent', 'default', { analytics_storage: choice === 'yes' ? 'granted' : 'denied',
        ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    })();
    // Called by consent.js when the visitor presses Allow, and below for a visitor who allowed it before
    window.obLoadGa = function () {
      if (window.obGaLoaded || window['ga-disable-${GA_ID}']) return;
      window.obGaLoaded = true;
      gtag('js', new Date());
      // Pairing codes and room links can be in the address, so report the page without its ?query and #hash
      gtag('config', '${GA_ID}', { page_location: location.origin + location.pathname });
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=${GA_ID}';
      document.head.appendChild(s);
    };
    // Allowed on an earlier visit: after the page has loaded, at the first tap, scroll or key, or when the phone is
    // idle (at most 5 s after loading), whichever comes first
    (function () {
      var choice = null;
      try { choice = localStorage.getItem('omnibeam-analytics'); } catch (e) {}
      if (choice !== 'yes' || window['ga-disable-${GA_ID}']) return;
      var events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
      var go = function () {
        events.forEach(function (t) { removeEventListener(t, go, true); });
        window.obLoadGa();
      };
      addEventListener('load', function () {
        events.forEach(function (t) { addEventListener(t, go, { capture: true, passive: true }); });
        if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 });
        else setTimeout(go, 3000);
      });
    })();
  </script>
  <script src="/consent.js?v=6" data-ga="${GA_ID}"${FB_PIXEL_ID ? ' data-pixel="1"' : ''} defer></script>` : '';
// Meta Pixel, when FB_PIXEL_ID is set: Meta's usual snippet, except that fbevents.js is only fetched once the visitor
// has pressed Allow on the banner (now or on an earlier visit); consent.js calls obLoadPixel() when they do.
const FB_TAG = FB_PIXEL_ID ? `<!-- Meta Pixel -->
  <script>
    !function(f,n){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[]}(window);
    fbq('init', '${FB_PIXEL_ID}');
    fbq('track', 'PageView');
    window.obLoadPixel = function () {
      if (window.obPixelLoaded) return;
      window.obPixelLoaded = true;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://connect.facebook.net/en_US/fbevents.js';
      document.head.appendChild(s);
    };
    (function () {
      var choice = null;
      try { choice = localStorage.getItem('omnibeam-analytics'); } catch (e) {}
      if (choice === 'yes') addEventListener('load', function () { setTimeout(window.obLoadPixel, 1000); });
    })();
  </script>` : '';
// The site's own visitor count for /stats (public/visit.js, loaded after the page; see VISITS at the top)
const VISIT_TAG = VISITS ? '<script src="/visit.js?v=1" defer></script>' : '';
const withAnalytics = (html) => {
  const tags = [GA_TAG, FB_TAG, VISIT_TAG].filter(Boolean);
  return tags.length ? String(html).replace(/<meta charset="utf-8">\s*/, (m) => `${m}${tags.join('\n  ')}\n  `) : html;
};

// ---------- Security headers ----------
// The Content Security Policy lists everything pages may load: our own files (fonts included), Google Analytics
// (only the inline Google tag above, by its hash), and the Seobility badge image. Anything else (injected scripts,
// other sites framing the page) is blocked by the browser. When adding a new outside service, add it here.
const SITE_HOST = new URL(SITE_URL).host;
const GA_INLINE = GA_TAG ? (GA_TAG.match(/<script>([\s\S]*?)<\/script>/) || [])[1] : '';
const GA_HASH = GA_INLINE ? `'sha256-${crypto.createHash('sha256').update(GA_INLINE).digest('base64')}'` : '';
const FB_INLINE = FB_TAG ? (FB_TAG.match(/<script>([\s\S]*?)<\/script>/) || [])[1] : '';
const FB_HASH = FB_INLINE ? `'sha256-${crypto.createHash('sha256').update(FB_INLINE).digest('base64')}'` : '';
const META = FB_PIXEL_ID ? 'https://connect.facebook.net https://www.facebook.com' : '';
function securityHeaders(req, res) {
  const host = /^[a-z0-9.:[\]-]+$/i.test(req.headers.host || '') ? req.headers.host : SITE_HOST;
  const live = host === SITE_HOST;
  // Google Analytics' own list of addresses (including those used when Google signals are on)
  const google = 'https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://*.google.com';
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${GA_HASH} ${FB_HASH} https://*.googletagmanager.com ${META}`.replace(/\s+/g, ' ').trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: https://app.seobility.net ${google} ${META}`.trim(),
    `connect-src 'self' wss://${host} ws://${host} ${google} ${META}`.trim(),
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "frame-src 'self' blob:", // previews of received PDFs (media.js)
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(live ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  // HTTPS only, for a year (browsers ignore this header on plain http, e.g. when testing on the LAN)
  if (live) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Microphone: the "⚡ Faster Wi-Fi" button (turned off at once, nothing is recorded) and voice notes. Camera:
  // "Take a photo". Screen: "Share my screen". Clipboard: Clipboard sync and the Paste button. This site only,
  // never inside frames, and each only after the browser asks the person. Everything else is off.
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), display-capture=(self), clipboard-read=(self), clipboard-write=(self), geolocation=(), payment=(), usb=(), browsing-topics=()');
}

// Same idea as apply() in i18n.js, on the HTML source: translate text between tags and a few attributes
function translateHtml(html, strings) {
  const tr = (raw) => strings[normText(decodeHtml(raw))];
  return html
    .replace(/>([^<]+)</g, (m, text) => {
      const t = tr(text);
      return t ? '>' + text.replace(/^(\s*)[\s\S]*?(\s*)$/, (x, a, b) => a + encodeHtml(t) + b) + '<' : m;
    })
    .replace(/\b(title|placeholder|aria-label|content|alt)="([^"]*)"/g, (m, attr, value) => {
      const t = tr(value);
      return t ? `${attr}="${encodeHtml(t)}"` : m;
    });
}

// JSON-LD for search engines, built from the page itself so the FAQ always matches what visitors see
function structuredData(html, lang, url) {
  const text = (h) => normText(decodeHtml(h.replace(/<[^>]+>/g, '')));
  const title = text((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'OmniBeam');
  const description = decodeHtml((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  const faq = [...html.matchAll(/<details class="faq"><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } }));
  const graph = [
    // OnlineBusiness: schema.org's kind of Organization for a business that only exists online (LocalBusiness is for
    // places people visit, and needs a street address)
    { '@type': ['Organization', 'OnlineBusiness'], '@id': `${SITE_URL}/#org`, name: 'OmniBeam', url: `${SITE_URL}/`,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/icon-512.png`, width: 512, height: 512 }, image: `${SITE_URL}/og.png`,
      description: 'Free browser-based file sharing between iPhone, Android, Windows, Mac and Linux, encrypted end to end.',
      email: 'yazeedbdourwork@gmail.com', areaServed: 'Worldwide', foundingDate: '2026',
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: 'yazeedbdourwork@gmail.com', availableLanguage: ['en', 'ar'] },
      founder: { '@type': 'Person', name: 'Yazeed Bdour' },
      sameAs: [...SOCIAL.map(([, link]) => link), 'https://apps.microsoft.com/detail/9PLR2PMX3SQZ', 'https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki'] },
    { '@type': 'WebSite', '@id': `${SITE_URL}/#site`, name: 'OmniBeam', url: `${SITE_URL}/`, inLanguage: ['en', ...PAGE_LANGS], publisher: { '@id': `${SITE_URL}/#org` } },
    { '@type': 'WebApplication', name: 'OmniBeam', url, description, inLanguage: lang, applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any (web browser): iOS, Android, Windows, macOS, Linux, ChromeOS', browserRequirements: 'Requires a modern browser with WebRTC',
      isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, image: `${SITE_URL}/og.png`, publisher: { '@id': `${SITE_URL}/#org` } },
    { '@type': 'WebPage', '@id': url, url, name: title, inLanguage: lang, isPartOf: { '@id': `${SITE_URL}/#site` } },
  ];
  if (faq.length) graph.push({ '@type': 'FAQPage', '@id': `${url}#faq`, inLanguage: lang, mainEntity: faq });
  // The intro video on the page (its poster in the learn section), in this page's language
  const intro = introVideoInfo(lang);
  const poster = html.match(/<h2 id="intro-title">([\s\S]*?)<\/h2>[\s\S]*?<figcaption>([\s\S]*?)<\/figcaption>/);
  if (intro && poster) {
    graph.push({ '@type': 'VideoObject', '@id': `${url}#intro`, name: text(poster[1]), description: text(poster[2]), inLanguage: lang,
      thumbnailUrl: [`${SITE_URL}/media/${intro.name}.jpg`, `${SITE_URL}/media/${intro.name}.webp?v=4`], uploadDate: '2026-10-30T00:00:00+03:00',
      duration: `PT${intro.seconds}S`, contentUrl: `${SITE_URL}/media/${intro.name}.mp4?v=4`, isFamilyFriendly: true,
      publisher: { '@id': `${SITE_URL}/#org` }, ...(intro.vtt ? { caption: `${SITE_URL}${intro.vtt}` } : {}) });
  }
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

// Icons linking to OmniBeam's social media pages (SOCIAL above), for the home page footer
const SOCIAL_ICONS = {
  X: '<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>',
  Instagram: '<path d="M12 2.2c3.2 0 3.6 0 4.8.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8C2.4 3.9 3.9 2.4 7.2 2.3 8.4 2.2 8.8 2.2 12 2.2zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1 0 8.3 0 8.7 0 12s0 3.7.1 4.9c.2 4.4 2.6 6.8 7 7 1.2.1 1.6.1 4.9.1s3.7 0 4.9-.1c4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9s0-3.7-.1-4.9c-.2-4.4-2.6-6.8-7-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.9 1.4 1.4 0 0 0 0-2.9z"/>',
  LinkedIn: '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>',
  YouTube: '<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>',
  Facebook: '<path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/>',
  TikTok: '<path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>',
};
function socialLinks() {
  if (!SOCIAL.length) return '';
  return `<nav class="social-links" aria-label="OmniBeam on social media">${SOCIAL.map(([name, link]) =>
    `<a href="${encodeHtml(link)}" target="_blank" rel="noopener me" title="OmniBeam on ${name}" aria-label="OmniBeam on ${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${SOCIAL_ICONS[name]}</svg></a>`).join('')}</nav>`;
}

// The intro video in each language (public/media/intro-<lang>.mp4): its length, read once from the file's "mvhd"
// header, for the label on the poster and the VideoObject for search engines. Subtitles are used when
// public/media/intro-<lang>.vtt exists (none are made yet: drop a WebVTT file there and Restart).
const introCache = new Map();
function introVideoInfo(lang) {
  if (introCache.has(lang)) return introCache.get(lang);
  let info = null;
  try {
    const name = fs.existsSync(path.join(PUBLIC_DIR, 'media', `intro-${lang}.mp4`)) ? `intro-${lang}` : 'intro-en';
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, 'media', `${name}.mp4`));
    const i = buf.indexOf('mvhd');
    const v1 = buf[i + 4] === 1;
    const scale = buf.readUInt32BE(i + (v1 ? 24 : 16));
    const units = v1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
    const seconds = Math.round(units / scale);
    const vtt = fs.existsSync(path.join(PUBLIC_DIR, 'media', `${name}.vtt`)) ? `/media/${name}.vtt` : '';
    if (i > 0 && seconds > 0) info = { name, seconds, vtt };
  } catch {}
  introCache.set(lang, info);
  return info;
}

// index.html for one language: translated, with its own canonical URL, locale and structured data
function renderHome(lang) {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const url = lang === 'en' ? `${SITE_URL}/` : `${SITE_URL}/${lang}/`;
  if (lang !== 'en') {
    const others = Object.keys(LANGS).filter((l) => l !== lang);
    html = translateHtml(html, LANGS[lang].strings)
      .replace('<html lang="en">', `<html lang="${lang}" dir="${LANGS[lang].dir}">`)
      .replace('<link rel="canonical" href="https://omnibeam.site/">', `<link rel="canonical" href="${url}">`)
      .replace('<meta property="og:url" content="https://omnibeam.site/">', `<meta property="og:url" content="${url}">`)
      .replace('<meta property="og:locale" content="en_US">', `<meta property="og:locale" content="${OG_LOCALE[lang] || lang}">`)
      .replace(/(\s*<meta property="og:locale:alternate" content="[^"]*">)+/, others.map((l) => `\n  <meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`).join(''))
      // Links to the page in the other languages
      .replace(/<span class="lang-links">[\s\S]*?<\/span>/, `<span class="lang-links">${others
        .map((l) => `<a href="${l === 'en' ? '/' : `/${l}/`}" hreflang="${l}" lang="${l}">${LANGS[l].name}</a>`).join(' ')}</span>`)
      // This language's translations, for the text the app adds while it runs (fetched early, with the app's script)
      .replace(/(\s*)<script src="\/i18n\.js/, `$1<script src="/lang/${lang}.js?v=${LANG_VERSION}" defer></script>$1<script src="/i18n.js`)
      .replace(/(\s*)<link rel="preload" href="\/app\.js/, `$1<link rel="preload" href="/lang/${lang}.js?v=${LANG_VERSION}" as="script">$1<link rel="preload" href="/app.js`)
      // Links to the info pages and guides go to this language's version where there is one
      .replace(/href="\/([a-z0-9-]+)"/g, (m, slug) => (pages.has(`${lang}/${slug}`) ? `href="/${lang}/${slug}"` : m));
  }
  // The early fetch of app.js asks for the same version as its <script> tag, even if only one of them was updated
  const appSrc = (html.match(/<script src="(\/app\.js\?v=[^"]+)"/) || [])[1];
  if (appSrc) html = html.replace(/<link rel="preload" href="\/app\.js\?v=[^"]+"/, `<link rel="preload" href="${appSrc}"`);
  // The intro video poster: this language's video and its length (0:52)
  const intro = introVideoInfo(lang);
  if (intro) {
    html = html.replace(/\/media\/intro-en\.(mp4|webp)\?v=4/g, `/media/${intro.name}.$1?v=4`)
      .replace(/<span class="intro-time" aria-hidden="true">[^<]*<\/span>/, `<span class="intro-time" aria-hidden="true">${Math.floor(intro.seconds / 60)}:${String(intro.seconds % 60).padStart(2, '0')}</span>`);
    if (intro.vtt) html = html.replace('<a class="intro-play" ', `<a class="intro-play" data-captions="${intro.vtt}" `);
  } else html = html.replace(/\s*<h2 id="intro-title">[\s\S]*?<\/figure>/, '');
  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="omnibeam-build" content="${BUILD}">`)
    // The language menu shows this page's language
    .replace(/<option value="([a-z]{2})" lang="\1"( selected)?>/g, (m, l) => `<option value="${l}" lang="${l}"${l === lang ? ' selected' : ''}>`)
    .replace('<!--social-links-->', socialLinks())
    // The Support links (header, ⋯ menu, footer) are in the page from the start when SUPPORT_URL is set. They used to
    // appear when app.js ran, which made the footer a line taller on phones and moved the centred home card (CLS 0.14
    // on /ar/). app.js still sets them the same way (showSupport), so nothing changes when it runs.
    .replace(/<(a|span) ([^>]*?)class="([^"]*)"([^>]*?) hidden>/g, (m, tag, before, cls, after) => {
      const all = before + after;
      const mine = /\bsupport-(btn|link)\b/.test(cls) || /id="menu-support"/.test(all);
      if (!SUPPORT_URL || !mine) return m;
      return `<${tag} ${before}class="${cls}"${after}>`.replace(/href="(\/[a-z]{2})?\/about"/, `href="${encodeHtml(SUPPORT_URL)}"`);
    })
    // The styles go inside the page, so it can be drawn without waiting for style.css (one round trip less on phones)
    .replace(/<link rel="stylesheet" href="\/style\.css\?v=\d+">/, () => `<style>${minifyCss(fs.readFileSync(path.join(PUBLIC_DIR, 'style.css'), 'utf8'))}</style>`);
  return withAnalytics(html.replace('<!--structured-data-->', structuredData(html, lang, url)));
}
// public/parts/info.html (moved out of index.html so the first visit loads less), translated like the home page
const infoCache = new Map();
function infoDialogs(lang) {
  if (infoCache.has(lang)) return infoCache.get(lang);
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'parts', 'info.html'), 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '');
  if (lang !== 'en') {
    html = translateHtml(html, LANGS[lang].strings)
      .replace(/href="\/([a-z0-9-]+)"/g, (m, slug) => (pages.has(`${lang}/${slug}`) ? `href="/${lang}/${slug}"` : m));
  }
  const out = Buffer.from(html);
  infoCache.set(lang, out);
  return out;
}
// TV mode (/tv): the home page marked class="tv" (app.js and style.css switch to the TV screen), not indexed
const tvCache = new Map();
function tvPage(lang) {
  if (tvCache.has(lang)) return tvCache.get(lang);
  const html = home(lang)
    .replace(/<html lang="([a-z]{2})"/, '<html class="tv" lang="$1"')
    // The TV screen's heading is this page's H1 (on the home page it is a plain <p>, so the real H1 comes first)
    .replace(/<h1 id="learn-title">([\s\S]*?)<\/h1>/, '<h2 id="learn-title">$1</h2>')
    .replace(/<p class="tv-heading" id="tv-title">([\s\S]*?)<\/p>/, '<h1 class="tv-heading" id="tv-title">$1</h1>')
    .replace(/<title>[^<]*<\/title>/, `<title>${(LANGS[lang] && LANGS[lang].strings['TV mode']) || 'TV mode'} · OmniBeam</title>`)
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <meta name="robots" content="noindex">');
  const out = Buffer.from(html);
  tvCache.set(lang, out);
  return out;
}
const homeCache = new Map(); // lang -> rendered page (index.html only changes on a deploy, which restarts the app)
const home = (lang) => homeCache.get(lang) || homeCache.set(lang, renderHome(lang)).get(lang);

// ---------- Info pages and guides ----------
// Each page's text is in public/pages/<lang>/<slug>.html: a short header (title, description, kind, updated date)
// and the article. The server wraps it in the shared layout and serves it at /<slug> in English and /<lang>/<slug>
// in other languages, with links between the languages. /guides lists the guides (kind: guide), /blog the blog
// posts (kind: post, newest first by "published"); /sitemap.xml lists everything.
// To add a page, guide or post: add its file in pages/en/ (and in other languages if translated) and Restart.
const PAGES_DIR = path.join(PUBLIC_DIR, 'pages');
const PAGE_UI = JSON.parse(fs.readFileSync(path.join(PAGES_DIR, 'ui.json'), 'utf8'));
const ui = (lang, key) => (PAGE_UI[lang] && PAGE_UI[lang][key]) || PAGE_UI.en[key];
const ALL_LANGS = Object.keys(LANGS);
const langPath = (lang, slug = '') => (lang === 'en' ? `/${slug}` : `/${lang}/${slug}`);
function loadPages() {
  const found = new Map(); // "<lang>/<slug>" -> page
  for (const lang of ALL_LANGS) {
    let files = [];
    try { files = fs.readdirSync(path.join(PAGES_DIR, lang)); } catch {}
    for (const file of files.filter((f) => /^[a-z0-9-]+\.html$/.test(f))) {
      const src = fs.readFileSync(path.join(PAGES_DIR, lang, file), 'utf8').replace(/^\uFEFF/, '');
      const head = src.match(/^<!--([\s\S]*?)-->/);
      const meta = {};
      for (const line of (head ? head[1] : '').split('\n')) {
        const m = line.match(/^\s*([a-z]+):\s*(.*?)\s*$/);
        if (m) meta[m[1]] = m[2];
      }
      const slug = file.slice(0, -5);
      found.set(`${lang}/${slug}`, {
        lang, slug, title: meta.title || 'OmniBeam', description: meta.description || '', kind: meta.kind || 'info',
        short: meta.short || meta.title, order: Number(meta.order) || 99, updated: meta.updated || '', published: meta.published || meta.updated || '',
        body: head ? src.slice(head[0].length).trim() : src.trim(),
      });
    }
  }
  // The guides list and the blog are pages of their own in every language that has guides or posts
  for (const lang of ALL_LANGS) {
    for (const [kind, slug] of [['guide', 'guides'], ['post', 'blog'], ['compare', 'compare']]) {
      const list = sortedKind(found, lang, kind);
      if (!list.length) continue;
      found.set(`${lang}/${slug}`, {
        lang, slug, title: ui(lang, `${slug}Title`), description: ui(lang, `${slug}Description`), kind: 'hub', short: ui(lang, slug),
        updated: list.map((g) => g.updated).sort().pop(),
        body: `<h1>${ui(lang, `${slug}Heading`)}</h1>\n<p class="lead">${ui(lang, `${slug}Lead`)}</p>\n<ul class="guide-list">\n${list
          .map((g) => `  <li><a href="${langPath(lang, g.slug)}">${g.short}</a>${kind === 'post' && g.published ? `<time datetime="${g.published}">${prettyDate(g.published, lang)}</time>` : ''}<span>${g.description}</span></li>`).join('\n')}\n</ul>\n<p>${ui(lang, `${slug}Outro`)}</p>${PAGE_UI[lang]?.[`${slug}More`] ? `\n${PAGE_UI[lang][`${slug}More`]}` : ''}`,
      });
    }
  }
  return found;
}
// Guides in their set order, blog posts newest first (the status page is added to the list in loadPages)
function sortedKind(all, lang, kind) {
  return [...all.values()].filter((p) => p.lang === lang && p.kind === kind)
    .sort(kind === 'post' ? (a, b) => b.published.localeCompare(a.published) || a.order - b.order : (a, b) => a.order - b.order);
}
const prettyDate = (iso, lang) => {
  try { return new Date(iso + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-EG' : lang, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch { return iso; }
};
const pages = loadPages();

// A page's title or description inside an attribute (content="…"): a " in the text would end the attribute early
const attr = (t) => String(t).replace(/"/g, '&quot;');
// Everything a page shows, shared by the normal page (renderPage) and its AMP copy (renderAmpPage)
function pageParts(page) {
  const { lang, slug } = page;
  const url = SITE_URL + langPath(lang, slug);
  const versions = ALL_LANGS.filter((l) => pages.has(`${l}/${slug}`));
  const link = (s) => langPath(pages.has(`${lang}/${s}`) ? lang : 'en', s);
  const alternates = versions.length > 1 ? versions.map((l) => `\n  <link rel="alternate" hreflang="${l}" href="${SITE_URL}${langPath(l, slug)}">`).join('')
    + (versions.includes('en') ? `\n  <link rel="alternate" hreflang="x-default" href="${SITE_URL}${langPath('en', slug)}">` : '') : '';
  const homeUrl = langPath(lang);
  // Other guides at the end of a guide (other posts at the end of a post), so readers and search engines find them
  const article = page.kind === 'guide' || page.kind === 'post' || page.kind === 'compare';
  const related = article ? sortedKind(pages, lang, page.kind).filter((p) => p.slug !== slug).slice(0, 8) : [];
  const relatedHtml = related.length ? `\n      <h2>${ui(lang, page.kind === 'post' ? 'morePosts' : page.kind === 'compare' ? 'moreCompare' : 'moreGuides')}</h2>\n      <ul class="guide-list">\n${related
    .map((g) => `        <li><a href="${langPath(lang, g.slug)}">${g.short}</a></li>`).join('\n')}\n      </ul>` : '';
  const dateLine = page.kind === 'post' && page.published
    ? `<p class="post-date">${ui(lang, 'published')} <time datetime="${page.published}">${prettyDate(page.published, lang)}</time></p>\n      ` : '';
  const crumbs = [{ name: 'OmniBeam', item: SITE_URL + homeUrl }];
  if (page.kind === 'guide') crumbs.push({ name: ui(lang, 'guides'), item: SITE_URL + link('guides') });
  if (page.kind === 'post') crumbs.push({ name: ui(lang, 'blog'), item: SITE_URL + link('blog') });
  if (page.kind === 'compare') crumbs.push({ name: ui(lang, 'compare'), item: SITE_URL + link('compare') });
  crumbs.push({ name: page.short, item: url });
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': page.kind === 'post' ? 'BlogPosting' : page.kind === 'guide' || page.kind === 'compare' ? 'Article' : 'WebPage', '@id': url, url, name: page.title, headline: page.short, description: page.description,
        inLanguage: lang, ...(page.updated ? { dateModified: page.updated } : {}), ...(page.kind === 'post' && page.published ? { datePublished: page.published } : {}), image: `${SITE_URL}/og.png`,
        ...(article ? { author: { '@type': 'Person', name: 'Yazeed Bdour' } } : {}),
        isPartOf: { '@id': `${SITE_URL}/#site` }, publisher: { '@id': `${SITE_URL}/#org` } },
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, ...c })) },
    ],
  };
  // The page's "Questions and answers" section (<section class="qa">: <h3> question, <p> answer) as an FAQPage
  const text = (h) => normText(decodeHtml(h.replace(/<[^>]+>/g, '')));
  const qa = (page.body.match(/<section class="qa">([\s\S]*?)<\/section>/) || [])[1] || '';
  const faq = [...qa.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } }));
  if (faq.length) ld['@graph'].push({ '@type': 'FAQPage', '@id': `${url}#faq`, inLanguage: lang, mainEntity: faq });
  const others = versions.filter((l) => l !== lang)
    .map((l) => `<a href="${langPath(l, slug)}" hreflang="${l}" lang="${l}">${LANGS[l].name}</a>`).join(' ');
  const articleHtml = `${dateLine ? page.body.replace('</h1>', `</h1>\n      ${dateLine.trim()}`) : page.body}${relatedHtml}
      <p class="cta"><a class="open-app" href="${homeUrl}">${ui(lang, 'start')}</a></p>`;
  const footerHtml = `<p><a href="${homeUrl}">OmniBeam</a> <a href="${link('how-to-use')}">${ui(lang, 'howTo')}</a> <a href="${link('guides')}">${ui(lang, 'guides')}</a>${pages.has(`en/blog`) ? ` <a href="${link('blog')}">${ui(lang, 'blog')}</a>` : ''}${pages.has(`en/compare`) ? ` <a href="${link('compare')}">${ui(lang, 'compare')}</a>` : ''} <a href="${link('about')}">${ui(lang, 'about')}</a> <a href="${link('privacy')}">${ui(lang, 'privacy')}</a> <a href="${link('terms')}">${ui(lang, 'terms')}</a></p>${others ? `\n    <p class="page-langs">${others}</p>` : ''}
    <p>© 2026 OmniBeam.Site • ${ui(lang, 'createdBy')} <a href="https://www.facebook.com/jordanian.1988" target="_blank" rel="noopener noreferrer">Yazeed Bdour</a></p>`;
  return { lang, slug, url, versions, alternates, homeUrl, ld, articleHtml, footerHtml };
}
// Pages with an AMP copy: all of them except the live status page, whose content changes on every visit
const hasAmp = (page) => page.kind !== 'status';
const ampPath = (lang, slug) => (lang === 'en' ? `/amp/${slug}` : `/amp/${lang}/${slug}`);

function renderPage(page) {
  const { lang, slug, url, versions, alternates, homeUrl, ld, articleHtml, footerHtml } = pageParts(page);
  const amphtml = hasAmp(page) ? `\n  <link rel="amphtml" href="${SITE_URL}${ampPath(lang, slug)}">` : '';
  return withAnalytics(`<!doctype html>
<html lang="${lang}" dir="${LANGS[lang].dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title}</title>
  <meta name="description" content="${attr(page.description)}">
  <link rel="canonical" href="${url}">${amphtml}${alternates}
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="OmniBeam">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${attr(page.title)}">
  <meta property="og:description" content="${attr(page.description)}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${OG_LOCALE[lang] || lang}">${versions.filter((l) => l !== lang).map((l) => `\n  <meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`).join('')}
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
  <meta name="theme-color" content="#e6e9f0" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#2b2e38" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/icon.svg?v=4" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="preload" href="/fonts/plus-jakarta-sans-latin.woff2?v=1" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/pages.css?v=12">
</head>
<body>
  <header class="page-header">
    <nav aria-label="Main">
      <a class="brand" href="${homeUrl}"><img src="/icon.svg?v=4" alt="OmniBeam logo" width="32" height="32"><span>Omni<span>Beam</span></span></a>
      <a class="open-app" href="${homeUrl}">${ui(lang, 'open')}</a>
    </nav>
  </header>
  <main>
    <article>
      ${articleHtml}
    </article>
  </main>
  <footer class="page-footer">
    ${footerHtml}
  </footer>
</body>
</html>
`);
}
// ---------- AMP copies of the info pages and guides ----------
// Each page above (except /status) also exists as an AMP page (amp.dev) at /amp/<slug> in English and
// /amp/<lang>/<slug> in the other languages, linked from the normal page with <link rel="amphtml">. The AMP page has
// the same text, styles and links, but follows AMP's rules: only AMP's own script, all styles inside one
// <style amp-custom> (at most 75 KB, no !important, no transitions of layout properties), <amp-img> instead of <img>,
// and full addresses everywhere, because Google shows it from its own AMP cache (cdn.ampproject.org).
// Visits are counted for /stats like on the normal pages, by <amp-pixel> (GET /api/visit?amp=1…), with no cookies.
// Google Analytics and the Meta Pixel are not on the AMP pages: they need the consent banner, which is a script.
const AMP_BOILERPLATE = '<style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript>';
// The Content Security Policy of the AMP pages: AMP's script from cdn.ampproject.org, nothing else from outside
const AMP_CSP = "default-src 'self'; script-src 'self' https://cdn.ampproject.org; style-src 'self' 'unsafe-inline' https://cdn.ampproject.org; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://cdn.ampproject.org; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";
let ampCssCache = null;
function ampCss() {
  if (ampCssCache) return ampCssCache;
  let css = minifyCss(fs.readFileSync(path.join(PUBLIC_DIR, 'pages.css'), 'utf8'))
    .replace(/\s*!important/g, '') // not allowed in AMP
    .replace(/(^|[;{])\s*transition:[^;}]*;?/g, '$1') // AMP only allows transitions of opacity and transform
    .replace(/url\((['"]?)\//g, `url($1${SITE_URL}/`); // fonts by their full address (the page is shown from Google's cache)
  css += '.brand amp-img{flex:none}';
  return (ampCssCache = css);
}
// Page text made fit for AMP: no scripts, inline event handlers, frames or forms; <img> becomes <amp-img> (it needs
// width and height); links and images by their full address
function ampBody(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+on[a-z]+="[^"]*"/gi, '')
    .replace(/<img\b([^>]*)>/gi, (m, attrs) => (/\bwidth=/.test(attrs) && /\bheight=/.test(attrs)
      ? `<amp-img${attrs.replace(/\s*\/$/, '').replace(/\s+(loading|decoding|fetchpriority)="[^"]*"/g, '')} layout="responsive"></amp-img>` : ''))
    .replace(/\s(href|src)="\/(?!\/)/g, ` $1="${SITE_URL}/`);
}
function renderAmpPage(page) {
  const { lang, slug, url, homeUrl, ld, articleHtml, footerHtml } = pageParts(page);
  const pixel = `${SITE_URL}/api/visit?amp=1&amp;p=CANONICAL_PATH&amp;r=DOCUMENT_REFERRER&amp;u=QUERY_PARAM(utm_source)&amp;l=${lang}&amp;w=SCREEN_WIDTH&amp;h=SCREEN_HEIGHT`;
  return `<!doctype html>
<html ⚡ lang="${lang}" dir="${LANGS[lang].dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script async src="https://cdn.ampproject.org/v0.js"></script>
  <title>${page.title}</title>
  <meta name="description" content="${attr(page.description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="OmniBeam">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${attr(page.title)}">
  <meta property="og:description" content="${attr(page.description)}">
  <meta property="og:image" content="${SITE_URL}/og.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="${OG_LOCALE[lang] || lang}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
  <meta name="theme-color" content="#e6e9f0" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#2b2e38" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="${SITE_URL}/favicon.ico" sizes="48x48">
  <link rel="apple-touch-icon" href="${SITE_URL}/apple-touch-icon.png">
  ${AMP_BOILERPLATE}
  <style amp-custom>${ampCss()}</style>
</head>
<body>
  <header class="page-header">
    <nav aria-label="Main">
      <a class="brand" href="${SITE_URL}${homeUrl}"><amp-img src="${SITE_URL}/icon.svg?v=4" alt="OmniBeam logo" width="32" height="32" layout="fixed"></amp-img><span>Omni<span>Beam</span></span></a>
      <a class="open-app" href="${SITE_URL}${homeUrl}">${ui(lang, 'open')}</a>
    </nav>
  </header>
  <main>
    <article>
      ${ampBody(privacyExtra(articleHtml, `${lang}/${slug}`))}
    </article>
  </main>
  <footer class="page-footer">
    ${ampBody(footerHtml)}
  </footer>${VISITS ? `\n  <amp-pixel src="${pixel}" layout="nodisplay"></amp-pixel>` : ''}
</body>
</html>
`;
}
const ampCache = new Map();
const ampHtml = (key) => ampCache.get(key) || ampCache.set(key, Buffer.from(renderAmpPage(pages.get(key)))).get(key);

// ---------- Offline app (service-worker.js, served as /sw.js) ----------
// Kept outside public/: the host's web server sends files in public/ itself, so /sw.js would arrive without its
// version and with a long cache time.
// The service worker's version comes from everything it saves on the device: the home pages in every language,
// the files they load, and app.js's files loaded on demand (more.js, qrcode.js). Any change there (a deploy)
// gives a new version, so phones and the store apps never keep an old copy of OmniBeam.
let swCache = null;
function swScript() {
  if (swCache) return swCache;
  const src = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
  const extra = new Set();
  for (const [, url] of fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8').matchAll(/['`](\/[a-z0-9-]+\.js\?v=\d+)['`]/g)) extra.add(url);
  const hash = crypto.createHash('sha256').update(src).update([...extra].join(' '));
  for (const lang of ['en', ...PAGE_LANGS]) hash.update(home(lang));
  const version = hash.digest('hex').slice(0, 12);
  swCache = Buffer.from(src
    .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
    .replace(/const SHELL = \[([^\]]*)\];/, (m, list) => `const SHELL = [${list}${[...extra].map((u) => `, '${u}'`).join('')}];`));
  return swCache;
}

const pageCache = new Map();
const pageHtml = (key) => pageCache.get(key) || pageCache.set(key, Buffer.from(finishPage(renderPage(pages.get(key)), key))).get(key);
// Said on the privacy pages when the Meta Pixel is on (FB_PIXEL_ID)
const PIXEL_PRIVACY = {
  en: 'If you press Allow on the same banner, OmniBeam also loads the Meta Pixel to measure visits that come from our ads on Facebook and Instagram. Meta receives your IP address and browser details with these requests. After No thanks it is never loaded.',
  ar: 'إذا ضغطت على سماح في الشريط نفسه، يحمّل OmniBeam أيضًا Meta Pixel لقياس الزيارات القادمة من إعلاناتنا على فيسبوك وإنستغرام. تتلقى Meta عنوان IP الخاص بك وتفاصيل متصفحك مع هذه الطلبات. بعد اختيار لا، شكرًا لا يتم تحميله أبدًا.',
  fr: 'Si vous appuyez sur Autoriser dans le même bandeau, OmniBeam charge aussi le pixel Meta pour mesurer les visites venant de nos publicités sur Facebook et Instagram. Meta reçoit votre adresse IP et des informations sur votre navigateur avec ces requêtes. Après Non merci, il n\'est jamais chargé.',
  es: 'Si pulsas Permitir en el mismo aviso, OmniBeam también carga el píxel de Meta para medir las visitas que llegan desde nuestros anuncios en Facebook e Instagram. Meta recibe tu dirección IP y datos de tu navegador con estas solicitudes. Si eliges No, gracias, nunca se carga.',
  tr: 'Aynı bildirimde İzin ver\'e basarsanız OmniBeam, Facebook ve Instagram\'daki reklamlarımızdan gelen ziyaretleri ölçmek için Meta Pixel\'i de yükler. Meta bu isteklerle IP adresinizi ve tarayıcı bilgilerinizi alır. Hayır, teşekkürler seçildiğinde hiç yüklenmez.',
  de: 'Wenn du im selben Hinweis auf Erlauben drückst, lädt OmniBeam auch das Meta-Pixel, um Besuche zu messen, die über unsere Anzeigen auf Facebook und Instagram kommen. Meta erhält mit diesen Anfragen deine IP-Adresse und Angaben zu deinem Browser. Nach Nein, danke wird es nie geladen.',
  pt: 'Se você tocar em Permitir no mesmo aviso, o OmniBeam também carrega o Pixel da Meta para medir as visitas que chegam pelos nossos anúncios no Facebook e no Instagram. A Meta recebe seu endereço IP e dados do navegador com essas requisições. Depois de Não, obrigado, ele nunca é carregado.',
  hi: 'अगर आप उसी बैनर पर अनुमति दें दबाते हैं, तो OmniBeam Facebook और Instagram पर हमारे विज्ञापनों से आने वाली विज़िट मापने के लिए Meta Pixel भी लोड करता है। इन अनुरोधों के साथ Meta को आपका IP पता और ब्राउज़र की जानकारी मिलती है। नहीं, धन्यवाद चुनने पर यह कभी लोड नहीं होता।',
  id: 'Jika Anda menekan Izinkan di banner yang sama, OmniBeam juga memuat Meta Pixel untuk mengukur kunjungan yang datang dari iklan kami di Facebook dan Instagram. Meta menerima alamat IP dan detail browser Anda bersama permintaan ini. Setelah Tidak, terima kasih, Pixel tidak pernah dimuat.',
  ru: 'Если вы нажмёте «Разрешить» в том же уведомлении, OmniBeam также загрузит пиксель Meta, чтобы измерять посещения, пришедшие из нашей рекламы в Facebook и Instagram. Вместе с этими запросами Meta получает ваш IP-адрес и данные браузера. После «Нет, спасибо» он никогда не загружается.',
  ja: '同じバナーで「許可」を押すと、OmniBeamはFacebookやInstagramの広告から来た訪問を計測するためにMetaピクセルも読み込みます。これらのリクエストとともに、MetaはあなたのIPアドレスとブラウザの情報を受け取ります。「許可しない」を選ぶと、一切読み込まれません。',
  zh: '如果你在同一横幅中点按“允许”，OmniBeam 还会加载 Meta Pixel，用来统计来自我们在 Facebook 和 Instagram 上广告的访问。Meta 会随这些请求收到你的 IP 地址和浏览器信息。选择“不用了，谢谢”后，它永远不会加载。',
  ko: '같은 배너에서 허용을 누르면, OmniBeam은 Facebook과 Instagram 광고를 통해 온 방문을 측정하기 위해 Meta 픽셀도 불러옵니다. Meta는 이 요청과 함께 IP 주소와 브라우저 정보를 받습니다. 괜찮습니다를 고르면 절대 불러오지 않습니다.',
  it: 'Se premi Consenti nello stesso banner, OmniBeam carica anche il pixel di Meta per misurare le visite che arrivano dai nostri annunci su Facebook e Instagram. Meta riceve il tuo indirizzo IP e i dati del browser con queste richieste. Dopo No, grazie non viene mai caricato.',
  ur: 'اگر آپ اسی بینر پر "اجازت دیں" دبائیں تو OmniBeam ہمارے Facebook اور Instagram اشتہارات سے آنے والے وزٹ ناپنے کے لیے Meta Pixel بھی لوڈ کرتا ہے۔ ان درخواستوں کے ساتھ Meta کو آپ کا IP پتہ اور براؤزر کی معلومات ملتی ہیں۔ "نہیں، شکریہ" کے بعد یہ کبھی لوڈ نہیں ہوتا۔',
};
function privacyExtra(html, key) {
  const [lang, slug] = key.split('/');
  if (slug === 'privacy' && FB_PIXEL_ID) html = html.replace(/(<p>[^\n]*data-cookie-settings[^\n]*<\/p>)/, `$1\n<p>${PIXEL_PRIVACY[lang] || PIXEL_PRIVACY.en}</p>`);
  return html;
}
function finishPage(html, key) {
  html = privacyExtra(html, key);
  // The styles inside the page, so it can be drawn without waiting for pages.css
  return html.replace(/<link rel="stylesheet" href="\/pages\.css\?v=\d+">/, () => `<style>${minifyCss(fs.readFileSync(path.join(PUBLIC_DIR, 'pages.css'), 'utf8'))}</style>`);
}

// sitemap.xml, built from the pages above so new pages and languages are listed automatically
// llms.txt (llmstxt.org): a short Markdown summary of the site for AI assistants and their crawlers, with links to
// the English pages. Built from the pages, like sitemap.xml, so it stays up to date.
function llmsTxt() {
  const list = (kinds) => [...pages.values()].filter((p) => p.lang === 'en' && kinds.includes(p.kind))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((p) => `- [${p.short || p.title}](${SITE_URL}${langPath('en', p.slug)}): ${p.description || ''}`.trim()).join('\n');
  return `# OmniBeam

> OmniBeam (${SITE_URL}) is a free web app for sending files, photos, videos and text between any devices: iPhone, iPad, Android, Windows, Mac, Linux and Chromebook. It runs in the browser, so there is nothing to install and no account. Transfers are encrypted end to end and go directly between the devices when possible; nothing is stored on a server.

How it works: open ${SITE_URL} on both devices. Devices on the same Wi-Fi appear automatically; devices on different networks pair once with a 6-digit code or a QR code, and paired devices find each other from then on. Tap a device, choose files, and the other device accepts. Files can also be shared by a link that expires. There is no file size limit set by OmniBeam. The site is available in English, Arabic, French, Spanish, Turkish, German, Portuguese, Hindi, Indonesian, Russian, Japanese, Chinese (Simplified), Korean, Italian and Urdu (for example ${SITE_URL}/ar/).

Apps: Windows (Microsoft Store): https://apps.microsoft.com/detail/9PLR2PMX3SQZ ; Chrome and Edge extension: https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki ; on phones it can be installed from the browser as an app.
Price: free, no ads. Made by Yazeed Bdour. Contact: yazeedbdourwork@gmail.com

## Guides

${list(['guide', 'hub'])}

## Comparisons

${list(['compare'])}

## Blog

${list(['post'])}

## About

${list(['page', 'info', 'legal', undefined])}
`.replace(/\n## [^\n]+\n\n(?=\n## |$)/g, '\n');
}

function sitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const entry = (loc, lastmod, alts) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>${alts.map(([l, href]) =>
    `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`).join('')}\n  </url>`;
  const homeAlts = [...ALL_LANGS.map((l) => [l, SITE_URL + langPath(l)]), ['x-default', SITE_URL + '/']];
  const homeDate = fs.statSync(path.join(PUBLIC_DIR, 'index.html')).mtime.toISOString().slice(0, 10);
  const urls = ALL_LANGS.map((l) => entry(SITE_URL + langPath(l), homeDate, homeAlts));
  for (const p of pages.values()) {
    if (p.kind === 'status') continue; // changes all the time and is not indexed
    const versions = ALL_LANGS.filter((l) => pages.has(`${l}/${p.slug}`));
    const alts = versions.length > 1 ? [...versions.map((l) => [l, SITE_URL + langPath(l, p.slug)]),
      ...(versions.includes('en') ? [['x-default', SITE_URL + langPath('en', p.slug)]] : [])] : [];
    urls.push(entry(SITE_URL + langPath(p.lang, p.slug), p.updated || today, alts));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

// Gzip text files once and keep them: they are small and only change on a deploy. Brotli too, for browsers that take
// it (all current ones): about 15% smaller than gzip for the scripts and pages, so phones get the page sooner.
const gzipCache = new Map();
const brCache = new Map();
const brotli = (data) => zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
// How long browsers may keep a file. Pages and unversioned scripts: always revalidate, so visitors get updates right
// after a deploy. Files linked with a version (style.css?v=27) get a new link whenever they change, so browsers and
// Cloudflare may keep those for a year. Images and fonts without a version: a month; robots.txt, llms.txt…: a day.
function cacheFor(req, status, ext) {
  if (status !== 200 || ext === '.html') return 'no-cache';
  if (/[?&]v=/.test(req.url)) return 'public, max-age=31536000, immutable';
  if (['.png', '.jpg', '.webp', '.ico', '.svg', '.woff2'].includes(ext)) return 'public, max-age=2592000, stale-while-revalidate=604800';
  if (['.txt', '.xml'].includes(ext)) return 'public, max-age=86400';
  return 'no-cache';
}
function sendFile(req, res, status, filePath, data, extraHeaders = {}) {
  const ext = path.extname(filePath);
  if ((ext === '.js' || ext === '.css') && minified.size) data = minified.get(sha1(data)) || data;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheFor(req, status, ext),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extraHeaders,
  };
  // ETag: browsers and crawlers that already have this version get a quick "304 Not Modified"
  const hash = crypto.createHash('sha1').update(data).digest('base64url').slice(0, 20);
  headers.ETag = `"${hash}"`;
  if (status === 200 && (req.headers['if-none-match'] || '').includes(hash)) {
    res.writeHead(304, { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'], Vary: 'Accept-Encoding' });
    return res.end();
  }
  if (COMPRESSIBLE.has(ext)) {
    headers.Vary = 'Accept-Encoding';
    const accept = req.headers['accept-encoding'] || '';
    const key = filePath + ':' + hash;
    if (data.length > 1024 && /\bbr\b/.test(accept)) {
      if (!brCache.has(key)) brCache.set(key, brotli(data));
      data = brCache.get(key);
      headers['Content-Encoding'] = 'br';
    } else if (data.length > 1024 && /\bgzip\b/.test(accept)) {
      if (!gzipCache.has(key)) gzipCache.set(key, zlib.gzipSync(data, { level: 9 }));
      data = gzipCache.get(key);
      headers['Content-Encoding'] = 'gzip';
    }
  }
  headers['Content-Length'] = data.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : data);
}
// Videos (public/media/): sent in the pieces the browser asks for (Range requests), so they start playing quickly and
// can be skipped through. Safari doesn't play a video at all without this. Streamed from disk, not kept in memory.
function sendVideo(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(req, res);
    const headers = {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': /[?&]v=/.test(req.url) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ETag: `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,
    };
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), end);
      } else start = Math.max(0, st.size - Number(range[2]));
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}
function notFound(req, res) {
  fs.readFile(path.join(PUBLIC_DIR, '404.html'), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    sendFile(req, res, 404, '404.html', Buffer.from(withAnalytics(data)));
  });
}
function redirect(res, location) {
  res.writeHead(301, { Location: location, 'Cache-Control': 'max-age=3600' });
  res.end();
}

// ICE servers handed to browsers. A TURN server lets transfers go device to device (through the TURN server)
// even when a direct connection is impossible (strict NAT, mobile data, VPNs), instead of through this server.
// Set ONE of these in cPanel's "Setup Node.js App" environment variables:
//   TURN_URL + TURN_USERNAME + TURN_CREDENTIAL      fixed login (e.g. Metered/ExpressTURN dashboard, your own coturn)
//   TURN_URL + TURN_SECRET                          coturn with use-auth-secret: short-lived logins made here
//   CF_TURN_KEY_ID + CF_TURN_API_TOKEN              Cloudflare Realtime TURN: short-lived logins from Cloudflare's API
//   METERED_DOMAIN + METERED_API_KEY                Metered.ca: logins from Metered's API (e.g. yourapp.metered.live)
// TURN_URL may list several addresses separated by commas, e.g. "turn:turn.example.com:3478,turns:turn.example.com:443".
const STUN = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
const TURN_TTL = 24 * 3600; // seconds a generated login stays valid
let turnCache = { servers: null, until: 0 };
// What the stats page shows about TURN: which provider is set up and whether the last login request worked
function turnProvider() {
  const env = process.env;
  if (env.TURN_URL && env.TURN_SECRET) return 'Own TURN server (coturn, shared secret)';
  if (env.TURN_URL) return 'TURN server with a fixed login';
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) return 'Cloudflare';
  if (env.METERED_DOMAIN && env.METERED_API_KEY) return 'Metered';
  return '';
}
const turnState = { ok: null, error: '', at: 0, servers: 0 };
function fetchJson(url, options) {
  return new Promise((resolve, reject) => {
    const req = require('https').request(url, { ...options, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(options.body);
  });
}
async function turnServers() {
  const env = process.env;
  const urls = (env.TURN_URL || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length && env.TURN_SECRET) {
    // coturn "REST API" logins: "<expiry>:omnibeam", password = HMAC-SHA1 of it with the shared secret
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL}:omnibeam`;
    const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
    return [{ urls, username, credential }];
  }
  if (urls.length) return [{ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  if (turnCache.servers && Date.now() < turnCache.until) return turnCache.servers;
  let servers = [];
  if (env.CF_TURN_KEY_ID && env.CF_TURN_API_TOKEN) {
    const r = await fetchJson(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL }),
    });
    // Browsers block port 53, so leave those addresses out (they would only slow down connecting)
    servers = [].concat(r.iceServers || []).map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
  } else if (env.METERED_DOMAIN && env.METERED_API_KEY) {
    const host = env.METERED_DOMAIN.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    servers = [].concat(await fetchJson(`https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(env.METERED_API_KEY)}`, { method: 'GET' }));
  } else {
    return [];
  }
  // Ask again well before the logins expire (Metered's last until they're deleted; 1 hour is plenty)
  turnCache = { servers, until: Date.now() + 3600 * 1000 };
  return servers;
}
async function iceServers() {
  try {
    const turn = await turnServers();
    Object.assign(turnState, { ok: turn.length > 0 || !turnProvider(), error: '', at: Date.now(), servers: turn.length });
    return [STUN, ...turn];
  } catch (err) {
    console.error('Could not get TURN logins:', err.message);
    Object.assign(turnState, { ok: false, error: err.message, at: Date.now(), servers: 0 });
    turnCache = { servers: [], until: Date.now() + 60 * 1000 }; // try again in a minute
    return [STUN];
  }
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    // Malformed URL (e.g. "/%"): reject instead of crashing the server
    res.writeHead(400);
    return res.end('Bad request');
  }
  securityHeaders(req, res);
  if (urlPath.startsWith('/poll/')) return handlePoll(req, res, urlPath);
  if (urlPath.startsWith('/api/drop')) return handleDrop(req, res, urlPath);
  if (urlPath.startsWith('/api/request')) return handleRequest(req, res, urlPath);
  if (urlPath.startsWith('/api/album')) return handleAlbum(req, res, urlPath);
  if (urlPath.startsWith('/api/inbox/')) return handleInbox(req, res, urlPath);
  if (urlPath === '/api/stats') return handleStats(req, res);
  if (urlPath === '/api/stats/alert-test') return handleAlertTest(req, res);
  if (urlPath === '/api/stats/weekly-test') return handleWeeklyTest(req, res);
  if (urlPath === '/api/stats/clear') return handleStatsClear(req, res);
  if (urlPath === '/api/stats/backup') return handleStatsBackup(req, res);
  if (urlPath === '/api/stats/supporters') return handleStatsSupporters(req, res);
  if (urlPath === '/api/supporter') return handleSupporter(req, res);
  if (urlPath === '/api/report') return handleReport(req, res);
  if (urlPath === '/api/visit') return handleVisit(req, res);
  if (urlPath === '/api/status' || urlPath === '/api/status/checks') return handleStatusApi(req, res, urlPath);
  if (urlPath.startsWith('/api/tg/')) return handleTelegram(req, res, urlPath);
  // One address per page: www.omnibeam.site -> omnibeam.site
  const host = String(req.headers.host || '');
  if (/^www\./i.test(host) && (req.method === 'GET' || req.method === 'HEAD')) return redirect(res, SITE_URL + req.url);
  if (urlPath === '/share') {
    // Android share menu before the service worker is ready: just open the app
    req.resume();
    res.writeHead(303, { Location: '/' });
    return res.end();
  }
  if (urlPath === '/config.json') {
    return iceServers().then((list) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ iceServers: list, relay: RELAY,
        drop: DROPS ? { maxMb: DROP_MAX_MB, maxHours: DROP_MAX_HOURS, email: EMAIL_ON, requests: REQUESTS, requestMaxHours: REQ_MAX_HOURS } : null,
        album: ALBUMS ? { itemMb: ALBUM_ITEM_MB, maxMb: ALBUM_MAX_MB, maxDays: ALBUM_MAX_DAYS } : null,
        telegram: tgOn() ? { bot: TG_BOT_NAME, downMb: TG_DOWN_MB, upMb: TG_UP_MB } : null,
        push: pushKeys ? pushKeys.publicKey : null, inbox: INBOX ? { maxMb: INBOX_MAX_MB, hours: INBOX_HOURS } : null,
        support: SUPPORT_URL || null, supporter: !!SUPPORTER_KEY }));
    });
  }
  // The Help, Terms, Privacy and About windows of the home page, in one language, loaded by app.js when first opened
  if (urlPath === '/info-dialogs') {
    const lang = new URL(req.url, 'http://x').searchParams.get('lang');
    return sendFile(req, res, 200, 'info-dialogs.html', infoDialogs(LANGS[lang] ? lang : 'en'), { 'X-Robots-Tag': 'noindex' });
  }
  // Tests only (NODE_ENV=test on localhost): a phone's screen turns off and iOS cuts its connection. close: the server
  // sees it go at once; mute: it stays open but nothing passes any more (dead, and the server hasn't noticed yet)
  if (urlPath === '/__test/socket' && req.method === 'POST' && process.env.NODE_ENV === 'test' && /^localhost:\d+$/.test(req.headers.host || '')) {
    const q = new URL(req.url, 'http://x').searchParams;
    const hit = [...clients.values()].filter((c) => c.name === q.get('name'));
    for (const c of hit) {
      if (q.get('mode') === 'mute') c.ws.muted = true;
      else c.ws.terminate();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ n: hit.length }));
  }
  if (urlPath === '/sitemap.xml') return sendFile(req, res, 200, 'sitemap.xml', Buffer.from(sitemap()));
  if (urlPath === '/llms.txt') return sendFile(req, res, 200, 'llms.txt', Buffer.from(llmsTxt()));
  // The service worker, with this deploy's version written in, so browsers drop the files saved from the last one
  if (urlPath === '/sw.js') return sendFile(req, res, 200, 'sw.js', swScript(), { 'Cache-Control': 'no-cache, no-store' });
  // Download page of a shared link (the key is after # in the address, so it never reaches the server)
  if (/^\/d\/[A-Za-z0-9_-]{8,40}$/.test(urlPath)) {
    return fs.readFile(path.join(PUBLIC_DIR, 'drop.html'), (err, data) => {
      if (err) return notFound(req, res);
      sendFile(req, res, 200, 'drop.html', Buffer.from(withAnalytics(data)), { 'X-Robots-Tag': 'noindex, nofollow' });
    });
  }
  // The "Send me files" box people put on their own website (/embed explains it): the upload page of a request link,
  // made to sit in an <iframe>. This one page may be framed by any site (frame-ancestors *); every other page keeps
  // frame-ancestors 'none' and X-Frame-Options: DENY. The key stays after # in the frame's address.
  if (/^\/embed\/r\/[A-Za-z0-9_-]{8,40}$/.test(urlPath)) {
    return fs.readFile(path.join(PUBLIC_DIR, 'embed-box.html'), (err, data) => {
      if (err) return notFound(req, res);
      res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace("frame-ancestors 'none'", 'frame-ancestors *'));
      res.removeHeader('X-Frame-Options');
      sendFile(req, res, 200, 'embed-box.html', data, { 'X-Robots-Tag': 'noindex, nofollow' });
    });
  }
  // An event photo album (the key is after #, like /d/)
  if (/^\/e\/[A-Za-z0-9_-]{8,40}$/.test(urlPath)) {
    return fs.readFile(path.join(PUBLIC_DIR, 'event.html'), (err, data) => {
      if (err) return notFound(req, res);
      sendFile(req, res, 200, 'event.html', Buffer.from(withAnalytics(data)), { 'X-Robots-Tag': 'noindex, nofollow' });
    });
  }
  // Upload page of a request link (the key is after #, like /d/)
  if (/^\/r\/[A-Za-z0-9_-]{8,40}$/.test(urlPath)) {
    return fs.readFile(path.join(PUBLIC_DIR, 'request.html'), (err, data) => {
      if (err) return notFound(req, res);
      sendFile(req, res, 200, 'request.html', Buffer.from(withAnalytics(data)), { 'X-Robots-Tag': 'noindex, nofollow' });
    });
  }
  // The status page is only in the admin panel now (since 2026-11-12): old links to /status, /ar/status, /amp/…/status
  // go to its Status tab. 302 + no-store, so it can be made public again later without stale redirects.
  if (/^\/(?:amp\/)?(?:[a-z]{2}\/)?status(?:\.html|\/)?$/.test(urlPath)) {
    req.resume();
    res.writeHead(302, { Location: '/admin#status', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    return res.end();
  }
  // The admin panel (Overview, Visitors, Transfers, Features, Problems, Status, Settings), for whoever knows STATS_KEY.
  // /stats, the old address, opens the same page; /admin.html and /stats.html go to /admin
  if (urlPath === '/admin' || urlPath === '/admin/' || urlPath === '/admin.html' || urlPath === '/stats' || urlPath === '/stats.html') {
    if (urlPath !== '/admin' && urlPath !== '/stats') return redirect(res, '/admin');
    return fs.readFile(path.join(PUBLIC_DIR, 'admin.html'), (err, data) => {
      if (err) return notFound(req, res);
      sendFile(req, res, 200, 'admin.html', data, { 'X-Robots-Tag': 'noindex, nofollow' });
    });
  }
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  // TV mode: /tv and /ar/tv… (the app with class="tv": receive-only, big QR code, photo slideshow)
  const tvMatch = urlPath.match(/^\/(?:([a-z]{2})\/)?tv\/?$/);
  if (tvMatch && (!tvMatch[1] || PAGE_LANGS.includes(tvMatch[1]))) {
    const lang = tvMatch[1] || 'en';
    const canonicalPath = lang === 'en' ? '/tv' : `/${lang}/tv`;
    if (urlPath !== canonicalPath) return redirect(res, canonicalPath + query);
    try {
      return sendFile(req, res, 200, 'index.html', tvPage(lang), { 'X-Robots-Tag': 'noindex' });
    } catch (err) {
      console.error('Rendering the TV page failed', err);
      res.writeHead(500);
      return res.end('Server error');
    }
  }
  // Home page in each language: / and /ar/ (the app itself also runs from /ar/)
  const langMatch = urlPath.match(/^\/(?:([a-z]{2})\/?)?(index\.html)?$/);
  if (langMatch && (!langMatch[1] || PAGE_LANGS.includes(langMatch[1]))) {
    const lang = langMatch[1] || 'en';
    const canonicalPath = lang === 'en' ? '/' : `/${lang}/`;
    if (urlPath !== canonicalPath) return redirect(res, canonicalPath + query);
    try {
      return sendFile(req, res, 200, 'index.html', Buffer.from(home(lang)));
    } catch (err) {
      console.error('Rendering the home page failed', err);
      res.writeHead(500);
      return res.end('Server error');
    }
  }
  // AMP copies of the info pages and guides: /amp/privacy, /amp/ar/privacy… (see renderAmpPage)
  const ampMatch = urlPath.match(/^\/amp\/(?:([a-z]{2})\/)?([a-z0-9-]+)\/?$/);
  if (ampMatch) {
    const [, lang = 'en', slug] = ampMatch;
    const key = `${lang}/${slug}`;
    if (!pages.has(key) || !hasAmp(pages.get(key)) || (lang === 'en' && ampMatch[1])) {
      if (pages.has(`en/${slug}`) && hasAmp(pages.get(`en/${slug}`))) return redirect(res, ampPath('en', slug) + query);
      return notFound(req, res);
    }
    if (urlPath !== ampPath(lang, slug)) return redirect(res, ampPath(lang, slug) + query);
    res.removeHeader('X-Frame-Options');
    return sendFile(req, res, 200, 'page.html', ampHtml(key), { 'Content-Security-Policy': AMP_CSP });
  }
  // Info pages and guides: /privacy, /ar/privacy… (and /privacy.html or /privacy/ redirect there)
  const pageMatch = urlPath.match(/^\/(?:([a-z]{2})\/)?([a-z0-9-]+)(\.html|\/)?$/);
  if (pageMatch) {
    const [, lang = 'en', slug, extra] = pageMatch;
    const key = `${lang}/${slug}`;
    if (pages.has(key) && !(lang === 'en' && urlPath.startsWith('/en/'))) {
      if (extra) return redirect(res, langPath(lang, slug) + query);
      return sendFile(req, res, 200, 'page.html', pageHtml(key));
    }
    // Old address of a page that now only exists in English, or /en/…: send to the English one
    if (pages.has(`en/${slug}`) && (extra || lang !== 'en' || urlPath.startsWith('/en/'))) return redirect(res, langPath('en', slug) + query);
  }
  // The intro video, streamed (see sendVideo)
  if (/^\/media\/[a-z0-9-]+\.mp4$/.test(urlPath)) return sendVideo(req, res, path.join(PUBLIC_DIR, urlPath));
  // The page sources are only used to build the pages above
  if (urlPath.startsWith('/pages/')) return notFound(req, res);
  let filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
  if (/^\/[a-z0-9-]+$/.test(urlPath) && urlPath !== '/404') filePath += '.html';
  // Only serve files inside public/ (a plain prefix check would also allow a sibling folder like "public2")
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) || urlPath.includes('\0')) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(req, res);
    sendFile(req, res, 200, filePath, path.extname(filePath) === '.html' ? Buffer.from(withAnalytics(data)) : data);
  });
});

// ---------- HTTP long-polling fallback ----------
// Some antivirus products (e.g. Kaspersky's encrypted-connection scanning) and proxies break WebSockets.
// Clients then fall back to plain HTTPS requests. A PollSocket looks like a `ws` socket to the rest of
// the server, so rooms, pairing and relaying work the same over both transports.
const pollSessions = new Map(); // sid -> PollSocket
const POLL_HOLD = 25000;        // how long a /poll/recv request waits for messages
const POLL_MAX_BATCH = 2 * 1024 * 1024;
const POLL_MAX_QUEUE = 32 * 1024 * 1024;

class PollSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = 1;
    this.sid = crypto.randomUUID();
    this.queue = [];
    this.queuedBytes = 0;
    this.waiter = null;
    this.lastPoll = Date.now();
  }
  send(data) {
    if (this.readyState !== 1) return;
    const item = Buffer.isBuffer(data) ? { b: data.toString('base64') } : String(data);
    const size = typeof item === 'string' ? item.length : item.b.length;
    this.queuedBytes += size;
    if (this.queuedBytes > POLL_MAX_QUEUE) return this.terminate(); // receiver stopped polling
    this.queue.push({ item, size });
    this.flush();
  }
  flush() {
    if (!this.waiter || !this.queue.length) return;
    const res = this.waiter;
    this.waiter = null;
    clearTimeout(res.pollTimer);
    const batch = [];
    let bytes = 0;
    while (this.queue.length && (batch.length === 0 || bytes + this.queue[0].size <= POLL_MAX_BATCH)) {
      const { item, size } = this.queue.shift();
      batch.push(item);
      bytes += size;
    }
    this.queuedBytes -= bytes;
    res.end(JSON.stringify(batch));
  }
  ping() {}
  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.waiter) { clearTimeout(this.waiter.pollTimer); this.waiter.end('[]'); this.waiter = null; }
    pollSessions.delete(this.sid);
    this.emit('close');
  }
  close() {
    this.terminate();
  }
}

function handlePoll(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (urlPath === '/poll/open' && req.method === 'POST') {
    const sock = new PollSocket();
    pollSessions.set(sock.sid, sock);
    json(200, { sid: sock.sid });
    onConnection(sock, req);
    return;
  }
  const sid = new URL(req.url, 'http://x').searchParams.get('sid');
  const sock = pollSessions.get(sid);
  if (!sock) return json(410, { error: 'session closed' });
  sock.lastPoll = Date.now();

  if (urlPath === '/poll/recv') {
    if (sock.waiter) { clearTimeout(sock.waiter.pollTimer); sock.waiter.end('[]'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    sock.waiter = res;
    res.pollTimer = setTimeout(() => {
      if (sock.waiter === res) { sock.waiter = null; res.end('[]'); }
    }, POLL_HOLD);
    req.on('close', () => {
      if (sock.waiter === res) { sock.waiter = null; clearTimeout(res.pollTimer); }
    });
    sock.flush();
    return;
  }
  if ((urlPath === '/poll/send' || urlPath === '/poll/bin') && req.method === 'POST') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024 + 64) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > 1024 * 1024 + 64) return;
      sock.emit('message', Buffer.concat(chunks), urlPath === '/poll/bin');
      json(200, { ok: true });
    });
    return;
  }
  if (urlPath === '/poll/close') {
    sock.terminate();
    return json(200, { ok: true });
  }
  json(404, { error: 'not found' });
}

// ---------- Share by link ----------
// The browser encrypts the files (AES-GCM, with a key that only exists in the link after #, which browsers never
// send to a server) and uploads them in parts. This server only stores encrypted bytes and a little bookkeeping:
// data/drops/<id>.bin (the encrypted parts, one after another) and <id>.json. Links are deleted when they expire,
// after the last download the sender allowed (1, 3, 5, 10 or unlimited), or when the sender deletes them.
// A link can also need a PIN: the download page sends a proof made from the PIN and the key in the link
// (sha256('omnibeam-pin:' + PIN + ':' + key)), so the server, which never has the key, can't work the PIN out
// from what it stores (a hash of that proof). After DROP_PIN_TRIES wrong PINs the link locks for good.
const DROP_DIR = path.join(DATA_DIR, 'drops');
const DROP_PART = 4 * 1024 * 1024; // plain bytes per part; each encrypted part is 16 bytes longer
const DROP_TAG = 16;
const DROP_LINKS_PER_HOUR = 20;    // per network
const DROP_MB_PER_DAY = Math.max(DROP_MAX_MB, 2048); // per network
const DROP_PIN_TRIES = 10;
const drops = new Map(); // id -> bookkeeping (as in <id>.json)
let dropBytes = 0;       // disk used or reserved by all links
const dropUploads = new Map(); // network -> [{ at, size }] recent uploads, for the limits above
const encryptedSize = (size) => size + Math.max(1, Math.ceil(size / DROP_PART)) * DROP_TAG;
const dropFile = (id, ext) => path.join(DROP_DIR, `${id}.${ext}`);

function saveDrop(d) {
  fs.writeFile(dropFile(d.id, 'json'), JSON.stringify(d), (err) => { if (err) console.error('Could not save link', err.message); });
}
function deleteDrop(id) {
  const d = drops.get(id);
  if (!d) return;
  drops.delete(id);
  dropBytes -= d.reserved;
  // An upload to a request link that never finished: it doesn't use up one of the uploads the link allows
  const r = d.req && !d.complete ? requests.get(d.req) : null;
  if (r) { r.uploads = Math.max(0, r.uploads - 1); saveRequest(r); }
  fs.unlink(dropFile(id, 'bin'), () => {});
  fs.unlink(dropFile(id, 'json'), () => {});
}
function loadDrops() {
  if (!DROPS) return;
  try {
    fs.mkdirSync(DROP_DIR, { recursive: true });
    for (const f of fs.readdirSync(DROP_DIR)) {
      const m = f.match(/^([A-Za-z0-9_-]+)\.json$/);
      if (!m) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DROP_DIR, f), 'utf8'));
        d.active = 0;
        drops.set(d.id, d);
        dropBytes += d.reserved;
      } catch { fs.unlink(path.join(DROP_DIR, f), () => {}); }
    }
    // Parts without bookkeeping (a crash mid-upload): remove
    for (const f of fs.readdirSync(DROP_DIR)) {
      const m = f.match(/^([A-Za-z0-9_-]+)\.bin$/);
      if (m && !drops.has(m[1])) fs.unlink(path.join(DROP_DIR, f), () => {});
    }
  } catch (err) {
    console.error('Share by link: cannot use', DROP_DIR, err.message);
  }
}
function cleanDrops() {
  const now = Date.now();
  for (const d of [...drops.values()]) {
    // Expired, or an upload abandoned for more than an hour
    if (now > d.expires || (!d.complete && now - d.touched > 3600 * 1000)) deleteDrop(d.id);
  }
  for (const [key, list] of dropUploads) {
    const recent = list.filter((u) => now - u.at < 24 * 3600 * 1000);
    if (recent.length) dropUploads.set(key, recent); else dropUploads.delete(key);
  }
}

function readJsonBody(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

function handleDrop(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (!DROPS) { req.resume(); return json(404, { error: 'off' }); }
  const m = urlPath.match(/^\/api\/drop(?:\/([A-Za-z0-9_-]{8,40}))?(?:\/(data|email|\d{1,6}))?$/);
  if (!m) { req.resume(); return json(404, { error: 'not found' }); }
  const [, id, sub] = m;
  const d = id ? drops.get(id) : null;
  const owner = (x) => {
    const token = String(req.headers['x-drop-token'] || '');
    return x && token.length === 32 && samePassword(x.tokenHash, crypto.createHash('sha256').update(token).digest('hex'));
  };
  // Files sent to a request link: only the device that made the link may download (or throw away) them
  const reqOwnerOf = (x) => !!x && !!x.req && reqOwner(req, requests.get(x.req));

  // The PIN proof sent by the download page, if the link has a PIN. Wrong ones count towards locking the link.
  // Returns true if it may go on; otherwise it has already answered.
  const pinOk = (x) => {
    if (!x.pinHash) return true;
    if (x.pinFails >= DROP_PIN_TRIES) { json(423, { error: 'locked', pin: true }); return false; }
    const proof = String(req.headers['x-drop-pin'] || '');
    if (!proof) { json(401, { error: 'pin', pin: true, left: DROP_PIN_TRIES - (x.pinFails || 0) }); return false; }
    if (/^[A-Za-z0-9_-]{43}$/.test(proof) && samePassword(x.pinHash, crypto.createHash('sha256').update(proof).digest('hex'))) return true;
    x.pinFails = (x.pinFails || 0) + 1;
    saveDrop(x);
    count('linkPinWrong');
    if (x.pinFails >= DROP_PIN_TRIES) { json(423, { error: 'locked', pin: true }); return false; }
    json(403, { error: 'wrong-pin', pin: true, left: DROP_PIN_TRIES - x.pinFails });
    return false;
  };
  const left = (x) => (x.max ? Math.max(0, x.max - x.downloads - (x.active || 0)) : null);

  // New link: { size, hours, max (downloads allowed, 0 = no limit), once (old pages: max 1), pin (proof), meta }
  //   -> { id, token, part, expires }
  if (!id && req.method === 'POST') {
    return readJsonBody(req).then((body) => {
      const size = Math.floor(Number(body.size));
      const hours = Math.min(DROP_MAX_HOURS, Math.max(1, Number(body.hours) || 24));
      const max = body.once ? 1 : Math.min(100, Math.max(0, Math.floor(Number(body.max) || 0)));
      const pin = body.pin == null || body.pin === '' ? '' : String(body.pin);
      const meta = String(body.meta || '');
      if (!(size > 0) || !/^[A-Za-z0-9_-]{20,12000}$/.test(meta) || (pin && !/^[A-Za-z0-9_-]{43}$/.test(pin))) return json(400, { error: 'bad request' });
      if (size > DROP_MAX_MB * 1024 * 1024) return json(413, { error: 'too-large', maxMb: DROP_MAX_MB });
      const net = 'ip:' + getIp(req);
      const now = Date.now();
      const recent = (dropUploads.get(net) || []).filter((u) => now - u.at < 24 * 3600 * 1000);
      if (recent.filter((u) => now - u.at < 3600 * 1000).length >= DROP_LINKS_PER_HOUR
        || recent.reduce((s, u) => s + u.size, 0) + size > DROP_MB_PER_DAY * 1024 * 1024) {
        return json(429, { error: 'too-many' });
      }
      const reserved = encryptedSize(size);
      if (dropBytes + reserved > DROP_TOTAL_MB * 1024 * 1024) return json(507, { error: 'full' });
      recent.push({ at: now, size });
      dropUploads.set(net, recent);
      const token = crypto.randomBytes(16).toString('hex');
      const drop = {
        id: crypto.randomBytes(12).toString('base64url'), size, reserved, parts: Math.max(1, Math.ceil(size / DROP_PART)), got: 0,
        meta, once: max === 1, max, created: now, expires: now + hours * 3600 * 1000, touched: now, complete: false, downloads: 0,
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        pinHash: pin ? crypto.createHash('sha256').update(pin).digest('hex') : '', pinFails: 0,
      };
      drops.set(drop.id, drop);
      dropBytes += reserved;
      fs.writeFileSync(dropFile(drop.id, 'bin'), '');
      saveDrop(drop);
      count('links');
      if (pin) count('linkPins');
      if (max) count('linkLimited');
      if (hours > 72) count('linkLong');
      if (body.note) count('noteLinks'); // a read-once secret note (drop.js), not files
      json(200, { id: drop.id, token, part: DROP_PART, expires: drop.expires });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  if (!d) { req.resume(); return json(404, { error: 'gone' }); }

  // Email the link (the sender, with its token): { to, key, lang, name, names, tz }. The server writes the email and
  // sends it through Resend; the key is only used for the link in the email and is not kept.
  if (sub === 'email' && req.method === 'POST') {
    if (!owner(d)) { req.resume(); return json(403, { error: 'forbidden' }); }
    if (!EMAIL_ON) { req.resume(); return json(404, { error: 'off' }); }
    return readJsonBody(req, 8 * 1024).then((body) => {
      const to = String(body.to || '').trim();
      const key = String(body.key || '');
      const lang = LANGS[body.lang] ? body.lang : 'en';
      const clean = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
      const name = clean(body.name, 40) || 'Someone';
      const names = clean(body.names, 120) || 'Files';
      let tz = String(body.tz || '');
      try { if (tz) new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { tz = ''; }
      if (!d.complete || to.length > 254 || !EMAIL_RE.test(to) || !/^[A-Za-z0-9_-]{22}$/.test(key)) return json(400, { error: 'bad request' });
      if ((d.emailed || 0) >= EMAIL_PER_LINK) return json(429, { error: 'limit', why: 'link' });
      const ip = getIp(req);
      const why = emailAllowed(ip);
      if (why) return json(429, { error: 'limit', why });
      emailCounted(ip);
      d.emailed = (d.emailed || 0) + 1;
      saveDrop(d);
      return resendEmail(linkEmail(d, { to, key, lang, name, names, tz })).then(() => {
        count('emailsSent');
        json(200, { ok: true });
      }, (err) => {
        console.error('Link email not sent:', err.message);
        count('emailsFailed');
        d.emailed--;
        json(502, { error: 'send' });
      });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  // Upload part n (in order). Sending a part again that already arrived is fine (a retry after a lost answer).
  if (sub && sub !== 'data' && req.method === 'PUT') {
    if (!owner(d)) { req.resume(); return json(403, { error: 'forbidden' }); }
    const n = Number(sub);
    if (n < d.got) { req.resume(); return json(200, { got: d.got }); }
    if (n !== d.got || d.complete) { req.resume(); return json(409, { error: 'order', got: d.got }); }
    const expected = Math.min(DROP_PART, d.size - n * DROP_PART) + DROP_TAG;
    const chunks = [];
    let len = 0;
    req.on('data', (c) => {
      len += c.length;
      if (len > expected) return req.destroy();
      chunks.push(c);
    });
    req.on('end', () => {
      if (len !== expected) return json(400, { error: 'size' });
      if (d.got !== n || !drops.has(d.id)) return json(409, { error: 'order', got: d.got });
      fs.appendFile(dropFile(d.id, 'bin'), Buffer.concat(chunks), (err) => {
        if (err) { console.error('Could not store link part', err.message); return json(500, { error: 'disk' }); }
        d.got = n + 1;
        d.touched = Date.now();
        d.complete = d.got === d.parts;
        saveDrop(d);
        if (d.complete && d.req) requestFileReady(d);
        json(200, { got: d.got, complete: d.complete });
      });
    });
    return;
  }
  // Delete (the sender, with the token it got when creating the link)
  if (!sub && req.method === 'DELETE') {
    req.resume();
    if (!owner(d) && !(d.req && req.headers['x-request-token'] && reqOwnerOf(d))) return json(403, { error: 'forbidden' });
    deleteDrop(d.id);
    return json(200, { ok: true });
  }
  // For the sender (with its token): how many times the link was downloaded, and whether it's locked
  if (!sub && req.method === 'GET' && req.headers['x-drop-token']) {
    if (!owner(d)) return json(403, { error: 'forbidden' });
    return json(200, { complete: d.complete, downloads: d.downloads, max: d.max || 0, left: left(d), expires: d.expires,
      pin: !!d.pinHash, locked: !!d.pinHash && d.pinFails >= DROP_PIN_TRIES });
  }
  // Information for the download page: encrypted file names, size, expiry (after the PIN, if it has one)
  if (!sub && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!d.complete || d.req) return json(404, { error: 'uploading' });
    if (!pinOk(d)) return;
    return json(200, { size: d.size, part: DROP_PART, meta: d.meta, expires: d.expires, once: d.once, max: d.max || 0, left: left(d), pin: !!d.pinHash });
  }
  // The encrypted data itself
  if (sub === 'data' && req.method === 'GET') {
    if (!d.complete) return json(404, { error: 'gone' });
    if (d.req && !reqOwnerOf(d)) return json(403, { error: 'forbidden' });
    if (!pinOk(d)) return;
    // No downloads left (counting the ones still going: a limited link can't be downloaded more at the same time)
    if (d.max && d.downloads + (d.active || 0) >= d.max) return json(410, { error: 'gone' });
    d.active = (d.active || 0) + 1;
    const file = dropFile(d.id, 'bin');
    let total;
    try { total = fs.statSync(file).size; } catch { d.active--; return json(404, { error: 'gone' }); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': total, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    const stream = fs.createReadStream(file);
    stream.pipe(res);
    res.on('close', () => {
      stream.destroy();
      d.active = Math.max(0, (d.active || 0) - 1);
      if (res.writableFinished) {
        d.downloads++;
        if (!d.req) {
          count('linkDownloads');
          count('linkBytes', d.size);
        }
        if (d.max && d.downloads >= d.max) return deleteDrop(d.id);
        saveDrop(d);
      } // interrupted: doesn't count, it can be tried again
    });
    return;
  }
  req.resume();
  json(405, { error: 'method' });
}

// ---------- Request files by link ----------
// The other way round from share by link: a device makes a link (omnibeam.site/r/<id>#<key>) and sends it to
// someone. That person opens it on any device, with no pairing and no app, picks files, and they arrive on the
// device that made the link. The key after # never reaches the server. The upload page encrypts each upload with a
// new random key (so two uploads never share a key and IVs), and puts that key, the file names and the sender's
// name in a small "meta" box encrypted with the link's key, which only the requesting device has the rest of.
// Uploads are stored like shared links (data/drops/, same limits and disk budget) with d.req = the request id, and
// only the requesting device can download them (X-Request-Token); each is deleted as soon as it has it.
// data/requests/<id>.json: { id, tokenHash, meta, created, expires, max, uploads, pinHash, pinFails }
const REQUESTS = DROPS && process.env.REQUESTS !== 'false';
const REQ_DIR = path.join(DATA_DIR, 'requests');
const REQ_PER_HOUR = 20;       // new request links per network
const REQ_UPLOADS_PER_HOUR = 30; // uploads per network
// A request link can work for up to a year (for the "Send me files" box on a website, see /embed); the files sent to
// it are still deleted after DROP_MAX_HOURS. Each link takes at most REQ_UPLOADS_PER_LINK_DAY uploads a day, so a box
// on a busy public page can't fill the server's disk budget.
const REQ_MAX_HOURS = Math.max(1, Number(process.env.REQUEST_MAX_HOURS) || 8760);
const REQ_UPLOADS_PER_LINK_DAY = Number(process.env.REQUEST_UPLOADS_PER_LINK_DAY) || 100;
const requests = new Map();
const reqAttempts = new Map(); // network -> recent times (new links)
const reqUploadAttempts = new Map(); // network -> recent times (uploads)
const reqWatchers = new Map(); // request id -> client ids of open tabs of the device that made it
const reqFile = (id) => path.join(REQ_DIR, `${id}.json`);
const tokenHashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
function saveRequest(r) {
  fs.writeFile(reqFile(r.id), JSON.stringify(r), (err) => { if (err) console.error('Could not save request link', err.message); });
}
const requestFiles = (id) => [...drops.values()].filter((d) => d.req === id);
function deleteRequest(id) {
  if (!requests.has(id)) return;
  requests.delete(id);
  reqWatchers.delete(id);
  for (const d of requestFiles(id)) deleteDrop(d.id);
  fs.unlink(reqFile(id), () => {});
}
function loadRequests() {
  if (!REQUESTS) return;
  try {
    fs.mkdirSync(REQ_DIR, { recursive: true });
    for (const f of fs.readdirSync(REQ_DIR)) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(f)) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(REQ_DIR, f), 'utf8'));
        requests.set(r.id, r);
      } catch { fs.unlink(path.join(REQ_DIR, f), () => {}); }
    }
    // Files whose request is gone (deleted while the server was off)
    for (const d of [...drops.values()]) if (d.req && !requests.has(d.req)) deleteDrop(d.id);
  } catch (err) {
    console.error('Request files: cannot use', REQ_DIR, err.message);
  }
}
function cleanRequests() {
  const now = Date.now();
  // A request link that ended is kept while files sent to it are still waiting to be picked up
  for (const r of [...requests.values()]) if (now > r.expires && !requestFiles(r.id).length) deleteRequest(r.id);
  for (const map of [reqAttempts, reqUploadAttempts]) for (const [key, list] of map) if (!list.some((t) => now - t < 3600 * 1000)) map.delete(key);
}
const reqOwner = (req, r) => {
  const token = String(req.headers['x-request-token'] || req.headers['x-drop-token'] || '');
  return !!r && token.length === 32 && samePassword(r.tokenHash, tokenHashOf(token));
};
const reqLeft = (r) => (r.max ? Math.max(0, r.max - r.uploads) : null);
const reqView = (d) => ({ id: d.id, size: d.size, meta: d.meta, at: d.touched, part: DROP_PART });
// A tab of the requesting device says which of its request links it's watching (with their tokens)
function watchRequests(client, items) {
  unwatchRequests(client);
  client.reqs = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 50)) {
    const r = it && typeof it.id === 'string' ? requests.get(it.id) : null;
    if (!r || typeof it.token !== 'string' || !samePassword(r.tokenHash, tokenHashOf(it.token))) continue;
    if (!reqWatchers.has(r.id)) reqWatchers.set(r.id, new Set());
    reqWatchers.get(r.id).add(client.id);
    client.reqs.push(r.id);
    if (requestFiles(r.id).some((d) => d.complete)) send(client.ws, { type: 'request-files', id: r.id });
  }
}
function unwatchRequests(client) {
  for (const id of client.reqs || []) {
    const set = reqWatchers.get(id);
    set?.delete(client.id);
    if (set && !set.size) reqWatchers.delete(id);
  }
  client.reqs = [];
}
// An upload to a request link finished: tell the requesting device (its newest open tab), or wake it
function requestFileReady(d) {
  const r = requests.get(d.req);
  if (!r) return;
  count('requestFiles');
  count('requestBytes', d.size);
  const ids = [...(reqWatchers.get(r.id) || [])].filter((id) => clients.has(id));
  if (ids.length) return send(clients.get(ids[ids.length - 1]).ws, { type: 'request-files', id: r.id });
  pushRoom('req:' + r.id, null, (lang) => ({
    title: trFor(lang, 'Files arrived on your request link'),
    body: trFor(lang, 'Tap to open OmniBeam and save them.'),
    url: '/?wake=1',
    tag: 'req-' + r.id.slice(0, 8),
  }));
}

function handleRequest(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (!REQUESTS) { req.resume(); return json(404, { error: 'off' }); }
  const m = urlPath.match(/^\/api\/request(?:\/([A-Za-z0-9_-]{8,40}))?(?:\/(upload))?$/);
  if (!m) { req.resume(); return json(404, { error: 'not found' }); }
  const [, id, sub] = m;
  const r = id ? requests.get(id) : null;
  const net = 'ip:' + getIp(req);

  // New request link: { hours, max (uploads allowed, 0 = no limit), pin (proof, see drop.js), meta } -> { id, token, expires }
  if (!id && req.method === 'POST') {
    return readJsonBody(req).then((body) => {
      const hours = Math.min(REQ_MAX_HOURS, Math.max(1, Number(body.hours) || 24));
      const max = Math.min(100, Math.max(0, Math.floor(Number(body.max) || 0)));
      const pin = body.pin == null || body.pin === '' ? '' : String(body.pin);
      const meta = String(body.meta || '');
      if (!/^[A-Za-z0-9_-]{20,4000}$/.test(meta) || (pin && !/^[A-Za-z0-9_-]{43}$/.test(pin))) return json(400, { error: 'bad request' });
      if (!allowAttempt(reqAttempts, net, REQ_PER_HOUR, 3600 * 1000)) return json(429, { error: 'too-many' });
      const token = crypto.randomBytes(16).toString('hex');
      const now = Date.now();
      const r2 = {
        id: crypto.randomBytes(12).toString('base64url'), tokenHash: tokenHashOf(token), meta, created: now,
        expires: now + hours * 3600 * 1000, max, uploads: 0, pinHash: pin ? tokenHashOf(pin) : '', pinFails: 0,
      };
      requests.set(r2.id, r2);
      saveRequest(r2);
      count('requests');
      json(200, { id: r2.id, token, expires: r2.expires });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  if (!r) { req.resume(); return json(404, { error: 'gone' }); }
  const pinOk = () => {
    if (!r.pinHash) return true;
    if (r.pinFails >= DROP_PIN_TRIES) { json(423, { error: 'locked', pin: true }); return false; }
    const proof = String(req.headers['x-drop-pin'] || '');
    if (!proof) { json(401, { error: 'pin', pin: true, left: DROP_PIN_TRIES - (r.pinFails || 0) }); return false; }
    if (/^[A-Za-z0-9_-]{43}$/.test(proof) && samePassword(r.pinHash, tokenHashOf(proof))) return true;
    r.pinFails = (r.pinFails || 0) + 1;
    saveRequest(r);
    count('linkPinWrong');
    if (r.pinFails >= DROP_PIN_TRIES) { json(423, { error: 'locked', pin: true }); return false; }
    json(403, { error: 'wrong-pin', pin: true, left: DROP_PIN_TRIES - r.pinFails });
    return false;
  };

  // For the requesting device: the files waiting for it, and how the link is doing
  if (!sub && req.method === 'GET' && (req.headers['x-request-token'] || req.headers['x-drop-token'])) {
    if (!reqOwner(req, r)) return json(403, { error: 'forbidden' });
    return json(200, { expires: r.expires, uploads: r.uploads, max: r.max, left: reqLeft(r), pin: !!r.pinHash,
      locked: !!r.pinHash && r.pinFails >= DROP_PIN_TRIES, files: requestFiles(r.id).filter((d) => d.complete).map(reqView) });
  }
  // Delete the link and anything still waiting on it (the requesting device)
  if (!sub && req.method === 'DELETE') {
    req.resume();
    if (!reqOwner(req, r)) return json(403, { error: 'forbidden' });
    deleteRequest(r.id);
    return json(200, { ok: true });
  }
  const ended = Date.now() > r.expires;
  // For the upload page: who asks and for what (encrypted), how much fits, whether it still takes files
  if (!sub && (req.method === 'GET' || req.method === 'HEAD')) {
    if (ended) return json(410, { error: 'ended' });
    if (!pinOk()) return;
    return json(200, { meta: r.meta, expires: r.expires, maxMb: DROP_MAX_MB, part: DROP_PART, max: r.max, left: reqLeft(r), pin: !!r.pinHash });
  }
  // Start an upload: { size, meta } -> { id, token, part } for PUT /api/drop/<id>/<n> (the same as a shared link)
  if (sub === 'upload' && req.method === 'POST') {
    if (ended) { req.resume(); return json(410, { error: 'ended' }); }
    if (!pinOk()) { req.resume(); return; }
    return readJsonBody(req).then((body) => {
      const size = Math.floor(Number(body.size));
      const meta = String(body.meta || '');
      // meta: the sealed box (base64url), or "x1.<sender's public key>.<box>" for a box sealed to the requesting
      // device's public key (links used on a website, and the Telegram bot)
      if (!(size > 0) || !/^(x1\.[A-Za-z0-9_-]{80,100}\.)?[A-Za-z0-9_-]{40,12000}$/.test(meta)) return json(400, { error: 'bad request' });
      if (size > DROP_MAX_MB * 1024 * 1024) return json(413, { error: 'too-large', maxMb: DROP_MAX_MB });
      if (r.max && r.uploads >= r.max) return json(410, { error: 'full-link' });
      const now = Date.now();
      r.day = r.day && now - r.day.at < 86400000 ? r.day : { at: now, n: 0 };
      if (r.day.n >= REQ_UPLOADS_PER_LINK_DAY) return json(429, { error: 'too-many' });
      const recent = (dropUploads.get(net) || []).filter((u) => now - u.at < 24 * 3600 * 1000);
      if (recent.reduce((s, u) => s + u.size, 0) + size > DROP_MB_PER_DAY * 1024 * 1024) return json(429, { error: 'too-many' });
      if (!allowAttempt(reqUploadAttempts, net, REQ_UPLOADS_PER_HOUR, 3600 * 1000)) return json(429, { error: 'too-many' });
      const reserved = encryptedSize(size);
      if (dropBytes + reserved > DROP_TOTAL_MB * 1024 * 1024) return json(507, { error: 'full' });
      recent.push({ at: now, size });
      dropUploads.set(net, recent);
      const token = crypto.randomBytes(16).toString('hex');
      // Waits up to DROP_MAX_HOURS for the requesting device, even if the request link ends sooner
      const d = {
        id: crypto.randomBytes(12).toString('base64url'), size, reserved, parts: Math.max(1, Math.ceil(size / DROP_PART)), got: 0,
        meta, once: true, max: 1, created: now, expires: now + DROP_MAX_HOURS * 3600 * 1000, touched: now, complete: false, downloads: 0,
        tokenHash: tokenHashOf(token), pinHash: '', pinFails: 0, req: r.id,
      };
      drops.set(d.id, d);
      dropBytes += reserved;
      fs.writeFileSync(dropFile(d.id, 'bin'), '');
      saveDrop(d);
      r.uploads++;
      r.day.n++;
      saveRequest(r);
      if (body.embed === true) count('requestEmbedUploads');
      json(200, { id: d.id, token, part: DROP_PART });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  req.resume();
  json(405, { error: 'method' });
}

// ---------- Event photo albums ----------
// A device makes an album for a wedding, a party or a class (the ⋯ menu, Event photo album: album.js) and shows its
// QR code. Guests scan it (omnibeam.site/e/<id>#<key>: event.html + event.js), add their photos and videos, and see
// everyone else's; the host saves them all at the end. Like shared links, everything is encrypted in the browser
// with the key after #, which never reaches this server: it only keeps encrypted bytes and a little bookkeeping.
// Each photo is one upload: [encrypted small picture][encrypted photo], with its name and size in an encrypted box
// (X-Album-Meta). data/albums/<id>.json: { id, tokenHash, meta, created, expires, open, used, next, items: [...] },
// data/albums/<id>/<n>.bin. The host (X-Album-Token) can stop uploads, delete any photo or the album; a guest can
// delete their own photos (the X-Album-Del token their upload got back). Albums are deleted when they end.
//   ALBUMS=false        turns albums off
//   ALBUM_MAX_MB=1024   all the photos of one album together
//   ALBUM_TOTAL_MB=4096 all albums together
//   ALBUM_ITEM_MB=60    largest single photo or video
const ALBUMS = DROPS && process.env.ALBUMS !== 'false';
const ALBUM_DIR = path.join(DATA_DIR, 'albums');
const ALBUM_MAX_MB = Number(process.env.ALBUM_MAX_MB) || 1024;
const ALBUM_TOTAL_MB = Number(process.env.ALBUM_TOTAL_MB) || 4096;
const ALBUM_ITEM_MB = Number(process.env.ALBUM_ITEM_MB) || 60;
const ALBUM_MAX_DAYS = 30;
const ALBUM_MAX_ITEMS = 3000;
const ALBUM_NEW_PER_HOUR = 5;       // new albums per network
// Everyone at a party is often on the same Wi-Fi, so uploads are counted per album more than per network
const ALBUM_UPLOADS_PER_HOUR = 600; // per network
const ALBUM_UPLOADS_PER_DAY = 2000; // per album
const albums = new Map();
let albumBytes = 0;
const albumAttempts = new Map();
const albumUploadAttempts = new Map();
const albumJson = (id) => path.join(ALBUM_DIR, `${id}.json`);
const albumItem = (id, n) => path.join(ALBUM_DIR, id, `${n}.bin`);
function saveAlbum(a) {
  fs.writeFile(albumJson(a.id), JSON.stringify(a), (err) => { if (err) console.error('Could not save album', err.message); });
}
function deleteAlbum(id) {
  const a = albums.get(id);
  if (!a) return;
  albums.delete(id);
  albumBytes -= a.used;
  fs.rm(path.join(ALBUM_DIR, id), { recursive: true, force: true }, () => {});
  fs.unlink(albumJson(id), () => {});
}
function loadAlbums() {
  if (!ALBUMS) return;
  try {
    fs.mkdirSync(ALBUM_DIR, { recursive: true });
    for (const f of fs.readdirSync(ALBUM_DIR)) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(f)) continue;
      try {
        const a = JSON.parse(fs.readFileSync(path.join(ALBUM_DIR, f), 'utf8'));
        albums.set(a.id, a);
        albumBytes += a.used;
      } catch { fs.unlink(path.join(ALBUM_DIR, f), () => {}); }
    }
    // Photo folders without bookkeeping (deleted while the server was off)
    for (const e of fs.readdirSync(ALBUM_DIR, { withFileTypes: true })) {
      if (e.isDirectory() && !albums.has(e.name)) fs.rm(path.join(ALBUM_DIR, e.name), { recursive: true, force: true }, () => {});
    }
  } catch (err) {
    console.error('Event albums: cannot use', ALBUM_DIR, err.message);
  }
}
function cleanAlbums() {
  const now = Date.now();
  for (const a of [...albums.values()]) if (now > a.expires) deleteAlbum(a.id);
  for (const map of [albumAttempts, albumUploadAttempts]) for (const [key, list] of map) if (!list.some((t) => now - t < 3600 * 1000)) map.delete(key);
}
const albumView = (it) => ({ n: it.n, at: it.at, meta: it.meta, thumb: it.thumb, size: it.size });

function handleAlbum(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (!ALBUMS) { req.resume(); return json(404, { error: 'off' }); }
  const m = urlPath.match(/^\/api\/album(?:\/([A-Za-z0-9_-]{8,40}))?(?:\/(add|settings|(\d{1,5})(?:\/(thumb|full))?))?$/);
  if (!m) { req.resume(); return json(404, { error: 'not found' }); }
  const [, id, sub, num, part] = m;
  const a = id ? albums.get(id) : null;
  const net = 'ip:' + getIp(req);
  const host = () => {
    const token = String(req.headers['x-album-token'] || '');
    return !!a && token.length === 32 && samePassword(a.tokenHash, tokenHashOf(token));
  };

  // New album: { days, meta (the album's name and quality, encrypted) } -> { id, token, expires }
  if (!id && req.method === 'POST') {
    return readJsonBody(req).then((body) => {
      const days = Math.min(ALBUM_MAX_DAYS, Math.max(1, Math.floor(Number(body.days) || 7)));
      const meta = String(body.meta || '');
      if (!/^[A-Za-z0-9_-]{20,2000}$/.test(meta)) return json(400, { error: 'bad request' });
      if (!allowAttempt(albumAttempts, net, ALBUM_NEW_PER_HOUR, 3600 * 1000)) return json(429, { error: 'too-many' });
      const token = crypto.randomBytes(16).toString('hex');
      const now = Date.now();
      const a2 = { id: crypto.randomBytes(12).toString('base64url'), tokenHash: tokenHashOf(token), meta, created: now,
        expires: now + days * 86400000, open: true, used: 0, next: 1, items: [] };
      albums.set(a2.id, a2);
      fs.mkdirSync(path.join(ALBUM_DIR, a2.id), { recursive: true });
      saveAlbum(a2);
      count('albums');
      json(200, { id: a2.id, token, expires: a2.expires });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  if (!a || Date.now() > a.expires) { req.resume(); return json(404, { error: 'gone' }); }

  // The album page: name (encrypted), photos (encrypted names), whether it still takes photos, room left
  if (!sub && req.method === 'GET') {
    return json(200, { meta: a.meta, expires: a.expires, open: a.open, host: host(), itemMb: ALBUM_ITEM_MB,
      left: Math.max(0, ALBUM_MAX_MB * 1048576 - a.used), items: a.items.map(albumView) });
  }
  // The host: delete the album now
  if (!sub && req.method === 'DELETE') {
    req.resume();
    if (!host()) return json(403, { error: 'forbidden' });
    deleteAlbum(a.id);
    return json(200, { ok: true });
  }
  // The host: stop or start taking photos { open }
  if (sub === 'settings' && req.method === 'POST') {
    if (!host()) { req.resume(); return json(403, { error: 'forbidden' }); }
    return readJsonBody(req, 1024).then((body) => {
      a.open = body.open !== false;
      saveAlbum(a);
      json(200, { open: a.open });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  // A guest adds a photo: the body is [small picture][photo], both encrypted; X-Thumb-Size says where the
  // photo starts, X-Album-Size is the whole body, X-Album-Meta is the encrypted box with its name, type and who added it. -> { n, del }
  if (sub === 'add' && req.method === 'POST') {
    // (its own header, not Content-Length: a proxy on the way may send the body in chunks without one)
    const size = Number(req.headers['x-album-size']);
    const thumb = Number(req.headers['x-thumb-size']);
    const meta = String(req.headers['x-album-meta'] || '');
    if (!a.open) { req.resume(); return json(403, { error: 'closed' }); }
    if (!(size > 16) || !(thumb >= 0) || thumb >= size || !Number.isInteger(thumb) || !/^[A-Za-z0-9_-]{20,1500}$/.test(meta)) { req.resume(); return json(400, { error: 'bad request' }); }
    if (size > ALBUM_ITEM_MB * 1048576 + 4096) { req.resume(); return json(413, { error: 'too-large', maxMb: ALBUM_ITEM_MB }); }
    if (a.items.length >= ALBUM_MAX_ITEMS || a.used + size > ALBUM_MAX_MB * 1048576) { req.resume(); return json(507, { error: 'album-full' }); }
    if (albumBytes + size > ALBUM_TOTAL_MB * 1048576) { req.resume(); return json(507, { error: 'full' }); }
    const now = Date.now();
    a.day = a.day && now - a.day.at < 86400000 ? a.day : { at: now, n: 0 };
    if (a.day.n >= ALBUM_UPLOADS_PER_DAY || !allowAttempt(albumUploadAttempts, net, ALBUM_UPLOADS_PER_HOUR, 3600 * 1000)) { req.resume(); return json(429, { error: 'too-many' }); }
    // Reserved now, so uploads at the same moment can't go over the limits together
    a.used += size;
    albumBytes += size;
    const n = a.next++;
    const file = albumItem(a.id, n);
    const out = fs.createWriteStream(file);
    let len = 0;
    let failed = false;
    const fail = (code, error) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.unlink(file, () => {});
      if (albums.get(a.id) === a) a.used -= size;
      albumBytes -= size;
      if (!res.headersSent) json(code, { error });
    };
    req.on('data', (c) => { len += c.length; if (len > size) { fail(400, 'size'); req.destroy(); } });
    req.on('aborted', () => fail(400, 'aborted'));
    req.on('error', () => fail(400, 'aborted'));
    out.on('error', () => fail(500, 'disk'));
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      if (len !== size) return fail(400, 'size');
      if (albums.get(a.id) !== a) { fs.unlink(file, () => {}); return json(404, { error: 'gone' }); }
      const del = crypto.randomBytes(16).toString('hex');
      a.items.push({ n, at: Date.now(), meta, thumb, size, delHash: tokenHashOf(del) });
      a.day.n++;
      saveAlbum(a);
      count('albumPhotos');
      count('albumBytes', size);
      json(200, { n, del });
    });
    return;
  }
  const it = num ? a.items.find((x) => x.n === Number(num)) : null;
  if (num && !it) { req.resume(); return json(404, { error: 'gone' }); }
  // The small picture or the photo itself (encrypted)
  if (it && part && req.method === 'GET') {
    const start = part === 'thumb' ? 0 : it.thumb;
    const end = part === 'thumb' ? it.thumb : it.size;
    if (end <= start) return json(404, { error: 'none' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start,
      'Cache-Control': 'private, max-age=604800, immutable', 'X-Robots-Tag': 'noindex' });
    if (part === 'full') count('albumViews');
    return fs.createReadStream(albumItem(a.id, it.n), { start, end: end - 1 }).on('error', () => res.destroy()).pipe(res);
  }
  // Delete one photo: the host, or the guest who added it
  if (it && !part && req.method === 'DELETE') {
    req.resume();
    const del = String(req.headers['x-album-del'] || '');
    const mine = del.length === 32 && samePassword(it.delHash, tokenHashOf(del));
    if (!mine && !host()) return json(403, { error: 'forbidden' });
    a.items = a.items.filter((x) => x !== it);
    a.used -= it.size;
    albumBytes -= it.size;
    fs.unlink(albumItem(a.id, it.n), () => {});
    saveAlbum(a);
    return json(200, { ok: true });
  }
  req.resume();
  json(405, { error: 'method' });
}

// ---------- Notifications while OmniBeam is closed (web push) ----------
// A device that turns notifications on gives the server its push address (made by its browser) and what it can
// be woken for: its pairings and its Shortcut inbox. When a paired device wants to send it something while it's
// closed, or a file arrives in its inbox, the server sends it a notification through its browser maker's push
// service (Apple, Google, Mozilla or Microsoft). The text is encrypted for that one browser (RFC 8291), so the push
// service can't read it, and signed with this server's key (VAPID, RFC 8292).
const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const PUSH_KEYS_FILE = path.join(DATA_DIR, 'push-keys.json');
const MAX_PUSH_SUBS = 5000;
const PUSH_ROOMS = 60; // pairings + inbox one device can be woken for
const PUSH_PER_WINDOW = 20; // wake-ups per network every CODE_WINDOW (10 minutes)
// Only the browsers' own push services: a push address is a web address the server posts to, so anything else
// could make this server send requests to places it shouldn't
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
let pushKeys = null; // { publicKey: base64url 65-byte point, privateKey: KeyObject }
let pushSubs = {};   // id -> { endpoint, keys: { p256dh, auth }, rooms: [room names], lang, seen }
let pushDirty = false;
const pushAttempts = new Map();

function loadPushKeys() {
  if (!PUSH) return;
  try {
    let pub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    let priv = (process.env.VAPID_PRIVATE_KEY || '').trim();
    if (!pub || !priv) {
      try { ({ publicKey: pub, privateKey: priv } = JSON.parse(fs.readFileSync(PUSH_KEYS_FILE, 'utf8'))); } catch {}
    }
    if (!pub || !priv) {
      const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
      pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
      priv = jwk.d;
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(PUSH_KEYS_FILE, JSON.stringify({ publicKey: pub, privateKey: priv }, null, 2));
      console.log('Made the key pair for notifications: data/push-keys.json');
    }
    const point = Buffer.from(pub, 'base64url');
    const d = Buffer.from(priv, 'base64url');
    if (point.length !== 65 || point[0] !== 4 || d.length > 32) throw new Error('VAPID keys have the wrong length');
    const privateKey = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
      x: b64u(point.subarray(1, 33)), y: b64u(point.subarray(33)), d: b64u(Buffer.concat([Buffer.alloc(32 - d.length), d])) } });
    pushKeys = { publicKey: pub, privateKey };
  } catch (err) {
    console.error('Notifications are off, the VAPID keys did not work:', err.message);
  }
  try { pushSubs = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')).subs || {}; } catch {}
}
function savePush() {
  if (!pushDirty) return;
  pushDirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PUSH_FILE, JSON.stringify({ subs: pushSubs }));
  } catch (err) {
    console.error('Could not save push.json', err.message);
  }
}
function validPushSub(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000 || !sub.keys) return false;
  let url;
  try { url = new URL(sub.endpoint); } catch { return false; }
  const testing = process.env.NODE_ENV === 'test' && url.protocol === 'http:' && url.hostname === 'localhost';
  if (!testing && (url.protocol !== 'https:' || !PUSH_HOSTS.test(url.hostname))) return false;
  try {
    return Buffer.from(String(sub.keys.p256dh), 'base64url').length === 65 && Buffer.from(String(sub.keys.auth), 'base64url').length === 16;
  } catch {
    return false;
  }
}
// The message, encrypted for one browser (RFC 8291, "aes128gcm" content coding, one record)
function encryptPush(sub, payload) {
  const uaPublic = Buffer.from(sub.keys.p256dh, 'base64url');
  const auth = Buffer.from(sub.keys.auth, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const salt = crypto.randomBytes(16);
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
  const ikm = hmac(hmac(auth, ecdh.computeSecret(uaPublic)), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}
// Proof for the push service that this server sent it (a JWT signed with the VAPID key)
function vapidHeader(endpoint) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUBJECT || SITE_URL }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key: pushKeys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pushKeys.publicKey}`;
}
function sendPush(id, message) {
  const sub = pushSubs[id];
  if (!sub || !pushKeys) return Promise.resolve(false);
  return new Promise((resolve) => {
    let body;
    try { body = encryptPush(sub, JSON.stringify(message)); } catch { return resolve(false); }
    const url = new URL(sub.endpoint);
    const req = (url.protocol === 'http:' ? http : require('https')).request(url, {
      method: 'POST',
      timeout: 10000,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length,
        TTL: '86400', Urgency: 'high', Authorization: vapidHeader(sub.endpoint) },
    }, (res) => {
      res.resume();
      // Gone: the device turned notifications off, or the browser dropped the subscription
      if (res.statusCode === 404 || res.statusCode === 410) { delete pushSubs[id]; pushDirty = true; }
      else if (res.statusCode >= 400) console.warn('Push service answered', res.statusCode, url.host);
      count('pushes');
      resolve(res.statusCode < 300);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end(body);
  });
}
// Notification text in the device's language (the strings are in public/lang/*.js, keyed by the English text)
function trFor(lang, text, vars = {}) {
  let out = (LANGS[lang] && LANGS[lang].strings[text]) || text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}
// Wake every device that can be woken for this room, except the one asking (exceptId)
function pushRoom(room, exceptId, make) {
  const ids = Object.keys(pushSubs).filter((id) => id !== exceptId && pushSubs[id].rooms.includes(room));
  for (const id of ids) sendPush(id, make(pushSubs[id].lang));
  return ids.length;
}
function onPushMessage(client, msg) {
  if (!pushKeys) return;
  if (msg.type === 'push-sub') {
    if (!validPushSub(msg.sub)) return;
    const id = sha256(msg.sub.endpoint).slice(0, 32);
    const secrets = (Array.isArray(msg.secrets) ? msg.secrets : []).filter((s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s));
    const rooms = secrets.map(secretRoom);
    if (typeof msg.inbox === 'string' && /^[0-9a-f]{32}$/.test(msg.inbox)) rooms.push(inboxRoom(msg.inbox));
    // Request links this device made (with their tokens): woken when files arrive on one
    for (const it of (Array.isArray(msg.requests) ? msg.requests : []).slice(0, 20)) {
      const r = it && typeof it.id === 'string' ? requests.get(it.id) : null;
      if (r && typeof it.token === 'string' && samePassword(r.tokenHash, tokenHashOf(it.token))) rooms.push('req:' + r.id);
    }
    if (!pushSubs[id] && Object.keys(pushSubs).length >= MAX_PUSH_SUBS) {
      // Full: make room by forgetting the device that hasn't been seen for the longest time
      const oldest = Object.keys(pushSubs).sort((a, b) => pushSubs[a].seen - pushSubs[b].seen)[0];
      delete pushSubs[oldest];
    }
    pushSubs[id] = { endpoint: msg.sub.endpoint, keys: { p256dh: msg.sub.keys.p256dh, auth: msg.sub.keys.auth },
      rooms: rooms.slice(0, PUSH_ROOMS), lang: LANGS[msg.lang] ? msg.lang : 'en', seen: Date.now() };
    client.pushId = id;
    pushDirty = true;
    send(client.ws, { type: 'push-ok' });
  } else if (msg.type === 'push-unsub') {
    if (client.pushId) { delete pushSubs[client.pushId]; pushDirty = true; }
    client.pushId = null;
  } else if (msg.type === 'push-wake') {
    // A paired device is offline: wake it with "<name> wants to send you 3 files"
    if (typeof msg.secret !== 'string' || !/^[0-9a-f]{64}$/.test(msg.secret)) return;
    const room = secretRoom(msg.secret);
    const result = (extra) => send(client.ws, { type: 'push-result', secret: msg.secret, ...extra });
    if (!client.rooms.has(room)) return; // only for pairings this device really has
    const ring = msg.ring === true ? { ring: true } : {};
    if ([...(rooms.get(room) || [])].some((id) => id !== client.id)) return result({ sent: 0, online: true, ...ring });
    if (!allowAttempt(pushAttempts, client.networkRoom, PUSH_PER_WINDOW)) return result({ sent: 0, limited: true, ...ring });
    // Ring my device: "<name> is looking for this device" (it rings when OmniBeam opens in the next 2 minutes)
    if (msg.ring === true) {
      const sent = pushRoom(room, client.pushId, (lang) => ({
        title: trFor(lang, '{name} is looking for this device', { name: client.name }),
        body: trFor(lang, 'Tap to open OmniBeam: it rings so you can find it.'),
        url: '/?wake=1',
        tag: 'ring-' + room.slice(7, 19),
      }));
      return result({ sent, ring: true });
    }
    const files = Math.max(0, Math.min(99999, Math.floor(Number(msg.files)) || 0));
    const sent = pushRoom(room, client.pushId, (lang) => ({
      title: files ? trFor(lang, '{name} wants to send you {n} file(s)', { name: client.name, n: files })
        : trFor(lang, '{name} wants to send you a message', { name: client.name }),
      body: trFor(lang, 'Tap to open OmniBeam and receive it.'),
      url: '/?wake=1',
      tag: 'wake-' + room.slice(7, 19),
    }));
    result({ sent });
  }
}

// Limits like allowCodeAttempt, for any map of key -> recent times
function allowAttempt(map, key, limit, windowMs = CODE_WINDOW) {
  const now = Date.now();
  const recent = (map.get(key) || []).filter((t) => now - t < windowMs);
  const ok = recent.length < limit;
  if (ok) recent.push(now);
  map.set(key, recent);
  return ok;
}

// ---------- iPhone Shortcut inbox ----------
// A device turns on "Receive from the iPhone Shortcut" and gets a private key (32 hex characters). The Shortcut
// posts what was shared to /api/inbox/<key> (a form with the files, or the file itself as the body). The files wait
// here until OmniBeam on that device downloads them, which happens at once if it's open (it's told over its
// connection) or the next time it opens (with a notification, if those are on). Downloaded files are deleted.
// Unlike transfers between devices, these files pass through this server unencrypted, so they're deleted as soon
// as they're picked up, and after INBOX_HOURS otherwise.
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const INBOX_BOXES_FILE = path.join(DATA_DIR, 'inbox-boxes.json');
const INBOX_PER_HOUR = 60;     // uploads per inbox
const INBOX_TEXT_MAX = 64 * 1024; // shared text up to this size arrives as a message, not as a file
const inboxRoom = (key) => 'inbox:' + sha256('inbox:' + key);
const inboxItems = new Map(); // id -> { id, box, name, mime, size, at, text? } (also in <id>.json)
const inboxClients = new Map(); // box -> client ids of open OmniBeam tabs with that inbox
const inboxUploads = new Map(); // box -> recent upload times
let inboxBoxes = {}; // box -> last seen: only inboxes a device has opened can receive (no filling random keys)
let inboxBytes = 0;
const inboxFile = (id, ext) => path.join(INBOX_DIR, `${id}.${ext}`);
function loadInbox() {
  try { inboxBoxes = JSON.parse(fs.readFileSync(INBOX_BOXES_FILE, 'utf8')); } catch {}
  let names = [];
  try { names = fs.readdirSync(INBOX_DIR); } catch {}
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    try {
      const item = JSON.parse(fs.readFileSync(path.join(INBOX_DIR, n), 'utf8'));
      inboxItems.set(item.id, item);
      inboxBytes += item.size || 0;
    } catch {}
  }
  cleanInbox();
}
function deleteInboxItem(id) {
  const item = inboxItems.get(id);
  if (!item) return;
  inboxItems.delete(id);
  inboxBytes -= item.text == null ? item.size : 0;
  fs.rm(inboxFile(id, 'json'), { force: true }, () => {});
  fs.rm(inboxFile(id, 'bin'), { force: true }, () => {});
}
function cleanInbox() {
  const cutoff = Date.now() - INBOX_HOURS * 3600 * 1000;
  for (const item of [...inboxItems.values()]) if (item.at < cutoff) deleteInboxItem(item.id);
  // Leftovers of interrupted uploads
  let names = [];
  try { names = fs.readdirSync(INBOX_DIR); } catch {}
  for (const n of names) {
    const id = n.split('.')[0];
    if (!inboxItems.has(id) && !n.endsWith('.json')) {
      try { if (Date.now() - fs.statSync(path.join(INBOX_DIR, n)).mtimeMs > 3600 * 1000) fs.rmSync(path.join(INBOX_DIR, n), { force: true }); } catch {}
    }
  }
  const forget = Date.now() - 180 * 864e5;
  for (const [box, seen] of Object.entries(inboxBoxes)) if (seen < forget) delete inboxBoxes[box];
}
function saveInboxBoxes() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INBOX_BOXES_FILE, JSON.stringify(inboxBoxes));
  } catch {}
}
const inboxView = ({ id, name, mime, size, at, text }) => (text != null ? { id, at, text } : { id, name, mime, size, at });
// Tell the open OmniBeam tab of this inbox (the newest one, so a file isn't saved twice) what's waiting
function deliverInbox(box) {
  const ids = [...(inboxClients.get(box) || [])].filter((id) => clients.has(id));
  if (!ids.length) return false;
  const items = [...inboxItems.values()].filter((x) => x.box === box).sort((a, b) => a.at - b.at).map(inboxView);
  if (items.length) send(clients.get(ids[ids.length - 1]).ws, { type: 'inbox', items });
  return true;
}
function joinInbox(client, key) {
  if (!INBOX || typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(key)) return;
  const box = inboxRoom(key).slice(6);
  if (client.inbox && client.inbox !== box) inboxClients.get(client.inbox)?.delete(client.id);
  client.inbox = box;
  if (!inboxClients.has(box)) inboxClients.set(box, new Set());
  inboxClients.get(box).add(client.id);
  if (!inboxBoxes[box] || Date.now() - inboxBoxes[box] > 864e5) { inboxBoxes[box] = Date.now(); saveInboxBoxes(); }
  deliverInbox(box);
}
function leaveInbox(client) {
  if (!client.inbox) return;
  const set = inboxClients.get(client.inbox);
  set?.delete(client.id);
  if (set && !set.size) inboxClients.delete(client.inbox);
}
// Reads multipart/form-data as it arrives: onPart(headers) returns a sink { write(buf) -> false to wait, end() },
// done(err) when the whole form has been read
function readMultipart(req, boundary, onPart, done) {
  const delim = Buffer.from('\r\n--' + boundary);
  let buf = Buffer.from('\r\n'); // so the first boundary looks like the others
  let state = 'pre'; // pre | after | headers | body | end
  let sink = null;
  let failed = false;
  const fail = (err) => { if (!failed) { failed = true; req.removeAllListeners('data'); req.resume(); done(err); } };
  const feed = () => {
    let wait = false;
    for (;;) {
      if (state === 'pre' || state === 'body') {
        const i = buf.indexOf(delim);
        const upto = i >= 0 ? i : Math.max(0, buf.length - delim.length + 1);
        if (state === 'body' && upto > 0 && sink.write(buf.subarray(0, upto)) === false) wait = true;
        if (i < 0) { buf = buf.subarray(upto); break; }
        if (state === 'body') sink.end();
        buf = buf.subarray(i + delim.length);
        state = 'after';
      } else if (state === 'after') {
        if (buf.length < 2) break;
        if (buf[0] === 0x2d && buf[1] === 0x2d) { state = 'end'; break; }
        if (buf[0] !== 0x0d || buf[1] !== 0x0a) return fail(new Error('bad form'));
        buf = buf.subarray(2);
        state = 'headers';
      } else if (state === 'headers') {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) { if (buf.length > 16384) return fail(new Error('bad form')); break; }
        const headers = {};
        for (const line of buf.subarray(0, i).toString('utf8').split('\r\n')) {
          const c = line.indexOf(':');
          if (c > 0) headers[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
        }
        buf = buf.subarray(i + 4);
        try { sink = onPart(headers); } catch (err) { return fail(err); }
        state = 'body';
      } else break;
    }
    return wait;
  };
  req.on('data', (chunk) => {
    if (failed) return;
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    try {
      if (feed()) { req.pause(); sink.drain(() => req.resume()); }
    } catch (err) { fail(err); }
  });
  req.on('end', () => { if (!failed) { if (state === 'end') done(null); else fail(new Error('form ended early')); } });
  req.on('error', fail);
}
const EXT_OF = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/quicktime': 'mov', 'video/mp4': 'mp4', 'application/pdf': 'pdf', 'text/plain': 'txt', 'audio/mpeg': 'mp3', 'audio/x-m4a': 'm4a' };
const cleanFileName = (n) => String(n || '').replace(/[\x00-\x1f\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 200);
function handleInbox(req, res, urlPath) {
  const reply = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  const m = urlPath.match(/^\/api\/inbox\/([0-9a-f]{32})(?:\/([0-9a-f]{24}))?$/);
  if (!INBOX || !m) { req.resume(); return reply(404, { error: 'not found' }); }
  const box = inboxRoom(m[1]).slice(6);
  const lang = LANGS[(req.url.match(/[?&]lang=([a-z]{2})/) || [])[1]] ? req.url.match(/[?&]lang=([a-z]{2})/)[1] : 'en';
  const item = m[2] ? inboxItems.get(m[2]) : null;
  if (m[2]) {
    req.resume();
    if (!item || item.box !== box) return reply(404, { error: 'not found' });
    if (req.method === 'DELETE') { deleteInboxItem(item.id); return reply(200, { ok: true }); }
    if (req.method !== 'GET' || item.text != null) return reply(405, { error: 'method' });
    res.writeHead(200, { 'Content-Type': item.mime || 'application/octet-stream', 'Content-Length': item.size, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.name)}` });
    return fs.createReadStream(inboxFile(item.id, 'bin')).on('error', () => res.destroy()).pipe(res);
  }
  if (req.method !== 'POST') { req.resume(); return reply(405, { error: 'method' }); }
  // The Shortcut shows this text when it's done
  const message = (code, text, extra = {}) => reply(code, { message: trFor(lang, text), ...extra });
  if (!inboxBoxes[box]) { req.resume(); return message(404, 'This Shortcut link is not active. Make a new one in OmniBeam: Settings, iPhone Shortcut.'); }
  const limit = INBOX_MAX_MB * 1024 * 1024;
  const length = Number(req.headers['content-length']) || 0;
  if (length > limit + 64 * 1024) { req.resume(); return message(413, 'Too big for the Shortcut. Send it from the OmniBeam page instead.'); }
  if (inboxBytes + length > INBOX_TOTAL_MB * 1024 * 1024) { req.resume(); return message(507, 'The server is full right now. Try again later.'); }
  if (!allowAttempt(inboxUploads, box, INBOX_PER_HOUR, 3600 * 1000)) { req.resume(); return message(429, 'Too many uploads. Wait a while and try again.'); }
  fs.mkdirSync(INBOX_DIR, { recursive: true });
  const made = [];
  let total = 0;
  // One file or text: returns the sink readMultipart and the plain-body upload write to
  const newItem = ({ name, mime, asText }) => {
    const id = crypto.randomBytes(12).toString('hex');
    const it = { id, box, name: cleanFileName(name), mime: String(mime || 'application/octet-stream').split(';')[0].trim().slice(0, 100), size: 0, at: Date.now() };
    made.push(it);
    const chunks = [];
    let out = null;
    const toFile = () => {
      out = fs.createWriteStream(inboxFile(id, 'bin'));
      out.on('error', () => {});
      if (chunks.length) out.write(Buffer.concat(chunks));
      chunks.length = 0;
    };
    if (!asText) toFile();
    it.abort = () => out && out.destroy();
    return {
      write(b) {
        it.size += b.length;
        total += b.length;
        if (total > limit) throw new Error('too-large');
        // Text stays in memory while it's small enough to be a message
        if (!out && it.size > INBOX_TEXT_MAX) toFile();
        if (!out) { chunks.push(Buffer.from(b)); return true; }
        return out.write(b);
      },
      // An ended stream never emits 'drain' (a small last part can fill the buffer and end in the same chunk)
      drain(cb) { out && out.writableNeedDrain && !out.writableEnded ? out.once('drain', cb) : cb(); },
      end() {
        if (!out) it.text = Buffer.concat(chunks).toString('utf8');
        it.done = new Promise((r) => (out ? out.end(r) : r()));
      },
    };
  };
  const finish = async (err) => {
    if (err) for (const it of made) it.abort();
    await Promise.all(made.map((it) => it.done));
    const keep = made.filter((it) => (it.text != null ? it.text.trim() : it.size > 0));
    if (err || !keep.length) {
      for (const it of made) fs.rm(inboxFile(it.id, 'bin'), { force: true }, () => {});
      if (err && err.message === 'too-large') return message(413, 'Too big for the Shortcut. Send it from the OmniBeam page instead.');
      return message(400, err ? 'The upload did not arrive in full. Try again.' : 'Nothing to send: share a file, photo or text.');
    }
    for (const it of made) if (!keep.includes(it)) fs.rm(inboxFile(it.id, 'bin'), { force: true }, () => {});
    let n = 0;
    for (const it of keep) {
      delete it.done;
      delete it.abort;
      if (it.text != null) it.text = it.text.slice(0, INBOX_TEXT_MAX);
      else {
        n++;
        inboxBytes += it.size;
        if (!it.name) it.name = `Shared ${new Date(it.at).toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-')}.${EXT_OF[it.mime] || 'bin'}`;
        else if (!/\.\w{1,8}$/.test(it.name) && EXT_OF[it.mime]) it.name += '.' + EXT_OF[it.mime];
      }
      inboxItems.set(it.id, it);
      fs.writeFile(inboxFile(it.id, 'json'), JSON.stringify(it), () => {});
    }
    count('inbox', keep.length);
    if (deliverInbox(box)) return message(200, 'Sent to OmniBeam.', { delivered: true });
    const first = keep.find((it) => it.text == null);
    pushRoom('inbox:' + box, null, (l) => ({
      title: first ? trFor(l, 'From your iPhone Shortcut: {name}', { name: n > 1 ? trFor(l, '{n} files', { n }) : first.name })
        : trFor(l, 'From your iPhone Shortcut: a message'),
      body: trFor(l, 'Tap to open OmniBeam and save it.'),
      url: '/?wake=1',
      tag: 'inbox',
    }));
    message(200, 'Saved. It arrives when OmniBeam opens on your device.', { delivered: false });
  };
  const type = String(req.headers['content-type'] || '');
  const boundary = (type.match(/^multipart\/form-data;.*boundary=(?:"([^"]+)"|([^;]+))/i) || []).slice(1).find(Boolean);
  if (boundary) {
    return readMultipart(req, boundary, (h) => {
      const disp = h['content-disposition'] || '';
      const fname = (disp.match(/filename\*=UTF-8''([^;]+)/i) || [])[1];
      const name = fname ? decodeURIComponent(fname) : (disp.match(/filename="([^"]*)"/i) || [])[1];
      // A form field without a file name is text; so is a small text/plain file
      return newItem({ name, mime: h['content-type'] || (name == null ? 'text/plain' : ''), asText: name == null || /^text\/plain/i.test(h['content-type'] || '') });
    }, finish);
  }
  // The file itself as the body; its name in the X-File-Name header or ?name= (optional)
  let name = String(req.headers['x-file-name'] || '');
  try { name = decodeURIComponent(name || (req.url.match(/[?&]name=([^&]*)/) || [])[1] || ''); } catch {}
  const sink = newItem({ name, mime: type, asText: !name && (!type || /^text\/plain/i.test(type)) });
  let failed = null;
  req.on('data', (b) => {
    if (failed) return;
    try {
      if (sink.write(b) === false) { req.pause(); sink.drain(() => req.resume()); }
    } catch (err) { failed = err; req.resume(); }
  });
  req.on('end', () => { sink.end(); finish(failed); });
  req.on('error', (err) => { failed = failed || err; });
}

// ---------- Owner statistics ----------
// Counts per day (UTC), kept in data/stats.json: connections, networks (counted with a daily random salt, so
// no addresses are stored), transfers by route, bytes, shared links. Shown in the admin panel (/admin) to whoever knows STATS_KEY.
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
let stats = { days: {} };
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); stats.days = stats.days || {}; } catch {}
let statsDirty = false;
const dayNets = { day: '', salt: '', seen: new Set() };
const today = () => new Date().toISOString().slice(0, 10);
function statDay() {
  const key = today();
  if (!stats.days[key]) {
    stats.days[key] = {};
    // Keep about 13 months
    for (const k of Object.keys(stats.days).sort().slice(0, -400)) delete stats.days[k];
  }
  return stats.days[key];
}
function count(field, n = 1, dayKey = '') {
  const day = dayKey && dayKey !== today() ? stats.days[dayKey] : statDay();
  if (!day) return;
  day[field] = (day[field] || 0) + n;
  statsDirty = true;
}
// A short code for something seen today (a network, a visitor) that can't be turned back into it: the random salt
// changes every day and is never saved
function dayHash(text) {
  const key = today();
  if (dayNets.day !== key) Object.assign(dayNets, { day: key, salt: crypto.randomBytes(16).toString('hex'), seen: new Set() });
  return crypto.createHash('sha256').update(dayNets.salt + text).digest('hex').slice(0, 12);
}
function countNetwork(networkRoom) {
  const h = dayHash(networkRoom);
  if (dayNets.seen.has(h)) return;
  dayNets.seen.add(h);
  count('networks');
}
function saveStats() {
  if (errorsDirty) {
    errorsDirty = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ERRORS_FILE + '.tmp', JSON.stringify(errors));
      fs.renameSync(ERRORS_FILE + '.tmp', ERRORS_FILE);
    } catch (err) {
      console.error('Could not save problem reports', err.message);
    }
  }
  if (!statsDirty) return;
  statsDirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE + '.tmp', JSON.stringify(stats));
    fs.renameSync(STATS_FILE + '.tmp', STATS_FILE);
  } catch (err) {
    console.error('Could not save stats', err.message);
  }
}
const statsAttempts = new Map();
// Checks the stats key sent by the /stats page. Answers the request itself (and returns null) when it's wrong.
function statsAuth(req, res) {
  req.resume();
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (!STATS_KEY) return json(404, { error: 'off' }), null;
  const key = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const net = 'stats:' + getIp(req);
  const now = Date.now();
  const recent = (statsAttempts.get(net) || []).filter((t) => now - t < CODE_WINDOW);
  if (recent.length >= CODE_ATTEMPTS) return json(429, { error: 'too-many' }), null;
  const want = crypto.createHash('sha256').update(STATS_KEY).digest();
  if (!crypto.timingSafeEqual(want, crypto.createHash('sha256').update(key).digest())) {
    recent.push(now);
    statsAttempts.set(net, recent);
    return json(403, { error: 'wrong-key' }), null;
  }
  statsAttempts.delete(net);
  return json;
}
function handleStats(req, res) {
  const json = statsAuth(req, res);
  if (!json) return;
  // Ask the TURN provider now, so the page shows whether it works at this moment
  // ?days=60: only the last 60 days (the page asks for twice the period it shows, to compare)
  const want = Math.min(400, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 400));
  const from = new Date(Date.now() - (want - 1) * 86400000).toISOString().slice(0, 10);
  const days = {};
  for (const [k, v] of Object.entries(stats.days)) if (k >= from) days[k] = v;
  iceServers().then(() => json(200, {
    days,
    now: { online: clients.size, links: drops.size, linkMb: Math.round(dropBytes / 1048576), linkMaxMb: DROP_TOTAL_MB, started: STARTED,
      visits: VISITS, ...visitorsNow() },
    errors,
    turn: { provider: turnProvider(), ...turnState },
    alerts: alertInfo(),
    weekly: weeklyInfo(),
    first: Object.keys(stats.days).sort()[0] || null,
    cleared: clearedInfo(),
  }));
}
// "Send a test alert" on /stats
function handleAlertTest(req, res) {
  if (req.method !== 'POST') { req.resume(); res.writeHead(405); return res.end(); }
  const json = statsAuth(req, res);
  if (!json) return;
  sendAlert('OmniBeam test alert', 'Alerts work. You will get a message like this when problem reports on omnibeam.site spike.\n'
    + `${SITE_URL}/admin`).then((result) => json(200, { ...result, alerts: alertInfo() }));
}

// "Clear stats" on /stats. POST /api/stats/clear?what=all|visitors|transfers|problems&from=YYYY-MM-DD&to=YYYY-MM-DD
// (no from/to = every day). What was there is saved first to data/stats-cleared.json, so "Undo" can bring it back
// (POST /api/stats/clear?undo=1) until the next clear.
const CLEARED_FILE = path.join(DATA_DIR, 'stats-cleared.json');
const VISIT_FIELD = /^(views|visitors|app|time|timed|engaged|(vc|uc|tc|vp|tp|us|ud|ub|uo|ul|vh|tb)_.*)$/;
const PROBLEM_FIELD = /^(err|e_.*)$/;
const statGroup = (f) => (VISIT_FIELD.test(f) ? 'visitors' : PROBLEM_FIELD.test(f) ? 'problems' : 'transfers');
function clearedInfo() {
  try { const c = JSON.parse(fs.readFileSync(CLEARED_FILE, 'utf8')); return { at: c.at, what: c.what, from: c.from, to: c.to }; } catch { return null; }
}
function handleStatsClear(req, res) {
  if (req.method !== 'POST') { req.resume(); res.writeHead(405); return res.end(); }
  const json = statsAuth(req, res);
  if (!json) return;
  const q = new URL(req.url, 'http://x').searchParams;
  const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  if (q.get('undo')) {
    let c;
    try { c = JSON.parse(fs.readFileSync(CLEARED_FILE, 'utf8')); } catch { return json(404, { error: 'nothing-to-undo' }); }
    // Add the saved numbers back (anything counted since the clear stays)
    for (const [d, fields] of Object.entries(c.days || {})) {
      const day = stats.days[d] || (stats.days[d] = {});
      for (const [f, n] of Object.entries(fields)) day[f] = typeof n === 'number' && typeof day[f] === 'number' ? day[f] + n : (day[f] ?? n);
    }
    if (Array.isArray(c.errors) && c.errors.length) {
      errors = [...c.errors, ...errors].sort((a, b) => a.t - b.t).slice(-MAX_ERRORS);
      errorsDirty = true;
    }
    statsDirty = true;
    saveStats();
    try { fs.unlinkSync(CLEARED_FILE); } catch {}
    return json(200, { undone: true });
  }
  const what = ['all', 'visitors', 'transfers', 'problems'].includes(q.get('what')) ? q.get('what') : null;
  if (!what || q.get('confirm') !== 'CLEAR') return json(400, { error: 'confirm' });
  const from = isDay(q.get('from')) ? q.get('from') : '0000-00-00';
  const to = isDay(q.get('to')) ? q.get('to') : '9999-99-99';
  const saved = { at: Date.now(), what, from: isDay(q.get('from')) ? from : null, to: isDay(q.get('to')) ? to : null, days: {}, errors: [] };
  let fields = 0;
  for (const [d, day] of Object.entries(stats.days)) {
    if (d < from || d > to) continue;
    for (const f of Object.keys(day)) {
      if (what !== 'all' && statGroup(f) !== what) continue;
      (saved.days[d] = saved.days[d] || {})[f] = day[f];
      delete day[f];
      fields++;
    }
    if (!Object.keys(day).length && d !== today()) delete stats.days[d];
  }
  if (what === 'all' || what === 'problems') {
    const lo = Date.parse(from + 'T00:00:00Z') || 0;
    const hi = to === '9999-99-99' ? Infinity : Date.parse(to + 'T23:59:59.999Z');
    saved.errors = errors.filter((e) => e.t >= lo && e.t <= hi);
    if (saved.errors.length) { errors = errors.filter((e) => !(e.t >= lo && e.t <= hi)); errorsDirty = true; }
  }
  // Clearing all of today also forgets who was already counted today, so they count again from now
  if (what === 'all' && today() >= from && today() <= to) dayNets.day = '';
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLEARED_FILE, JSON.stringify(saved));
  } catch (err) {
    console.error('Could not save the cleared stats', err.message);
  }
  statsDirty = true;
  saveStats();
  json(200, { cleared: fields, reports: saved.errors.length, undo: clearedInfo() });
}
// "Download a backup (JSON)" on /stats: every day and every problem report kept for the page
function handleStatsBackup(req, res) {
  const json = statsAuth(req, res);
  if (!json) return;
  saveStats();
  json(200, { site: SITE_URL, made: new Date().toISOString(), days: stats.days, errors });
}

// ---------- Supporter codes ----------
// After someone donates (the Support link), the owner makes them a code on /stats -> Supporters. Typed into Settings
// on their devices, it unlocks a small thank-you: a ♥ badge on the device's card that other devices see, four extra
// colour themes and extra pictures. Nothing else changes: everything stays free for everyone, with no ads.
// A code is OB- and 16 letters/digits (Crockford base32 of 10 bytes): 5 random bytes (the code's id) and the first
// 5 bytes of an HMAC-SHA256 of that id under SUPPORTER_KEY. So the server can check any code by itself, even when
// data/supporters.json (the list of codes made, with a note each, and the ones taken back) is missing or restored
// from an old copy: the list is only needed to take a code back. Off until SUPPORTER_KEY is set (cPanel).
// The app remembers on the device that its code was accepted, so the perks also work offline.
const SUPPORTER_KEY = (process.env.SUPPORTER_KEY || '').trim();
const SUPPORTER_FILE = path.join(DATA_DIR, 'supporters.json');
let supporterData = { codes: [] };
try { supporterData = { codes: [], ...JSON.parse(fs.readFileSync(SUPPORTER_FILE, 'utf8')) }; } catch {}
const saveSupporters = () => fs.writeFile(SUPPORTER_FILE, JSON.stringify(supporterData, null, 1), () => {});
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function toB32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function fromB32(str) {
  const bytes = [];
  let bits = 0, value = 0;
  for (const ch of str) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}
const supporterMac = (id) => crypto.createHmac('sha256', SUPPORTER_KEY).update('omnibeam-supporter:' + id.toString('hex')).digest().subarray(0, 5);
const supporterCodeOf = (idHex) => {
  const raw = toB32(Buffer.concat([Buffer.from(idHex, 'hex'), supporterMac(Buffer.from(idHex, 'hex'))]));
  return 'OB-' + raw.match(/.{4}/g).join('-');
};
// The code's id when it is a real code that wasn't taken back, otherwise null. Forgiving about how it's typed:
// small letters, spaces, dashes, O for 0 and I or L for 1.
function checkSupporterCode(code) {
  if (!SUPPORTER_KEY || typeof code !== 'string' || code.length > 60) return null;
  const clean = code.toUpperCase().replace(/^\s*OB/, '').replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 16) return null;
  const bytes = fromB32(clean);
  if (!bytes || bytes.length !== 10) return null;
  const id = bytes.subarray(0, 5), mac = bytes.subarray(5);
  if (!crypto.timingSafeEqual(mac, supporterMac(id))) return null;
  const idHex = id.toString('hex');
  if (supporterData.codes.some((c) => c.id === idHex && c.revoked)) return null;
  return idHex;
}
const supporterTries = new Map(); // network -> recent tries
function supporterLimited(req) {
  const net = 'sup:' + getIp(req);
  const now = Date.now();
  const recent = (supporterTries.get(net) || []).filter((t) => now - t < CODE_WINDOW);
  recent.push(now);
  supporterTries.set(net, recent);
  if (supporterTries.size > 5000) for (const [k, v] of supporterTries) if (now - v[v.length - 1] > CODE_WINDOW) supporterTries.delete(k);
  return recent.length > CODE_ATTEMPTS * 2;
}
// POST /api/supporter {code}: is this a working code? (Settings asks before it unlocks anything)
function handleSupporter(req, res) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'POST') { req.resume(); return json(405, { error: 'method' }); }
  if (!SUPPORTER_KEY) { req.resume(); return json(404, { error: 'off' }); }
  if (supporterLimited(req)) { req.resume(); return json(429, { error: 'too-many' }); }
  readJsonBody(req, 2048).then((body) => {
    const id = checkSupporterCode(body.code);
    if (id) count('supporterUnlock');
    json(200, { ok: !!id });
  }).catch(() => json(400, { error: 'bad request' }));
}
// /stats -> Supporters: GET lists the codes made, POST ?note= makes a new one, POST ?revoke=<id> takes one back
// (?restore=<id> gives it back again)
function handleStatsSupporters(req, res) {
  const json = statsAuth(req, res);
  if (!json) return;
  const q = new URL(req.url, 'http://x').searchParams;
  const list = () => ({ on: !!SUPPORTER_KEY, codes: SUPPORTER_KEY ? supporterData.codes.slice().reverse().map((c) => ({ ...c, code: supporterCodeOf(c.id) })) : [] });
  if (req.method === 'GET') return json(200, list());
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!SUPPORTER_KEY) return json(409, { error: 'no-key' });
  const revoke = q.get('revoke') || q.get('restore');
  if (revoke) {
    const c = supporterData.codes.find((x) => x.id === revoke);
    if (!c) return json(404, { error: 'not-found' });
    if (q.get('revoke')) c.revoked = new Date().toISOString(); else delete c.revoked;
    saveSupporters();
    // A device using a code that was taken back loses its badge now (it learns it the next time it connects)
    if (q.get('revoke')) {
      for (const client of clients.values()) {
        if (client.supporter !== revoke) continue;
        client.supporter = '';
        send(client.ws, { type: 'supporter', ok: false });
        for (const id of visiblePeers(client)) send(clients.get(id).ws, { type: 'peer-updated', peer: peerInfo(client, clients.get(id)) });
      }
    }
    return json(200, list());
  }
  let id;
  do { id = crypto.randomBytes(5).toString('hex'); } while (supporterData.codes.some((c) => c.id === id));
  const note = String(q.get('note') || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 120);
  supporterData.codes.push({ id, note, made: new Date().toISOString() });
  if (supporterData.codes.length > 5000) supporterData.codes = supporterData.codes.slice(-5000);
  saveSupporters();
  json(200, { ...list(), made: supporterCodeOf(id) });
}

// ---------- Visitors ----------
// public/visit.js sends {t:'v'} when a page opens and {t:'t', s} with the seconds it has been visible so far (every
// minute while it's on screen, and when it's hidden or closed). Each day gets totals only: views, visitors (one per
// address + browser per day, by dayHash), and per country, page, source, device, browser, system, language and hour.
// Fields: views, visitors, vc_<country> uc_<country> tc_<country> (views, visitors, seconds), vp_<page> tp_<page>,
// us_<source> ud_<device> ub_<browser> uo_<system> ul_<language> (visitors), vh_<UTC hour>, app (installed app),
// time (seconds on pages), timed (pages whose visit ended), tb_0..tb_6 (how long: <10 s, <30 s, <1 min, <3 min,
// <10 min, <30 min, longer), engaged (stayed 10 s or more).
const visitViews = new Map(); // random id of an open page -> { day, cc, page, s, last }, in memory only
const visitAttempts = new Map(); // network -> { start, n }
const VISIT_BUCKETS = [10, 30, 60, 180, 600, 1800];
const VISIT_MAX_SECONDS = 4 * 3600;
const VISIT_KEY_LIMIT = 150; // different pages / sources per day; the rest are counted as "(other)"
const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|scan|monitor|facebookexternalhit|curl|wget|python|java\/|go-http/i;
const visitKey = (field, value) => {
  const day = statDay();
  const prefix = field + '_';
  if (day[prefix + value] !== undefined) return prefix + value;
  const used = Object.keys(day).filter((k) => k.startsWith(prefix)).length;
  return used < VISIT_KEY_LIMIT ? prefix + value : prefix + '(other)';
};
// Where a visitor came from: utm_source if the link had one, else the other site's name (google.com, t.co…)
function visitSource(r) {
  const utm = String(r.u || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
  if (utm) return utm;
  let host = String(r.r || '').toLowerCase().replace(/^(www|m|l|lm|mobile)\./, '');
  if (!host) return 'direct';
  if (!/^[a-z0-9.-]{1,80}$/.test(host)) return '(other)';
  if (host === SITE_HOST || host.endsWith('.' + SITE_HOST)) return 'direct';
  // Search engines and big sites under many country domains count as one
  const m = host.match(/(?:^|\.)(google|bing|yahoo|yandex|duckduckgo|baidu|facebook|instagram|youtube|linkedin|reddit|pinterest|tiktok|snapchat)\.[a-z.]+$/);
  if (m) return m[1] + '.com';
  if (host === 't.co' || host === 'x.com' || host === 'twitter.com') return 'x.com';
  if (/^com\.google\.android\.(gm|googlequicksearchbox)$/.test(host)) return 'google.com';
  return host;
}
function finishVisit(id, v) {
  visitViews.delete(id);
  if (v.amp) return; // AMP pages only count the view, not the time
  const bucket = VISIT_BUCKETS.findIndex((b) => v.s < b);
  count('tb_' + (bucket < 0 ? VISIT_BUCKETS.length : bucket), 1, v.day);
  count('timed', 1, v.day);
  if (v.s >= 10) count('engaged', 1, v.day);
}
// Pages not heard from for 15 minutes have been closed; their time goes into the "how long" groups
function sweepVisits(all = false) {
  const now = Date.now();
  for (const [id, v] of visitViews) if (all || now - v.last > 15 * 60 * 1000) finishVisit(id, v);
}
// A page view (visit.js's first message, or the <amp-pixel> of an AMP page)
function recordView(req, id, r, ip, now) {
  if (visitViews.has(id)) return;
  if (visitViews.size >= 20000) sweepVisits();
  if (visitViews.size >= 20000) return;
  let cc = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]$/.test(cc) || cc === 'XX') cc = 'XX';
  let page = String(r.p || '/').toLowerCase().replace(/[?#].*$/, '');
  if (page.startsWith('/d/')) page = '/d/'; // shared links: one entry, not one per link
  if (page.startsWith('/r/')) page = '/r/'; // request links: the same
  if (page.startsWith('/e/')) page = '/e/'; // event albums: the same
  if (!/^\/[a-z0-9/._-]{0,80}$/.test(page)) page = '(other)';
  page = visitKey('vp', page).slice(3);
  const day = today();
  visitViews.set(id, { day, cc, page, s: 0, last: now, ...(r.amp ? { amp: 1 } : {}) });
  count('views');
  count('vc_' + cc);
  count('vp_' + page);
  count('vh_' + new Date(now).getUTCHours());
  if (r.a) count('app');
  const ua = req.headers['user-agent'] || '';
  const h = dayHash('visitor:' + ip + ua);
  if (!dayNets.seen.has(h)) {
    dayNets.seen.add(h);
    const { os, browser } = uaInfo(ua);
    const device = ['phone', 'tablet', 'desktop'].includes(r.d) ? r.d : /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'desktop';
    const lang = Object.prototype.hasOwnProperty.call(LANGS, r.l) ? r.l : 'en';
    count('visitors');
    count('uc_' + cc);
    count(visitKey('us', visitSource(r)));
    count('ud_' + device);
    count('ub_' + browser.replace(/ \d+$/, ''));
    count('uo_' + os);
    count('ul_' + lang);
  }
}
function handleVisit(req, res) {
  const done = (code) => { res.writeHead(code, { 'Cache-Control': 'no-store' }); res.end(); };
  const amp = req.method === 'GET' && /[?&]amp=1(&|$)/.test(req.url);
  if (req.method !== 'POST' && !amp) { req.resume(); return done(405); }
  if (!VISITS || BOT_UA.test(req.headers['user-agent'] || '')) { req.resume(); return done(204); }
  const ip = getIp(req);
  const now = Date.now();
  const a = visitAttempts.get(ip);
  if (a && now - a.start < CODE_WINDOW) { if (++a.n > 300) { req.resume(); return done(429); } }
  else visitAttempts.set(ip, { start: now, n: 1 });
  // An AMP page's <amp-pixel>: one GET with the page, where the visitor came from and the screen size. It only counts
  // the view (AMP pages can't say how long they stay open).
  if (amp) {
    const q = new URL(req.url, 'http://x').searchParams;
    let p = '/';
    try { p = new URL(q.get('p') || '/', SITE_URL).pathname; } catch {}
    let from = '';
    try { from = q.get('r') ? new URL(q.get('r')).hostname : ''; } catch {}
    if (from === SITE_HOST) from = '';
    const small = Math.min(Number(q.get('w')) || 0, Number(q.get('h')) || 0);
    const touch = /Mobi|iPhone|iPad|Android/.test(req.headers['user-agent'] || '');
    recordView(req, crypto.randomBytes(6).toString('hex'), { t: 'v', amp: 1, p, r: from, u: (q.get('u') || '').slice(0, 60), l: q.get('l'),
      d: !touch ? 'desktop' : small >= 600 && small < 1100 ? 'tablet' : 'phone', a: 0 }, ip, now);
    req.resume();
    return done(204);
  }
  readJsonBody(req, 1024).then((r) => {
    const id = typeof r.id === 'string' && /^[a-z0-9]{8,16}$/i.test(r.id) ? r.id : null;
    if (!id) return done(400);
    if (r.t === 'v') {
      recordView(req, id, r, ip, now);
      return done(204);
    }
    if (r.t === 't') {
      const v = visitViews.get(id);
      if (!v) return done(204);
      // Never more than the time that really passed since the last message (plus a little), at most 4 hours a page
      const s = Math.min(VISIT_MAX_SECONDS, Math.floor(Number(r.s) || 0), v.s + Math.ceil((now - v.last) / 1000) + 30);
      if (s > v.s) {
        const add = s - v.s;
        count('time', add, v.day);
        count('tc_' + v.cc, add, v.day);
        count('tp_' + v.page, add, v.day);
        v.s = s;
      }
      v.last = now;
      if (r.end) finishVisit(id, v);
      return done(204);
    }
    done(400);
  }, () => done(400));
}
// Who is on the site right now: pages that sent a message in the last 2 minutes (they do every minute)
function visitorsNow() {
  const now = Date.now();
  const countries = {};
  let n = 0;
  for (const v of visitViews.values()) {
    if (now - v.last > 2 * 60 * 1000) continue;
    n++;
    countries[v.cc] = (countries[v.cc] || 0) + 1;
  }
  return { visitors: n, countries };
}

// ---------- Problem reports ----------
// Browsers report what went wrong for their user: a failed or interrupted transfer, a direct connection that
// didn't work, a script error, a shared link that failed. Reports hold no file names, contents or addresses
// (cleanReport removes anything that looks like one). Daily counts go into the stats above (err, e_<kind>);
// the latest MAX_ERRORS reports are kept in data/errors.json and listed on /stats.
const ERRORS_FILE = path.join(DATA_DIR, 'errors.json');
const MAX_ERRORS = 300;
const REPORT_KINDS = ['transfer', 'direct', 'js', 'socket', 'link', 'storage', 'shrink', 'crash', 'stuck'];
const REPORTS_PER_WINDOW = 20; // per network, every CODE_WINDOW (10 minutes)
let errors = [];
try { errors = JSON.parse(fs.readFileSync(ERRORS_FILE, 'utf8')); if (!Array.isArray(errors)) errors = []; } catch {}
let errorsDirty = false;
const reportAttempts = new Map();
function cleanReport(text, max = 200) {
  return String(text == null ? '' : text)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/(?:https?|wss?|blob|file):\/\/\S+/gi, '<url>')
    .replace(/\S+@\S+\.\S+/g, '<email>')
    .replace(/[A-Za-z]:\\[^\s"']*|\/(?:Users|home|storage|private|var)\/[^\s"']*/g, '<path>')
    .replace(/[^\s/\\:"']+\.(?:jpe?g|png|gif|heic|heif|webp|bmp|tiff?|mp4|mov|m4v|avi|mkv|webm|pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv|txt|mp3|m4a|wav|ogg|apk|exe|msi|dmg|iso)\b/gi, '<file>')
    .replace(/\b\d{6,}\b/g, '#') // pairing codes and other long numbers
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
// Browser and system, from the User-Agent, in a few words ("Chrome 141", "iOS")
function uaInfo(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  // In this order: Edge, Opera and Samsung also say "Chrome", Chrome on iPhone also says "Safari"
  const names = [['EdgiOS', 'Edge'], ['Edg', 'Edge'], ['OPR', 'Opera'], ['SamsungBrowser', 'Samsung Internet'], ['FxiOS', 'Firefox'],
    ['Firefox', 'Firefox'], ['CriOS', 'Chrome'], ['Chrome', 'Chrome'], ['Version', 'Safari']];
  let browser = 'Other';
  for (const [token, name] of names) {
    const m = ua.match(new RegExp(`${token}/(\\d+)`));
    if (m) { browser = `${name} ${m[1]}`; break; }
  }
  if (!/Mozilla/.test(ua)) browser = 'Command line';
  return { os, browser };
}
function handleReport(req, res) {
  const done = (code) => { res.writeHead(code, { 'Cache-Control': 'no-store' }); res.end(); };
  if (req.method !== 'POST') { req.resume(); return done(405); }
  const net = 'report:' + getIp(req);
  const now = Date.now();
  const recent = (reportAttempts.get(net) || []).filter((t) => now - t < CODE_WINDOW);
  if (recent.length >= REPORTS_PER_WINDOW) { req.resume(); return done(429); }
  recent.push(now);
  reportAttempts.set(net, recent);
  readJsonBody(req, 4096).then((r) => {
    const kind = REPORT_KINDS.includes(r.k) ? r.k : null;
    if (!kind) return done(400);
    const entry = {
      t: now, k: kind, m: cleanReport(r.m) || 'Unknown problem',
      ...uaInfo(req.headers['user-agent']),
      ...(r.d ? { d: cleanReport(r.d, 200) } : {}),
      ...(['lan', 'internet', 'turn', 'relay', 'none'].includes(r.r) ? { r: r.r } : {}),
      ...(['send', 'receive'].includes(r.role) ? { role: r.role } : {}),
      ...(typeof r.same === 'boolean' ? { same: r.same } : {}),
      ...(Number(r.size) > 0 ? { size: Math.min(1e13, Math.round(Number(r.size))) } : {}),
      ...(r.src ? { src: cleanReport(String(r.src).replace(/[?#].*$/, ''), 60) + (Number(r.line) > 0 ? `:${Math.floor(Number(r.line))}` : '') } : {}),
      ...(typeof r.v === 'string' ? { v: r.v.replace(/[^\w.-]/g, '').slice(0, 20) } : {}),
      // Stuck transfers: how far it got (%) and how long nothing moved (seconds). Crashes: a transfer was running,
      // how long the page had been open (minutes), and which page (the app, TV mode, a link page)
      ...(Number(r.pct) >= 0 && r.pct !== '' && r.pct != null ? { pct: Math.min(100, Math.floor(Number(r.pct))) } : {}),
      ...(Number(r.secs) > 0 ? { secs: Math.min(86400, Math.round(Number(r.secs))) } : {}),
      ...(Number(r.up) > 0 ? { up: Math.min(10080, Math.round(Number(r.up))) } : {}),
      ...(typeof r.busy === 'boolean' ? { busy: r.busy } : {}),
      ...(['app', 'tv', 'link', 'request'].includes(r.page) ? { page: r.page } : {}),
    };
    errors.push(entry);
    if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
    errorsDirty = true;
    count('err');
    count('e_' + kind);
    // Which network sent it, only in memory and only for the spike check (one broken device isn't a spike)
    alertNets.push({ t: now, n: crypto.createHash('sha256').update(alertSalt + getIp(req)).digest('hex').slice(0, 12) });
    checkSpike(now);
    instantAlert(entry, alertNets[alertNets.length - 1].n);
    done(204);
  }, () => done(400));
}

// ---------- Alerts ----------
// A spike: at least ALERT_MIN reports in the last ALERT_WINDOW, at least 3 times the usual number for that much
// time (the average over the last 24 hours), from at least 2 networks. Then one email and/or Telegram message,
// and no other for ALERT_EVERY. data/alert.json remembers the last alert and the Telegram chat.
const ALERT_FILE = path.join(DATA_DIR, 'alert.json');
const SENDMAIL = process.env.ALERT_SENDMAIL || ['/usr/sbin/sendmail', '/usr/lib/sendmail'].find((f) => fs.existsSync(f)) || '';
let alertState = { last: 0, chat: '', sent: 0, error: '' };
try { alertState = { ...alertState, ...JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8')) }; } catch {}
const alertSalt = crypto.randomBytes(16).toString('hex');
let alertNets = [];
const alertChannels = () => [ALERT_EMAIL && (SENDMAIL || process.env.ALERT_OUTBOX) ? 'email' : '', ALERT_TELEGRAM_TOKEN ? 'telegram' : ''].filter(Boolean);
function saveAlertState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ALERT_FILE, JSON.stringify(alertState));
  } catch (err) {
    console.error('Could not save alert state', err.message);
  }
}
function alertInfo() {
  return {
    channels: alertChannels(), email: ALERT_EMAIL ? ALERT_EMAIL.replace(/^(.).*(@.*)$/, '$1…$2') : '', sendmail: !!SENDMAIL,
    telegram: !!ALERT_TELEGRAM_TOKEN, chat: !!(process.env.ALERT_TELEGRAM_CHAT || alertState.chat),
    min: ALERT_MIN, windowMin: ALERT_WINDOW / 60000, everyMin: ALERT_EVERY / 60000, last: alertState.last || 0, error: alertState.error || '',
    instant: { channels: instantChannels(), everyMin: INSTANT_EVERY / 60000, maxDay: INSTANT_MAX_DAY, last: alertState.instantSent || 0,
      error: alertState.instantError || '', today: instant.day === new Date().toISOString().slice(0, 10) ? instant.sentToday : 0 },
  };
}
function checkSpike(now = Date.now()) {
  alertNets = alertNets.filter((x) => now - x.t < ALERT_WINDOW);
  if (!alertChannels().length || now - alertState.last < ALERT_EVERY) return;
  const recent = errors.filter((e) => now - e.t < ALERT_WINDOW);
  if (recent.length < ALERT_MIN || new Set(alertNets.map((x) => x.n)).size < 2) return;
  // The usual number: reports in the 24 hours before this window, scaled to the window's length
  const before = errors.filter((e) => e.t <= now - ALERT_WINDOW && e.t > now - ALERT_WINDOW - 864e5).length;
  const usual = (before * ALERT_WINDOW) / 864e5;
  if (recent.length < 3 * usual) return;
  alertState.last = now;
  saveAlertState();
  const top = new Map();
  for (const e of recent) {
    const k = `${e.k}: ${e.m}`;
    top.set(k, (top.get(k) || 0) + 1);
  }
  const systems = new Map();
  for (const e of recent) systems.set(`${e.browser} on ${e.os}`, (systems.get(`${e.browser} on ${e.os}`) || 0) + 1);
  const list = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `• ${n}× ${k}`).join('\n');
  const mins = Math.round(ALERT_WINDOW / 60000);
  sendAlert(`OmniBeam: ${recent.length} problem reports in ${mins} minutes`,
    `${recent.length} problem reports on omnibeam.site in the last ${mins} minutes (usually about ${Math.max(0, Math.round(usual * 10) / 10)}).\n\n`
    + `Most common:\n${list(top)}\n\nOn:\n${list(systems)}\n\nDetails: ${SITE_URL}/admin`);
}
// Instant alerts (see INSTANT_ALERTS near the top): crashes, stuck transfers and new script errors
const instant = { pending: [], timer: null, last: 0, day: '', sentToday: 0, seen: new Map(), skipped: 0 };
const instantChannels = () => (INSTANT_ALERTS === 'off' || INSTANT_ALERTS === 'false' ? [] : [
  (INSTANT_ALERTS === 'telegram' || INSTANT_ALERTS === 'both') && (ALERT_TELEGRAM_TOKEN || process.env.INSTANT_OUTBOX) ? 'telegram' : '',
  (INSTANT_ALERTS === 'email' || INSTANT_ALERTS === 'both') && ALERT_EMAIL && (SENDMAIL || process.env.ALERT_OUTBOX) ? 'email' : '',
].filter(Boolean));
function instantWorthIt(e, net) {
  if (e.k === 'crash' || e.k === 'stuck') return true;
  if (e.k !== 'js') return false;
  // A script error: only one not reported (by anyone) in the 7 days before this one
  const week = e.t - 7 * 864e5;
  return !errors.some((x) => x !== e && x.k === 'js' && x.m === e.m && x.t >= week);
}
function instantAlert(e, net) {
  if (!instantChannels().length || !instantWorthIt(e, net)) return;
  // The same device (network) and kind: once an hour
  const key = `${net}|${e.k}`;
  for (const [k, t] of instant.seen) if (e.t - t > 3600e3) instant.seen.delete(k);
  if (instant.seen.has(key)) return;
  instant.seen.set(key, e.t);
  instant.pending.push(e);
  if (instant.pending.length > 50) instant.pending.shift();
  if (!instant.timer) {
    // Gather for a minute; then wait out INSTANT_EVERY since the last message
    const wait = Math.max(Number(process.env.INSTANT_GATHER_MS) || 60e3, instant.last + INSTANT_EVERY - Date.now());
    instant.timer = setTimeout(flushInstant, wait);
    instant.timer.unref?.();
  }
}
const INSTANT_NAMES = { crash: 'Tab crashed', stuck: 'Stuck transfer', js: 'New script error' };
function describeReport(e) {
  const route = { lan: 'same network', internet: 'internet', turn: 'TURN', relay: 'server relay', none: 'not connected' }[e.r];
  const size = e.size ? (e.size >= 1048576 ? `${Math.round(e.size / 1048576)} MB` : `${Math.max(1, Math.round(e.size / 1024))} KB`) : '';
  const parts = [
    e.k === 'stuck' ? `${e.role === 'receive' ? 'receiving' : 'sending'}${e.pct != null ? ` at ${e.pct}%` : ''}${e.secs ? `, nothing moved for ${e.secs} s` : ''}`
      : e.k === 'crash' ? `${e.busy ? 'during a transfer' : 'no transfer running'}${e.up ? `, open ${e.up} min` : ''}` : e.m,
    route, size, e.page && e.page !== 'app' ? `page: ${e.page}` : '', `${e.browser} on ${e.os}`, e.src || '', e.v ? `v${e.v}` : '',
  ].filter(Boolean);
  return `• ${INSTANT_NAMES[e.k] || e.k}: ${parts.join(' · ')}`;
}
async function flushInstant() {
  instant.timer = null;
  const list = instant.pending.splice(0);
  if (!list.length) return;
  const today = new Date().toISOString().slice(0, 10);
  if (instant.day !== today) { instant.day = today; instant.sentToday = 0; }
  if (instant.sentToday >= INSTANT_MAX_DAY) { instant.skipped += list.length; return; }
  instant.sentToday++;
  instant.last = Date.now();
  const counts = {};
  for (const e of list) counts[e.k] = (counts[e.k] || 0) + 1;
  const PLURAL = { crash: ['tab crash', 'tab crashes'], stuck: ['stuck transfer', 'stuck transfers'], js: ['new script error', 'new script errors'] };
  const subject = `OmniBeam: ${Object.entries(counts).map(([k, n]) => `${n} ${(PLURAL[k] || [k, k])[n > 1 ? 1 : 0]}`).join(', ')}`;
  const skipped = instant.skipped ? `\n(${instant.skipped} more were not sent: the daily limit of ${INSTANT_MAX_DAY} messages was reached)` : '';
  instant.skipped = 0;
  const text = `${list.slice(0, 15).map(describeReport).join('\n')}${list.length > 15 ? `\n… and ${list.length - 15} more` : ''}${skipped}\n\nDetails: ${SITE_URL}/admin`;
  const channels = instantChannels();
  const failed = [];
  if (channels.includes('telegram')) {
    try {
      if (process.env.INSTANT_OUTBOX) fs.appendFileSync(process.env.INSTANT_OUTBOX, JSON.stringify({ subject, text }) + '\n'); // tests
      else await sendTelegram(`${subject}\n\n${text}`);
    } catch (err) { failed.push('telegram: ' + err.message); }
  }
  if (channels.includes('email')) {
    try { await sendEmail(subject, text); } catch (err) { failed.push('email: ' + err.message); }
  }
  alertState.instantError = failed.join('; ').slice(0, 300);
  if (failed.length < channels.length) alertState.instantSent = Date.now();
  saveAlertState();
  if (failed.length) console.error('Instant alert not sent:', alertState.instantError);
}
// Sends to every channel that is set up; resolves to { sent: ['email', …], error }
async function sendAlert(subject, text) {
  const sent = [];
  const failed = [];
  if (ALERT_EMAIL && (SENDMAIL || process.env.ALERT_OUTBOX)) {
    try { await sendEmail(subject, text); sent.push('email'); } catch (err) { failed.push('email: ' + err.message); }
  } else if (ALERT_EMAIL) failed.push('email: no sendmail on this server');
  if (ALERT_TELEGRAM_TOKEN) {
    try { await sendTelegram(`${subject}\n\n${text}`); sent.push('telegram'); } catch (err) { failed.push('telegram: ' + err.message); }
  }
  if (!sent.length && !failed.length) failed.push('no alert channel is set up (ALERT_EMAIL or ALERT_TELEGRAM_TOKEN)');
  alertState.error = failed.join('; ').slice(0, 300);
  if (sent.length) alertState.sent = Date.now();
  saveAlertState();
  if (failed.length) console.error('Alert not sent:', alertState.error);
  return { sent, error: alertState.error };
}
function sendEmail(subject, text) {
  return new Promise((resolve, reject) => {
    const from = `OmniBeam <alerts@${new URL(SITE_URL).hostname}>`;
    const clean = (h) => String(h).replace(/[\r\n]+/g, ' ');
    const msg = [`From: ${from}`, `To: ${clean(ALERT_EMAIL)}`, `Subject: =?UTF-8?B?${Buffer.from(clean(subject)).toString('base64')}?=`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\n'), ''].join('\n');
    // The tests write the email to a file instead of sending it
    if (process.env.ALERT_OUTBOX) return fs.appendFile(process.env.ALERT_OUTBOX, msg + '\n', (e) => (e ? reject(e) : resolve()));
    const child = require('child_process').spawn(SENDMAIL, ['-t', '-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 200) || `sendmail exited with ${code}`)); });
    child.stdin.end(msg);
  });
}
// Telegram's Bot API. Without ALERT_TELEGRAM_CHAT the chat is the last one that wrote to the bot, then remembered.
function telegram(method, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}));
    const req = require('https').request(`https://api.telegram.org/bot${ALERT_TELEGRAM_TOKEN}/${method}`, {
      method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(out); } catch {}
        j.ok ? resolve(j.result) : reject(new Error(j.description || `Telegram answered ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram did not answer')));
    req.on('error', reject);
    req.end(data);
  });
}
async function sendTelegram(text) {
  let chat = (process.env.ALERT_TELEGRAM_CHAT || '').trim() || alertState.chat;
  if (!chat) {
    const updates = await telegram('getUpdates', { limit: 100 });
    const last = updates.map((u) => (u.message || u.my_chat_member || u.channel_post || {}).chat).filter(Boolean).pop();
    if (!last) throw new Error('send your bot a message in Telegram first, then try again');
    chat = String(last.id);
    alertState.chat = chat;
  }
  await telegram('sendMessage', { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true });
}
const STARTED = Date.now();

// ---------- Email from the server (Resend) ----------
// "Send to" an email address in the Share by link window: with a Resend key set, the server sends the email itself,
// from no-reply@omnibeam.site, so nothing depends on the visitor's mail app. Without a key the browser opens the
// mail app instead, as before. The link (with its key) passes through the server once to be written into the email
// and is not stored. Environment variables in cPanel:
//   RESEND_API_KEY     the API key from resend.com (needed; never put it in this file)
//   EMAIL_FROM         sender, default "OmniBeam <no-reply@omnibeam.site>" (the domain must be verified in Resend)
//   EMAIL_PER_IP_DAY   emails one internet connection may send per day (default 10)
//   EMAIL_PER_DAY      emails the whole site may send per day (default 90; Resend's free plan allows 100)
// The weekly summary (below) also goes out through Resend when the key is set.
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || `OmniBeam <no-reply@${new URL(SITE_URL).hostname}>`).trim();
const EMAIL_PER_IP_DAY = Number(process.env.EMAIL_PER_IP_DAY) || 10;
const EMAIL_PER_DAY = Number(process.env.EMAIL_PER_DAY) || 90;
const EMAIL_PER_LINK = 3;
// The tests write emails to a file instead of sending them
const EMAIL_OUTBOX = (process.env.EMAIL_OUTBOX || '').trim();
const EMAIL_ON = !!(RESEND_API_KEY || EMAIL_OUTBOX);
const emailSent = { day: '', all: 0, byIp: new Map() };
const EMAIL_RE = /^[^\s@<>,;"'()\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
function emailAllowed(ip) {
  const day = today();
  if (emailSent.day !== day) Object.assign(emailSent, { day, all: 0, byIp: new Map() });
  if (emailSent.all >= EMAIL_PER_DAY) return 'site';
  if ((emailSent.byIp.get(ip) || 0) >= EMAIL_PER_IP_DAY) return 'ip';
  return '';
}
function emailCounted(ip) {
  emailSent.all++;
  emailSent.byIp.set(ip, (emailSent.byIp.get(ip) || 0) + 1);
}
// { to, subject, text, html } -> resolves to Resend's id (or 'outbox')
function resendEmail(mail) {
  const body = { from: EMAIL_FROM, to: [mail.to], subject: mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 200), text: mail.text, ...(mail.html ? { html: mail.html } : {}) };
  if (EMAIL_OUTBOX) {
    return new Promise((resolve, reject) => fs.appendFile(EMAIL_OUTBOX, JSON.stringify(body) + '\n', (e) => (e ? reject(e) : resolve('outbox'))));
  }
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = require('https').request('https://api.resend.com/emails', {
      method: 'POST', timeout: 15000,
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': data.length, 'User-Agent': 'OmniBeam' },
    }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(out); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300 && j.id) return resolve(j.id);
        reject(new Error(`Resend ${res.statusCode}: ${String(j.message || j.name || out).slice(0, 200)}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Resend did not answer')));
    req.on('error', reject);
    req.end(data);
  });
}
const sizeText = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// The email with a shared link, in the sender's language
function linkEmail(d, { to, key, lang, name, names, tz }) {
  const L = LANGS[lang] ? lang : 'en';
  const url = `${SITE_URL}/d/${d.id}#${key}`;
  let until;
  try {
    until = new Date(d.expires).toLocaleString(L === 'ar' ? 'ar-EG' : L, { dateStyle: 'medium', timeStyle: 'short', ...(tz ? { timeZone: tz } : { timeZone: 'UTC', timeZoneName: 'short' }) });
  } catch { until = new Date(d.expires).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
  const what = `${names} · ${sizeText(d.size)}`;
  const lines = [trFor(L, '{name} sent you files with OmniBeam:', { name }), url, '', what, trFor(L, 'The link works until {date}.', { date: until })];
  if (d.pinHash) lines.push(trFor(L, 'You also need a PIN to open it. {name} will tell you the PIN separately.', { name }));
  const foot = trFor(L, 'You got this email because someone typed your address in OmniBeam. Nothing is attached: the files stay encrypted until you open the link.');
  lines.push('', '—', foot);
  const e = (s) => encodeHtml(String(s));
  const dir = LANGS[L].dir || 'ltr';
  const html = `<!doctype html><html lang="${L}" dir="${dir}"><body style="margin:0;padding:24px;background:#eef0f5;font-family:Arial,Helvetica,sans-serif;color:#1d2030">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
<p style="font-size:20px;font-weight:bold;margin:0 0 16px">Omni<span style="color:#6c5ce7">Beam</span></p>
<p style="font-size:16px;margin:0 0 12px">${e(trFor(L, '{name} sent you files with OmniBeam:', { name }))}</p>
<p style="font-size:15px;margin:0 0 20px"><b>${e(what)}</b></p>
<p style="margin:0 0 20px"><a href="${e(url)}" style="display:inline-block;background:#6c5ce7;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold">${e(trFor(L, 'Download the files'))}</a></p>
<p style="font-size:14px;color:#555;margin:0 0 8px">${e(trFor(L, 'The link works until {date}.', { date: until }))}</p>
${d.pinHash ? `<p style="font-size:14px;color:#555;margin:0 0 8px">${e(trFor(L, 'You also need a PIN to open it. {name} will tell you the PIN separately.', { name }))}</p>` : ''}
<p style="font-size:12px;color:#888;margin:20px 0 0;word-break:break-all">${e(url)}</p>
<p style="font-size:12px;color:#888;margin:12px 0 0">${e(foot)}</p>
</div></body></html>`;
  return { to, subject: trFor(L, 'Files for you: {names}', { names }), text: lines.join('\n'), html };
}

// ---------- Weekly summary ----------
// Once a week (Monday 9:00 in WEEKLY_TZ by default) the last 7 days from /stats go to Telegram (the same bot as the
// alerts, ALERT_TELEGRAM_TOKEN) and by email to ALERT_EMAIL (through Resend if RESEND_API_KEY is set, otherwise the
// host's sendmail), compared with the 7 days before. "Send the weekly summary now" on /stats sends one at once.
// Optional: WEEKLY=false (off), WEEKLY_TO=telegram or email (only one of them), WEEKLY_DAY=1 (0 Sunday … 6 Saturday),
// WEEKLY_HOUR=9, WEEKLY_TZ=Asia/Amman.
const WEEKLY = process.env.WEEKLY !== 'false';
const WEEKLY_TO = (process.env.WEEKLY_TO || 'both').trim().toLowerCase();
const WEEKLY_DAY = Math.min(6, Math.max(0, Number(process.env.WEEKLY_DAY ?? 1) || 0));
const WEEKLY_HOUR = Math.min(23, Math.max(0, Number(process.env.WEEKLY_HOUR ?? 9) || 0));
const WEEKLY_TZ = (() => {
  const tz = (process.env.WEEKLY_TZ || 'Asia/Amman').trim();
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { console.warn(`WEEKLY_TZ "${tz}" is not a time zone; using UTC`); return 'UTC'; }
})();
// Weekday, hour and date where the summary is sent
function weeklyClock(at = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: WEEKLY_TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
}
const weeklyChannels = () => [
  (WEEKLY_TO === 'both' || WEEKLY_TO === 'telegram') && ALERT_TELEGRAM_TOKEN ? 'telegram' : '',
  (WEEKLY_TO === 'both' || WEEKLY_TO === 'email') && ALERT_EMAIL && (EMAIL_ON || SENDMAIL || process.env.ALERT_OUTBOX) ? 'email' : '',
].filter(Boolean);
// Totals for the 7 UTC days ending yesterday (end = days back), and the week before
function weekTotals(endDaysBack = 1) {
  const keys = [];
  for (let i = endDaysBack; i < endDaysBack + 7; i++) keys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const sum = {};
  for (const k of keys) for (const [f, n] of Object.entries(stats.days[k] || {})) if (typeof n === 'number') sum[f] = (sum[f] || 0) + n;
  return { from: keys[keys.length - 1], to: keys[0], sum };
}
function weeklySummary() {
  const w = weekTotals(1).sum;
  const prev = weekTotals(8).sum;
  const { from, to } = weekTotals(1);
  const n = (x) => Math.round(x || 0).toLocaleString('en-US');
  const change = (f) => {
    const a = w[f] || 0;
    const b = prev[f] || 0;
    if (!b) return a ? ' (new)' : '';
    const pct = Math.round(((a - b) / b) * 100);
    return pct ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ' (same)';
  };
  const top = (prefix, k = 3) => Object.entries(w).filter(([f]) => f.startsWith(prefix)).map(([f, v]) => [f.slice(prefix.length), v])
    .sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, v]) => `${name || '?'} ${n(v)}`).join(', ');
  const done = w.transfers || 0;
  const failed = w.tfail || 0;
  const rate = done + failed ? `${Math.round((done / (done + failed)) * 100)}%` : '–';
  const weekErrors = errors.filter((e) => e.t >= Date.parse(from + 'T00:00:00Z') && e.t < Date.parse(to + 'T00:00:00Z') + 864e5).length;
  const lines = [
    `Visitors: ${n(w.visitors)}${change('visitors')} · page views ${n(w.views)}${change('views')}`,
    `Transfers: ${n(done)}${change('transfers')} · ${n(w.files)} files · ${sizeText(w.bytes || 0)}`,
    `Worked: ${rate} of sends (${n(failed)} stopped early)`,
    `Links: ${n(w.links)} made${change('links')} · ${n(w.linkDownloads)} downloads · ${n(w.emailsSent)} emailed`,
    `Clipboard: ${n(w.clipResend)} sent again from history · Auto-send folder: ${n(w.autoSend)} files · Big files: ${n(w.bigFiles)}`,
    `Problem reports: ${n(weekErrors)}`,
  ];
  const countries = top('uc_');
  const pagesTop = top('vp_');
  const sources = top('us_');
  if (countries) lines.push(`Top countries: ${countries}`);
  if (pagesTop) lines.push(`Top pages: ${pagesTop}`);
  if (sources) lines.push(`Top sources: ${sources}`);
  return { subject: `OmniBeam weekly: ${n(w.visitors)} visitors, ${n(done)} transfers (${from} to ${to})`, text: `${lines.join('\n')}\n\nDetails: ${SITE_URL}/admin` };
}
async function sendWeekly() {
  const { subject, text } = weeklySummary();
  const sent = [];
  const failed = [];
  const channels = weeklyChannels();
  if (channels.includes('telegram')) {
    try { await sendTelegram(`${subject}\n\n${text}`); sent.push('telegram'); } catch (err) { failed.push('telegram: ' + err.message); }
  }
  if (channels.includes('email')) {
    try {
      if (EMAIL_ON) await resendEmail({ to: ALERT_EMAIL, subject, text });
      else await sendEmail(subject, text);
      sent.push('email');
    } catch (err) { failed.push('email: ' + err.message); }
  }
  if (!channels.length) failed.push('no channel is set up (ALERT_TELEGRAM_TOKEN, or ALERT_EMAIL with RESEND_API_KEY or sendmail)');
  alertState.weeklyError = failed.join('; ').slice(0, 300);
  if (sent.length) alertState.weeklySent = Date.now();
  saveAlertState();
  if (failed.length) console.error('Weekly summary not sent:', alertState.weeklyError);
  return { sent, error: alertState.weeklyError };
}
function checkWeekly() {
  if (!WEEKLY || !weeklyChannels().length) return;
  const c = weeklyClock();
  // Once per week: on the day, from the hour on (a restart later that day still sends it, but never twice)
  if (c.day !== WEEKLY_DAY || c.hour < WEEKLY_HOUR || alertState.weekly === c.date) return;
  alertState.weekly = c.date;
  saveAlertState();
  sendWeekly();
}
function weeklyInfo() {
  return { on: WEEKLY, channels: weeklyChannels(), day: WEEKLY_DAY, hour: WEEKLY_HOUR, tz: WEEKLY_TZ, last: alertState.weeklySent || 0, error: alertState.weeklyError || '', resend: !!RESEND_API_KEY };
}
// "Send the weekly summary now" on /stats
function handleWeeklyTest(req, res) {
  if (req.method !== 'POST') { req.resume(); res.writeHead(405); return res.end(); }
  const json = statsAuth(req, res);
  if (!json) return;
  sendWeekly().then((result) => json(200, { ...result, weekly: weeklyInfo(), preview: weeklySummary() }));
}

// ---------- Status (the admin panel's Status tab; /status sends there) ----------
// "All systems working" or what isn't, uptime for the last 30 days and recent incidents, at /api/status for whoever
// knows STATS_KEY. Until 2026-11-12 this was also a public page at /status.
// Two sources:
// - The uptime Worker (tools/uptime-worker.js, Cloudflare, every 5 minutes from outside) POSTs its results to
//   /api/status/checks with the shared secret STATUS_KEY (the same value in cPanel and as a Worker secret). Checks
//   made while the site was down are kept by the Worker and sent when it is back, so outages show up here too.
// - The server's own checks, every 5 minutes: TURN logins (direct connections), the storage for links, the Telegram
//   bot. Until the Worker sends anything, uptime is the share of the server's own checks that passed.
// data/status.json: { days: { 'YYYY-MM-DD': { n, ok, ms, self, selfOk } }, incidents: [{ part, start, end }],
//   workerLast, workerFails, firstFail, parts: { part: ok } }
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const STATUS_KEY = (process.env.STATUS_KEY || '').trim();
const STATUS_DAYS = 30;
const STATUS_EVERY = (Number(process.env.STATUS_EVERY_MIN) || 5) * 60 * 1000;
let statusData = { days: {}, incidents: [], workerLast: 0, workerFails: 0, firstFail: 0, parts: {} };
try { statusData = { ...statusData, ...JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')) }; } catch {}
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
function saveStatus() {
  const keep = utcDay(Date.now() - (STATUS_DAYS + 1) * 86400000);
  for (const d of Object.keys(statusData.days)) if (d < keep) delete statusData.days[d];
  statusData.incidents = statusData.incidents.filter((i) => !i.end || i.end > Date.now() - (STATUS_DAYS + 1) * 86400000).slice(-100);
  fs.writeFile(STATUS_FILE, JSON.stringify(statusData), () => {});
}
const statusDay = (t) => (statusData.days[utcDay(t)] ||= { n: 0, ok: 0, ms: 0, self: 0, selfOk: 0 });
// An incident starts when a part stops working and ends when it works again
function statusPart(part, ok, at = Date.now()) {
  if (ok === null || ok === undefined) { delete statusData.parts[part]; return; }
  statusData.parts[part] = ok;
  const open = statusData.incidents.find((i) => i.part === part && !i.end);
  if (!ok && !open) statusData.incidents.push({ part, start: at, end: 0 });
  if (ok && open) open.end = at;
}
// The parts the server can check itself (not set up here: not shown)
async function statusSelfCheck() {
  const parts = {};
  if (turnProvider()) {
    if (Date.now() - turnState.at > 30 * 60 * 1000) await iceServers().catch(() => {});
    parts.turn = turnState.ok !== false;
  }
  if (DROPS) {
    let writable = true;
    try { fs.writeFileSync(path.join(DATA_DIR, '.status-check'), String(Date.now())); } catch { writable = false; }
    parts.links = writable && dropBytes < DROP_TOTAL_MB * 1024 * 1024 * 0.95;
  }
  if (tgOn()) parts.telegram = tgState.ok !== false;
  for (const part of ['turn', 'links', 'telegram']) statusPart(part, parts[part] ?? null);
  const day = statusDay(Date.now());
  day.self++;
  if (Object.values(parts).every(Boolean)) day.selfOk++;
  saveStatus();
}
// The uptime Worker's results: [{ at, ok, ms, status, error }], oldest first; ones already known are skipped
function statusWorkerChecks(list) {
  const now = Date.now();
  let added = 0;
  for (const c of list.filter((x) => x && Number.isFinite(Number(x.at))).sort((a, b) => a.at - b.at).slice(-5000)) {
    const at = Number(c.at);
    if (at <= statusData.workerLast || at > now + 60000 || at < now - STATUS_DAYS * 86400000) continue;
    statusData.workerLast = at;
    const day = statusDay(at);
    day.n++;
    added++;
    if (c.ok === true) {
      day.ok++;
      day.ms += Math.min(60000, Math.max(0, Number(c.ms) || 0));
      statusData.workerFails = 0;
      statusData.firstFail = 0;
      statusPart('web', true, at);
    } else {
      statusData.workerFails++;
      statusData.firstFail ||= at;
      // Two failed checks in a row (as for the Worker's own alert): the site was down from the first one
      if (statusData.workerFails >= 2) statusPart('web', false, statusData.firstFail);
    }
  }
  if (added) saveStatus();
  return added;
}
function statusSummary() {
  const now = Date.now();
  // Without recent outside checks the website part is "working": this very page was just served
  const workerOn = now - statusData.workerLast < 20 * 60 * 1000;
  const parts = { web: workerOn ? statusData.parts.web !== false : true };
  for (const [k, v] of Object.entries(statusData.parts)) if (k !== 'web') parts[k] = v;
  const days = [];
  let n = 0, ok = 0, self = 0, selfOk = 0;
  for (let i = STATUS_DAYS - 1; i >= 0; i--) {
    const date = utcDay(now - i * 86400000);
    const d = statusData.days[date] || { n: 0, ok: 0, self: 0, selfOk: 0 };
    n += d.n; ok += d.ok; self += d.self; selfOk += d.selfOk;
    days.push({ date, pct: d.n ? (100 * d.ok) / d.n : d.self ? (100 * d.selfOk) / d.self : null, outside: !!d.n });
  }
  return {
    ok: Object.values(parts).every(Boolean), parts, days,
    uptime: n ? (100 * ok) / n : self ? (100 * selfOk) / self : null, outside: n > 0,
    incidents: statusData.incidents.slice().reverse().slice(0, 15).map((i) => ({ part: i.part, start: i.start, end: i.end || null })),
    lastOutsideCheck: statusData.workerLast || null, updated: now,
  };
}
function handleStatusApi(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  // The numbers are for the owner only (the admin panel's Status tab sends STATS_KEY)
  if (urlPath === '/api/status') { const ok = statsAuth(req, res); if (ok) ok(200, statusSummary()); return; }
  // The uptime Worker sends its checks (Authorization: Bearer <STATUS_KEY>)
  if (req.method !== 'POST') { req.resume(); return json(405, { error: 'method' }); }
  if (!STATUS_KEY) { req.resume(); return json(404, { error: 'off' }); }
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!samePassword(tokenHashOf(auth), tokenHashOf(STATUS_KEY))) { req.resume(); return json(403, { error: 'forbidden' }); }
  readJsonBody(req, 1024 * 1024).then((body) => {
    json(200, { ok: true, added: statusWorkerChecks(Array.isArray(body.checks) ? body.checks : []) });
  }).catch(() => json(400, { error: 'bad request' }));
}
// ---------- Names ----------
const ADJECTIVES = ['Red', 'Blue', 'Green', 'Golden', 'Silver', 'Purple', 'Orange', 'Pink', 'Teal', 'Amber',
  'Swift', 'Calm', 'Brave', 'Clever', 'Happy', 'Lucky', 'Quiet', 'Sunny', 'Witty', 'Cosmic'];
const ANIMALS = ['Fox', 'Panda', 'Tiger', 'Otter', 'Koala', 'Falcon', 'Dolphin', 'Wolf', 'Owl', 'Lynx',
  'Penguin', 'Rabbit', 'Hawk', 'Bear', 'Moose', 'Gecko', 'Llama', 'Raven', 'Seal', 'Zebra'];
const pick = (arr) => arr[crypto.randomInt(arr.length)];
const randomName = () => `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;

// ---------- Rooms ----------
// Each client is in its network room (by public IP) and optionally in code rooms (paired devices).
const clients = new Map(); // id -> { ws, id, name, device, rooms:Set }
const rooms = new Map();   // roomName -> Set<id>
// Public rooms with a password: room -> hash of the password. Browsers send SHA-256("omnibeam-room:<code>:<password>"),
// never the password itself. Set by whoever opens the empty room, forgotten when the last device leaves.
const roomPasswords = new Map();
const samePassword = (a, b) => typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function getIp(req) {
  // Behind Cloudflare, CF-Connecting-IP is the visitor's own address
  const forwarded = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  let ip = (forwarded || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  // In production the app sits behind the host's proxy; without a forwarded IP we can't tell
  // visitors apart, so don't lump them together - each one gets its own room (pairing still works).
  if (process.env.NODE_ENV === 'production' && !forwarded) return 'unknown:' + crypto.randomUUID();
  // Devices on a private/local network all share one room when the server runs on the LAN.
  if (ip === '::1' || ip === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fe80:|fc|fd)/i.test(ip)) {
    return 'lan';
  }
  // IPv6: every device on a home network gets its own address, but they share the first 64 bits
  if (ip.includes(':')) return ipv6Prefix64(ip);
  return ip;
}

// The visitor's public address, or null when it's unknown or a private (LAN) address
function publicIp(req) {
  const forwarded = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  const ip = (forwarded || (process.env.NODE_ENV === 'production' ? '' : req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
  if (!ip || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fc|fd)/i.test(ip)) return null;
  return /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}

function ipv6Prefix64(ip) {
  const [head, tail = ''] = ip.split('%')[0].split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map((x) => parseInt(x || '0', 16).toString(16)).join(':') + '::/64';
}

// Relayed file data waits here when the receiving device reads slower than the sender sends (a phone on mobile data,
// or one whose screen just turned off). Above RELAY_HIGH, this server stops reading from the sender until the receiver
// has caught up, so TCP slows the sender down instead of this server holding the whole file in memory. Not for longer
// than RELAY_MAX_PAUSE: a receiver that stopped reading altogether is dropped by the regular ping check.
const RELAY_HIGH = 8 * 1024 * 1024;
const RELAY_MAX_PAUSE = 20000;
function relayBackpressure(from, to) {
  if (to.bufferedAmount < RELAY_HIGH || from.relayPaused || !from._socket || typeof from._socket.pause !== 'function') return;
  from.relayPaused = true;
  from._socket.pause();
  const since = Date.now();
  const timer = setInterval(() => {
    if (to.readyState === to.OPEN && to.bufferedAmount > RELAY_HIGH / 2 && Date.now() - since < RELAY_MAX_PAUSE && from.readyState === from.OPEN) return;
    clearInterval(timer);
    from.relayPaused = false;
    from.isAlive = true; // its answers to the ping check waited too
    try { from._socket.resume(); } catch {}
  }, 25);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN && !ws.muted) ws.send(JSON.stringify(msg));
}

// sameNet: both devices reach the server from the same network (same Wi-Fi), so a direct connection should be
// possible. The app uses it to explain slow "internet" routes between them.
// avatar: the picture the device chose (one of AVATARS). teams: the team rooms both are in (the start of each room's
// id), so the app can show the team's name on the card.
function peerInfo(c, viewer) {
  const info = { id: c.id, name: c.name, device: c.device, sameNet: !!viewer && c.networkRoom === viewer.networkRoom && !c.networkRoom.startsWith('ip:unknown:') };
  if (c.avatar) info.avatar = c.avatar;
  if (c.supporter) info.supporter = true;
  if (viewer) {
    const teams = [...c.rooms].filter((r) => r.startsWith('team:') && viewer.rooms.has(r)).map((r) => r.slice(5, 21));
    if (teams.length) info.teams = teams;
  }
  return info;
}
// Devices that already saw each other and now share a team room too (or no longer do): update their cards
function teamChanged(client, room, ids) {
  if (!room.startsWith('team:')) return;
  for (const id of ids) {
    const other = clients.get(id);
    if (!other) continue;
    send(other.ws, { type: 'peer-updated', peer: peerInfo(client, other) });
    send(client.ws, { type: 'peer-updated', peer: peerInfo(other, client) });
  }
}

// All peers visible to a client = union of everyone in its rooms
function visiblePeers(client) {
  const ids = new Set();
  for (const r of client.rooms) for (const id of rooms.get(r) || []) if (id !== client.id) ids.add(id);
  return ids;
}

function joinRoom(client, room) {
  if (client.rooms.has(room)) return;
  const before = visiblePeers(client);
  client.rooms.add(room);
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(client.id);
  const after = visiblePeers(client);
  for (const id of after) {
    if (before.has(id)) continue;
    const other = clients.get(id);
    send(other.ws, { type: 'peer-joined', peer: peerInfo(client, other) });
  }
  send(client.ws, { type: 'peers', peers: [...after].map((id) => peerInfo(clients.get(id), client)) });
  teamChanged(client, room, [...rooms.get(room)].filter((id) => id !== client.id && before.has(id)));
}

function leaveRoom(client, room) {
  if (!client.rooms.has(room)) return;
  const before = visiblePeers(client);
  client.rooms.delete(room);
  const set = rooms.get(room);
  set.delete(client.id);
  if (set.size === 0) {
    rooms.delete(room);
    roomPasswords.delete(room);
  }
  const after = visiblePeers(client);
  teamChanged(client, room, [...set].filter((id) => after.has(id)));
  for (const id of before) {
    if (after.has(id)) continue;
    const other = clients.get(id);
    if (other) {
      send(other.ws, { type: 'peer-left', id: client.id });
      send(client.ws, { type: 'peer-left', id });
    }
  }
}

const cleanName = (n) => String(n || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 40);
// The pictures a device can choose (same list as AVATARS in app.js); anything else is dropped
const AVATARS = ['😀', '😎', '🤓', '🥳', '🤖', '👻', '👽', '🐱', '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🐧', '🦉', '🐙', '🦄',
  '🐝', '🌵', '🌻', '🍀', '🍉', '🍕', '⭐', '🔥', '⚡', '🌈', '🎧', '🎮', '🎸', '🚀', '🏠', '💼', '🎨', '📷', '⚽', '💻'];
// Extra pictures for supporters (Settings -> Supporter): only passed on for a device whose code the server checked
const SUPPORTER_AVATARS = ['🦋', '🐳', '🦖', '🐲', '🦩', '🦚', '🌸', '🌙', '💎', '👑', '🎃', '🧸', '🍩', '🧁', '🏆', '🛸', '🪐', '🎯', '🧩', '🌊'];
const cleanAvatar = (a, client) => (AVATARS.includes(a) || (client && client.supporter && SUPPORTER_AVATARS.includes(a)) ? a : '');
// Team rooms: a fixed link for a family or office. Each device may be in a few; each room holds up to MAX_TEAM_ROOM.
const MAX_TEAMS = 5;
const MAX_TEAM_ROOM = 50;
const secretRoom = (secret) => 'secret:' + crypto.createHash('sha256').update(secret).digest('hex');

function leaveAll(client) {
  for (const room of [...client.rooms]) leaveRoom(client, room);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

function onConnection(ws, req) {
  const networkRoom = 'ip:' + getIp(req);
  const client = { ws, id: crypto.randomUUID(), name: randomName(), device: 'Unknown device', rooms: new Set(), networkRoom, statAt: 0 };
  // Browser and system ("Safari · iOS") for the transfer success counts on the stats page; no version, nothing stored per device
  const ua = uaInfo(req.headers['user-agent']);
  client.browser = `${ua.browser.replace(/ \d+$/, '')} · ${ua.os}`;
  clients.set(client.id, client);
  ws.isAlive = true;

  // Short, non-reversible network ID so users can check two devices are on the same network
  const networkId = networkRoom.startsWith('ip:unknown:')
    ? null
    : crypto.createHash('sha256').update(networkRoom).digest('hex').slice(0, 4).toUpperCase();
  // ip: this device's public address as the server sees it. The connection check compares it with the address
  // WebRTC finds, to spot a VPN or proxy that sends the page and the transfers different ways.
  send(ws, { type: 'hello', id: client.id, name: client.name, networkId, build: BUILD, ip: publicIp(req) });

  ws.on('pong', () => (ws.isAlive = !ws.muted));

  ws.on('message', (raw, isBinary) => {
    if (ws.muted) return;
    // Binary frames are relayed file chunks: [36-byte target id][data] -> [36-byte sender id][data]
    if (isBinary) {
      if (!RELAY || raw.length < 36) return;
      const to = raw.subarray(0, 36).toString('latin1');
      const target = clients.get(to);
      if (!target || !visiblePeers(client).has(to) || target.ws.readyState !== target.ws.OPEN || target.ws.muted) return;
      raw.write(client.id, 0, 36, 'latin1');
      target.ws.send(raw, { binary: true });
      count('relayBytes', raw.length - 36);
      relayBackpressure(ws, target.ws);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'intro':
        // tab: a random key a browser tab keeps across reconnects and reloads. When a phone sleeps or changes
        // network, its old connection can linger here for up to 30 s before the ping notices; without this, the
        // tab would see that dead connection as another device with its own name ("I see myself").
        if (typeof msg.tab === 'string' && /^[0-9a-f]{32}$/.test(msg.tab)) {
          for (const old of clients.values()) {
            if (old === client || old.tab !== msg.tab) continue;
            send(old.ws, { type: 'replaced' });
            leaveAll(old);
            clients.delete(old.id);
            // 4001 tells a tab that is still alive (a duplicated tab) to take a new key; a polling tab gets
            // the 'replaced' message on its next poll instead
            if (old.ws instanceof PollSocket) setTimeout(() => old.ws.terminate(), 3000);
            else old.ws.close(4001, 'replaced');
          }
          client.tab = msg.tab;
        }
        client.device = String(msg.device || '').slice(0, 60) || 'Unknown device';
        if (cleanName(msg.name)) client.name = cleanName(msg.name);
        // A supporter code (Settings): checked here, so other devices can trust the ♥ on its card
        if (msg.supporter) {
          client.supporter = checkSupporterCode(msg.supporter) || '';
          client.supporterTries = 1;
          send(ws, { type: 'supporter', ok: !!client.supporter, ...(SUPPORTER_KEY ? {} : { off: true }) });
        }
        client.avatar = cleanAvatar(msg.avatar, client);
        send(ws, { type: 'name', name: client.name });
        joinRoom(client, networkRoom);
        count('connections');
        countNetwork(networkRoom);
        break;
      case 'ping':
        // A phone back from a locked screen checks that this connection still works (see checkSocketAlive in app.js)
        send(ws, { type: 'pong' });
        break;
      case 'rename': {
        // A new name (random: a new random one) and/or picture
        const name = msg.random === true ? randomName() : cleanName(msg.name);
        if (!name && !('avatar' in msg)) return;
        if (name) client.name = name;
        if ('avatar' in msg) client.avatar = cleanAvatar(msg.avatar, client);
        for (const id of visiblePeers(client)) send(clients.get(id).ws, { type: 'peer-updated', peer: peerInfo(client, clients.get(id)) });
        send(ws, { type: 'name', name: client.name });
        break;
      }
      case 'supporter': {
        // A code typed in Settings (already checked through /api/supporter) or removed (code: ''). A few tries per
        // connection: codes are guessed through the rate-limited /api/supporter, not here.
        if ((client.supporterTries = (client.supporterTries || 0) + 1) > 5) return;
        const was = client.supporter || '';
        client.supporter = msg.code ? checkSupporterCode(msg.code) || '' : '';
        if (!client.supporter && SUPPORTER_AVATARS.includes(client.avatar)) client.avatar = '';
        send(ws, { type: 'supporter', ok: !!client.supporter, ...(SUPPORTER_KEY ? {} : { off: true }) });
        if (was !== client.supporter) for (const id of visiblePeers(client)) send(clients.get(id).ws, { type: 'peer-updated', peer: peerInfo(client, clients.get(id)) });
        break;
      }
      case 'join-team': {
        // Team rooms: the app sends a hash of the team link's secret (never the secret itself)
        const ids = Array.isArray(msg.ids) ? msg.ids.slice(0, MAX_TEAMS) : [];
        for (const id of ids) {
          if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) continue;
          const room = 'team:' + id;
          if (client.rooms.has(room)) continue;
          if ([...client.rooms].filter((r) => r.startsWith('team:')).length >= MAX_TEAMS) { send(ws, { type: 'team-error', reason: 'too-many' }); break; }
          if ((rooms.get(room) || new Set()).size >= MAX_TEAM_ROOM) { send(ws, { type: 'team-error', reason: 'full' }); continue; }
          if (!rooms.has(room)) count('teamRooms'); // a team room opened (first device in it today or since a restart)
          joinRoom(client, room);
        }
        break;
      }
      case 'leave-team':
        if (typeof msg.id === 'string' && /^[0-9a-f]{64}$/.test(msg.id)) leaveRoom(client, 'team:' + msg.id);
        break;
      case 'join-secrets': {
        // Remembered pairings: long random secrets shared by two devices
        const secrets = Array.isArray(msg.secrets) ? msg.secrets : [];
        for (const sec of secrets) {
          if (typeof sec !== 'string' || !/^[0-9a-f]{64}$/.test(sec)) continue;
          if ([...client.rooms].filter((r) => r.startsWith('secret:')).length >= MAX_SECRET_ROOMS) break;
          joinRoom(client, secretRoom(sec));
        }
        break;
      }
      case 'leave-secret':
        if (typeof msg.secret === 'string' && /^[0-9a-f]{64}$/.test(msg.secret)) leaveRoom(client, secretRoom(msg.secret));
        break;
      case 'relay': {
        if (!RELAY || !visiblePeers(client).has(msg.to)) return;
        const target = clients.get(msg.to);
        if (target) send(target.ws, { type: 'relay', from: client.id, data: String(msg.data).slice(0, 1e6) });
        break;
      }
      case 'join-code': {
        const code = String(msg.code || '').replace(/\D/g, '').slice(0, 6);
        if (code.length !== 6) return;
        if (client.rooms.has('code:' + code)) return send(ws, { type: 'joined-code', code });
        if (!allowCodeAttempt(networkRoom)) {
          return send(ws, { type: 'code-error', reason: 'Too many pairing attempts. Wait a few minutes and try again.' });
        }
        if ((rooms.get('code:' + code) || new Set()).size >= 2) {
          return send(ws, { type: 'code-error', reason: 'That code is already in use by two devices. Create a new code.' });
        }
        for (const r of [...client.rooms]) if (r.startsWith('code:')) leaveRoom(client, r);
        joinRoom(client, 'code:' + code);
        send(ws, { type: 'joined-code', code });
        // Tell both sides exactly who they met through the code (they may already see each other via Wi-Fi)
        for (const id of rooms.get('code:' + code)) {
          if (id === client.id) continue;
          send(ws, { type: 'code-partner', id });
          send(clients.get(id).ws, { type: 'code-partner', id: client.id });
        }
        break;
      }
      case 'join-public': {
        // Public rooms: a 5-letter code that any number of devices can join, on any network, until they leave
        const code = String(msg.code || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
        if (code.length !== 5) return;
        const room = 'public:' + code;
        const pass = typeof msg.pass === 'string' && /^[0-9a-f]{64}$/.test(msg.pass) ? msg.pass : null;
        if (client.rooms.has(room)) return send(ws, { type: 'joined-public', code, locked: roomPasswords.has(room) });
        const members = rooms.get(room) || new Set();
        // Only joining an empty room counts as an attempt, so guessing codes is limited but rejoining isn't
        if (members.size === 0 && !allowCodeAttempt(networkRoom + ':public')) {
          return send(ws, { type: 'public-error', reason: 'too-many' });
        }
        if (members.size > 0 && roomPasswords.has(room) && !samePassword(roomPasswords.get(room), pass)) {
          // Wrong or missing password: limited like pairing codes, so passwords can't be guessed quickly
          if (pass && !allowCodeAttempt(networkRoom + ':password')) return send(ws, { type: 'public-error', reason: 'too-many', code });
          return send(ws, { type: 'public-error', reason: pass ? 'wrong-password' : 'password', code });
        }
        if (members.size >= MAX_PUBLIC_ROOM) return send(ws, { type: 'public-error', reason: 'full' });
        for (const r of [...client.rooms]) if (r.startsWith('public:')) leaveRoom(client, r);
        if (members.size === 0) {
          if (pass) roomPasswords.set(room, pass);
          else roomPasswords.delete(room);
        }
        joinRoom(client, room);
        send(ws, { type: 'joined-public', code, locked: roomPasswords.has(room) });
        break;
      }
      case 'leave-public':
        for (const r of [...client.rooms]) if (r.startsWith('public:')) leaveRoom(client, r);
        send(ws, { type: 'left-public' });
        break;
      case 'leave-code':
        for (const r of [...client.rooms]) if (r.startsWith('code:')) leaveRoom(client, r);
        send(ws, { type: 'left-code' });
        break;
      case 'stat': {
        // A finished (or failed) transfer, reported by the sending device: which way it went, and how much.
        // 'none' only for a failed send that never connected.
        // Small counts with no transfer attached: the rating/share prompt after sends (shown / rate / share / no),
        // the rest of a dropped send going to another device, a link sent on to an email address or phone
        if (['ask', 'handoff', 'sendto', 'again', 'export', 'gallery', 'team', 'cliphist', 'autosend', 'bigfile', 'photo', 'voice', 'screen', 'preview', 'scan', 'chat', 'ring', 'link', 'sendall', 'invite', 'pin', 'video', 'lock', 'clean', 'backup', 'restore', 'nreply', 'fshare', 'fbrowse', 'fget'].includes(msg.kind)) {
          client.extraStats = (client.extraStats || 0) + 1;
          if (client.extraStats > 30) return;
          if (msg.kind === 'handoff') count('thandoff');
          else if (msg.kind === 'sendto') count('linkSendTo');
          else if (msg.kind === 'again') count('sendAgain');
          else if (msg.kind === 'export') count('histExport');
          else if (msg.kind === 'gallery') count('galleryOpen');
          else if (msg.kind === 'team') count('teamNew');
          else if (msg.kind === 'cliphist') count('clipResend');
          else if (msg.kind === 'autosend') count('autoSend', Math.min(50, Math.max(1, Math.floor(Number(msg.n)) || 1)));
          else if (msg.kind === 'bigfile') count('bigFiles');
          // Taking a photo, a voice note, sharing a screen, previewing a received file (media.js)
          else if (msg.kind === 'photo') count('photosTaken');
          else if (msg.kind === 'voice') count('voiceNotes');
          else if (msg.kind === 'screen') count('screenShares');
          else if (msg.kind === 'preview') count('previews');
          // Scan to PDF (scan.js) and opening a device's chat (chat.js)
          else if (msg.kind === 'scan') count('scans');
          else if (msg.kind === 'chat') count('chatOpen');
          // Ring my device, a link opened from another device, Send to all my devices, Invite card, pinned notes
          else if (msg.kind === 'ring') count('rings');
          else if (msg.kind === 'link') count('linksOpened');
          else if (msg.kind === 'sendall') count('sendAll');
          else if (msg.kind === 'invite') count('inviteCards');
          else if (msg.kind === 'pin') count('pins');
          // A video made smaller before sending (and how many bytes that saved), App lock / Auto-clean turned on
          else if (msg.kind === 'video') { count('videoShrunk'); count('videoSaved', Math.min(4e10, Math.max(0, Math.floor(Number(msg.saved)) || 0))); }
          else if (msg.kind === 'lock') count('lockOn');
          else if (msg.kind === 'clean') count('cleanOn');
          // Move to a new phone (backup file saved / opened), a quick reply typed in a notification
          else if (msg.kind === 'backup') count('backupsSaved');
          else if (msg.kind === 'restore') count('backupsOpened');
          else if (msg.kind === 'nreply') count('notifReplies');
          // Browse my computer: a folder shared, another device looking in it, a file taken from it (browse.js)
          else if (msg.kind === 'fshare') count('folderShares');
          else if (msg.kind === 'fbrowse') count('folderBrowse');
          else if (msg.kind === 'fget') count('folderGets', Math.min(100, Math.max(1, Math.floor(Number(msg.n)) || 1)));
          else if (['shown', 'rate', 'share', 'no'].includes(msg.act)) count('ask_' + msg.act);
          break;
        }
        const route = ['lan', 'internet', 'turn', 'relay'].includes(msg.route) || (msg.route === 'none' && msg.kind === 'fail') ? msg.route : null;
        const bytes = Math.floor(Number(msg.bytes));
        const files = Math.floor(Number(msg.files));
        if (!route || !(bytes >= 0 && bytes < 1e13) || !(files >= 0 && files <= 100000) || Date.now() - client.statAt < 300) return;
        client.statAt = Date.now();
        if (msg.kind === 'text') { count('texts'); break; }
        if (msg.kind === 'secret') { count('secretNotes'); break; }
        // Which browsers took part (this device and the other one), for success rates by browser
        const other = clients.get(String(msg.peer || ''));
        const browsers = new Set([client.browser, other && other.browser].filter(Boolean));
        if (msg.kind === 'fail') {
          // A send that stopped before the end. cancel: someone pressed Stop; lost: the connection or the other
          // device went away (it may continue by itself later); error: anything else (saving failed, …)
          const why = ['cancel', 'lost', 'error'].includes(msg.why) ? msg.why : 'error';
          if (why === 'cancel') { count('tcancel'); break; }
          count('tfail');
          count('tf_' + route);
          count('tw_' + why);
          for (const b of browsers) count('bf_' + b);
          break;
        }
        if (msg.kind === 'speed') {
          // A speed test from the Connection check: how many, and the speeds (in KB/s, summed) by route
          const kbs = Math.floor(Number(msg.rate) / 1024);
          if (!(kbs >= 0 && kbs < 1e7)) return;
          count('speeds');
          count('sp_' + route);
          count('spk_' + route, kbs);
          break;
        }
        count('transfers');
        count('t_' + route);
        if (msg.resumed) count('tresumed'); // finished by itself after the connection dropped (AutoResume)
        for (const b of browsers) count('bo_' + b);
        count('files', files);
        count('bytes', bytes);
        count('b_' + route, bytes);
        break;
      }
      case 'push-sub':
      case 'push-unsub':
      case 'push-wake':
        onPushMessage(client, msg);
        break;
      case 'join-inbox':
        joinInbox(client, msg.key);
        break;
      case 'watch-requests':
        if (REQUESTS) watchRequests(client, msg.items);
        break;
      case 'leave-inbox':
        leaveInbox(client);
        client.inbox = null;
        break;
      case 'signal': {
        // Only relay to peers that can actually see this client
        if (!visiblePeers(client).has(msg.to)) return;
        const target = clients.get(msg.to);
        if (target) send(target.ws, { type: 'signal', from: client.id, data: msg.data });
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveInbox(client);
    unwatchRequests(client);
    leaveAll(client);
    clients.delete(client.id);
  });
}
wss.on('connection', onConnection);

// Drop dead connections
setInterval(() => {
  for (const [key, list] of codeAttempts) if (!list.some((t) => Date.now() - t < CODE_WINDOW)) codeAttempts.delete(key);
  for (const map of [pushAttempts, inboxUploads]) for (const [key, list] of map) if (!list.some((t) => Date.now() - t < 3600 * 1000)) map.delete(key);
  for (const [key, list] of reportAttempts) if (!list.some((t) => Date.now() - t < CODE_WINDOW)) reportAttempts.delete(key);
  for (const sock of pollSessions.values()) {
    if (!sock.waiter && Date.now() - sock.lastPoll > 40000) sock.terminate();
  }
  for (const ws of wss.clients) {
    if (ws.relayPaused) continue; // not reading from it on purpose (see relayBackpressure)
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Shared links: pick up the ones from before a restart, and delete expired ones every few minutes
loadDrops();
setInterval(cleanDrops, 5 * 60 * 1000).unref();
cleanDrops();
// Request links: the same, after the shared links (their files are kept with them)
loadRequests();
setInterval(cleanRequests, 5 * 60 * 1000).unref();
cleanRequests();
// Event albums: the same
loadAlbums();
setInterval(cleanAlbums, 5 * 60 * 1000).unref();
cleanAlbums();
// Shortcut inbox and notifications: same, and the list of devices to notify is saved every minute
loadInbox();
setInterval(cleanInbox, 5 * 60 * 1000).unref();
loadPushKeys();
setInterval(savePush, 60 * 1000).unref();
// Statistics are written every 5 minutes and when the app is stopped (cPanel Restart, deploy)
setInterval(saveStats, 5 * 60 * 1000).unref();
// The status page's own checks (TURN, link storage, Telegram bot), every 5 minutes and once soon after a start
setInterval(() => statusSelfCheck().catch((err) => console.error('Status check failed', err.message)), STATUS_EVERY).unref();
setTimeout(() => statusSelfCheck().catch(() => {}), Math.min(30000, STATUS_EVERY)).unref();
// The weekly summary: checked every 10 minutes (and once shortly after a start)
setInterval(checkWeekly, 10 * 60 * 1000).unref();
setTimeout(checkWeekly, 60 * 1000).unref();
setInterval(() => {
  sweepVisits();
  const now = Date.now();
  for (const [ip, a] of visitAttempts) if (now - a.start > CODE_WINDOW) visitAttempts.delete(ip);
}, 60 * 1000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { sweepVisits(true); saveStats(); savePush(); process.exit(0); });
process.on('exit', () => { saveStats(); savePush(); });

minifyAll();
// Build the home pages and info pages before the first visitor arrives, so no request waits for them
for (const [i, lang] of ['en', ...PAGE_LANGS].entries()) {
  try {
    const html = Buffer.from(home(lang));
    const key = 'index.html:' + crypto.createHash('sha1').update(html).digest('base64url').slice(0, 20);
    gzipCache.set(key, zlib.gzipSync(html, { level: 9 }));
    setTimeout(() => { if (!brCache.has(key)) brCache.set(key, brotli(html)); }, 2000 + i * 400).unref();
  } catch (err) {
    console.error('Rendering the home page failed', err);
  }
}
for (const key of pages.keys()) {
  try {
    const html = pageHtml(key);
    gzipCache.set('page.html:' + crypto.createHash('sha1').update(html).digest('base64url').slice(0, 20), zlib.gzipSync(html, { level: 9 }));
  } catch (err) {
    console.error('Rendering page', key, 'failed', err);
  }
}

server.listen(PORT, () => {
  console.log(`OmniBeam running on http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  On your network: http://${n.address}:${PORT}`);
    }
  }
});

// ---------- Telegram bot (TG_BOT_TOKEN) ----------
// A device links itself to the bot once (Settings → Telegram → Link Telegram: a one-time code in a t.me link). Then:
// - files, photos, videos, voice notes and text sent to the bot in Telegram arrive on that device, through a request
//   link of its own (the same storage and pickup as Request files). The server downloads the file from Telegram and
//   seals it to the device's public key (an "x1" box, see put.js), so the copy waiting on the server can only be opened
//   by the device. It is not end-to-end encrypted: Telegram and, while passing through, this server see the file.
// - files sent from OmniBeam to "Telegram" are passed on to the chat with the bot (not stored, not end-to-end either).
// Telegram's limits for bots: they can download files up to 20 MB and upload files up to 50 MB.
// Off unless TG_BOT_TOKEN is set (a bot from @BotFather). TG_BOT_USE_ALERT_TOKEN=true uses the alert bot's token
// (ALERT_TELEGRAM_TOKEN) instead; then set ALERT_TELEGRAM_CHAT too, because a bot with a webhook can't look up chats.
// The webhook is https://<site>/api/tg/<secret path from the token>, with Telegram's secret_token header; the server
// sets it itself at every start (TG_WEBHOOK=off to set it by hand; the path is printed then).
// data/telegram.json: { links: { <chat id>: { req, pub, device, lang, at, name } } }
const TG_TOKEN = ((process.env.TG_BOT_TOKEN || '').trim() || (process.env.TG_BOT_USE_ALERT_TOKEN === 'true' ? ALERT_TELEGRAM_TOKEN : '')).replace(/^bot/i, '');
const TG_API = (process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
let TG_BOT_NAME = (process.env.TG_BOT_NAME || 'OmniBeam_bot').replace(/^@/, '').trim(); // until getMe answers (tgBotName)
const TG_DOWN_MB = 20;
const TG_UP_MB = 50;
const TG_FILE = path.join(DATA_DIR, 'telegram.json');
const TG_PATH = TG_TOKEN ? crypto.createHash('sha256').update('omnibeam-tg-path:' + TG_TOKEN).digest('hex').slice(0, 32) : '';
const TG_HEADER = TG_TOKEN ? crypto.createHash('sha256').update('omnibeam-tg-header:' + TG_TOKEN).digest('hex').slice(0, 48) : '';
const TG_PER_HOUR = 30; // files or messages per chat each way
const tgState = { ok: null, error: '', at: 0 };
const tgOn = () => !!TG_TOKEN && REQUESTS;
const tgCodes = new Map(); // one-time code -> { req, pub, device, lang, exp }
const tgAttempts = new Map(); // chat / request id / network -> recent times
let tgData = { links: {} };
try { tgData = { links: {}, ...JSON.parse(fs.readFileSync(TG_FILE, 'utf8')) }; } catch {}
const saveTg = () => fs.writeFile(TG_FILE, JSON.stringify(tgData), () => {});
const tgLinkOf = (reqId) => Object.entries(tgData.links).find(([, l]) => l.req === reqId) || null;
const TG_TEXT = {
  en: {
    welcome: 'Hi! I pass files between Telegram and OmniBeam.\n\nTo start, open omnibeam.site on your phone or computer → ⋯ → Settings → Telegram → Link Telegram, and tap the link it shows.',
    linked: '✅ Linked to {device}.\n\nSend me files, photos, videos or text and they arrive in OmniBeam on {device}. Files you send from OmniBeam to Telegram arrive here.\n\nLimits from Telegram: files up to 20 MB to me, up to 50 MB from OmniBeam. Files that go through Telegram are not end-to-end encrypted. /unlink stops it.',
    badCode: 'That link has expired or was already used. Make a new one in OmniBeam: Settings → Telegram → Link Telegram.',
    notLinked: 'This chat is not linked to a device yet. In OmniBeam: ⋯ → Settings → Telegram → Link Telegram.',
    sent: '✓ Sent to {device}.',
    waiting: '✓ Saved for {device}: it arrives when OmniBeam opens there.',
    tooBig: 'This file is {size}. Telegram only lets bots receive files up to 20 MB. Send bigger files with OmniBeam directly: https://omnibeam.site',
    failed: 'Sorry, this could not be passed on to OmniBeam. Try again in a minute.',
    tooMany: 'That is a lot at once. Wait a few minutes and send the rest.',
    unlinked: 'Unlinked. Nothing more goes between this chat and {device}.',
    unsupported: 'I can pass on files, photos, videos, voice notes and text.',
    status: 'This chat is linked to {device}.',
    fromOmni: 'From OmniBeam ({device})',
  },
  ar: {
    welcome: 'مرحبًا! أنقل الملفات بين تيليجرام وOmniBeam.\n\nللبدء، افتح omnibeam.site على هاتفك أو حاسوبك ← ⋯ ← الإعدادات ← تيليجرام ← ربط تيليجرام، ثم اضغط الرابط الذي يظهر.',
    linked: '✅ تم الربط مع {device}.\n\nأرسل لي ملفات أو صورًا أو فيديوهات أو نصوصًا وستصل إلى OmniBeam على {device}. والملفات التي ترسلها من OmniBeam إلى تيليجرام تصل إلى هنا.\n\nحدود تيليجرام: حتى 20 ميغابايت للملفات المرسلة إليّ، وحتى 50 ميغابايت من OmniBeam. الملفات التي تمر عبر تيليجرام ليست مشفّرة من طرف إلى طرف. ‎/unlink يوقف الربط.',
    badCode: 'انتهت صلاحية هذا الرابط أو استُخدم من قبل. أنشئ رابطًا جديدًا في OmniBeam: الإعدادات ← تيليجرام ← ربط تيليجرام.',
    notLinked: 'هذه المحادثة غير مربوطة بجهاز بعد. في OmniBeam: ⋯ ← الإعدادات ← تيليجرام ← ربط تيليجرام.',
    sent: '✓ أُرسل إلى {device}.',
    waiting: '✓ حُفظ لـ {device}: سيصل عند فتح OmniBeam هناك.',
    tooBig: 'حجم هذا الملف {size}. يسمح تيليجرام للبوتات باستلام ملفات حتى 20 ميغابايت فقط. أرسل الملفات الأكبر عبر OmniBeam مباشرة: https://omnibeam.site/ar/',
    failed: 'عذرًا، تعذّر تمرير هذا إلى OmniBeam. حاول بعد دقيقة.',
    tooMany: 'هذا كثير دفعة واحدة. انتظر بضع دقائق ثم أرسل الباقي.',
    unlinked: 'تم إلغاء الربط. لن يمر شيء بعد الآن بين هذه المحادثة و{device}.',
    unsupported: 'يمكنني تمرير الملفات والصور والفيديوهات والرسائل الصوتية والنصوص.',
    status: 'هذه المحادثة مربوطة بـ {device}.',
    fromOmni: 'من OmniBeam ({device})',
  },
  fr: {
    welcome: 'Bonjour ! Je fais passer des fichiers entre Telegram et OmniBeam.\n\nPour commencer, ouvrez omnibeam.site sur votre téléphone ou ordinateur → ⋯ → Réglages → Telegram → Associer Telegram, puis touchez le lien affiché.',
    linked: '✅ Associé à {device}.\n\nEnvoyez-moi des fichiers, photos, vidéos ou textes : ils arrivent dans OmniBeam sur {device}. Les fichiers envoyés d\'OmniBeam vers Telegram arrivent ici.\n\nLimites de Telegram : jusqu\'à 20 Mo vers moi, jusqu\'à 50 Mo depuis OmniBeam. Les fichiers qui passent par Telegram ne sont pas chiffrés de bout en bout. /unlink arrête l\'association.',
    badCode: 'Ce lien a expiré ou a déjà servi. Créez-en un nouveau dans OmniBeam : Réglages → Telegram → Associer Telegram.',
    notLinked: 'Cette conversation n\'est encore associée à aucun appareil. Dans OmniBeam : ⋯ → Réglages → Telegram → Associer Telegram.',
    sent: '✓ Envoyé à {device}.',
    waiting: '✓ Gardé pour {device} : il arrivera à l\'ouverture d\'OmniBeam.',
    tooBig: 'Ce fichier fait {size}. Telegram ne laisse les bots recevoir que des fichiers de 20 Mo au plus. Envoyez les plus gros directement avec OmniBeam : https://omnibeam.site/fr/',
    failed: 'Désolé, impossible de transmettre ceci à OmniBeam. Réessayez dans une minute.',
    tooMany: 'Cela fait beaucoup d\'un coup. Attendez quelques minutes avant d\'envoyer la suite.',
    unlinked: 'Association supprimée. Plus rien ne passe entre cette conversation et {device}.',
    unsupported: 'Je peux transmettre des fichiers, photos, vidéos, messages vocaux et textes.',
    status: 'Cette conversation est associée à {device}.',
    fromOmni: 'Depuis OmniBeam ({device})',
  },
  es: {
    welcome: '¡Hola! Paso archivos entre Telegram y OmniBeam.\n\nPara empezar, abre omnibeam.site en tu teléfono u ordenador → ⋯ → Ajustes → Telegram → Vincular Telegram y toca el enlace que aparece.',
    linked: '✅ Vinculado con {device}.\n\nEnvíame archivos, fotos, vídeos o texto y llegarán a OmniBeam en {device}. Los archivos que envíes desde OmniBeam a Telegram llegan aquí.\n\nLímites de Telegram: hasta 20 MB hacia mí, hasta 50 MB desde OmniBeam. Los archivos que pasan por Telegram no tienen cifrado de extremo a extremo. /unlink lo desvincula.',
    badCode: 'Ese enlace caducó o ya se usó. Crea uno nuevo en OmniBeam: Ajustes → Telegram → Vincular Telegram.',
    notLinked: 'Este chat aún no está vinculado a ningún dispositivo. En OmniBeam: ⋯ → Ajustes → Telegram → Vincular Telegram.',
    sent: '✓ Enviado a {device}.',
    waiting: '✓ Guardado para {device}: llegará cuando se abra OmniBeam allí.',
    tooBig: 'Este archivo ocupa {size}. Telegram solo deja a los bots recibir archivos de hasta 20 MB. Envía los más grandes directamente con OmniBeam: https://omnibeam.site/es/',
    failed: 'Lo siento, no se pudo pasar esto a OmniBeam. Vuelve a intentarlo en un minuto.',
    tooMany: 'Es mucho de golpe. Espera unos minutos y envía el resto.',
    unlinked: 'Desvinculado. Ya no pasa nada entre este chat y {device}.',
    unsupported: 'Puedo pasar archivos, fotos, vídeos, notas de voz y texto.',
    status: 'Este chat está vinculado con {device}.',
    fromOmni: 'Desde OmniBeam ({device})',
  },
  tr: {
    welcome: 'Merhaba! Telegram ile OmniBeam arasında dosya aktarırım.\n\nBaşlamak için telefonunuzda veya bilgisayarınızda omnibeam.site adresini açın → ⋯ → Ayarlar → Telegram → Telegram\'ı bağla, ardından gösterilen bağlantıya dokunun.',
    linked: '✅ {device} ile bağlandı.\n\nBana dosya, fotoğraf, video veya metin gönderin; {device} üzerindeki OmniBeam\'e gelir. OmniBeam\'den Telegram\'a gönderdiğiniz dosyalar buraya gelir.\n\nTelegram sınırları: bana en fazla 20 MB, OmniBeam\'den en fazla 50 MB. Telegram üzerinden geçen dosyalar uçtan uca şifreli değildir. /unlink bağlantıyı kaldırır.',
    badCode: 'Bu bağlantının süresi dolmuş ya da kullanılmış. OmniBeam\'de yenisini oluşturun: Ayarlar → Telegram → Telegram\'ı bağla.',
    notLinked: 'Bu sohbet henüz bir cihaza bağlı değil. OmniBeam\'de: ⋯ → Ayarlar → Telegram → Telegram\'ı bağla.',
    sent: '✓ {device} cihazına gönderildi.',
    waiting: '✓ {device} için saklandı: orada OmniBeam açılınca gelir.',
    tooBig: 'Bu dosya {size}. Telegram, botların yalnızca 20 MB\'a kadar dosya almasına izin verir. Daha büyük dosyaları doğrudan OmniBeam ile gönderin: https://omnibeam.site/tr/',
    failed: 'Üzgünüm, bu OmniBeam\'e aktarılamadı. Bir dakika sonra tekrar deneyin.',
    tooMany: 'Bir seferde çok fazla. Birkaç dakika bekleyip gerisini gönderin.',
    unlinked: 'Bağlantı kaldırıldı. Bu sohbet ile {device} arasında artık hiçbir şey geçmez.',
    unsupported: 'Dosya, fotoğraf, video, sesli mesaj ve metin aktarabilirim.',
    status: 'Bu sohbet {device} ile bağlı.',
    fromOmni: 'OmniBeam\'den ({device})',
  },
  de: {
    welcome: 'Hallo! Ich bringe Dateien zwischen Telegram und OmniBeam hin und her.\n\nÖffne zum Start omnibeam.site auf deinem Handy oder Computer → ⋯ → Einstellungen → Telegram → Telegram verbinden und tippe auf den angezeigten Link.',
    linked: '✅ Mit {device} verbunden.\n\nSchick mir Dateien, Fotos, Videos oder Text, und sie kommen in OmniBeam auf {device} an. Dateien, die du aus OmniBeam an Telegram sendest, kommen hier an.\n\nGrenzen von Telegram: bis 20 MB an mich, bis 50 MB aus OmniBeam. Dateien über Telegram sind nicht Ende-zu-Ende-verschlüsselt. /unlink trennt die Verbindung.',
    badCode: 'Dieser Link ist abgelaufen oder wurde schon benutzt. Erstelle in OmniBeam einen neuen: Einstellungen → Telegram → Telegram verbinden.',
    notLinked: 'Dieser Chat ist noch mit keinem Gerät verbunden. In OmniBeam: ⋯ → Einstellungen → Telegram → Telegram verbinden.',
    sent: '✓ An {device} gesendet.',
    waiting: '✓ Für {device} gespeichert: kommt an, sobald OmniBeam dort geöffnet wird.',
    tooBig: 'Diese Datei ist {size} groß. Telegram lässt Bots nur Dateien bis 20 MB empfangen. Größere Dateien sendest du direkt mit OmniBeam: https://omnibeam.site/de/',
    failed: 'Das konnte leider nicht an OmniBeam weitergegeben werden. Versuch es in einer Minute noch einmal.',
    tooMany: 'Das ist viel auf einmal. Warte ein paar Minuten und schick dann den Rest.',
    unlinked: 'Verbindung getrennt. Zwischen diesem Chat und {device} geht nichts mehr hin und her.',
    unsupported: 'Ich kann Dateien, Fotos, Videos, Sprachnachrichten und Text weitergeben.',
    status: 'Dieser Chat ist mit {device} verbunden.',
    fromOmni: 'Aus OmniBeam ({device})',
  },
  pt: {
    welcome: 'Olá! Eu passo arquivos entre o Telegram e o OmniBeam.\n\nPara começar, abra omnibeam.site no celular ou computador → ⋯ → Configurações → Telegram → Conectar o Telegram e toque no link que aparecer.',
    linked: '✅ Conectado a {device}.\n\nEnvie-me arquivos, fotos, vídeos ou texto e eles chegam ao OmniBeam em {device}. Os arquivos que você enviar do OmniBeam para o Telegram chegam aqui.\n\nLimites do Telegram: até 20 MB para mim, até 50 MB a partir do OmniBeam. Arquivos que passam pelo Telegram não têm criptografia de ponta a ponta. /unlink desfaz a conexão.',
    badCode: 'Esse link expirou ou já foi usado. Crie um novo no OmniBeam: Configurações → Telegram → Conectar o Telegram.',
    notLinked: 'Esta conversa ainda não está conectada a nenhum aparelho. No OmniBeam: ⋯ → Configurações → Telegram → Conectar o Telegram.',
    sent: '✓ Enviado para {device}.',
    waiting: '✓ Guardado para {device}: chega quando o OmniBeam for aberto lá.',
    tooBig: 'Este arquivo tem {size}. O Telegram só deixa bots receberem arquivos de até 20 MB. Envie os maiores direto pelo OmniBeam: https://omnibeam.site/pt/',
    failed: 'Desculpe, não foi possível passar isto para o OmniBeam. Tente de novo em um minuto.',
    tooMany: 'É muita coisa de uma vez. Espere alguns minutos e envie o resto.',
    unlinked: 'Conexão desfeita. Nada mais passa entre esta conversa e {device}.',
    unsupported: 'Posso passar arquivos, fotos, vídeos, mensagens de voz e texto.',
    status: 'Esta conversa está conectada a {device}.',
    fromOmni: 'Do OmniBeam ({device})',
  },
  hi: {
    welcome: 'नमस्ते! मैं Telegram और OmniBeam के बीच फ़ाइलें पहुँचाता हूँ।\n\nशुरू करने के लिए अपने फ़ोन या कंप्यूटर पर omnibeam.site खोलें → ⋯ → सेटिंग → Telegram → Telegram जोड़ें, और दिखने वाले लिंक पर टैप करें।',
    linked: '✅ {device} से जुड़ गया।\n\nमुझे फ़ाइलें, फ़ोटो, वीडियो या टेक्स्ट भेजें, वे {device} पर OmniBeam में पहुँचेंगे। OmniBeam से Telegram पर भेजी गई फ़ाइलें यहाँ आती हैं।\n\nTelegram की सीमाएँ: मुझे 20 MB तक, OmniBeam से 50 MB तक। Telegram से होकर जाने वाली फ़ाइलें एंड-टू-एंड एन्क्रिप्टेड नहीं होतीं। /unlink से जोड़ हट जाता है।',
    badCode: 'यह लिंक खत्म हो गया है या पहले ही इस्तेमाल हो चुका है। OmniBeam में नया बनाएँ: सेटिंग → Telegram → Telegram जोड़ें।',
    notLinked: 'यह चैट अभी किसी डिवाइस से नहीं जुड़ी है। OmniBeam में: ⋯ → सेटिंग → Telegram → Telegram जोड़ें।',
    sent: '✓ {device} को भेज दिया।',
    waiting: '✓ {device} के लिए रख लिया: वहाँ OmniBeam खुलते ही पहुँचेगा।',
    tooBig: 'यह फ़ाइल {size} की है। Telegram बॉट को सिर्फ़ 20 MB तक की फ़ाइलें लेने देता है। बड़ी फ़ाइलें सीधे OmniBeam से भेजें: https://omnibeam.site/hi/',
    failed: 'माफ़ करें, इसे OmniBeam तक नहीं पहुँचाया जा सका। एक मिनट बाद फिर कोशिश करें।',
    tooMany: 'एक साथ बहुत ज़्यादा है। कुछ मिनट रुककर बाकी भेजें।',
    unlinked: 'जोड़ हटा दिया। अब इस चैट और {device} के बीच कुछ नहीं जाएगा।',
    unsupported: 'मैं फ़ाइलें, फ़ोटो, वीडियो, वॉइस नोट और टेक्स्ट पहुँचा सकता हूँ।',
    status: 'यह चैट {device} से जुड़ी है।',
    fromOmni: 'OmniBeam से ({device})',
  },
  id: {
    welcome: 'Halo! Saya meneruskan file antara Telegram dan OmniBeam.\n\nUntuk mulai, buka omnibeam.site di ponsel atau komputer Anda → ⋯ → Pengaturan → Telegram → Hubungkan Telegram, lalu ketuk tautan yang muncul.',
    linked: '✅ Terhubung ke {device}.\n\nKirimi saya file, foto, video, atau teks dan semuanya tiba di OmniBeam pada {device}. File yang Anda kirim dari OmniBeam ke Telegram tiba di sini.\n\nBatas dari Telegram: hingga 20 MB ke saya, hingga 50 MB dari OmniBeam. File yang lewat Telegram tidak terenkripsi end-to-end. /unlink memutuskan hubungan.',
    badCode: 'Tautan itu sudah kedaluwarsa atau sudah dipakai. Buat yang baru di OmniBeam: Pengaturan → Telegram → Hubungkan Telegram.',
    notLinked: 'Chat ini belum terhubung ke perangkat mana pun. Di OmniBeam: ⋯ → Pengaturan → Telegram → Hubungkan Telegram.',
    sent: '✓ Terkirim ke {device}.',
    waiting: '✓ Disimpan untuk {device}: akan tiba saat OmniBeam dibuka di sana.',
    tooBig: 'File ini berukuran {size}. Telegram hanya mengizinkan bot menerima file hingga 20 MB. Kirim file yang lebih besar langsung dengan OmniBeam: https://omnibeam.site/id/',
    failed: 'Maaf, ini tidak bisa diteruskan ke OmniBeam. Coba lagi dalam satu menit.',
    tooMany: 'Terlalu banyak sekaligus. Tunggu beberapa menit, lalu kirim sisanya.',
    unlinked: 'Hubungan diputus. Tidak ada lagi yang lewat antara chat ini dan {device}.',
    unsupported: 'Saya bisa meneruskan file, foto, video, pesan suara, dan teks.',
    status: 'Chat ini terhubung ke {device}.',
    fromOmni: 'Dari OmniBeam ({device})',
  },
  ru: {
    welcome: 'Привет! Я передаю файлы между Telegram и OmniBeam.\n\nЧтобы начать, откройте omnibeam.site на телефоне или компьютере → ⋯ → Настройки → Telegram → «Связать Telegram» и нажмите на показанную ссылку.',
    linked: '✅ Связано с {device}.\n\nОтправляйте мне файлы, фото, видео или текст, и они придут в OmniBeam на {device}. Файлы, которые вы отправите из OmniBeam в Telegram, придут сюда.\n\nОграничения Telegram: до 20 МБ мне, до 50 МБ из OmniBeam. Файлы через Telegram не защищены сквозным шифрованием. /unlink отключает связь.',
    badCode: 'Эта ссылка устарела или уже использована. Создайте новую в OmniBeam: Настройки → Telegram → «Связать Telegram».',
    notLinked: 'Этот чат ещё не связан с устройством. В OmniBeam: ⋯ → Настройки → Telegram → «Связать Telegram».',
    sent: '✓ Отправлено на {device}.',
    waiting: '✓ Сохранено для {device}: придёт, когда там откроется OmniBeam.',
    tooBig: 'Размер этого файла — {size}. Telegram позволяет ботам получать файлы только до 20 МБ. Большие файлы отправляйте прямо через OmniBeam: https://omnibeam.site/ru/',
    failed: 'Извините, не удалось передать это в OmniBeam. Попробуйте через минуту.',
    tooMany: 'Слишком много за раз. Подождите несколько минут и отправьте остальное.',
    unlinked: 'Связь отключена. Между этим чатом и {device} больше ничего не передаётся.',
    unsupported: 'Я могу передавать файлы, фото, видео, голосовые сообщения и текст.',
    status: 'Этот чат связан с {device}.',
    fromOmni: 'Из OmniBeam ({device})',
  },
  ja: {
    welcome: 'こんにちは!TelegramとOmniBeamの間でファイルをやり取りします。\n\n始めるには、スマホかパソコンでomnibeam.siteを開き → ⋯ → 設定 → Telegram → Telegramと連携 を選んで、表示されたリンクをタップしてください。',
    linked: '✅ {device} と連携しました。\n\nファイル、写真、動画、テキストを送ると、{device} のOmniBeamに届きます。OmniBeamからTelegramに送ったファイルはここに届きます。\n\nTelegramの制限:こちらへは20 MBまで、OmniBeamからは50 MBまで。Telegramを通るファイルはエンドツーエンド暗号化されません。/unlink で連携を解除できます。',
    badCode: 'このリンクは期限切れか、すでに使われています。OmniBeamで新しく作ってください:設定 → Telegram → Telegramと連携。',
    notLinked: 'このチャットはまだデバイスと連携していません。OmniBeamで:⋯ → 設定 → Telegram → Telegramと連携。',
    sent: '✓ {device} に送信しました。',
    waiting: '✓ {device} 用に保存しました:そちらでOmniBeamが開くと届きます。',
    tooBig: 'このファイルは {size} です。Telegramではボットが受け取れるのは20 MBまでです。大きなファイルはOmniBeamから直接送ってください:https://omnibeam.site/ja/',
    failed: '申し訳ありません、OmniBeamに渡せませんでした。1分後にもう一度お試しください。',
    tooMany: '一度に多すぎます。数分待ってから残りを送ってください。',
    unlinked: '連携を解除しました。このチャットと {device} の間では何もやり取りされません。',
    unsupported: 'ファイル、写真、動画、ボイスメッセージ、テキストを渡せます。',
    status: 'このチャットは {device} と連携しています。',
    fromOmni: 'OmniBeamから({device})',
  },
  zh: {
    welcome: '你好！我在 Telegram 和 OmniBeam 之间传送文件。\n\n开始使用：在手机或电脑上打开 omnibeam.site → ⋯ → 设置 → Telegram → 关联 Telegram，然后点按显示的链接。',
    linked: '✅ 已关联 {device}。\n\n把文件、照片、视频或文字发给我，它们会出现在 {device} 上的 OmniBeam 中。你从 OmniBeam 发到 Telegram 的文件会出现在这里。\n\nTelegram 的限制：发给我最大 20 MB，从 OmniBeam 发出最大 50 MB。经过 Telegram 的文件不是端到端加密的。/unlink 可以取消关联。',
    badCode: '此链接已过期或已被使用。请在 OmniBeam 中新建一个：设置 → Telegram → 关联 Telegram。',
    notLinked: '这个聊天还没有关联设备。在 OmniBeam 中：⋯ → 设置 → Telegram → 关联 Telegram。',
    sent: '✓ 已发送到 {device}。',
    waiting: '✓ 已为 {device} 保存：那边打开 OmniBeam 时就会收到。',
    tooBig: '这个文件有 {size}。Telegram 只允许机器人接收最大 20 MB 的文件。更大的文件请直接用 OmniBeam 发送：https://omnibeam.site/zh/',
    failed: '抱歉，无法把它转交给 OmniBeam。请一分钟后再试。',
    tooMany: '一次太多了。请等几分钟再发送剩下的。',
    unlinked: '已取消关联。这个聊天与 {device} 之间不再传送任何内容。',
    unsupported: '我可以转交文件、照片、视频、语音消息和文字。',
    status: '这个聊天已关联 {device}。',
    fromOmni: '来自 OmniBeam({device})',
  },
  ko: {
    welcome: '안녕하세요! Telegram과 OmniBeam 사이에서 파일을 전달합니다.\n\n시작하려면 휴대폰이나 컴퓨터에서 omnibeam.site를 열고 → ⋯ → 설정 → Telegram → Telegram 연결을 누른 뒤, 표시되는 링크를 탭하세요.',
    linked: '✅ {device}에 연결했습니다.\n\n파일, 사진, 동영상, 텍스트를 보내면 {device}의 OmniBeam에 도착합니다. OmniBeam에서 Telegram으로 보낸 파일은 여기로 옵니다.\n\nTelegram 제한: 저에게는 20MB까지, OmniBeam에서는 50MB까지. Telegram을 거치는 파일은 종단 간 암호화되지 않습니다. /unlink로 연결을 끊을 수 있습니다.',
    badCode: '이 링크는 만료되었거나 이미 사용되었습니다. OmniBeam에서 새로 만드세요: 설정 → Telegram → Telegram 연결.',
    notLinked: '이 채팅은 아직 기기와 연결되지 않았습니다. OmniBeam에서: ⋯ → 설정 → Telegram → Telegram 연결.',
    sent: '✓ {device}(으)로 보냈습니다.',
    waiting: '✓ {device}용으로 저장했습니다: 그 기기에서 OmniBeam이 열리면 도착합니다.',
    tooBig: '이 파일은 {size}입니다. Telegram은 봇이 20MB까지만 받을 수 있게 합니다. 더 큰 파일은 OmniBeam으로 직접 보내세요: https://omnibeam.site/ko/',
    failed: '죄송합니다. OmniBeam으로 전달할 수 없었습니다. 1분 뒤에 다시 시도하세요.',
    tooMany: '한 번에 너무 많습니다. 몇 분 기다린 뒤 나머지를 보내세요.',
    unlinked: '연결을 끊었습니다. 이제 이 채팅과 {device} 사이에는 아무것도 오가지 않습니다.',
    unsupported: '파일, 사진, 동영상, 음성 메시지, 텍스트를 전달할 수 있습니다.',
    status: '이 채팅은 {device}에 연결되어 있습니다.',
    fromOmni: 'OmniBeam에서({device})',
  },
  it: {
    welcome: 'Ciao! Passo i file tra Telegram e OmniBeam.\n\nPer iniziare, apri omnibeam.site sul telefono o sul computer → ⋯ → Impostazioni → Telegram → Collega Telegram, e tocca il link che compare.',
    linked: '✅ Collegato a {device}.\n\nMandami file, foto, video o testi e arriveranno in OmniBeam su {device}. I file che invii da OmniBeam a Telegram arrivano qui.\n\nLimiti di Telegram: fino a 20 MB verso di me, fino a 50 MB da OmniBeam. I file che passano da Telegram non sono crittografati end-to-end. /unlink interrompe il collegamento.',
    badCode: 'Questo link è scaduto o è già stato usato. Creane uno nuovo in OmniBeam: Impostazioni → Telegram → Collega Telegram.',
    notLinked: 'Questa chat non è ancora collegata a un dispositivo. In OmniBeam: ⋯ → Impostazioni → Telegram → Collega Telegram.',
    sent: '✓ Inviato a {device}.',
    waiting: '✓ Salvato per {device}: arriverà quando lì si apre OmniBeam.',
    tooBig: 'Questo file è di {size}. Telegram permette ai bot di ricevere solo file fino a 20 MB. Invia i file più grandi direttamente con OmniBeam: https://omnibeam.site/it/',
    failed: 'Spiacente, non è stato possibile passarlo a OmniBeam. Riprova tra un minuto.',
    tooMany: 'È tanto tutto insieme. Aspetta qualche minuto e invia il resto.',
    unlinked: 'Scollegato. Tra questa chat e {device} non passa più nulla.',
    unsupported: 'Posso passare file, foto, video, messaggi vocali e testi.',
    status: 'Questa chat è collegata a {device}.',
    fromOmni: 'Da OmniBeam ({device})',
  },
  ur: {
    welcome: 'سلام! میں Telegram اور OmniBeam کے درمیان فائلیں پہنچاتا ہوں۔\n\nشروع کرنے کے لیے اپنے فون یا کمپیوٹر پر omnibeam.site کھولیں ← ⋯ ← سیٹنگز ← Telegram ← Telegram جوڑیں، اور دکھائے گئے لنک پر ٹیپ کریں۔',
    linked: '✅ {device} سے جڑ گیا۔\n\nمجھے فائلیں، تصاویر، ویڈیوز یا متن بھیجیں، وہ {device} پر OmniBeam میں پہنچ جائیں گے۔ OmniBeam سے Telegram کو بھیجی گئی فائلیں یہاں آئیں گی۔\n\nTelegram کی حدیں: مجھے 20 MB تک، OmniBeam سے 50 MB تک۔ Telegram سے گزرنے والی فائلیں اینڈ ٹو اینڈ انکرپٹڈ نہیں ہوتیں۔ ‎/unlink سے جوڑ ختم ہوتا ہے۔',
    badCode: 'یہ لنک ختم ہو گیا ہے یا پہلے استعمال ہو چکا ہے۔ OmniBeam میں نیا بنائیں: سیٹنگز ← Telegram ← Telegram جوڑیں۔',
    notLinked: 'یہ چیٹ ابھی کسی ڈیوائس سے نہیں جڑی۔ OmniBeam میں: ⋯ ← سیٹنگز ← Telegram ← Telegram جوڑیں۔',
    sent: '✓ {device} کو بھیج دیا گیا۔',
    waiting: '✓ {device} کے لیے محفوظ: وہاں OmniBeam کھلتے ہی پہنچ جائے گا۔',
    tooBig: 'یہ فائل {size} کی ہے۔ Telegram بوٹس کو صرف 20 MB تک کی فائلیں لینے دیتا ہے۔ بڑی فائلیں سیدھا OmniBeam سے بھیجیں: https://omnibeam.site/ur/',
    failed: 'معذرت، یہ OmniBeam تک نہیں پہنچایا جا سکا۔ ایک منٹ بعد دوبارہ کوشش کریں۔',
    tooMany: 'ایک ساتھ بہت زیادہ ہے۔ چند منٹ انتظار کر کے باقی بھیجیں۔',
    unlinked: 'جوڑ ختم ہو گیا۔ اب اس چیٹ اور {device} کے درمیان کچھ نہیں جائے گا۔',
    unsupported: 'میں فائلیں، تصاویر، ویڈیوز، وائس نوٹس اور متن پہنچا سکتا ہوں۔',
    status: 'یہ چیٹ {device} سے جڑی ہوئی ہے۔',
    fromOmni: 'OmniBeam سے ({device})',
  },
};
const tgText = (lang, key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), (TG_TEXT[lang] && TG_TEXT[lang][key]) || TG_TEXT.en[key]);

// Telegram's Bot API: JSON in, JSON out (or a raw body for file uploads and downloads)
function tgRequest(url, { method = 'POST', body = null, headers = {}, raw = false, max = 60 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? require('https') : http;
    const req = lib.request(url, { method, timeout: 60000, headers: { ...(body ? { 'Content-Length': body.length } : {}), ...headers } }, (res) => {
      const parts = [];
      let len = 0;
      res.on('data', (d) => { len += d.length; if (len > max) req.destroy(new Error('too large')); else parts.push(d); });
      res.on('end', () => {
        const buf = Buffer.concat(parts);
        if (raw) return res.statusCode === 200 ? resolve(buf) : reject(new Error(`Telegram answered ${res.statusCode}`));
        let j = {};
        try { j = JSON.parse(buf.toString('utf8')); } catch {}
        j.ok ? resolve(j.result) : reject(Object.assign(new Error(j.description || `Telegram answered ${res.statusCode}`), { code: res.statusCode }));
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram did not answer')));
    req.on('error', reject);
    req.end(body || undefined);
  });
}
async function tg(method, params) {
  try {
    const out = await tgRequest(`${TG_API}/bot${TG_TOKEN}/${method}`, { body: Buffer.from(JSON.stringify(params || {})), headers: { 'Content-Type': 'application/json' } });
    Object.assign(tgState, { ok: true, error: '', at: Date.now() });
    return out;
  } catch (err) {
    // A wrong request (400/403: the user blocked the bot...) is not Telegram being down
    if (!err.code || err.code >= 500 || err.code === 401) Object.assign(tgState, { ok: false, error: err.message, at: Date.now() });
    throw err;
  }
}
const tgSay = (chat, text) => tg('sendMessage', { chat_id: chat, text, disable_web_page_preview: true }).catch((err) => console.error('Telegram bot: could not answer', err.message));
// A file into the chat: multipart/form-data, as sendDocument wants it
async function tgSendFile(chat, name, type, data, caption) {
  const boundary = 'omnibeam' + crypto.randomBytes(12).toString('hex');
  const clean = (s) => String(s).replace(/["\r\n\\]/g, '_');
  const field = (k, v) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const body = Buffer.concat([
    Buffer.from(field('chat_id', chat) + (caption ? field('caption', caption.slice(0, 1000)) : '')
      + `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${clean(name)}"\r\nContent-Type: ${clean(type || 'application/octet-stream')}\r\n\r\n`),
    data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  try {
    const out = await tgRequest(`${TG_API}/bot${TG_TOKEN}/sendDocument`, { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
    Object.assign(tgState, { ok: true, error: '', at: Date.now() });
    return out;
  } catch (err) {
    if (!err.code || err.code >= 500) Object.assign(tgState, { ok: false, error: err.message, at: Date.now() });
    throw err;
  }
}

// A box sealed to the device's public key (the "x1" format of put.js and request.js)
function sealX1(pubB64, obj) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const shared = ecdh.computeSecret(Buffer.from(pubB64, 'base64url'));
  const key = crypto.createHash('sha256').update(Buffer.concat([Buffer.from('omnibeam-x1:'), shared])).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj))), cipher.final(), cipher.getAuthTag()]);
  return `x1.${ecdh.getPublicKey(null, 'uncompressed').toString('base64url')}.${Buffer.concat([iv, ct]).toString('base64url')}`;
}
// Files (or a text) from Telegram onto the device's request link, as if they were uploaded on its upload page:
// encrypted in DROP_PART parts with a new key, that key sealed to the device. Returns true if a tab of it is open.
function tgStore(link, files, from, text) {
  const r = requests.get(link.req);
  if (!r) throw new Error('request link gone');
  const size = files.reduce((s, f) => s + f.data.length, 0);
  const reserved = encryptedSize(size);
  if (dropBytes + reserved > DROP_TOTAL_MB * 1024 * 1024) throw new Error('server full');
  const fileKey = crypto.randomBytes(16);
  const box = { v: 1, k: fileKey.toString('base64url'), from, files: files.map((f) => ({ name: f.name, size: f.data.length, type: f.type || '' })), ...(text !== undefined ? { text } : {}) };
  const all = Buffer.concat(files.map((f) => f.data));
  const parts = Math.max(1, Math.ceil(size / DROP_PART));
  const out = [];
  for (let n = 0; size && n < parts; n++) {
    const iv = Buffer.alloc(12);
    iv.writeUInt32BE(n, 8);
    const cipher = crypto.createCipheriv('aes-128-gcm', fileKey, iv);
    out.push(cipher.update(all.subarray(n * DROP_PART, Math.min(size, (n + 1) * DROP_PART))), cipher.final(), cipher.getAuthTag());
  }
  const now = Date.now();
  const d = {
    id: crypto.randomBytes(12).toString('base64url'), size, reserved, parts, got: parts, meta: sealX1(link.pub, box), once: true, max: 1,
    created: now, expires: now + DROP_MAX_HOURS * 3600 * 1000, touched: now, complete: true, downloads: 0,
    tokenHash: tokenHashOf(crypto.randomBytes(16).toString('hex')), pinHash: '', pinFails: 0, req: r.id, tg: true,
  };
  fs.writeFileSync(dropFile(d.id, 'bin'), Buffer.concat(out));
  drops.set(d.id, d);
  dropBytes += reserved;
  saveDrop(d);
  r.uploads++;
  saveRequest(r);
  count('telegramIn');
  const open = [...(reqWatchers.get(r.id) || [])].some((id) => clients.has(id));
  requestFileReady(d);
  return open;
}

// What Telegram sends to the webhook
async function tgUpdate(update) {
  const msg = update && (update.message || update.edited_message);
  if (!msg || !msg.chat || msg.chat.type !== 'private') return;
  const chat = String(msg.chat.id);
  const spoken = String(msg.from && msg.from.language_code || '').slice(0, 2);
  const lang = (tgData.links[chat] && tgData.links[chat].lang) || (TG_TEXT[spoken] ? spoken : 'en');
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const cmd = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(\S+))?/);
  if (cmd && cmd[1] === 'start') {
    const code = cmd[2] || '';
    const pending = tgCodes.get(code);
    if (!code) return tgSay(chat, tgText(lang, tgData.links[chat] ? 'status' : 'welcome', { device: tgData.links[chat]?.device || '' }));
    if (!pending || pending.exp < Date.now() || !requests.has(pending.req)) return tgSay(chat, tgText(lang, 'badCode'));
    tgCodes.delete(code);
    // One device per chat and one chat per device: an older pairing of either is replaced
    for (const [c, l] of Object.entries(tgData.links)) if (l.req === pending.req) delete tgData.links[c];
    tgData.links[chat] = { req: pending.req, pub: pending.pub, device: pending.device, lang: pending.lang, at: Date.now(), name: String(msg.from && msg.from.first_name || '').slice(0, 40) };
    saveTg();
    count('telegramLinks');
    return tgSay(chat, tgText(pending.lang, 'linked', { device: pending.device }));
  }
  const link = tgData.links[chat];
  if (cmd && cmd[1] === 'unlink') {
    if (!link) return tgSay(chat, tgText(lang, 'notLinked'));
    delete tgData.links[chat];
    saveTg();
    return tgSay(chat, tgText(lang, 'unlinked', { device: link.device }));
  }
  if (cmd && (cmd[1] === 'help' || cmd[1] === 'status')) return tgSay(chat, link ? tgText(lang, 'status', { device: link.device }) : tgText(lang, 'welcome'));
  if (!link) return tgSay(chat, tgText(lang, 'notLinked'));
  if (!requests.has(link.req)) { delete tgData.links[chat]; saveTg(); return tgSay(chat, tgText(lang, 'notLinked')); }
  if (!allowAttempt(tgAttempts, 'in:' + chat, TG_PER_HOUR, 3600 * 1000)) return tgSay(chat, tgText(lang, 'tooMany'));
  const from = String(msg.from && (msg.from.first_name || msg.from.username) || 'Telegram').slice(0, 40);
  // The file in the message: a document keeps its name; a photo comes in several sizes (the last is the largest)
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
  const media = msg.document || msg.video || msg.audio || msg.voice || msg.video_note || msg.animation || photo;
  try {
    let open;
    if (media) {
      if (media.file_size > TG_DOWN_MB * 1024 * 1024) return tgSay(chat, tgText(lang, 'tooBig', { size: `${(media.file_size / 1048576).toFixed(0)} MB` }));
      const info = await tg('getFile', { file_id: media.file_id });
      const data = await tgRequest(`${TG_API}/file/bot${TG_TOKEN}/${info.file_path}`, { method: 'GET', raw: true, max: TG_DOWN_MB * 1024 * 1024 + 1024 });
      const ext = (String(info.file_path || '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || (photo ? 'jpg' : 'bin');
      const stamp = new Date((msg.date || Date.now() / 1000) * 1000).toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
      const kind = photo ? 'Photo' : msg.voice ? 'Voice' : msg.video || msg.video_note ? 'Video' : 'File';
      const name = safeFileName(media.file_name || `${kind} ${stamp}.${ext}`);
      const type = media.mime_type || (photo ? 'image/jpeg' : '');
      open = tgStore(link, [{ name, type, data }], from);
      if (msg.caption) tgStore(link, [], from, String(msg.caption).slice(0, 4096));
    } else if (text) {
      open = tgStore(link, [], from, text.slice(0, 64 * 1024));
    } else return tgSay(chat, tgText(lang, 'unsupported'));
    return tgSay(chat, tgText(lang, open ? 'sent' : 'waiting', { device: link.device }));
  } catch (err) {
    console.error('Telegram bot: could not pass a message on', err.message);
    return tgSay(chat, tgText(lang, 'failed'));
  }
}
const safeFileName = (s) => String(s).replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').slice(0, 120) || 'file';

// For the device (Settings → Telegram); it proves it owns its request link with the link's token
function handleTelegram(req, res, urlPath) {
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(JSON.stringify(obj));
  };
  if (!tgOn()) { req.resume(); return json(404, { error: 'off' }); }
  // The webhook: only Telegram knows the path and the header (both made from the bot token)
  if (urlPath === `/api/tg/${TG_PATH}`) {
    if (req.method !== 'POST' || !samePassword(String(req.headers['x-telegram-bot-api-secret-token'] || ''), TG_HEADER)) { req.resume(); return json(403, { error: 'forbidden' }); }
    return readJsonBody(req, 1024 * 1024).then((update) => {
      json(200, { ok: true });
      tgUpdate(update).catch((err) => console.error('Telegram bot:', err.message));
    }).catch(() => json(400, { error: 'bad request' }));
  }
  const q = new URL(req.url, 'http://x').searchParams;
  const r = requests.get(String(q.get('id') || ''));
  if (!r || !reqOwner(req, r)) { req.resume(); return json(403, { error: 'forbidden' }); }
  const net = 'ip:' + getIp(req);
  const found = tgLinkOf(r.id);
  // A one-time code for the t.me link: { pub, device, lang } -> { code, url }
  if (urlPath === '/api/tg/pair' && req.method === 'POST') {
    return readJsonBody(req).then(async (body) => {
      const pub = String(body.pub || '');
      if (!/^[A-Za-z0-9_-]{87}$/.test(pub)) return json(400, { error: 'bad request' });
      if (!allowAttempt(tgAttempts, 'pair:' + net, 20, 3600 * 1000)) return json(429, { error: 'too-many' });
      for (const [c, p] of tgCodes) if (p.exp < Date.now() || p.req === r.id) tgCodes.delete(c);
      const name = await tgBotName();
      const code = crypto.randomBytes(12).toString('base64url');
      tgCodes.set(code, { req: r.id, pub, device: String(body.device || 'OmniBeam').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 40), lang: LANGS[body.lang] ? body.lang : 'en', exp: Date.now() + 15 * 60 * 1000 });
      json(200, { code, bot: name, url: `https://t.me/${name}?start=${code}` });
    }).catch(() => json(400, { error: 'bad request' }));
  }
  if (urlPath === '/api/tg/link' && req.method === 'GET') { req.resume(); return json(200, { linked: !!found, name: found ? found[1].name : '' }); }
  if (urlPath === '/api/tg/link' && req.method === 'DELETE') {
    req.resume();
    if (found) {
      delete tgData.links[found[0]];
      saveTg();
      tgSay(found[0], tgText(found[1].lang, 'unlinked', { device: found[1].device }));
    }
    return json(200, { ok: true });
  }
  // A file (raw body, its name in X-File-Name) or a text (X-Kind: text) from this device into the Telegram chat
  if (urlPath === '/api/tg/send' && req.method === 'POST') {
    if (!found) { req.resume(); return json(409, { error: 'not-linked' }); }
    if (Number(req.headers['content-length']) > TG_UP_MB * 1024 * 1024) { req.resume(); return json(413, { error: 'too-large', maxMb: TG_UP_MB }); }
    if (!allowAttempt(tgAttempts, 'out:' + r.id, TG_PER_HOUR, 3600 * 1000)) { req.resume(); return json(429, { error: 'too-many' }); }
    const parts = [];
    let len = 0;
    req.on('data', (c) => { len += c.length; if (len > TG_UP_MB * 1024 * 1024) req.destroy(); else parts.push(c); });
    req.on('end', async () => {
      const data = Buffer.concat(parts);
      const [chat, link] = found;
      try {
        if (req.headers['x-kind'] === 'text') await tg('sendMessage', { chat_id: chat, text: `${tgText(link.lang, 'fromOmni', { device: link.device })}:\n${data.toString('utf8').slice(0, 4000)}`, disable_web_page_preview: true });
        else {
          let name = 'file';
          try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch {}
          await tgSendFile(chat, safeFileName(name), String(req.headers['content-type'] || ''), data, tgText(link.lang, 'fromOmni', { device: link.device }));
        }
        count('telegramOut');
        json(200, { ok: true });
      } catch (err) {
        // The person blocked the bot or deleted the chat: unlink
        if (err.code === 403) { delete tgData.links[chat]; saveTg(); return json(409, { error: 'not-linked' }); }
        json(502, { error: 'telegram' });
      }
    });
    return;
  }
  req.resume();
  json(405, { error: 'method' });
}
// The bot's real username, from Telegram itself (getMe), so the t.me link always opens the bot whose token this is.
// TG_BOT_NAME is only used while Telegram can't be asked.
let tgNameChecked = false;
async function tgBotName() {
  if (!tgNameChecked) {
    try {
      const me = await tg('getMe');
      if (me && me.username) { TG_BOT_NAME = me.username; tgNameChecked = true; }
    } catch (err) {
      console.error('Telegram bot: could not ask Telegram for the bot name:', err.message);
    }
  }
  return TG_BOT_NAME;
}
// At start: the bot's name and the webhook, tried again every minute (up to 30 times) until both worked
if (tgOn() && process.env.TG_WEBHOOK !== 'off') {
  let tries = 0;
  const setUp = async () => {
    try {
      await tgBotName();
      await tg('setWebhook', { url: `${SITE_URL}/api/tg/${TG_PATH}`, secret_token: TG_HEADER, allowed_updates: ['message'], drop_pending_updates: false });
      console.log(`Telegram bot @${TG_BOT_NAME}: webhook set`);
    } catch (err) {
      console.error('Telegram bot: could not set the webhook:', err.message);
      if (++tries < 30) setTimeout(setUp, 60 * 1000).unref();
    }
  };
  setTimeout(setUp, 3000).unref();
} else if (tgOn()) console.log(`Telegram bot: set the webhook by hand to ${SITE_URL}/api/tg/${TG_PATH} with secret_token ${TG_HEADER.slice(0, 6)}… (see DEPLOY)`);
