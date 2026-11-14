// OmniBeam service worker. It keeps the app's own files on the device so OmniBeam opens almost instantly and
// still opens without internet (with the files you received earlier), puts OmniBeam in the system Share menu once
// installed as an app on Android, and shows notifications sent while OmniBeam is closed.
//
// Never stale after a deploy: the server writes the site's current version into VERSION below when it sends this
// file, so every deploy is a new service worker with a new, empty cache, and the old cache is deleted.
// - Pages (the app, guides): always asked from the network first. The saved copy is only used when the network
//   fails or takes more than NAV_TIMEOUT, and the app reloads itself if that copy turns out to be older than the site.
// - Files with a version in their address (app.js?v=37): saved once and served from the device. A new version of
//   such a file always gets a new address, so the saved one can never be out of date.
// - Other files (icons, the manifest): served from the device and refreshed in the background.
// - Everything that talks to the server (/ws, /poll, /api, /d/, /r/, /e/, /stats…) and the intro video (/media/, streamed in
//   pieces the browser asks for) is never touched.
const VERSION = 'dev';
const CACHE = `omnibeam-${VERSION}`;
const NAV_TIMEOUT = 3000;
const MAX_PAGES = 40;
// The app's files besides the home page. The server adds the files the home page and app.js load on demand.
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon.svg?v=4', '/favicon.ico'];
const isHome = (p) => /^\/(?:[a-z]{2}\/)?$/.test(p);
const LIVE = /^\/(?:ws|poll\/|api\/|d\/|r\/|e\/|media\/|stats|sw\.js|share$|sitemap\.xml|robots\.txt|\.well-known\/)/;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // The home page in the language that's open right now (/ar/, /fr/…) and everything it loads
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const homes = new Set(['/']);
    for (const c of open) {
      const p = new URL(c.url).pathname;
      if (isHome(p)) homes.add(p);
    }
    const assets = new Set(SHELL);
    for (const home of homes) {
      try {
        const res = await fetch(home, { cache: 'no-cache' });
        if (!res.ok) continue;
        const html = await res.clone().text();
        await cache.put(home, res);
        for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"#]+\?v=[^"#]+)"/g)) assets.add(url.replace(/&amp;/g, '&'));
      } catch {}
    }
    // One missing file must not stop the rest from being saved
    await Promise.all([...assets].filter((u) => !homes.has(u)).map((u) => cache.add(u).catch(() => {})));
  })());
});

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('omnibeam-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share')) return e.respondWith(receiveShare(req));
  if (req.method !== 'GET' || url.origin !== self.location.origin || LIVE.test(url.pathname)) return;
  if (req.mode === 'navigate') return e.respondWith(page(e, url));
  if (url.searchParams.has('v')) return e.respondWith(versioned(req));
  if (/\.(?:png|svg|ico|webmanifest|woff2|mp3)$/.test(url.pathname)) e.respondWith(refreshing(e, req));
});

// Network first; the saved copy when offline or very slow. Every good answer replaces the saved copy.
async function page(e, url) {
  const cache = await caches.open(CACHE);
  const key = url.pathname;
  const network = fetch(e.request).then((res) => {
    if (res.ok && res.type === 'basic' && !res.redirected && (res.headers.get('Content-Type') || '').includes('text/html')) {
      e.waitUntil(cache.put(key, res.clone()).then(() => trimPages(cache)));
    }
    return res;
  });
  const saved = await cache.match(key);
  if (!saved) return network.catch(() => offline());
  const slow = new Promise((resolve) => setTimeout(() => resolve(saved), NAV_TIMEOUT));
  e.waitUntil(network.catch(() => {}));
  return Promise.race([network.catch(() => saved), slow]);
}

async function versioned(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  if (saved) return saved;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function refreshing(e, req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
    return res;
  });
  if (!saved) return network;
  e.waitUntil(network.catch(() => {}));
  return saved;
}

// Guides people opened are kept for offline reading too, but only the most recent few
async function trimPages(cache) {
  const pages = (await cache.keys()).filter((r) => { const p = new URL(r.url).pathname; return !isHome(p) && !/\.\w+$/.test(p); });
  for (const r of pages.slice(0, Math.max(0, pages.length - MAX_PAGES))) await cache.delete(r);
}

// The app page is the one thing needed offline; anything else that isn't saved gets a small page that tries
// again by itself as soon as the device is back online
async function offline() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OmniBeam</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#e6e9f0;color:#3b4252;text-align:center}
@media (prefers-color-scheme:dark){body{background:#2b2e38;color:#e5e7ee}}
main{padding:24px;max-width:340px}h1{font-size:22px;margin:0 0 8px}button,a{margin-top:16px;font:inherit;border:0;border-radius:999px;padding:10px 22px;background:#6c63ff;color:#fff;cursor:pointer;display:inline-block;text-decoration:none}
</style></head><body><main><h1>You're offline</h1><p>This page isn't saved on this device. It opens again as soon as you're back online.</p>
<button onclick="location.reload()">Try again</button></main>
<script>addEventListener('online',()=>location.reload())</script></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Keep the shared files in IndexedDB until the page picks them up (it opens /?share=1 next)
async function receiveShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string' && f.size >= 0);
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n').trim();
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('omnibeam-share', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('shared');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').put({ files, text, at: Date.now() }, 'pending');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Share failed', err);
  }
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}

// A notification from the server: { title, body, url, tag }. Every push must show one (Safari stops sending
// them otherwise), so there's a plain one if the message can't be read.
self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(String(msg.title || 'OmniBeam'), {
    body: String(msg.body || ''),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: String(msg.tag || 'omnibeam'),
    renotify: true,
    data: { url: typeof msg.url === 'string' && msg.url.startsWith('/') ? msg.url : '/' },
  }));
});

// Tapping it opens OmniBeam, or brings an open OmniBeam window to the front. The buttons on it (notify() in app.js):
// - reply: a message's quick reply. Where the browser lets people type in the notification (e.reply), the open
//   OmniBeam tab sends it without coming to the front; with no tab open, OmniBeam opens and sends it. Where it
//   doesn't, Reply opens the chat with the typing box ready.
// - open: the chat. link: the link that was sent. save: the files that just arrived. stop: stops Ring my device.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const act = e.action || '';
  const url = new URL(data.url || '/', self.registration.scope).href;
  e.waitUntil((async () => {
    const link = data.link;
    const isLink = typeof link === 'string' && /^https?:\/\//i.test(link);
    // A link sent from another device: tapping its notification (or Open link) opens the link itself
    if (isLink && (act === '' || act === 'link')) return self.clients.openWindow(link);
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = appTab(open);
    const chat = typeof data.chat === 'string' ? data.chat : '';
    const text = act === 'reply' && typeof e.reply === 'string' ? e.reply.trim().slice(0, 20000) : '';
    if (act === 'reply' && text && chat) {
      // The tab says when it took the reply. A phone often pauses a tab that isn't on screen: no answer in 2 seconds
      // brings OmniBeam to the front, which wakes it so the reply goes (and shows in the chat).
      if (app) {
        if (await tellTab(app, { type: 'notif-reply', chat, text }, 2000)) return;
        return Promise.resolve(app.focus()).catch(() => {});
      }
      // No OmniBeam open: it opens and sends the reply once the device shows up
      await saveReply({ chat, text, at: Date.now() });
      return self.clients.openWindow(url);
    }
    if (act === 'stop') {
      if (app) app.postMessage({ type: 'ring-stop' });
      return;
    }
    if (act === 'save') {
      if (!app) return self.clients.openWindow(url);
      app.postMessage({ type: 'save-files', chat });
      return app.focus();
    }
    // A message's notification (or Reply where nothing can be typed in it): the open tab shows that chat
    if (app && chat) app.postMessage({ type: 'open-chat', chat, focus: act === 'reply' });
    if (app) return app.focus();
    return self.clients.openWindow(act === 'reply' && chat ? url + (url.includes('?') ? '&' : '?') + 'reply=1' : url);
  })());
});

// The OmniBeam app among the open windows: its main page (not /admin, a guide page or a link page), the one on
// screen first
function appTab(list) {
  const mine = list.filter((c) => { const u = new URL(c.url); return u.origin === self.location.origin && u.pathname === '/'; });
  return mine.find((c) => c.focused) || mine.find((c) => c.visibilityState === 'visible') || mine[0];
}
// A message to the tab, which answers on the port it comes with: true once it did, false after ms without an answer
function tellTab(client, msg, ms) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(false), ms);
    ch.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
    try { client.postMessage(msg, [ch.port2]); } catch { clearTimeout(timer); resolve(false); }
  });
}
// A reply typed in a notification while no OmniBeam was open, kept until the page that opens picks it up
async function saveReply(reply) {
  try {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('omnibeam-share', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('shared');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readwrite');
      tx.objectStore('shared').put(reply, 'reply');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}
