// OmniBeam client: peer discovery via WebSocket, file/text transfer via WebRTC data channels.
'use strict';

// Replaced at startup by /config.json (which can include a TURN server)
let RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let RELAY_ENABLED = true; // server relay fallback (from /config.json)
// Direct WebRTC chunks stay at 64 KB: larger messages break transfers to iPhone/Safari and were not faster.
// Server-relay chunks can be bigger (fewer requests per MB).
const MIN_CHUNK = 64 * 1024;
const MAX_CHUNK = 64 * 1024;
const RELAY_CHUNK = 256 * 1024;
// iPhone/iPad (every browser there) and Safari on a Mac
const IS_WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\//.test(navigator.userAgent);
// Files are read from disk in blocks, one block ahead of sending. Safari is slow per read, so it reads bigger ones.
const READ_BLOCK = (IS_WEBKIT ? 4 : 1) * 1024 * 1024;
// Data waiting in the direct channel's send buffer. Browsers close the channel above 16 MB, so it stays at 8 MB;
// sending tops it up when it drops below the low mark (Safari earlier, so its buffer never runs dry).
const MAX_BUFFERED = 8 * 1024 * 1024;
const LOW_BUFFERED = IS_WEBKIT ? 6 * 1024 * 1024 : MAX_BUFFERED / 2;
const RELAY_MAX_BUFFERED = 2 * 1024 * 1024;
const RTC_TIMEOUT = 8000; // how long to try a direct connection before falling back to the relay
const DIRECT_RETRY_AFTER = 10 * 60 * 1000; // after a failed direct attempt, go straight to the relay for this long
// A direct connection can work but crawl (router loopback, poor internet route): below this speed after
// SLOW_DIRECT_AFTER, the receiver moves the transfer to the server relay
const SLOW_DIRECT_RATE = 200 * 1024;
const SLOW_DIRECT_AFTER = 5000;
// Speed test (Connection check): send random data for a few seconds and see what arrives. Through the server it
// stops sooner and sends less, since that uses the hosting's bandwidth.
const SPEED_SECONDS = 6;
const SPEED_MAX_BYTES = 300 * 1024 * 1024;
const SPEED_RELAY_SECONDS = 4;
const SPEED_RELAY_MAX_BYTES = 24 * 1024 * 1024;
// Big-file mode: files from BIG_MIN up are checked piece by piece while they arrive. The receiver keeps each piece
// (BIG_SEG, 16 MB) in memory until the sender's CRC-32 of it matches, then saves it; a piece that doesn't match is
// thrown away and only that piece is sent again. So a 10 GB video never has to be sent twice because a few bytes
// went wrong, and a resume after a drop starts at the last checked piece. (Both values can be lowered for the
// tests: localStorage omnibeam-big-min / omnibeam-big-seg.)
const testNumber = (key) => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
const BIG_MIN = testNumber('omnibeam-big-min') || 1024 * 1024 * 1024;
const BIG_SEG = testNumber('omnibeam-big-seg') || 16 * 1024 * 1024;
const BIG_REDO_MAX = 6; // pieces of one file that may be sent again before the transfer gives up
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Problem notes for the owner's stats page (report.js); does nothing if that script didn't load
const report = (kind, message, extra) => { try { window.omniReport?.(kind, message, extra); } catch {} };
// A transfer that shows no progress for this long (with the page on screen) is reported as stuck
const STUCK_MS = testNumber('omnibeam-stuck-ms') || 30000;
// TV mode (omnibeam.site/tv): the server marks the page with class="tv". Receive-only, a big QR code, and received
// photos and videos play as a full-screen slideshow (see the TV section near the end).
const IS_TV = document.documentElement.classList.contains('tv');
// The app's address without /tv, for links other devices open (pairing, rooms)
const appPath = () => location.pathname.replace(/tv\/?$/, '');

const $ = (s, el = document) => el.querySelector(s);
// Translation lookup (see i18n.js). Falls back to the English text when no translation is loaded.
const t = (text, vars) => {
  let out = (window.I18N && window.I18N.lookup(text)) || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
};
const peersEl = $('#peers');
const fileInput = $('#file-input');

let me = { id: null, name: null };
let ws = null;
const peers = new Map(); // id -> Peer
let pairedCode = null;
const PUBLIC_KEY = 'omnibeam-public-room';
let publicRoom = null; // current room code (lowercase), confirmed by the server
let wantedPublicRoom = (() => { try { return localStorage.getItem(PUBLIC_KEY); } catch { return null; } })();
// Hash of the room's password, if it has one (the password itself is never stored or sent)
const PUBLIC_PASS_KEY = 'omnibeam-public-pass';
let wantedPublicPass = (() => { try { return localStorage.getItem(PUBLIC_PASS_KEY); } catch { return null; } })();
let publicLocked = false;

// ---------- Accessibility ----------
// Screen readers announce a dialog by its title: link each dialog to its first heading
document.querySelectorAll('dialog').forEach((dlg, i) => {
  if (dlg.hasAttribute('aria-labelledby') || dlg.hasAttribute('aria-label')) return;
  const h = dlg.querySelector('h1, h2, h3');
  if (!h) return;
  h.id = h.id || `dlg-title-${i}`;
  dlg.setAttribute('aria-labelledby', h.id);
});
// Long texts that scroll inside a dialog: reachable with the keyboard so they can be scrolled with the arrow keys
document.querySelectorAll('dialog .text-body').forEach((el) => { el.tabIndex = 0; });

// ---------- Helpers ----------
// Scripts loaded only when needed, so phones download and run less on the first visit: more.js (connection check,
// speed test, shrinking, HEIC to JPG, ZIP, iPhone Shortcut setup) and qrcode.js (QR codes)
const scriptLoads = new Map();
function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => {
        scriptLoads.delete(src); // try again next time
        el.remove();
        reject(new Error(t('Could not load this part of OmniBeam. Check the internet connection and try again.')));
      };
      document.head.appendChild(el);
    }));
  }
  return scriptLoads.get(src);
}
const loadMore = () => loadScript('/more.js?v=7');
const loadQr = () => loadScript('/qrcode.js?v=1');
// Auto-send a folder (Settings): loaded when Settings opens, or at the start when it is turned on
const loadAutoSend = () => loadScript('/autosend.js?v=1');
window.loadQr = loadQr; // for drop.js
// A function from more.js, loaded on first use
const more = (name) => async (...args) => {
  try {
    await loadMore();
  } catch (err) {
    toast(err.message);
    throw err;
  }
  return window.More[name](...args);
};
// media.js: taking a photo, voice notes, sharing a screen, secret notes and previews of received files
const loadMedia = () => loadScript('/media.js?v=1');
const media = (name) => async (...args) => {
  try {
    await loadMedia();
  } catch (err) {
    toast(err.message);
    throw err;
  }
  return window.Media[name](...args);
};
function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} ${browser}`;
}
function deviceType(device) {
  return /Android|iOS/.test(device) ? 'mobile' : 'desktop';
}
function colorFor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  // Soft pastel gradient avatars to match the clay look
  return `linear-gradient(145deg, hsl(${h} 75% 72%), hsl(${(h + 30) % 360} 65% 60%))`;
}
const ICONS = {
  desktop: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  mobile: '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
};
// Pictures a device can show instead of its device icon (Settings > Change name and picture). The server only
// passes on these, so a name card can't carry anything else.
const AVATARS = ['😀', '😎', '🤓', '🥳', '🤖', '👻', '👽', '🐱', '🐶', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🐧', '🦉', '🐙', '🦄',
  '🐝', '🌵', '🌻', '🍀', '🍉', '🍕', '⭐', '🔥', '⚡', '🌈', '🎧', '🎮', '🎸', '🚀', '🏠', '💼', '🎨', '📷', '⚽', '💻'];
// Extra pictures for supporters (Settings -> Supporter); the server passes them on only for a checked code
const SUPPORTER_AVATARS = ['🦋', '🐳', '🦖', '🐲', '🦩', '🦚', '🌸', '🌙', '💎', '👑', '🎃', '🧸', '🍩', '🧁', '🏆', '🛸', '🪐', '🎯', '🧩', '🌊'];
// ---------- Supporter perks (Settings -> Supporter, codes made on /stats, see Supporter codes in server.js) ----------
// A code from the owner, after a donation, unlocks: the ♥ on this device's card (the server checks the code before it
// shows it to others), four colour themes and extra pictures. Nothing else is locked: OmniBeam is free for everyone.
// The accepted code is kept on this device, so the perks also work offline; a code the server says was taken back
// turns them off.
const SUPPORTER_LS = 'omnibeam-supporter';
const COLOR_KEY = 'omnibeam-color';
const SUPPORTER_COLORS = ['ocean', 'forest', 'sunset', 'rose'];
function applyColor(c) {
  if (SUPPORTER_COLORS.includes(c)) document.documentElement.dataset.color = c;
  else delete document.documentElement.dataset.color;
}
const Supporter = {
  saved() {
    try { const v = JSON.parse(localStorage.getItem(SUPPORTER_LS)); return v && typeof v.code === 'string' ? v : null; } catch { return null; }
  },
  on() { return !!this.saved(); },
  code() { return this.saved()?.code || ''; },
  color() {
    if (!this.on()) return '';
    try { const c = localStorage.getItem(COLOR_KEY) || ''; return SUPPORTER_COLORS.includes(c) ? c : ''; } catch { return ''; }
  },
  setColor(c) {
    try { if (c) localStorage.setItem(COLOR_KEY, c); else localStorage.removeItem(COLOR_KEY); } catch {}
    this.apply();
  },
  // Checks the code with the server (/api/supporter, a few tries per network), then keeps it. true / false.
  async unlock(code) {
    code = String(code || '').trim().toUpperCase();
    const r = await fetch('/api/supporter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }), cache: 'no-store' });
    if (r.status === 429) throw new Error(t('Too many attempts. Wait a few minutes and try again.'));
    if (!r.ok) throw new Error(t('Could not check the code. Check the internet connection and try again.'));
    const res = await r.json().catch(() => ({}));
    if (!res.ok) return false;
    try { localStorage.setItem(SUPPORTER_LS, JSON.stringify({ code, at: Date.now() })); } catch {}
    wsSend({ type: 'supporter', code });
    this.apply();
    return true;
  },
  remove() {
    const hadExtra = SUPPORTER_AVATARS.includes((() => { try { return localStorage.getItem(AVATAR_KEY); } catch { return ''; } })());
    try { localStorage.removeItem(SUPPORTER_LS); localStorage.removeItem(COLOR_KEY); } catch {}
    if (hadExtra) { try { localStorage.removeItem(AVATAR_KEY); } catch {} wsSend({ type: 'rename', avatar: '' }); }
    wsSend({ type: 'supporter', code: '' });
    this.apply();
  },
  // What the server said about the code when this device connected (off: supporter codes aren't set up there)
  onServer(msg) {
    if (msg.off || msg.ok || !this.on()) return;
    try { localStorage.removeItem(SUPPORTER_LS); localStorage.removeItem(COLOR_KEY); } catch {}
    this.apply();
    toast(t('This supporter code no longer works, so the supporter perks are off on this device.'), 6000);
  },
  apply() {
    applyColor(this.color());
    const on = this.on();
    const off = document.getElementById('supporter-off');
    if (!off) return;
    off.hidden = on;
    $('#supporter-on').hidden = !on;
    const now = this.color();
    for (const b of document.querySelectorAll('#supporter-colors [data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === now));
    const mine = $('#me-supporter');
    if (mine) mine.hidden = !on;
    if (typeof showMyAvatar === 'function' && me) showMyAvatar();
  },
};
try { applyColor(Supporter.color()); } catch {}
window.addEventListener('storage', (e) => { if (e.key === SUPPORTER_LS || e.key === COLOR_KEY) Supporter.apply(); });
const avatarHtml = (avatar, device) => (AVATARS.includes(avatar) || SUPPORTER_AVATARS.includes(avatar) ? `<span class="emoji">${avatar}</span>` : ICONS[deviceType(device || '')]);
function formatDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '';
  sec = Math.ceil(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor(sec / 60) % 60).padStart(2, '0')}m`;
}
function formatSize(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function linkify(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
// A message that is only a web address (what the Chrome extension, the share menu or a copied link sends): the other
// device offers to open it with one tap (banner, chat bubble, notification), or opens it by itself (Settings ->
// Open links, from paired devices only). null for anything else.
function linkOnly(text) {
  const s = String(text || '').trim();
  if (s.length > 4000 || !/^https?:\/\/\S+$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}
const OPEN_LINKS_KEY = 'omnibeam-open-links';
let openLinksAuto = (() => { try { return localStorage.getItem(OPEN_LINKS_KEY) === 'on'; } catch { return false; } })();
// Opens a link in a new tab, without giving it this page (window.open after a tap, or by itself when allowed)
function openLink(url) {
  const w = window.open(url, '_blank');
  if (!w) return false;
  try { w.opener = null; } catch {}
  wsSend({ type: 'stat', kind: 'link' });
  return true;
}
let toastTimer;
function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// opts.chat: the thread key of a message (tapping the notification opens that chat)
// opts.always: also while the page is on screen (a message whose chat isn't showing)
function notify(title, body, opts = {}) {
  if ((!document.hidden && !opts.always) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const data = opts.chat ? { chat: opts.chat, url: '/?chat=' + encodeURIComponent(opts.chat), ...(opts.link ? { link: opts.link } : {}) } : undefined;
  // Through the service worker where there is one: Android and installed apps don't allow new Notification()
  const show = () => {
    try {
      const n = new Notification(title, { body, icon: '/icon-192.png', tag: opts.chat || undefined });
      if (data) n.onclick = () => { window.focus(); n.close(); if (data.link) openLink(data.link); else openChatByKey(data.chat); };
    } catch {}
  };
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png', data, ...(opts.chat ? { tag: opts.chat, renotify: true, vibrate: opts.vibrate || [70] } : {}), ...(opts.sticky ? { requireInteraction: true } : {}) })).catch(show);
  } else show();
}
// Short two-note chime when something arrives (Web Audio, no sound file needed). Browsers only allow sound
// after the user has interacted with the page, so the audio context is created on the first tap/click.
let audioCtx = null;
const unlockAudio = () => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
};
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);
function chime() {
  if (!audioCtx || audioCtx.state !== 'running') return;
  try {
    const t0 = audioCtx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const start = t0 + i * 0.13;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  } catch {}
}

// Message sound: the chime (and a short buzz on phones that can) for every message and file that arrives from
// another device, never for what this device sends. On by default; Settings -> Message sound, or the speaker button
// in the chat, turns it off.
const MSG_SOUND_KEY = 'omnibeam-msg-sound';
let msgSound = (() => { try { return localStorage.getItem(MSG_SOUND_KEY) !== 'off'; } catch { return true; } })();
function setMsgSound(on) {
  msgSound = !!on;
  try { localStorage.setItem(MSG_SOUND_KEY, msgSound ? 'on' : 'off'); } catch {}
  const box = document.getElementById('msg-sound');
  if (box) box.checked = msgSound;
  window.Chat?.refresh?.();
}
function messageSound() {
  if (msgSound) chime();
  try { if (msgSound && document.visibilityState === 'visible') navigator.vibrate?.(70); } catch {}
}

// Ring my device: another device asked this one to ring, to find it (a phone under a cushion). A loud beep that
// repeats, a buzz on phones, a window with Stop, and a notification, for up to 30 seconds. It rings even with the
// message sound off (that's the point), but it can't get past a phone's own silent switch. Browsers only allow sound
// on a page that was tapped once, so the other device is told whether the sound could play (ring-ok).
const Ringer = {
  peer: null,
  timer: 0,
  beeps: 0,
  last: new Map(), // device id -> when it last rang this one (one ring per 10 s)
  start(peer) {
    const now = Date.now();
    if (now - (this.last.get(peer.info.id) || 0) < 10000) return peer.sendJson({ t: 'ring-busy' });
    this.last.set(peer.info.id, now);
    this.stop(null, false);
    this.peer = peer;
    unlockAudio();
    const sound = !!audioCtx && audioCtx.state === 'running';
    peer.sendJson({ t: 'ring-ok', sound });
    const name = peer.info.name;
    let dlg = document.getElementById('dlg-ring');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-ring';
      dlg.className = 'ring-dialog';
      dlg.setAttribute('aria-labelledby', 'ring-title');
      dlg.innerHTML = '<div class="ring-bell" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>'
        + '<h3 id="ring-title"></h3><p class="muted"></p><div class="row"><button type="button" class="btn" data-act="stop"></button></div>';
      dlg.onclick = (e) => { if (e.target.closest('[data-act=stop]')) this.stop(this.peer, true); };
      dlg.oncancel = (e) => { e.preventDefault(); this.stop(this.peer, true); };
      document.body.appendChild(dlg);
    }
    $('h3', dlg).textContent = t('{name} is ringing this device', { name });
    $('p', dlg).textContent = t('Found it? Tap Stop.');
    $('[data-act=stop]', dlg).textContent = t('Stop');
    if (!dlg.open) dlg.showModal();
    notify(t('{name} is ringing this device', { name }), t('Found it? Tap Stop.'), { chat: chatKey(chatWho(peer)), always: true, sticky: true, vibrate: [500, 200, 500, 200, 500] });
    this.beeps = 0;
    const beep = () => {
      if (++this.beeps > 30) return this.stop(this.peer, false);
      try { navigator.vibrate?.([400, 150, 400]); } catch {}
      if (!audioCtx || audioCtx.state !== 'running') return;
      try {
        const t0 = audioCtx.currentTime;
        [0, 0.18, 0.36].forEach((at, i) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.value = i === 1 ? 1568 : 1175;
          gain.gain.setValueAtTime(0.0001, t0 + at);
          gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.16);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(t0 + at);
          osc.stop(t0 + at + 0.17);
        });
      } catch {}
    };
    beep();
    this.timer = setInterval(beep, 1000);
  },
  // tell: Stop was tapped here, so the device that rang hears it was found
  stop(peer, tell) {
    if (peer && this.peer && peer !== this.peer) return;
    clearInterval(this.timer);
    this.timer = 0;
    try { navigator.vibrate?.(0); } catch {}
    const was = this.peer;
    this.peer = null;
    const dlg = document.getElementById('dlg-ring');
    if (dlg?.open) dlg.close();
    if (tell && was && peers.get(was.info.id) === was) was.sendJson({ t: 'ring-found' });
  },
};
// Ring a device from its card, its chat or the list of actions. A paired device that is offline gets a notification
// (if it has them on) and rings as soon as it opens OmniBeam in the next 2 minutes.
const RING_WAIT = 120000;
const ringWaiting = new Map(); // pairing secret -> when it was asked
function ringDevice(x) {
  if (x?.info) {
    if (peers.get(x.info.id) !== x) return toast(t('{name} is no longer available', { name: x.info.name }));
    x.warmUp?.();
    return x.ring();
  }
  const here = x?.secret && [...peers.values()].find((p) => p.pairSecret === x.secret);
  if (here) return here.ring();
  if (!x?.secret) return;
  ringWaiting.set(x.secret, Date.now());
  wsSend({ type: 'push-wake', secret: x.secret, ring: true });
  toast(t('{name} is offline. It rings as soon as it opens OmniBeam in the next 2 minutes.', { name: x.name }), 5000);
}
function ringIfWaiting(peer) {
  const at = peer.pairSecret && ringWaiting.get(peer.pairSecret);
  if (!at) return;
  ringWaiting.delete(peer.pairSecret);
  if (Date.now() - at < RING_WAIT) peer.ring();
}

// Keep the screen on while a transfer runs (phones otherwise lock and the transfer pauses), and warn before
// the tab is closed in the middle of one
let wakeLock = null;
let wakeLockAsking = false;
// null: not needed yet; false: this browser can't or won't keep the screen on with the Wake Lock API (older iPhones,
// and iPhone home-screen apps before iOS 18.4), so a tiny video keeps it on instead (see KeepAwakeVideo)
let wakeLockOk = null;
// iPhone and iPad (every browser there)
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// iOS 18.4 -> 1804 (0 if unknown)
const iosVersion = (() => {
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent) || /Version\/(\d+)\.(\d+)/.exec(navigator.userAgent);
  return isIOS && m ? Number(m[1]) * 100 + Number(m[2]) : 0;
})();
// An iPhone home-screen app before iOS 18.4 gets a wake lock that does nothing
const wakeLockBroken = () => isIOS && iosVersion > 0 && iosVersion < 1804
  && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
// Where the Wake Lock API is missing or does nothing, a tiny black video (1 KB, made for this: 16×16 pixels, 2 s)
// playing muted in a loop keeps the screen on, as any playing video does. It isn't added to the page. Phones may only
// start it from a tap, so a tap readies it (see the pointerdown listener) and it plays only while something needs the
// screen on.
const KEEP_AWAKE_MP4 = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAK4bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkR0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAHgbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAD6AAAB9BVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABi21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUtzdGJsAAAAg3N0c2QAAAAAAAAAAQAAAHNhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAHWF2Y0MBQsAK/+EABmdCwAraeQEABGjOPIAAAAAYc3R0cwAAAAAAAAABAAAAFAAAAGQAAAAUc3RzcwAAAAAAAAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAFAAAAAEAAABkc3RzegAAAAAAAAAAAAAAFAAAAYoAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAAFHN0Y28AAAAAAAAAAQAAAuAAAAIqbWRhdAAAAYZliISg0BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAAAAAEQZoilAAAAARBmkKUAAAABEGaYpQAAAAEQZqClAAAAARBmqKUAAAABEGawpQAAAAEQZrilAAAAARBmwKUAAAABEGbIpQAAAAEQZtClAAAAARBm2KUAAAABEGbgpQAAAAEQZuilAAAAARBm8KUAAAABEGb4pQAAAAEQZoClAAAAARBmiKUAAAABEGaQpQAAAAEQZpilA==';
const KeepAwakeVideo = {
  el: null,
  element() {
    if (!this.el) {
      const v = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      for (const a of ['muted', 'playsinline', 'loop']) v.setAttribute(a, '');
      v.src = KEEP_AWAKE_MP4;
      this.el = v;
    }
    return this.el;
  },
  start() {
    const v = this.element();
    if (v.paused) v.play().catch(() => {});
  },
  stop() {
    if (this.el && !this.el.paused) this.el.pause();
  },
  get playing() { return !!this.el && !this.el.paused; },
  // In a tap: play it once so that it may be started later without one
  ready() {
    if (this.readied) return;
    this.readied = true;
    const v = this.element();
    v.play().then(() => { if (!needAwake()) v.pause(); }, () => { this.readied = false; });
  },
};
const needsVideo = () => wakeLockOk === false || wakeLockBroken() || !navigator.wakeLock;
const transferActive = () => [...peers.values()].some((p) => p.busy);
window.omniBusy = transferActive; // for the crash check in report.js
// Other work that must not stop when the screen turns off: a link upload, sharing or watching a screen, a voice
// note being recorded. keepAwake('link', true) while it runs, keepAwake('link', false) when it ends.
const awakeHolds = new Set();
function keepAwake(what, on) {
  if (on) awakeHolds.add(what); else awakeHolds.delete(what);
  updateWakeLock();
}
window.keepAwake = keepAwake; // for drop.js and media.js
const needAwake = () => transferActive() || awakeHolds.size > 0;
async function updateWakeLock() {
  const need = needAwake();
  BgAudio.update(need);
  if (!need) KeepAwakeVideo.stop();
  else if (document.visibilityState === 'visible' && isPhone && needsVideo()) KeepAwakeVideo.start();
  if (need && wakeLockBroken()) wakeLockOk = false;
  else if (need && !wakeLock && !wakeLockAsking && document.visibilityState === 'visible') {
    if (!navigator.wakeLock) {
      wakeLockOk = false;
    } else {
      wakeLockAsking = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        wakeLock = lock;
        wakeLockOk = true;
        lock.addEventListener('release', () => {
          if (wakeLock === lock) wakeLock = null;
          // Let go by the phone itself (e.g. battery saver) while the page is in front: ask again
          setTimeout(updateWakeLock, 1000);
        });
      } catch {
        wakeLockOk = false;
      } finally {
        wakeLockAsking = false;
      }
      if (wakeLock && !needAwake()) return updateWakeLock(); // the transfer ended while we asked
      if (!wakeLock && needAwake() && isPhone) KeepAwakeVideo.start();
    }
  } else if (!need && wakeLock) {
    const lock = wakeLock;
    wakeLock = null;
    try { await lock.release(); } catch {}
  }
  updateScreenHints();
}
// Some browsers only allow it after a tap: try again on the next one. The video and the experimental sound are
// readied in a tap too (a phone may refuse to start them later otherwise).
document.addEventListener('pointerdown', () => {
  if (wakeLockOk === false && navigator.wakeLock && !wakeLockBroken()) updateWakeLock();
  if (isPhone && needsVideo()) {
    KeepAwakeVideo.ready();
    if (needAwake()) KeepAwakeVideo.start();
  }
  BgAudio.ready();
}, { passive: true });

// ---------- Keep going with the screen off (iPhone, experimental) ----------
// Settings → "Keep transfers going with the screen off". Safari lets a page run on while it plays sound, even with the
// screen off, so a near-silent sound plays in a loop during transfers, shown on the lock screen as "OmniBeam ·
// Sending 3 file(s)". Off by default: it pauses music that is playing, and iOS may still stop the page.
const BG_AUDIO_KEY = 'omnibeam-bg-audio';
const BgAudio = {
  on: (() => { try { return localStorage.getItem(BG_AUDIO_KEY) === 'on'; } catch { return false; } })(),
  el: null,
  element() {
    if (!this.el) {
      // 1 s of very quiet noise (16-bit WAV, 8 kHz), made here: a sound that is all zeros may not count as playing
      const rate = 8000;
      const v = new DataView(new ArrayBuffer(44 + rate * 2));
      const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
      str(0, 'RIFF'); v.setUint32(4, 36 + rate * 2, true); str(8, 'WAVEfmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
      v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      str(36, 'data'); v.setUint32(40, rate * 2, true);
      for (let i = 0; i < rate; i++) v.setInt16(44 + i * 2, Math.floor(Math.random() * 3) - 1, true);
      this.el = new Audio(URL.createObjectURL(new Blob([v.buffer], { type: 'audio/wav' })));
      this.el.loop = true;
    }
    return this.el;
  },
  get playing() { return !!this.el && !this.el.paused; },
  // In a tap: Safari only lets sound start from one, and a sound started once may be started again later
  ready() {
    if (!this.on || this.readied) return;
    this.readied = true;
    const a = this.element();
    a.play().then(() => { if (!needAwake()) a.pause(); }, () => { this.readied = false; });
  },
  update(need) {
    if (!this.on || !need) {
      if (this.playing) this.el.pause();
      try { if (navigator.mediaSession?.metadata?.artist === 'OmniBeam') navigator.mediaSession.metadata = null; } catch {}
      return;
    }
    let n = 0;
    let sending = false;
    for (const p of peers.values()) {
      if (p.sending && p.job?.files) { n += p.job.files.length; sending = true; } else if (p.incoming) n += p.incoming.count;
    }
    const what = sending ? t('Sending {n} file(s)', { n }) : t('Receiving {n} file(s)', { n: n || 1 });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: `OmniBeam · ${what}`, artist: 'OmniBeam',
        artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] });
    } catch {}
    const a = this.element();
    if (a.paused) a.play().catch(() => {});
  },
  set(on) {
    this.on = on;
    try { localStorage.setItem(BG_AUDIO_KEY, on ? 'on' : 'off'); } catch {}
    if (on) this.ready(); else this.update(false);
    updateScreenHints();
  },
};

// ---------- Screen off (phones) ----------
// iPhones pause a web page completely as soon as the screen turns off or another app is opened (Android does
// the same a little later): its connections freeze and break, and no website can keep running then. So the
// card on a phone says to keep the screen on, the other device is told why the transfer stopped, and when the
// phone is back its connection is checked at once so the transfer continues (see AutoResume) within seconds.
let isPhone = /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// The page stops at once when it is hidden (every browser on iPhone and iPad), rather than a while later (Android).
// The other device then pauses the transfer right away instead of sending into a connection that is about to die.
let freezesHidden = isIOS;
let hiddenAt = 0;
let wokeAt = 0;
// The page was paused (or is now) because the screen turned off: explains a transfer that stopped
const screenWasOff = () => isPhone && (document.hidden || Date.now() - wokeAt < 20000);
// What the devices say when a transfer paused because a screen turned off (see Peer.pause)
const PAUSED_SELF = 'The transfer paused because the screen turned off. It continues by itself in a moment (keep this page open).';
const PAUSED_OTHER = 'Paused: the screen of {name} turned off. It continues by itself when {name} is back.';
function updateScreenHints() {
  for (const p of peers.values()) {
    const el = $('.xfer-hint', p.el);
    if (!el) continue;
    const show = isPhone && p.busy;
    const unsure = wakeLockOk === false && !KeepAwakeVideo.playing;
    el.hidden = !show;
    el.textContent = !show ? ''
      : isIOS && BgAudio.on ? t('Trying to keep going with the screen off (experimental). If it stops, it continues when you are back.')
      : isIOS ? t('Keep the screen on until this finishes. If it turns off, it continues when you are back (or try the screen-off option in Settings).')
      : unsure ? t('Your phone may turn the screen off: tap it now and then until this finishes')
      : t('Keep OmniBeam open and the screen on until this finishes');
    el.classList.toggle('warn', unsure);
  }
}
let visibleSince = Date.now(); // for the stuck check: timers pause while the page is hidden
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) visibleSince = Date.now();
  if (document.hidden) {
    hiddenAt = Date.now();
    if (!isPhone) return;
    Outgoing.screenOff();
    for (const p of peers.values()) {
      if (!p.busy) continue;
      // What arrived so far is saved now: a page in the background may be thrown away
      p.saveSoFar();
      // Tell the other side while we still can (the phone gives the page a moment before pausing it). Not while the
      // experimental sound may keep this page running.
      if (!BgAudio.playing) wsSend({ type: 'signal', to: p.info.id, data: { asleep: true, ...(freezesHidden ? { freeze: true } : {}) } });
    }
  } else if (hiddenAt && Date.now() - hiddenAt > 3000) {
    wake();
  }
});
// The screen is back on (or OmniBeam is in front again) after a while: check the connection to the server at once,
// then tell the other devices, so a paused transfer continues within seconds, in both directions
const WAKE_STALL_MS = 4000;
function wake() {
  if (Date.now() - wokeAt < 2000) return;
  const away = Date.now() - hiddenAt;
  wokeAt = Date.now();
  // A phone's transfer that was still going here when the page stopped: if nothing moves within a few seconds, its
  // connection died meanwhile. Pause it cleanly, so it continues by itself like the others. (Not at the end, while
  // the receiver saves.)
  for (const p of peers.values()) {
    if (!isPhone || away < 10000 || !p.busy || !p.prog || !(p.job?.send || p.incoming)) continue;
    if (Math.max(p.prog.done, p.prog.acked || 0) >= p.prog.total) continue;
    const prog = p.prog;
    const mark = `${prog.done}|${prog.acked}`;
    setTimeout(() => {
      if (peers.get(p.info.id) === p && p.busy && p.prog === prog && `${prog.done}|${prog.acked}` === mark) p.pause(t(PAUSED_SELF));
    }, WAKE_STALL_MS);
  }
  for (const name of new Set([...AutoResume.jobs.values()].map((e) => e.name).concat(Interrupted.load().map((e) => e.name)))) {
    for (const p of peers.values()) if (p.info.name === name && !p.busy) p.showWaiting(t('Resuming…'));
  }
  const held = [...AutoResume.held];
  AutoResume.held.clear();
  checkSocketAlive(() => {
    for (const p of peers.values()) wsSend({ type: 'signal', to: p.info.id, data: { awake: true } });
    for (const [from, tag] of held) if (peers.has(from)) AutoResume.onOffer(from, tag).catch(() => {});
    AutoResume.offerAll();
  });
}
// After the page was paused, the connection to the server often looks open but is dead, and the browser can
// take half a minute to notice. Ask the server for an answer; none within 2.5 s: reconnect right away. (A new
// connection makes every device show up again, and paused transfers continue from there.)
// alive: called when the server answered
function checkSocketAlive(alive) {
  const sock = ws;
  if (!sock || sock.readyState !== WebSocket.OPEN) return ensureConnected();
  const asked = Date.now();
  sock.onPong = () => { sock.onPong = null; alive?.(); };
  wsSend({ type: 'ping' });
  setTimeout(() => {
    if (ws !== sock || sock.readyState !== WebSocket.OPEN || sock.pongAt >= asked) return;
    const onclose = sock.onclose;
    sock.onclose = sock.onmessage = sock.onPong = null;
    try { sock.close(); } catch {}
    onclose?.call(sock, {});
    clearTimeout(reconnectTimer);
    connectSocket();
  }, 2500);
}
document.addEventListener('visibilitychange', updateWakeLock);
window.addEventListener('beforeunload', (e) => {
  // Files waiting for an offline device, or to continue an interrupted send, only exist in this page
  if (!transferActive() && !waiting.size && !AutoResume.size) return;
  e.preventDefault();
  e.returnValue = '';
});

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------- End-to-end encryption for the server relay ----------
// Direct WebRTC connections are always encrypted by the browsers (DTLS). When a transfer has to go through
// the server instead, the two devices agree on a key with ECDH (only public keys pass through the server) and
// encrypt every message with AES-GCM, so the server only forwards data it can't read. Each message is bound
// to its direction and position, so data can't be replayed, reordered or swapped between devices either.
const bufToB64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const E2E = {
  keys: null, // this tab's ECDH key pair (new on every page load)
  pub: null,  // its public key, base64
  ready: null,
  init() {
    if (!this.ready) {
      this.ready = (async () => {
        if (!crypto.subtle) throw new Error('Secure connection failed');
        this.keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        this.pub = bufToB64(await crypto.subtle.exportKey('raw', this.keys.publicKey));
      })();
    }
    return this.ready;
  },
  // Both devices get the same AES key from their own private key and the other's public key
  async derive(theirPub, idA, idB) {
    await this.init();
    const pub = await crypto.subtle.importKey('raw', b64ToBuffer(theirPub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, this.keys.privateKey, 256);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const enc = new TextEncoder();
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: enc.encode([idA, idB].sort().join('|')), info: enc.encode('omnibeam-relay-v1') },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  // -> [12-byte IV][ciphertext + tag]
  async seal(key, data, label) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(label) }, key, data));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  },
  open(key, data, label) {
    const u = new Uint8Array(data);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: new TextEncoder().encode(label) }, key, u.subarray(12));
  },
};

// ---------- Peer connection ----------
class Peer {
  constructor(info) {
    this.info = info;
    this.pc = null;
    this.dc = null;
    this.signalQueue = Promise.resolve();
    this.openWaiters = [];
    this._busy = false;
    this.queue = []; // file selections waiting for the current transfer to finish
    this.acceptWaiter = null;
    this.incoming = null; // receive state
    this.el = this.render();
  }

  // --- UI ---
  render() {
    // The whole card can be clicked; for the keyboard and screen readers the avatar is its main button, next to
    // the hover action buttons (buttons can't be inside other buttons)
    const el = document.createElement('div');
    el.className = 'peer';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', this.info.name);
    el.innerHTML = `
      <button type="button" class="avatar-wrap peer-main">
        <div class="avatar" style="background:${colorFor(this.info.name)}" aria-hidden="true">${avatarHtml(this.info.avatar, this.info.device)}</div>
        <svg class="progress" viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="44"/></svg>
      </button>
      <div class="name"></div>
      <div class="device"></div>
      <div class="status"></div>
      <div class="xfer" hidden>
        <div class="xfer-bar"><span></span></div>
        <div class="xfer-meta"><b class="xfer-pct"></b><span class="xfer-speed"></span></div>
        <div class="xfer-sub"></div>
        <div class="xfer-route"></div>
        <div class="xfer-hint" hidden></div>
      </div>
      <div class="peer-actions">
        <button type="button" data-act="files">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          ${t('Send files')}
        </button>
        <button type="button" data-act="message">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${t('Send message')}
        </button>
        ${CAN_PICK_FOLDER ? `<button type="button" data-act="folder">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          ${t('Send folder')}
        </button>` : ''}
        <button type="button" data-act="more">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>
          ${t('More…')}
        </button>
      </div>
      <button type="button" class="xfer-cancel" data-act="cancel" title="${t('Cancel transfer')}" aria-label="${t('Cancel transfer')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>`;
    $('.name', el).textContent = this.info.name;
    $('.device', el).textContent = this.info.device;
    $('.peer-main', el).setAttribute('aria-label', t('Send to {name}', { name: this.info.name }));
    this.paintSupporter(el);
    this.markTab(el); // this.el isn't set yet: the constructor assigns it when render() returns

    const pickFiles = () => { this.warmUp(); pickAndSend(fileInput, [this]); };
    // Clicking the card sends files; the hover buttons pick files, a folder or a message explicitly
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') this.cancelTransfer();
      else if (act === 'message') { this.warmUp(); openChat(this); }
      else if (act === 'folder') { this.warmUp(); pickAndSend(folderInput, [this]); }
      else if (act === 'more') openActions(this);
      else if (act === 'chat') openChat(this);
      else if (shared) sendShared(this);
      else pickFiles();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openChat(this);
    });
    let pressTimer;
    // A long press on a phone opens the list of everything that can be sent (message, photo, voice note…)
    el.addEventListener('touchstart', () => { pressTimer = setTimeout(() => openActions(this), 600); }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(pressTimer));
    el.addEventListener('touchmove', () => clearTimeout(pressTimer));

    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag');
      const text = e.dataTransfer.getData('text');
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) this.sendFiles(files);
      else if (text) this.sendText(text);
    });
    return el;
  }
  // A ♥ on the card of a device whose supporter code the server checked (see Supporter)
  paintSupporter(el = this.el) {
    let tag = el.querySelector('.supporter-tag');
    if (!this.info.supporter) { tag?.remove(); return; }
    if (tag) return;
    tag = document.createElement('span');
    tag.className = 'supporter-tag';
    tag.textContent = '♥';
    tag.title = t('Supporter');
    tag.setAttribute('aria-label', t('Supporter'));
    tag.setAttribute('role', 'img');
    el.appendChild(tag);
  }
  // While busy the card shows a cancel button. When the transfer ends, the next queued send starts.
  get busy() { return this._busy; }
  set busy(v) {
    this._busy = v;
    if (this.el) this.el.classList.toggle('busy', v);
    if (v) this.showWaiting('');
    if (!v && this.queue.length) {
      setTimeout(() => { if (!this._busy && this.queue.length && peers.get(this.info.id) === this) this.sendFiles(this.queue.shift()); }, 300);
    }
  }
  cancelTransfer() {
    if (!this.busy) return;
    this.queue = [];
    if (this.asking) this.asking(false);
    this.abort('Transfer cancelled');
  }
  setProgress(p) {
    const c = $('.progress circle', this.el);
    c.style.strokeDashoffset = 276.5 * (1 - Math.max(0, Math.min(1, p)));
  }
  setStatus(s) {
    $('.status', this.el).textContent = s ? t(s) : '';
  }
  // A paused transfer between the two: the card says so ("Paused: …", "Resuming…") until it continues, or for ms
  showWaiting(text, ms = RESUME_WINDOW) {
    clearTimeout(this.waitingTimer);
    if (!text && !this.el.classList.contains('waiting')) return;
    this.el.classList.toggle('waiting', !!text);
    if (!this.busy) this.setStatus(text);
    if (text) this.waitingTimer = setTimeout(() => this.showWaiting(''), ms);
  }

  // --- Progress bar (sending and receiving) ---
  startProgress(total, sending) {
    this.endProgress();
    clearTimeout(this.hideTimer);
    const now = performance.now();
    this.prog = { total: total || 1, done: 0, sending, samples: [[now, 0]] };
    this.el.classList.add('xferring');
    $('.xfer', this.el).hidden = false;
    this.renderProgress();
    // Redraw on a timer instead of on every chunk: cheaper, and keeps updating while the send buffer drains
    this.progTimer = setInterval(() => this.renderProgress(), 250);
    updateWakeLock();
  }
  addProgress(bytes) {
    if (this.prog) this.prog.done += bytes;
  }
  renderProgress() {
    const p = this.prog;
    if (!p) return;
    let done = p.done;
    if (p.sending) {
      // Show what the receiver says it has, so both bars match. (Older versions don't report it: estimate
      // from what left the send buffer instead.)
      if (p.acked != null) done = p.acked;
      else done -= this.direct ? this.dc.bufferedAmount : (ws ? ws.bufferedAmount : 0) + (this.txPending || 0);
    } else if (this.incoming && p.reported !== p.done) {
      p.reported = p.done;
      try { this.sendJson({ t: 'progress', got: p.done }); } catch {}
    }
    if (this.incoming) this.checkSlowDirect();
    done = Math.max(0, Math.min(p.total, done));
    this.checkStuck(p, done);
    const now = performance.now();
    // Speed over the last ~3 seconds: reacts to changes without jumping around
    p.samples.push([now, done]);
    while (p.samples.length > 2 && now - p.samples[0][0] > 3000) p.samples.shift();
    const [t0, b0] = p.samples[0];
    const speed = now - t0 >= 500 ? (done - b0) / ((now - t0) / 1000) : 0;
    const frac = done / p.total;
    this.setProgress(frac);
    $('.xfer-bar span', this.el).style.width = `${(frac * 100).toFixed(1)}%`;
    $('.xfer-pct', this.el).textContent = `${Math.floor(frac * 100)}%`;
    $('.xfer-speed', this.el).textContent = speed > 0 ? `${formatSize(speed)}/s` : '';
    const left = speed > 0 && done < p.total ? formatDuration((p.total - done) / speed) : '';
    $('.xfer-sub', this.el).textContent = `${formatSize(done)} / ${formatSize(p.total)}${left ? ` · ${t('{time} left', { time: left })}` : ''}`;
    const route = this.direct ? this.route
      : this.useRelay ? `${t('OmniBeam server')} · ${t('end-to-end encrypted')}` + (this.directFailInfo ? ` (${t('direct failed')}: ${this.directFailInfo})` : '')
      : null;
    $('.xfer-route', this.el).textContent = route ? `${t('Route')}: ${route}` : '';
  }
  // Nothing moved for STUCK_MS while this page was on screen: report it once per transfer (for /stats and the
  // owner's Telegram). Not while the other device said its screen turned off, and not at 100% (saving).
  checkStuck(p, done) {
    const now = Date.now();
    if (p.lastDone !== done || !p.movedAt) { p.lastDone = done; p.movedAt = now; return; }
    if (p.stuckSent || done >= p.total || document.hidden || now - visibleSince < STUCK_MS) return;
    if (this.asleepAt && now - this.asleepAt < 10 * 60000) return;
    if (now - p.movedAt < STUCK_MS) return;
    p.stuckSent = true;
    report('stuck', 'No progress for 30 seconds', {
      r: this.useRelay ? 'relay' : this.direct ? this.routeKind || 'internet' : 'none',
      role: p.sending ? 'send' : 'receive', same: !!this.info.sameNet, size: p.total,
      pct: Math.floor((done / (p.total || 1)) * 100), secs: Math.round((now - p.movedAt) / 1000),
      d: this.directFailInfo || undefined,
    });
  }
  // completed: show a full bar for a moment before hiding it
  endProgress(completed = false) {
    clearInterval(this.progTimer);
    const p = this.prog;
    this.prog = null;
    if (completed && p) {
      this.setProgress(1);
      $('.xfer-bar span', this.el).style.width = '100%';
      $('.xfer-pct', this.el).textContent = '100%';
      $('.xfer-speed', this.el).textContent = '';
      $('.xfer-sub', this.el).textContent = `${formatSize(p.total)} · ${t('Done')}`;
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => { if (!this.prog) this.hideProgress(); }, 1500);
      return;
    }
    this.hideProgress();
  }
  hideProgress() {
    setTimeout(updateWakeLock, 0);
    this.el.classList.remove('xferring');
    $('.xfer', this.el).hidden = true;
    this.setProgress(0);
  }

  // --- WebRTC setup ---
  createPc() {
    this.closePc();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) wsSend({ type: 'signal', to: this.info.id, data: { candidate: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed') this.failOpenWaiters();
      if (['failed', 'closed'].includes(pc.connectionState)) this.onDirectLost('Connection lost');
    };
    pc.ondatachannel = (e) => this.setupChannel(e.channel);
    return pc;
  }
  closePc() {
    if (this.dc) { this.dc.onclose = null; this.dc.close(); }
    if (this.pc) this.pc.close();
    this.pc = null;
    this.dc = null;
  }
  setupChannel(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_BUFFERED;
    dc.onopen = () => {
      this.directFailInfo = null;
      this.detectRoute();
      this.openWaiters.forEach((w) => w.resolve());
      this.openWaiters = [];
    };
    // Ignore messages still queued on a channel we already dropped (we may have resumed via the server)
    dc.onmessage = (e) => { if (this.dc === dc) this.onData(e.data); };
    dc.onclose = () => {
      if (this.dc === dc) this.onDirectLost('Connection closed');
    };
  }
  // The direct connection dropped (phones switching networks, flaky Wi-Fi, VPNs...). During a transfer, carry on
  // through the server relay from where the receiver got to instead of failing. The receiver picks the resume
  // point because only it knows what actually arrived; the sender pauses until it hears back.
  onDirectLost(reason) {
    // A WebRTC attempt that never carried this transfer (it's already going through the server) can fail
    // later on its own, e.g. on iPhones ~30 s after the sender gave up on it. That must not restart anything.
    const wasCarrying = !this.useRelay;
    this.closePc();
    if (!this.busy || !wasCarrying) return;
    if (!RELAY_ENABLED || !ws || ws.readyState !== WebSocket.OPEN) return this.abort(reason, true, true);
    console.info(`Direct connection to ${this.info.name} dropped (${reason}); continuing via server`);
    if (this.incoming) this.sendResumePoint();
    else {
      this.setStatus('Reconnecting via server…');
      wsSend({ type: 'signal', to: this.info.id, data: { resumeAsk: true } });
    }
  }
  // Receiver: tell the sender where to continue, over the server
  sendResumePoint(slow = false) {
    const inc = this.incoming;
    // Only once per transfer: a second resume point could race with data already relayed
    if (!inc || inc.resumed) return;
    inc.resumed = true;
    this.closePc();
    this.useRelay = true;
    const c = inc.current;
    // Big-file mode: what isn't checked yet is thrown away, so it continues at the start of that piece
    if (c?.seg) {
      if (this.prog) this.prog.done -= c.got - c.segStart;
      Object.assign(c, { got: c.segStart, segBuf: [], segCrc: 0xffffffff });
      inc.discard = 0;
    }
    const point = c
      ? { file: inc.index - 1, offset: c.got, header: false }
      : { file: inc.index, offset: 0, header: true };
    if (slow) point.slow = true;
    wsSend({ type: 'signal', to: this.info.id, data: { resume: point } });
    this.setStatus('Receiving via server…');
  }
  // Receiver: once per transfer, if the direct connection is much slower than the server would be, continue
  // via the server (same resume as for a dropped connection) and use the server for the next sends too
  checkSlowDirect() {
    const inc = this.incoming;
    if (!inc.current || inc.resumed || inc.speedChecked || !this.direct) return;
    if (!RELAY_ENABLED || !ws || ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (!inc.directSince) { inc.directSince = { at: now, done: this.prog.done }; return; }
    if (now - inc.directSince.at < SLOW_DIRECT_AFTER) return;
    inc.speedChecked = true;
    const rate = (this.prog.done - inc.directSince.done) / ((now - inc.directSince.at) / 1000);
    const left = this.prog.total - this.prog.done;
    if (rate >= SLOW_DIRECT_RATE || left < rate * 5) return;
    console.info(`Direct connection to ${this.info.name} is slow (${formatSize(rate)}/s); continuing via server`);
    this.directFailedAt = Date.now();
    this.directFailInfo = `${formatSize(rate)}/s`;
    report('direct', 'Direct connection too slow, switched to the server', { d: this.directFailInfo, r: this.routeKind, same: !!this.info.sameNet });
    this.sendResumePoint(true);
  }
  // Sender: the receiver said where to continue
  onResume(point) {
    // Only valid while sending over the direct channel; once on the relay, a resume would duplicate data
    if (!this.busy || !this.sending || !point || this.useRelay) return;
    this.closePc();
    this.useRelay = true;
    if (point.slow) this.directFailedAt = Date.now(); // the next sends go straight to the server too
    this.resumePoint = { file: Number(point.file) || 0, offset: Number(point.offset) || 0, header: point.header !== false };
    this.sendGen++;
    if (this.resumeWaiter) this.resumeWaiter('resume');
  }

  // Short description of what ICE tried, shown when a direct connection fails, e.g.
  // "you: host-mDNS, srflx-v4 · them: host-mDNS · checks: 2 failed"
  async iceSummary() {
    const pc = this.pc;
    if (!pc) return '';
    try {
      const stats = await pc.getStats();
      const kinds = (type) => {
        const set = new Set();
        stats.forEach((r) => {
          if (r.type !== type) return;
          const a = r.address || r.ip || '';
          set.add(`${r.candidateType}${a.endsWith('.local') ? '-mDNS' : a.includes(':') ? '-v6' : a ? '-v4' : ''}`);
        });
        return [...set].join(', ') || 'none';
      };
      const states = {};
      stats.forEach((r) => { if (r.type === 'candidate-pair') states[r.state] = (states[r.state] || 0) + 1; });
      const checks = Object.entries(states).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
      return `you: ${kinds('local-candidate')} · them: ${kinds('remote-candidate')} · checks: ${checks}`;
    } catch {
      return '';
    }
  }

  // Which network path WebRTC picked: same network, across the internet, or through a TURN relay server.
  // Shown under the progress bar so slow transfers can be explained.
  async detectRoute() {
    const pc = this.pc;
    this.route = null;
    if (!pc) return;
    try {
      // Wait briefly: the selected pair is sometimes reported a moment after the channel opens
      for (let i = 0; i < 10 && pc === this.pc; i++) {
        const stats = await pc.getStats();
        let pair = null;
        stats.forEach((r) => {
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        });
        if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
        if (pair) {
          const local = stats.get(pair.localCandidateId) || {};
          const remote = stats.get(pair.remoteCandidateId) || {};
          const types = [local.candidateType, remote.candidateType];
          this.routeKind = types.includes('relay') ? 'turn' : types.every((t) => t === 'host') ? 'lan' : 'internet';
          // Same Wi-Fi but not "host" to "host": the data leaves through the router and comes back (slow on many
          // routers). Usually the browser hid its local address; the ⚡ button fixes that.
          const viaRouter = this.routeKind === 'internet' && this.info.sameNet;
          if (viaRouter) noteIndirect();
          const kind = { turn: 'TURN relay', lan: 'same network', internet: viaRouter ? 'via router' : 'internet' }[this.routeKind];
          const proto = (local.relayProtocol || local.protocol || '').toUpperCase();
          const rtt = pair.currentRoundTripTime != null ? ` · ${Math.round(pair.currentRoundTripTime * 1000)} ms` : '';
          this.route = `${t(kind)}${proto ? ' ' + proto : ''}${rtt}`;
          console.info(`Route to ${this.info.name}: ${this.route}`, { local, remote, pair });
          return;
        }
        await sleep(300);
      }
    } catch (err) {
      console.warn('Could not read connection stats', err);
    }
  }

  // --- Transport: direct WebRTC data channel when possible, otherwise relayed through the server ---
  get direct() {
    return !!(this.dc && this.dc.readyState === 'open');
  }
  get relayed() {
    return !this.direct && this.useRelay;
  }
  // Largest message size both browsers accept on this connection, capped at MAX_CHUNK
  get chunkSize() {
    if (!this.direct) return RELAY_CHUNK;
    const max = this.pc && this.pc.sctp && this.pc.sctp.maxMessageSize;
    return max > 0 ? Math.max(MIN_CHUNK, Math.min(MAX_CHUNK, max)) : MIN_CHUNK;
  }
  // One attempt at a time: a warm-up started when the card was tapped and the send that follows share it
  connect() {
    if (!this.connecting) this.connecting = this.connectOnce().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async connectOnce() {
    if (this.direct) return;
    // After a failed direct attempt, keep using the relay for a while (no new 8 s wait on every send). Otherwise,
    // including after a transfer that dropped and finished via the server, try a direct connection first again.
    const recentFail = Date.now() - (this.directFailedAt || 0) < DIRECT_RETRY_AFTER;
    if (this.useRelay && recentFail && ws && ws.readyState === WebSocket.OPEN) return;
    this.useRelay = false;
    try {
      await this.connectRtc();
    } catch (err) {
      if (!RELAY_ENABLED) throw err;
      console.info(`Direct connection to ${this.info.name} failed (${err.message}); using server relay`);
      this.closePc();
      this.directFailedAt = Date.now();
      if (this.info.sameNet) noteIndirect();
      this.useRelay = true;
      // The ICE summary can arrive a moment after the failure
      setTimeout(() => report('direct', 'Direct connection failed, using the server', { d: this.directFailInfo || err.message, same: !!this.info.sameNet }), 1000);
      this.e2eKey().catch(() => {}); // swap relay keys now, not when the first chunk goes out
    }
  }
  // Start connecting as soon as the user taps a device, so it happens while they pick files or type
  warmUp() {
    if (this.busy || this.direct || peers.get(this.info.id) !== this) return;
    this.connect().catch(() => {});
  }
  // ICE gave up before the channel opened: fall back now instead of waiting out RTC_TIMEOUT
  failOpenWaiters() {
    if (!this.openWaiters.length) return;
    const waiters = this.openWaiters;
    this.openWaiters = [];
    this.iceSummary().then((info) => { this.directFailInfo = info; }, () => {});
    waiters.forEach((w) => w.reject(new Error('Could not connect to device')));
  }
  sendRaw(data) {
    if (this.direct) return this.dc.send(data);
    if (!this.useRelay || !ws || ws.readyState !== WebSocket.OPEN) throw new Error('Connection lost');
    // Through the server: encrypted first. Encryption is asynchronous, so messages queue up in order.
    const binary = typeof data !== 'string';
    const size = binary ? data.byteLength : data.length;
    const to = this.info.id;
    this.txPending = (this.txPending || 0) + size;
    this.txChain = (this.txChain || Promise.resolve())
      .then(async () => {
        const st = await this.e2eKey();
        const sealed = await E2E.seal(st.key, binary ? data : new TextEncoder().encode(data), `${me.id}>${to}:${st.tx++}:${binary ? 'b' : 't'}`);
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (!binary) return wsSend({ type: 'relay', to, data: 'E1:' + bufToB64(sealed) });
        // Binary relay frame: [36-byte target id][encrypted chunk]
        const out = new Uint8Array(36 + sealed.length);
        for (let i = 0; i < 36; i++) out[i] = to.charCodeAt(i);
        out.set(sealed, 36);
        ws.send(out.buffer);
      })
      .catch((err) => {
        console.warn('Relay send failed', err);
        if (this.busy) this.abort(err.message || 'Connection lost', true, true);
      })
      .finally(() => { this.txPending -= size; });
  }
  // From the server relay: decrypt in arrival order. Anything not encrypted with our key is dropped.
  onRelay(data, binary = false) {
    this.useRelay = true;
    const from = this.info.id;
    this.rxChain = (this.rxChain || Promise.resolve())
      .then(async () => {
        if (!binary && !String(data).startsWith('E1:')) return;
        const st = await this.e2eKey();
        const plain = await E2E.open(st.key, binary ? data : b64ToBuffer(String(data).slice(3)), `${from}>${me.id}:${st.rx++}:${binary ? 'b' : 't'}`);
        if (binary) this.onChunk(plain);
        else this.onData(new TextDecoder().decode(plain));
      })
      .catch((err) => {
        console.warn('Could not decrypt relayed data', err);
        if (this.busy) this.abort('Secure connection failed', true, true);
      });
  }

  // --- End-to-end key for the relay (see E2E) ---
  // Resolves to { key, tx, rx } (tx/rx count messages each way). Asks the other device for its public key
  // the first time; it answers with its own.
  e2eKey() {
    if (!this.e2e) {
      let timer;
      const pending = new Promise((resolve, reject) => {
        this.e2eDone = (st) => { clearTimeout(timer); resolve(st); };
        timer = setTimeout(() => reject(new Error('Secure connection failed')), 15000);
        E2E.init().then(() => wsSend({ type: 'signal', to: this.info.id, data: { e2e: E2E.pub } }), reject);
      });
      pending.catch(() => { if (this.e2e === pending) { this.e2e = null; this.e2eDone = null; } });
      this.e2e = pending;
    }
    return this.e2e;
  }
  onE2E(data) {
    const pub = data.e2e;
    if (typeof pub !== 'string' || pub.length > 200) return;
    if (!data.reply) E2E.init().then(() => wsSend({ type: 'signal', to: this.info.id, data: { e2e: E2E.pub, reply: true } }), () => {});
    if (pub === this.theirPub) return; // both sides asked at once: we already have this key
    this.theirPub = pub;
    const st = E2E.derive(pub, me.id, this.info.id).then((key) => ({ key, tx: 0, rx: 0 }));
    st.catch(() => {});
    if (this.e2eDone) { st.then(this.e2eDone, () => {}); this.e2eDone = null; }
    this.e2e = st;
  }

  // Ensure an open data channel, initiating the connection if needed
  async connectRtc() {
    if (this.direct) return;
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC not available');
    const opened = new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.openWaiters.push(waiter);
      setTimeout(async () => {
        if (!this.openWaiters.includes(waiter)) return;
        this.openWaiters = this.openWaiters.filter((w) => w !== waiter);
        this.directFailInfo = await this.iceSummary();
        console.info(`Direct connection to ${this.info.name} failed: ${this.directFailInfo}`);
        reject(new Error('Could not connect to device'));
      }, RTC_TIMEOUT);
    });
    if (!this.dc || this.dc.readyState === 'closed') {
      const pc = this.createPc();
      this.setupChannel(pc.createDataChannel('omnibeam', { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend({ type: 'signal', to: this.info.id, data: { sdp: pc.localDescription } });
    }
    return opened;
  }
  onSignal(data) {
    // Process signals strictly in order so candidates never arrive before the remote description
    this.signalQueue = this.signalQueue.then(async () => {
      try {
        if (data.sdp) {
          if (data.sdp.type === 'offer') {
            const pc = this.createPc();
            await pc.setRemoteDescription(data.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            wsSend({ type: 'signal', to: this.info.id, data: { sdp: pc.localDescription } });
          } else if (this.pc) {
            await this.pc.setRemoteDescription(data.sdp);
          }
        } else if (data.candidate && this.pc) {
          await this.pc.addIceCandidate(data.candidate);
        }
      } catch (err) {
        console.warn('Signal error', err);
      }
    });
  }

  sendJson(obj) {
    this.sendRaw(JSON.stringify(obj));
  }
  async waitForBuffer() {
    if (!this.direct) {
      while (ws && ws.readyState === WebSocket.OPEN && ws.bufferedAmount + (this.txPending || 0) > RELAY_MAX_BUFFERED) await sleep(30);
      return;
    }
    if (this.dc.bufferedAmount < MAX_BUFFERED) return;
    await new Promise((resolve) => {
      const dc = this.dc;
      // Safari can be late with the event: also look every 50 ms
      const timer = setInterval(() => { if (dc.readyState !== 'open' || dc.bufferedAmount <= LOW_BUFFERED) done(); }, 50);
      const done = () => { clearInterval(timer); dc.removeEventListener('bufferedamountlow', done); dc.removeEventListener('close', done); resolve(); };
      dc.addEventListener('bufferedamountlow', done);
      dc.addEventListener('close', done);
    });
  }

  // --- Sending ---
  async sendText(text) {
    try {
      this.setStatus('Connecting…');
      await this.connect();
      this.sendJson({ t: 'text', text });
      this.setStatus('');
      toast(t('Message sent to {name}', { name: this.info.name }));
      Sent.add(this, { text }, 'ok');
      this.reportStat({ kind: 'text', bytes: 0, files: 0 });
    } catch (err) {
      this.setStatus('');
      toast(t(err.message));
    }
  }

  // A secret note: shown once on the other device, never kept in its history or notifications (see media.js)
  async sendSecret(text) {
    try {
      this.setStatus('Connecting…');
      await this.connect();
      this.sendJson({ t: 'secret', text });
      this.setStatus('');
      toast(t('Secret note sent to {name}', { name: this.info.name }));
      this.reportStat({ kind: 'secret', bytes: 0, files: 0 });
    } catch (err) {
      this.setStatus('');
      toast(t(err.message));
    }
  }

  // Ring this device (to find it): it beeps loudly, vibrates and shows a Stop button for up to 30 seconds
  async ring() {
    try {
      this.setStatus('Connecting…');
      await this.connect();
      this.sendJson({ t: 'ring' });
      this.setStatus('');
      toast(t('Ringing {name}…', { name: this.info.name }));
      wsSend({ type: 'stat', kind: 'ring' });
    } catch (err) {
      this.setStatus('');
      toast(t(err.message));
    }
  }

  // Tell the server's daily totals how a finished send went (numbers only; see the stats page)
  reportStat(info) {
    const route = this.useRelay || !this.direct ? 'relay' : this.routeKind || 'internet';
    this.lastRoute = route;
    wsSend({ type: 'stat', route, peer: this.info.id, ...info });
    window.dispatchEvent(new Event('omnibeam-sent')); // install.js offers to install the app after a send
  }

  // A send that stopped before the end, for the success rate on the stats page (numbers only).
  // why: cancel (someone pressed Stop), lost (connection or the other device went away), error (anything else)
  reportFail(why) {
    const route = this.useRelay ? 'relay' : this.direct ? this.routeKind || 'internet' : 'none';
    wsSend({ type: 'stat', kind: 'fail', why, route, peer: this.info.id, bytes: 0, files: 0 });
  }

  // opts.xid: continue an interrupted transfer (see AutoResume); the receiver accepts it without asking again.
  // opts.fps: the files' fingerprints when they were first sent (picked again after a reload, see Outgoing)
  async sendFiles(files, opts = {}) {
    if (this.busy) {
      this.queue.push(files);
      toast(t('Queued: will send to {name} after the current transfer', { name: this.info.name }));
      return;
    }
    this.busy = true;
    this.cancelled = false;
    const original = files; // before HEIC conversion and shrinking: what Send again sends
    // Each send owns the peer's transfer state until it ends or is aborted. A cancelled send can still be
    // waking up from an await when the next one starts: it must neither carry on nor tidy up the new one.
    const job = { send: true }; // (a speed test has a job too)
    this.job = job;
    const gone = () => this.cancelled || this.job !== job;
    try {
      files = await convertHeic(files, this.info.device);
      if (shrinkMode !== 'off') this.connect().catch(() => {}); // connect while shrinking
      files = await shrinkFiles(files, this, gone);
      if (gone()) return;
      this.setStatus(opts.xid ? 'Resuming…' : 'Connecting…');
      await this.connect();
      if (!opts.xid) this.setStatus('Waiting…');
      const [proofs, fps] = await Promise.all([pairProofs(me.id, this.info.id, this.info),
        opts.fps?.length === files.length ? opts.fps : fingerprints(files)]);
      if (gone()) return;
      // A random id for this transfer: lets it continue by itself if the connection drops (see AutoResume)
      job.xid = opts.xid || randomHex(16);
      job.files = files;
      this.acceptHave = null;
      const accepted = await new Promise((resolve) => {
        this.acceptWaiter = resolve;
        this.sendJson({ t: 'request', files: files.map((f, i) => ({ name: pathOf(f), size: f.size, mime: f.type, fp: fps[i] })), proofs, xid: job.xid });
      });
      this.acceptWaiter = null;
      if (!accepted) {
        if (!gone()) {
          toast(this.declineWhy === 'space' ? t('{name} does not have enough free space for this.', { name: this.info.name }) : t('{name} declined', { name: this.info.name }));
          Sent.add(this, original, 'declined', job.xid);
          job.logged = true;
        }
        return;
      }
      // Noted in case this page is thrown away before the end (see Outgoing)
      Outgoing.add(this, job.xid, files, fps);
      // File check sums are worked out from the blocks read for sending (see sumBlock)
      job.sums = files.map(() => ({ pos: 0, crc: 0xffffffff, done: false }));
      await loadMore().catch(() => {});
      if (gone()) return;
      // Big-file mode, if the receiver takes part (it said its piece size) and the CRC code is here
      job.segSize = this.acceptSeg && window.More ? this.acceptSeg : 0;
      const big = job.segSize ? files.filter((f) => f.size >= BIG_MIN).length : 0;
      if (big) toast(t('Big-file mode: every {size} is checked as it arrives, and only a bad piece is sent again.', { size: formatSize(job.segSize) }), 5000);
      // The receiver may already have some of these files, or the start of one, from an interrupted transfer
      const have = files.map((f, i) => Math.max(0, Math.min(f.size, Number(this.acceptHave?.[i]) || 0)));
      const skipped = have.reduce((s, n) => s + n, 0);
      if (skipped && !opts.xid) toast(t('Continuing where the last transfer stopped'));
      const total = files.reduce((s, f) => s + f.size, 0);
      this.sending = true;
      this.sendGen = (this.sendGen || 0) + 1;
      this.resumePoint = null;
      this.startProgress(total, true);
      this.prog.done = this.prog.acked = skipped;
      this.prog.samples = [[performance.now(), skipped]];
      let from = { file: 0, offset: 0, header: true };
      for (;;) {
        const gen = this.sendGen;
        if (await this.sendFrom(files, from, gen, have)) {
          if (!job.sumsRest) job.sumsRest = this.sendChecksums(files, job);
          // Wait for the receiver to confirm it got everything (or to ask us to resend the end via the server)
          const res = await new Promise((resolve) => { this.acceptWaiter = resolve; this.resumeWaiter = resolve; });
          this.acceptWaiter = this.resumeWaiter = null;
          if (res === false || gone()) return;
          if (res === true) break;
        } else if (!this.resumePoint) {
          if (gone()) return;
          // The direct connection dropped: wait for the receiver to say where to continue
          this.setStatus('Reconnecting via server…');
          await new Promise((resolve) => { this.resumeWaiter = resolve; setTimeout(resolve, 10000); });
          this.resumeWaiter = null;
          if (gone()) return;
          // No answer (its screen may be off): keep the files, and the transfer continues when it's back
          if (!this.resumePoint) {
            const asleep = Date.now() - (this.asleepAt || 0) < RESUME_WINDOW;
            this.abort(t(asleep ? PAUSED_OTHER : 'Connection lost. The transfer continues by itself when {name} is back (keep this page open).', { name: this.info.name }), true, true, '', asleep);
            return;
          }
        }
        from = this.resumePoint;
        this.resumePoint = null;
        // Progress goes back to what the receiver actually has
        this.prog.done = this.prog.acked = files.slice(0, from.file).reduce((s, f) => s + f.size, 0) + from.offset;
        this.prog.samples = [[performance.now(), this.prog.done]];
      }
      this.endProgress(true);
      toast(t(files.length > 1 ? 'Sent {n} files to {name}' : 'Sent 1 file to {name}', { n: files.length, name: this.info.name }));
      this.reportStat({ bytes: total - skipped, files: files.length, ...(opts.xid ? { resumed: 1 } : {}) });
      if (big) wsSend({ type: 'stat', kind: 'bigfile' });
      Sent.add(this, original, 'ok', job.xid);
      job.logged = true;
      AskAfterSend.sent();
    } catch (err) {
      if (!gone()) {
        toast(t(err.message));
        this.reportProblem(err.message);
        this.reportFail(/connection lost/i.test(err.message) ? 'lost' : 'error');
        Sent.add(this, original, 'failed', job.xid);
        job.logged = true;
      }
    } finally {
      // Stopped with ✕ (here or on the other device) or the connection went away: still in the Sent list
      if (!job.logged && job.xid) Sent.add(this, original, this.cancelled && !job.kept ? 'cancelled' : 'failed', job.xid);
      // Not to be continued any more (otherwise AutoResume continues it)
      if (job.xid && !job.kept) Outgoing.remove(job.xid);
      // After an abort, abort() has already reset everything (and a newer send may be running)
      if (this.job === job) {
        this.job = null;
        this.acceptWaiter = this.resumeWaiter = null;
        this.sending = false;
        this.busy = false;
        this.setStatus('');
        if (this.prog) this.endProgress();
      }
    }
  }

  // Send files[from.file] onwards, starting at byte from.offset. Returns true once everything (and 'done') is
  // sent, false if interrupted: the connection dropped or the receiver asked to resume from another point.
  // have: bytes of each file the receiver already has.
  async sendFrom(files, from, gen, have = []) {
    const stale = () => this.cancelled || gen !== this.sendGen;
    try {
      const chunkSize = this.chunkSize;
      for (let i = from.file; i < files.length; i++) {
        const file = files[i];
        const first = i === from.file;
        this.setStatus(files.length > 1
          ? t(this.relayed ? 'Sending via server {i} of {n}…' : 'Sending {i} of {n}…', { i: i + 1, n: files.length })
          : this.relayed ? 'Sending via server…' : 'Sending…');
        if (stale()) return false;
        let offset = Math.min(Math.max(first ? from.offset : 0, have[i] || 0), file.size);
        // Big-file mode: pieces of segSize, each followed by {t:'seg'} with its CRC-32 (null for a piece that starts
        // in the middle, after an older resume: the receiver then checks the whole file at the end instead)
        const segSize = this.job?.segSize && file.size >= BIG_MIN ? this.job.segSize : 0;
        const seg = segSize ? { end: Math.min(file.size, (Math.floor(offset / segSize) + 1) * segSize), crc: 0xffffffff, partial: offset % segSize !== 0 } : null;
        if (!first || from.header) {
          this.sendJson({ t: 'file', name: pathOf(file), size: file.size, mime: file.type, offset, ...(seg ? { seg: segSize } : {}), ...(first && from.redo ? { redo: from.redo } : {}) });
        }
        // Read the next block from disk while the current one is being sent
        let next = offset < file.size ? file.slice(offset, offset + READ_BLOCK).arrayBuffer() : null;
        while (offset < file.size) {
          const block = await next;
          const nextOffset = offset + block.byteLength;
          next = nextOffset < file.size ? file.slice(nextOffset, nextOffset + READ_BLOCK).arrayBuffer() : null;
          this.sumBlock(i, offset, block);
          for (let pos = 0; pos < block.byteLength;) {
            await this.waitForBuffer();
            if (stale()) return false;
            // A chunk never crosses the end of a piece
            const end = Math.min(pos + chunkSize, block.byteLength, seg ? seg.end - offset : Infinity);
            const chunk = block.slice(pos, end);
            this.sendRaw(chunk);
            this.addProgress(chunk.byteLength);
            pos = end;
            if (seg) {
              if (!seg.partial) seg.crc = More.crc32Update(seg.crc, new Uint8Array(chunk));
              if (offset + pos === seg.end) {
                this.sendJson({ t: 'seg', i, end: seg.end, crc: seg.partial ? null : More.crc32Final(seg.crc) });
                Object.assign(seg, { end: Math.min(file.size, seg.end + segSize), crc: 0xffffffff, partial: false });
              }
            }
          }
          offset = nextOffset;
        }
        this.sendSum(i, file.size);
      }
      if (stale()) return false;
      this.sendJson({ t: 'done' });
      this.setStatus('Finishing…');
      return true;
    } catch (err) {
      // sendRaw throws when the direct channel is gone and the relay isn't in use yet: wait for a resume point
      if (this.cancelled || this.direct || this.useRelay) throw err;
      return false;
    }
  }

  // "File intact" check: a CRC-32 of each whole file, sent once ready. The receiver works out the same from what
  // it saved (including any part kept from an interrupted transfer) and compares. The sender works it out from
  // the blocks it reads for sending, so the file isn't read twice.
  sumBlock(i, offset, block) {
    const s = this.job?.sums?.[i];
    if (!s || s.done || !window.More || offset > s.pos || offset + block.byteLength <= s.pos) return;
    s.crc = More.crc32Update(s.crc, new Uint8Array(block, s.pos - offset));
    s.pos = offset + block.byteLength;
  }
  sendSum(i, size) {
    const job = this.job;
    const s = job?.sums?.[i];
    if (!s || s.done || s.pos !== size || !window.More) return;
    s.done = true;
    this.sendJson({ t: 'sum', xid: job.xid, i, crc: More.crc32Final(s.crc) });
  }
  // Files not read from the start while sending (the receiver already had them or their start) are read again
  // once the sending is done. Runs in the background; a lost connection just means no check this time.
  async sendChecksums(files, job) {
    try {
      await loadMore();
      for (const [i, file] of files.entries()) {
        if (job.sums[i].done) continue;
        const crc = await More.crc32(file);
        if (this.cancelled || peers.get(this.info.id) !== this) return;
        job.sums[i].done = true;
        this.sendJson({ t: 'sum', xid: job.xid, i, crc });
      }
    } catch (err) {
      console.info('File check not sent', err.message || err);
    }
  }

  // A transfer failed: note how (route, direction, size), for the stats page
  reportProblem(message) {
    report('transfer', message, {
      r: this.useRelay ? 'relay' : this.direct ? this.routeKind || 'internet' : 'none',
      role: this.incoming ? 'receive' : 'send',
      same: !!this.info.sameNet,
      size: this.prog?.total,
      d: this.directFailInfo || undefined,
    });
  }

  // Stop the current transfer. Unless the other device told us to stop, tell it too (through the server,
  // since the data channel may be the thing that broke) so neither side keeps showing progress.
  // keep: the transfer broke rather than being cancelled, so the receiver keeps what arrived (see Partials)
  // why: how the stats page counts it if this device was sending (see reportFail); worked out from reason/keep if not given
  // pause: a screen turned off. Not a problem, so not reported as one; the other device is told, so it can say why.
  abort(reason, notifyPeer = true, keep = false, why = '', pause = false) {
    if (this.busy && this.job?.send) this.reportFail(why || (reason === 'Transfer cancelled' ? 'cancel' : keep ? 'lost' : 'error'));
    if (notifyPeer && this.busy) wsSend({ type: 'signal', to: this.info.id, data: { abort: reason, keep, ...(pause ? { pause: true } : {}) } });
    if (notifyPeer && this.busy && reason !== 'Transfer cancelled' && !pause) this.reportProblem(reason);
    // The connection broke (not a cancel): both sides remember the transfer, so it continues by itself when
    // the two devices see each other again
    if (keep && this.job) this.job.kept = true;
    if (keep && this.sending && this.job?.xid) AutoResume.remember(this, this.job, this.prog?.acked || 0);
    if (this.incoming?.xid) {
      if (keep) Interrupted.add(this.incoming.xid, this.info.name);
      else Interrupted.take(this.incoming.xid);
    }
    this.cancelled = true;
    if (reason) toast(t(reason), pause ? 6000 : 3000);
    // Stop the send loop and release whatever it is waiting for
    this.job = null;
    this.sendGen = (this.sendGen || 0) + 1;
    this.sending = false;
    if (this.acceptWaiter) this.acceptWaiter(false);
    if (this.resumeWaiter) this.resumeWaiter(false);
    this.acceptWaiter = this.resumeWaiter = null;
    for (const w of ['pongWaiter', 'speedReady', 'speedResult']) this[w]?.(null); // a speed test
    if (this.incoming) {
      const inc = this.incoming;
      if (keep && Store.kind !== 'memory') {
        // Let the writes already queued finish, then save the open file so far (a resume waits for this)
        inc.keep = true;
        Store.settle(inc.chain.then(async () => {
          if (inc.current?.sink) await inc.current.sink.save().catch(() => {});
          for (const f of inc.files) if (f.id && f.blob) History.add(f, this.info.name, this.pairSecret);
        }));
      } else {
        // Throw away a partly written file
        inc.chain.then(() => {
          Partials.forget([...inc.files.map((f) => f.id), inc.current?.sink?.id].filter(Boolean));
          if (inc.current?.sink) inc.current.sink.discard();
        });
        inc.files.forEach((f) => f.id && Store.remove(f.id));
      }
    }
    this.incoming = null;
    this.endSpeedTest();
    this.busy = false;
    this.setStatus('');
    this.endProgress();
    if (keep && pause) this.showWaiting(t(screenWasOff() ? 'Resuming…' : PAUSED_OTHER, { name: this.info.name }));
  }
  // A screen turned off (the other device's, or this one's): stop now, keeping what arrived, so that the transfer
  // continues by itself (AutoResume) from where it stopped as soon as both devices are back
  pause(reason) {
    if (!this.busy || !(this.job?.send || this.incoming)) return;
    this.abort(reason, true, true, 'lost', true);
  }
  // Receiver: save what arrived so far now (a phone may throw the page away while it's in the background)
  saveSoFar() {
    const inc = this.incoming;
    if (!inc || inc.current?.seg) return;
    if (inc.xid) Interrupted.add(inc.xid, this.info.name);
    this.queueStore(async () => { await inc.current?.sink?.save(); });
  }

  // --- Receiving ---
  onData(data) {
    if (typeof data !== 'string') return this.onChunk(data);
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    switch (msg.t) {
      case 'text': {
        Messages.add(String(msg.text), this.info.name, this.pairSecret);
        messageSound();
        if (chatShowing(this)) break;
        const link = linkOnly(msg.text);
        if (link) linkArrived(this, link);
        else messageArrived(this, String(msg.text));
        break;
      }
      case 'ring':
        Ringer.start(this);
        break;
      case 'ring-ok':
        toast(msg.sound ? t('{name} is ringing', { name: this.info.name })
          : t('{name} shows the ring on screen, but its browser blocked the sound. Tap OmniBeam on it once, then ring again.', { name: this.info.name }), msg.sound ? 3000 : 6000);
        break;
      case 'ring-busy':
        toast(t('You just rang {name}. Wait a few seconds and try again.', { name: this.info.name }));
        break;
      case 'ring-stop':
        Ringer.stop(this, false);
        break;
      case 'ring-found':
        toast(t('{name} was found and stopped ringing', { name: this.info.name }));
        break;
      case 'secret':
        chime();
        notify(t('Secret note from {name}', { name: this.info.name }), t('Open OmniBeam to read it. It is shown once.'));
        media('showSecret')(this.info.name, String(msg.text)).catch(() => {});
        break;
      case 'clip':
        onClip(this, msg);
        break;
      case 'ping':
        this.sendJson({ t: 'pong' });
        break;
      case 'pong':
        if (this.pongWaiter) this.pongWaiter();
        break;
      case 'speed':
      case 'speed-ready':
      case 'speed-busy':
      case 'speed-end':
      case 'speed-result':
        this.onSpeed(msg);
        break;
      case 'request': {
        // The sender continues the transfer this device is still receiving (it paused, and we didn't hear): keep
        // what arrived and take the rest
        if (this.busy && this.incoming?.xid && this.incoming.xid === msg.xid) this.abort('', false, true, '', true);
        if (this.busy || !Array.isArray(msg.files)) { this.sendJson({ t: 'decline' }); break; }
        msg.files = msg.files.map((f) => ({
          name: safePath(f.name), size: Math.max(0, Number(f.size) || 0), mime: String(f.mime || ''),
          fp: /^[0-9a-f]{32}$/.test(f.fp) ? f.fp : null,
        }));
        const xid = /^[0-9a-f]{32}$/.test(msg.xid) ? msg.xid : null;
        // The rest of a transfer this device already accepted, after the connection dropped: no need to ask again
        const resuming = Interrupted.take(xid);
        (async () => {
          const auto = resuming || (await autoAcceptFrom(this.info.id, msg.proofs));
          if (resuming) toast(t('Continuing the transfer from {name}', { name: this.info.name }));
          else if (auto) toast(t('Receiving from {name} (auto-accept)', { name: this.info.name }));
          // A TV with a PIN takes files only from phones that paired with the PIN
          const ok = auto || (IS_TV && tvPin() ? (toast(t('{name} is not paired with this TV. Scan the QR code and type the PIN first.', { name: this.info.name }), 6000), false) : await askAccept(this, msg.files));
          if (!ok) return this.sendJson({ t: 'decline' });
          // Big transfers: is there room for it? (The browser's own estimate; it errs on the low side.)
          const need = msg.files.reduce((s, f) => s + f.size, 0);
          if (need >= BIG_MIN) {
            if (Store.kind === 'memory') toast(t('This browser keeps received files in memory, so a transfer this big may not fit. Chrome, Edge or Firefox store it on disk.'), 8000);
            const est = await navigator.storage?.estimate?.().catch(() => null);
            if (est && est.quota && est.quota - (est.usage || 0) < need) {
              toast(t('Not enough free space for this transfer ({free} free). Free up some space and ask for it again.', { free: formatSize(Math.max(0, est.quota - (est.usage || 0))) }), 8000);
              return this.sendJson({ t: 'decline', why: 'space' });
            }
          }
          if (!window.More) await loadMore().catch(() => {});
          // Files we already have all or part of from an interrupted transfer: ask only for the rest (once what
          // was being saved when it stopped is saved)
          const resume = {};
          const have = {};
          await Store.ready; // a page that just opened (thrown away while its screen was off) may still be starting it
          await Store.settled;
          if (Store.kind !== 'memory') {
            for (const [i, f] of msg.files.entries()) {
              const p = Partials.find(f.fp);
              if (!p || p.size !== f.size) continue;
              const got = await Store.size(p.id);
              if (got > 0 && got <= f.size) { resume[i] = { id: p.id, got }; have[i] = got; }
            }
          }
          const total = msg.files.reduce((s, f) => s + f.size, 0);
          const skipped = Object.values(have).reduce((s, n) => s + n, 0);
          if (skipped) console.info(`Continuing a transfer from ${this.info.name}: ${formatSize(skipped)} already here`);
          // chain: every storage step of this transfer runs in order (creating files, writing chunks, closing)
          this.incoming = { total, count: msg.files.length, index: 0, files: [], current: null, chain: Promise.resolve(), req: msg.files, resume, xid };
          this.check = xid ? { xid, sums: {}, files: null } : null;
          // Noted at once, not only when it breaks: if this page is thrown away (a phone's screen turned off), the
          // sender can still continue it here after a reload
          if (xid) Interrupted.add(xid, this.info.name);
          this.busy = true;
          this.setStatus(this.relayed ? 'Receiving via server…' : 'Receiving…');
          this.startProgress(total, false);
          this.prog.done = skipped;
          this.prog.samples = [[performance.now(), skipped]];
          if (skipped && !resuming) toast(t('Continuing where the last transfer stopped'));
          // seg: this device checks big files piece by piece (big-file mode), with pieces of this size
          this.sendJson({ t: 'accept', have, ...(window.More ? { seg: BIG_SEG } : {}) });
        })().catch((err) => console.warn('Request failed', err));
        chime();
        notify(t('{name} wants to send you files', { name: this.info.name }), msg.files.slice(0, 10).map((f) => f.name).join(', '));
        break;
      }
      case 'progress':
        if (this.prog && this.prog.sending) this.prog.acked = Number(msg.got) || 0;
        break;
      case 'sum':
        if (this.check && msg.xid === this.check.xid && Number.isInteger(msg.i)) {
          this.check.sums[msg.i] = Number(msg.crc) >>> 0;
          this.checkIntact();
        }
        break;
      case 'accept':
        this.acceptHave = msg.have && typeof msg.have === 'object' ? msg.have : null;
        // Big-file mode: the receiver's piece size (older versions send none: then no piece checks)
        this.acceptSeg = Number.isInteger(msg.seg) && msg.seg >= 256 * 1024 && msg.seg <= 64 * 1024 * 1024 && msg.seg % 65536 === 0 ? msg.seg : 0;
      // falls through
      case 'decline':
        if (msg.t === 'decline') this.declineWhy = msg.why === 'space' ? 'space' : '';
      case 'received':
        if (this.acceptWaiter) this.acceptWaiter(msg.t !== 'decline');
        break;
      case 'seg':
        this.onSeg(msg);
        break;
      case 'redo':
        // Receiver: a piece didn't match its check; send it again from its start
        if (this.sending && this.job?.segSize && Number.isInteger(msg.n) && Number.isInteger(msg.file) && Number(msg.offset) >= 0) {
          this.resumePoint = { file: msg.file, offset: Number(msg.offset), header: true, redo: msg.n };
          this.sendGen++;
          if (this.resumeWaiter) this.resumeWaiter('resume');
        }
        break;
      case 'file': {
        const inc = this.incoming;
        if (!inc) return;
        // Waiting for a piece to be sent again: everything up to its new start is from before and is skipped
        if (inc.discard) {
          const c = inc.current;
          if (msg.redo !== inc.discard || !c) return;
          inc.discard = 0;
          if ((Number(msg.offset) || 0) !== c.got) return this.abort('Could not continue the interrupted transfer');
          return;
        }
        const i = inc.index++;
        if (inc.count > 1) {
          this.setStatus(t(this.relayed ? 'Receiving via server {i} of {n}…' : 'Receiving {i} of {n}…', { i: inc.index, n: inc.count }));
        }
        const prev = inc.resume?.[i];
        const c = { name: safePath(msg.name), size: Math.max(0, Number(msg.size) || 0), mime: String(msg.mime || ''), chunks: [], got: prev ? prev.got : 0, sink: null };
        // The sender must continue exactly where our saved part ends
        if ((Number(msg.offset) || 0) !== c.got) return this.abort('Could not continue the interrupted transfer');
        // Big-file mode: pieces are held here until their check matches (see onSeg)
        if (msg.seg === BIG_SEG && window.More) Object.assign(c, { seg: BIG_SEG, segStart: c.got, segBuf: [], segCrc: 0xffffffff, segAll: c.got % BIG_SEG === 0, redos: 0 });
        inc.current = c;
        const fp = inc.req?.[i]?.fp;
        this.queueStore(async () => {
          c.sink = await Store.create(prev?.id);
          if (c.sink && fp) Partials.add({ fp, id: c.sink.id, size: c.size });
        });
        if (c.got >= c.size) this.finishFile();
        break;
      }
      case 'done': {
        const inc = this.incoming;
        if (!inc || inc.discard) return;
        this.setStatus('Saving…');
        // Finish writing everything to storage first
        inc.chain.then(() => {
          if (this.incoming !== inc) return;
          this.sendJson({ t: 'received' });
          Partials.forget(inc.files.map((f) => f.id).filter(Boolean));
          if (inc.xid) Interrupted.take(inc.xid);
          if (!chatShowing(this)) showReceived(this, inc.files);
          else messageSound();
          inc.files.forEach((f) => History.add(f, this.info.name, this.pairSecret));
          if (this.check && this.check.xid === inc.xid) this.verifyFiles(this.check, inc.files);
          this.incoming = null;
          this.busy = false;
          this.setStatus('');
          this.endProgress(true);
        });
        break;
      }
    }
  }
  onChunk(buf) {
    if (this.speedRx) return this.speedChunk(buf);
    const inc = this.incoming;
    if (!inc || !inc.current || inc.discard) return;
    const c = inc.current;
    if (c.seg) {
      // Big-file mode: held until the piece's check arrives
      c.segBuf.push(buf);
      c.segCrc = More.crc32Update(c.segCrc, new Uint8Array(buf));
      c.got += buf.byteLength;
      this.addProgress(buf.byteLength);
      if (c.got - c.segStart > 2 * c.seg) this.abort('Transfer failed'); // a sender that never sends the checks
      return;
    }
    this.queueStore(async () => { if (c.sink) await c.sink.write(buf); else c.chunks.push(buf); });
    c.got += buf.byteLength;
    this.addProgress(buf.byteLength);
    if (inc.current.got >= inc.current.size) this.finishFile();
  }
  // Big-file mode: the sender's check of the piece that just ended. Matches: save it (and finish the file after its
  // last piece). Doesn't match: throw it away and ask for that piece again.
  onSeg(msg) {
    const inc = this.incoming;
    const c = inc?.current;
    if (!c || !c.seg || inc.discard) return;
    const ok = Number(msg.end) === c.got && (msg.crc === null ? (c.segAll = false, true) : (Number(msg.crc) >>> 0) === More.crc32Final(c.segCrc));
    if (!ok) {
      c.redos++;
      report('transfer', 'Big-file piece failed its check, sent again', { r: this.lastRoute || (this.useRelay ? 'relay' : this.routeKind), n: c.redos });
      if (c.redos > BIG_REDO_MAX) return this.abort(t('{file} did not arrive intact. Ask {name} to send it again.', { file: c.name, name: this.info.name }));
      if (this.prog) this.prog.done -= c.got - c.segStart;
      Object.assign(c, { got: c.segStart, segBuf: [], segCrc: 0xffffffff });
      inc.discard = (inc.redoN = (inc.redoN || 0) + 1);
      console.info(`A piece of ${c.name} at ${c.segStart} failed its check; asking for it again`);
      return this.sendJson({ t: 'redo', file: inc.index - 1, offset: c.segStart, n: inc.discard });
    }
    const bufs = c.segBuf;
    Object.assign(c, { segBuf: [], segCrc: 0xffffffff, segStart: c.got });
    this.queueStore(async () => { for (const b of bufs) { if (c.sink) await c.sink.write(b); else c.chunks.push(b); } });
    if (c.got >= c.size) this.finishFile();
  }
  finishFile() {
    const inc = this.incoming;
    const c = inc.current;
    inc.current = null;
    const entry = { name: c.name, size: c.size, mime: c.mime, blob: null, id: null, segOk: !!(c.seg && c.segAll) };
    inc.files.push(entry);
    this.queueStore(async () => {
      const type = c.mime || 'application/octet-stream';
      if (c.sink) {
        entry.id = c.sink.id;
        entry.blob = new Blob([await c.sink.finish()], { type }); // backed by disk, not memory
      } else {
        entry.blob = new Blob(c.chunks, { type });
        c.chunks = [];
      }
    });
  }
  // "File intact" check (see sendChecksums): work out each saved file's CRC-32, then compare with the sender's
  async verifyFiles(check, files) {
    check.files = files;
    try {
      await loadMore();
      for (const f of files) {
        if (this.check !== check) return;
        // Checked piece by piece already (big-file mode): no need to read it all again
        f.crc = f.segOk ? 0 : f.blob ? await More.crc32(f.blob) : null;
      }
    } catch (err) {
      console.info('Could not check the received files', err.message || err);
      return;
    }
    this.checkIntact();
    // An older sender sends no checksums: then there's nothing to compare, and no badge
    setTimeout(() => { if (this.check === check) this.check = null; }, 120000);
  }
  checkIntact() {
    const check = this.check;
    // A file checked piece by piece (big-file mode) needs no whole-file sum: it may have been lost when the transfer
    // switched to the server midway, and then the badge would never show
    if (!check || !check.files || check.files.some((f, i) => f.crc === undefined || (!f.segOk && !(i in check.sums)))) return;
    this.check = null;
    const bad = [];
    check.files.forEach((f, i) => {
      f.intact = f.segOk || f.crc === check.sums[i];
      if (!f.intact) bad.push(f);
      showIntact(f);
    });
    if (bad.length) {
      toast(t('{file} did not arrive intact. Ask {name} to send it again.', { file: bad[0].name, name: this.info.name }), 8000);
      report('transfer', 'Received file failed the intact check', { r: this.lastRoute || (this.useRelay ? 'relay' : this.routeKind), n: bad.length });
    }
  }

  // Run a storage step after the previous ones of this transfer; a failure (e.g. storage full) stops it
  queueStore(step) {
    const inc = this.incoming;
    if (!inc) return;
    inc.chain = inc.chain.then(() => (this.incoming === inc || inc.keep ? step() : undefined)).catch((err) => {
      if (this.incoming === inc) this.abort(t('Could not save the file') + ` (${err.message || err})`);
    });
  }

  // --- Clipboard sync (see onClip) ---
  async sendClip(text) {
    try {
      await this.connect();
      const proofs = await pairProofs(me.id, this.info.id);
      if (peers.get(this.info.id) === this) this.sendJson({ t: 'clip', text, proofs });
    } catch (err) {
      console.info(`Clipboard not sent to ${this.info.name}: ${err.message}`);
    }
  }

  // --- Speed test ---
  // Measures what really arrives on the other device over the route a transfer would take now (direct, TURN or
  // the server), plus the round trip time. Resolves to { rate (bytes/s), ping (ms), route }.
  async speedTest() {
    if (this.busy) throw new Error('Transfer in progress…');
    this.busy = true;
    this.cancelled = false;
    const job = {};
    this.job = job;
    const gone = () => this.cancelled || this.job !== job;
    const answer = (name, ms) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this[name] = null; reject(new Error('The other device did not answer')); }, ms);
      this[name] = (v) => { clearTimeout(timer); this[name] = null; resolve(v); };
    });
    try {
      this.setStatus('Connecting…');
      await this.connect();
      this.setStatus('Testing speed…');
      let ping = Infinity;
      for (let i = 0; i < 3; i++) {
        const at = performance.now();
        const pong = answer('pongWaiter', 5000);
        this.sendJson({ t: 'ping' });
        await pong;
        ping = Math.min(ping, performance.now() - at);
      }
      if (gone()) throw new Error('Transfer cancelled');
      const relay = this.relayed;
      const seconds = relay ? SPEED_RELAY_SECONDS : SPEED_SECONDS;
      const max = relay ? SPEED_RELAY_MAX_BYTES : SPEED_MAX_BYTES;
      const ready = answer('speedReady', 10000);
      this.sendJson({ t: 'speed' });
      const ok = await ready;
      if (gone()) throw new Error('Transfer cancelled');
      if (!ok) throw new Error('The other device is busy');
      // Random data, so nothing along the way can compress it
      const chunk = new Uint8Array(this.chunkSize);
      for (let i = 0; i < chunk.length; i += 65536) crypto.getRandomValues(chunk.subarray(i, i + 65536));
      const result = answer('speedResult', (seconds + 30) * 1000);
      const start = performance.now();
      let sent = 0;
      while (sent < max && performance.now() - start < seconds * 1000) {
        await this.waitForBuffer();
        if (gone()) throw new Error('Transfer cancelled');
        this.sendRaw(chunk.buffer);
        sent += chunk.length;
        this.setProgress((performance.now() - start) / (seconds * 1000));
      }
      this.sendJson({ t: 'speed-end' });
      this.setStatus('Finishing…');
      const r = await result;
      if (gone()) throw new Error('Transfer cancelled');
      const ms = Math.max(1, Number(r.ms) || 0);
      const route = this.relayed ? 'relay' : this.routeKind || 'internet';
      this.lastRoute = route;
      return { rate: ((Number(r.got) || 0) / ms) * 1000, ping: Math.round(ping), route };
    } finally {
      if (this.job === job) {
        this.job = null;
        this.speedReady = this.speedResult = this.pongWaiter = null;
        this.busy = false;
        this.setStatus('');
        this.setProgress(0);
        this.endProgress();
      }
    }
  }
  // Receiving side of the speed test (and the sender's answers)
  onSpeed(msg) {
    if (msg.t === 'speed-ready' || msg.t === 'speed-busy') return this.speedReady?.(msg.t === 'speed-ready');
    if (msg.t === 'speed-result') return this.speedResult?.(msg);
    if (msg.t === 'speed') {
      if (this.busy) return this.sendJson({ t: 'speed-busy' });
      this.busy = true;
      this.speedRx = { got: 0, first: 0, last: 0, firstSize: 0 };
      this.setStatus('Testing speed…');
      // The sender gone quiet: give up
      this.speedRxTimer = setTimeout(() => this.endSpeedTest(), 60000);
      return this.sendJson({ t: 'speed-ready' });
    }
    if (msg.t === 'speed-end' && this.speedRx) {
      const rx = this.speedRx;
      // Time from the first piece to the last, so the first one's size doesn't count
      this.sendJson({ t: 'speed-result', got: rx.got - rx.firstSize, ms: rx.last - rx.first });
      this.endSpeedTest();
      this.busy = false;
      this.setStatus('');
    }
  }
  speedChunk(buf) {
    const rx = this.speedRx;
    const now = performance.now();
    if (!rx.first) { rx.first = now; rx.firstSize = buf.byteLength; }
    rx.last = now;
    rx.got += buf.byteLength;
  }
  endSpeedTest() {
    if (!this.speedRx) return;
    clearTimeout(this.speedRxTimer);
    this.speedRx = null;
    if (!this.job) { this.busy = false; this.setStatus(''); }
  }

  // Another OmniBeam tab open in this same browser: say so, since it has the same device name
  markTab(el = this.el) {
    const device = el && $('.device', el);
    if (device && otherTabs.has(this.info.id)) device.textContent = `${this.info.device} · ${t('other tab in this browser')}`;
  }

  // Trusted / paired badge on the card
  markTrusted() {
    const pair = this.pairSecret && loadPaired().find((p) => p.secret === this.pairSecret);
    this.el.classList.toggle('trusted', !!pair?.trusted);
    // A device met through a team room shows the team's name
    const teams = pair ? [] : Teams.shared(this.info).map((x) => x.name);
    let tag = $('.tag', this.el);
    if (!pair && !teams.length) { tag?.remove(); return; }
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'tag';
      $('.status', this.el).before(tag);
    }
    tag.textContent = pair ? (pair.trusted ? t('Trusted') : t('Paired')) : teams.join(' · ');
    tag.classList.toggle('team-tag', !pair);
  }

  destroy() {
    // The other device went away (page reloaded or closed, lost its connection) in the middle of a transfer
    if (this.asking) this.asking(false);
    if (this.busy) {
      // A screen that turned off (this one's, or the other device's) is not a problem
      const asleep = Date.now() - (this.asleepAt || 0) < RESUME_WINDOW;
      if (!screenWasOff() && !asleep) this.reportProblem('The other device went away during the transfer');
      this.abort(t(screenWasOff() ? PAUSED_SELF
        : asleep ? PAUSED_OTHER
        : this.sending
        ? 'Connection lost. The transfer continues by itself when {name} is back (keep this page open).'
        : 'Transfer interrupted. Send the same files again to continue where it stopped.', { name: this.info.name }), false, true, '', screenWasOff() || asleep);
    }
    this.endProgress();
    this.closePc();
    this.el.remove();
  }
}

// ---------- HEIC photos ----------
// iPhone photos are often HEIC, which Windows and Android browsers can't show. When sending to one of those
// from a browser that can read HEIC (Safari), send a JPG copy instead. Other browsers send the file as is.
const isHeic = (f) => /\.(heic|heif)$/i.test(f.name) || /^image\/hei[cf]/.test(f.type);
// The conversion itself is in more.js
async function convertHeic(files, receiverDevice) {
  if (/iOS|macOS/.test(receiverDevice) || !files.some(isHeic)) return files;
  await loadMore();
  return More.convertHeic(files, receiverDevice);
}

// ---------- Shrink photos and videos before sending (optional, see Settings) ----------
// "Original / Smaller" (Settings, the More… window and the chat view): Smaller scales big photos down to 2048 px
// on the longest side and saves them as JPG (quality 0.82), the right way up. GIFs, PNGs with transparent parts,
// photos already under 500 KB and HEIC photos this browser can't read are sent as they are. With "photos and
// videos", videos are also re-recorded at 720p (only where the browser can record MP4, e.g. Chrome, Edge, Safari:
// they play silently in the background for as long as the video lasts). Smaller results only: anything that
// wouldn't shrink by much is sent as it is. The originals on this device are never changed. Default: Original.
const SHRINK_KEY = 'omnibeam-shrink';
let shrinkMode = (() => { try { return localStorage.getItem(SHRINK_KEY) || 'off'; } catch { return 'off'; } })(); // off | photos | all
if (!['off', 'photos', 'all'].includes(shrinkMode)) shrinkMode = 'off';
// One choice for every place that shows it; remembered on this device
function setShrink(mode) {
  shrinkMode = ['off', 'photos', 'all'].includes(mode) ? mode : 'off';
  try { localStorage.setItem(SHRINK_KEY, shrinkMode); } catch {}
  updateShrinkUi();
}
function updateShrinkUi() {
  for (const r of document.querySelectorAll('input[name=shrink]')) r.checked = r.value === shrinkMode;
  // The notes about what isn't shrunk only matter once smaller photos are chosen
  const notes = document.getElementById('shrink-notes');
  if (notes) notes.hidden = shrinkMode === 'off';
  for (const b of document.querySelectorAll('[data-shrink]')) b.setAttribute('aria-pressed', String((b.dataset.shrink === 'off') === (shrinkMode === 'off')));
}
window.addEventListener('storage', (e) => { if (e.key === SHRINK_KEY) { shrinkMode = e.newValue || 'off'; updateShrinkUi(); } });
const VIDEO_TYPE = typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream ? null
  : ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'].find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || null;
// Photos that can be made smaller (not GIFs: they may move; PNGs only without transparent parts, checked in more.js)
const isPhoto = (f) => /^image\/(jpeg|webp|png|hei[cf])$/.test(f.type) || /\.(jpe?g|webp|png|heic|heif)$/i.test(f.name);
const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(f.name);
// The shrinking itself is in more.js
const wantShrink = (f) => isPhoto(f) || (shrinkMode === 'all' && isVideo(f) && VIDEO_TYPE);
async function shrinkFiles(files, peer, gone) {
  if (shrinkMode === 'off' || !files.some(wantShrink)) return files;
  await loadMore();
  return More.shrinkFiles(files, peer, gone);
}

// ---------- Received-file storage ----------
// Incoming files are written to disk as they arrive, so large transfers don't have to fit in the phone's
// memory and received files survive a reload. Uses the browser's private file storage (OPFS) where pages can
// write to it (Chrome, Edge, Firefox), otherwise IndexedDB (e.g. Safari on iPhone), otherwise memory.
const IDB_BATCH = 4 * 1024 * 1024; // IndexedDB: collect this much before each write
const OPFS_SEGMENT = 8 * 1024 * 1024; // OPFS: save to disk after this much of a file (a page thrown away loses less)
const Store = {
  kind: 'memory', // 'opfs' | 'idb' | 'memory'
  dir: null,
  db: null,
  ready: null,
  // Saves of interrupted transfers still running: a resume waits for them, so it starts exactly where they end
  settled: Promise.resolve(),
  settle(promise) {
    this.settled = Promise.all([this.settled, promise.catch(() => {})]);
  },
  init() {
    this.ready = (async () => {
      if (await this.initOpfs()) this.kind = 'opfs';
      else if (await this.initIdb()) this.kind = 'idb';
      if (this.kind !== 'memory') navigator.storage?.persist?.().catch(() => {});
      console.info(`Received files are stored in: ${this.kind}`);
    })();
    return this.ready;
  },
  async initOpfs() {
    try {
      if (!navigator.storage?.getDirectory) return false;
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('received', { create: true });
      // Some browsers have the storage but can't write to it from a page: check once
      const probe = await dir.getFileHandle('.probe', { create: true });
      if (typeof probe.createWritable !== 'function') return false;
      const w = await probe.createWritable();
      await w.write(new Uint8Array([1]));
      await w.close();
      await dir.removeEntry('.probe');
      this.dir = dir;
      return true;
    } catch {
      return false;
    }
  },
  initIdb() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('omnibeam', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('chunks'); // key: [fileId, seq] -> Blob
        req.onsuccess = () => { this.db = req.result; resolve(true); };
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  },
  idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', mode);
      const result = fn(tx.objectStore('chunks'));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('storage error'));
    });
  },
  idRange: (id) => IDBKeyRange.bound([id, 0], [id, Infinity]),
  // OPFS keeps a file as segments ("id", "id.1", "id.2"…), each saved to disk once full. A page that is closed
  // mid-transfer then still has everything up to the last full segment, so the transfer can continue later.
  segName: (id, n) => (n ? `${id}.${n}` : id),
  async segments(id) {
    const out = [];
    for (let n = 0; ; n++) {
      try { out.push(await (await this.dir.getFileHandle(this.segName(id, n))).getFile()); } catch { return out; }
    }
  },
  // Returns a sink { id, write(buf), save(), finish() -> Blob, discard() }, or null to keep the file in memory.
  // With an id, adds to that stored file (continuing an interrupted transfer).
  async create(existing) {
    await this.ready;
    const id = existing || `${Date.now()}-${randomSecret().slice(0, 12)}`;
    if (this.kind === 'opfs') {
      let n = existing ? (await this.segments(id)).length : 0;
      let w = null;
      let written = 0;
      // Saves the open segment and starts the next one on the next write
      const save = async () => {
        if (!w) return;
        const cur = w;
        w = null;
        await cur.close();
        n++;
      };
      return {
        id,
        write: async (buf) => {
          if (!w) {
            w = await (await this.dir.getFileHandle(this.segName(id, n), { create: true })).createWritable();
            written = 0;
          }
          await w.write(buf);
          written += buf.byteLength;
          if (written >= OPFS_SEGMENT) await save();
        },
        save,
        finish: async () => { await save(); return new Blob(await this.segments(id)); },
        discard: () => { w?.abort?.().catch(() => {}); w = null; Store.remove(id); },
      };
    }
    if (this.kind === 'idb') {
      let pending = [];
      let pendingBytes = 0;
      let seq = 0;
      if (existing) {
        const keys = await this.idb('readonly', (st) => st.getAllKeys(this.idRange(id)));
        seq = keys.length ? Math.max(...keys.map((k) => k[1])) + 1 : 0;
      }
      const flush = async () => {
        if (!pending.length) return;
        const blob = new Blob(pending);
        pending = [];
        pendingBytes = 0;
        const key = [id, seq++];
        await this.idb('readwrite', (st) => st.put(blob, key));
      };
      return {
        id,
        write: async (buf) => {
          pending.push(buf);
          pendingBytes += buf.byteLength;
          if (pendingBytes >= IDB_BATCH) await flush();
        },
        save: flush,
        finish: async () => { await flush(); return Store.get(id); },
        discard: () => { pending = []; Store.remove(id); },
      };
    }
    return null;
  },
  async get(id) {
    await this.ready;
    try {
      if (this.kind === 'opfs') {
        const parts = await this.segments(id);
        return parts.length ? (parts.length === 1 ? parts[0] : new Blob(parts)) : null;
      }
      if (this.kind === 'idb') {
        const parts = await this.idb('readonly', (st) => st.getAll(this.idRange(id)));
        return parts && parts.length ? new Blob(parts) : null;
      }
    } catch {}
    return null;
  },
  // Bytes saved so far for a file (0 if none)
  async size(id) {
    const blob = await this.get(id);
    return blob ? blob.size : 0;
  },
  async remove(id) {
    await this.ready;
    try {
      if (this.kind === 'opfs') {
        const n = (await this.segments(id)).length;
        for (let i = 0; i < Math.max(n, 1); i++) await this.dir.removeEntry(this.segName(id, i)).catch(() => {});
      }
      if (this.kind === 'idb') await this.idb('readwrite', (st) => st.delete(this.idRange(id)));
    } catch {}
  },
  async list() {
    await this.ready;
    const ids = new Set();
    try {
      if (this.kind === 'opfs') for await (const name of this.dir.keys()) ids.add(name.replace(/\.\d+$/, ''));
      if (this.kind === 'idb') (await this.idb('readonly', (st) => st.getAllKeys())).forEach((k) => ids.add(k[0]));
    } catch {}
    return [...ids];
  },
};

// ---------- Interrupted transfers ----------
// Files (or parts of files) received in a transfer that didn't finish: the sender's page was reloaded or
// closed, the connection dropped, or this page was reloaded. When the same files are sent again (from any
// device), only the missing part is sent. Files are recognised by a fingerprint of their name, size, date
// and first and last bytes. Kept for a day.
const PARTIALS_KEY = 'omnibeam-partials';
const Partials = {
  load() {
    try { return JSON.parse(localStorage.getItem(PARTIALS_KEY)) || []; } catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(PARTIALS_KEY, JSON.stringify(list)); } catch {}
  },
  add(entry) {
    this.save([...this.load().filter((p) => p.fp !== entry.fp && p.id !== entry.id), { ...entry, at: Date.now() }]);
  },
  find: (fp) => (fp ? Partials.load().find((p) => p.fp === fp) : null),
  forget(ids) {
    const set = new Set(ids);
    this.save(this.load().filter((p) => !set.has(p.id)));
  },
  // Drop old ones and their data
  cleanup() {
    const dayAgo = Date.now() - 864e5;
    const list = this.load();
    list.filter((p) => !(p.at >= dayAgo)).forEach((p) => { if (!History.stored().some((f) => f.id === p.id)) Store.remove(p.id); });
    this.save(list.filter((p) => p.at >= dayAgo));
  },
};
// ---------- Transfers that continue by themselves ----------
// When the connection breaks mid-transfer (phone switches from Wi-Fi to mobile data, router restarts, the
// server restarts), each device gets a new id when it reconnects. The sender keeps the files (this page only)
// and, whenever a device shows up within RESUME_WINDOW, asks it with a tag made from the transfer's secret id
// (xid). Only the device that received part of that transfer knows the xid, so only it can answer with the right
// proof; the sender then sends the same files again and Partials makes that start where it stopped.
const RESUME_WINDOW = 30 * 60 * 1000;
const INTERRUPTED_KEY = 'omnibeam-interrupted';
// Receiver: xids of transfers it accepted that broke off
const Interrupted = {
  load() {
    try { return (JSON.parse(localStorage.getItem(INTERRUPTED_KEY)) || []).filter((e) => Date.now() - e.at < RESUME_WINDOW); } catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(INTERRUPTED_KEY, JSON.stringify(list.slice(-20))); } catch {}
  },
  add(xid, name) {
    this.save([...this.load().filter((e) => e.xid !== xid), { xid, name, at: Date.now() }]);
  },
  // true (and forgotten) if xid is a transfer this device was receiving when it broke off
  take(xid) {
    const list = this.load();
    if (!xid || !list.some((e) => e.xid === xid)) return false;
    this.save(list.filter((e) => e.xid !== xid));
    return true;
  },
};
// Sender: xid -> { files, name, at, tries, acked, tag, nextAt, wait }
const AutoResume = {
  jobs: new Map(),
  timer: null,
  get size() { return this.jobs.size; },
  // acked: bytes the receiver had confirmed, so files that fully arrived aren't sent again to another device
  remember(peer, job, acked = 0) {
    const old = this.jobs.get(job.xid);
    // A transfer may pause many times (each time a phone's screen turns off): only breaks without progress since
    // the last one count towards giving up
    const tries = old && acked <= (old.acked || 0) ? old.tries + 1 : 1;
    if (tries > 5) {
      this.jobs.delete(job.xid);
      Outgoing.remove(job.xid);
      return;
    }
    let doneFiles = 0;
    for (let sum = 0; doneFiles < job.files.length && (sum += job.files[doneFiles].size) <= acked; doneFiles++);
    doneFiles = Math.max(old?.doneFiles || 0, Math.min(doneFiles, job.files.length - 1));
    const entry = { files: job.files, name: peer.info.name, at: Date.now(), tries, doneFiles, acked: Math.max(acked, old?.acked || 0),
      peerId: peer.info.id, secret: peer.pairSecret || old?.secret || null, handoff: old?.handoff, nextAt: Date.now() + 1000, wait: 1000,
      directFailedAt: Math.max(peer.directFailedAt || 0, old?.directFailedAt || 0) };
    this.jobs.set(job.xid, entry);
    sha256Hex(`omnibeam-resume:${job.xid}`).then((tag) => { entry.tag = tag; });
    if (!this.timer) this.timer = setInterval(() => this.tick(), 500);
    // Still gone after a few seconds: offer to send the rest to another paired device that's online
    setTimeout(() => Handoff.check(), HANDOFF_DELAY);
  },
  // Ask every device here now and then (after 1, 2, 4, 8… seconds, then every 30 s), not only devices that show up
  // anew: the receiver may be back with the same id (only its screen was off), or appear before the sender noticed
  // its old connection was gone
  tick() {
    const now = Date.now();
    // An iPhone page that is hidden stops any moment: it asks again when it's back (see wake)
    const later = freezesHidden && document.hidden;
    for (const [xid, e] of this.jobs) {
      if (now - e.at > RESUME_WINDOW) {
        this.jobs.delete(xid);
        Outgoing.remove(xid);
        continue;
      }
      if (now < e.nextAt || later) continue;
      e.wait = Math.min(e.wait * 2, 30000);
      e.nextAt = now + e.wait;
      for (const p of peers.values()) this.offerOne(p, xid, e).catch(() => {});
    }
    if (!this.jobs.size) { clearInterval(this.timer); this.timer = null; }
  },
  // This page is back (the screen was off): ask everyone again now, and soon after
  offerAll() {
    for (const e of this.jobs.values()) { e.wait = 1000; e.nextAt = 0; }
    this.tick();
  },
  // A device (re)appeared or says it's back: ask whether it's the one we were sending to
  async offer(peer) {
    if (freezesHidden && document.hidden) return;
    for (const [xid, e] of this.jobs) await this.offerOne(peer, xid, e);
  },
  async offerOne(peer, xid, e) {
    if (Date.now() - e.at > RESUME_WINDOW) return;
    e.tag = e.tag || (await sha256Hex(`omnibeam-resume:${xid}`));
    wsSend({ type: 'signal', to: peer.info.id, data: { resumeOffer: e.tag } });
  },
  // Receiver side of offer()
  held: new Map(), // offers that came while this iPhone page was hidden: answered when it's back (see wake)
  async onOffer(from, tag) {
    if (typeof tag !== 'string' || !/^[0-9a-f]{64}$/.test(tag)) return;
    // Not while an iPhone page is hidden: it would stop again any moment
    if (freezesHidden && document.hidden) { this.held.set(from, tag); return; }
    for (const { xid } of Interrupted.load()) {
      if ((await sha256Hex(`omnibeam-resume:${xid}`)) !== tag) continue;
      const peer = peers.get(from);
      // Still receiving it here (the sender paused, and we didn't hear): the request that follows takes over
      if (peer && !peer.busy) peer.showWaiting(t('Resuming…'), 20000);
      // The proof includes our id, so it can't be replayed by another device
      wsSend({ type: 'signal', to: from, data: { resumeYes: await sha256Hex(`omnibeam-resume-yes:${xid}:${me.id}`), tag } });
      return;
    }
  },
  async onYes(from, data) {
    const peer = peers.get(from);
    if (!peer || typeof data.resumeYes !== 'string') return;
    for (const [xid, e] of this.jobs) {
      if (e.tag !== data.tag || (await sha256Hex(`omnibeam-resume-yes:${xid}:${from}`)) !== data.resumeYes) continue;
      if (!this.jobs.has(xid)) return; // both answers raced
      this.jobs.delete(xid);
      Handoff.hide(xid);
      toast(t('Back online: continuing the transfer to {name}', { name: peer.info.name }));
      // It went through the server because a direct connection failed: start there again, without a new 8 s try
      if (Date.now() - e.directFailedAt < DIRECT_RETRY_AFTER && !peer.direct) {
        peer.directFailedAt = Math.max(peer.directFailedAt || 0, e.directFailedAt);
        peer.useRelay = true;
      }
      peer.sendFiles(e.files, { xid });
      return;
    }
  },
};

// ---------- A send cut off by a reload ----------
// A phone can throw away a page in the background (Safari often does, while the screen is off), and the files being
// sent go with it: a web page can't open them again by itself. So what is being sent is noted here; when the page is
// opened again it says what happened, and picking the same files continues where it stopped (the receiver kept
// what arrived, see Partials, and takes the rest without asking because the transfer's id is the same).
const OUTGOING_KEY = 'omnibeam-outgoing';
const Outgoing = {
  mine: new Set(), // xids this page has the files of
  load() {
    try {
      return (JSON.parse(localStorage.getItem(OUTGOING_KEY)) || []).filter((e) => /^[0-9a-f]{32}$/.test(e?.xid || '') && Date.now() - e.at < 2 * 3600e3);
    } catch { return []; }
  },
  save(list) {
    try { localStorage.setItem(OUTGOING_KEY, JSON.stringify(list.slice(-5))); } catch {}
  },
  async add(peer, xid, files, fps) {
    this.mine.add(xid);
    if (files.length > 500) return;
    const undated = await fingerprints(files, false);
    if (!this.mine.has(xid)) return; // already finished
    const entry = { xid, to: peer.info.name, pair: peer.pairSecret?.slice(0, 16), at: Date.now(), beat: Date.now(), tab: tabKey,
      files: files.map((f, i) => ({ name: pathOf(f), size: f.size, fp: fps[i], any: undated[i] })), n: files.length };
    this.save([...this.load().filter((e) => e.xid !== xid), entry]);
    // Now and then: this page is still alive and has the files (another tab must not offer to pick them again)
    if (!this.timer) {
      this.timer = setInterval(() => {
        if (!this.mine.size) { clearInterval(this.timer); this.timer = null; return; }
        this.save(this.load().map((e) => (this.mine.has(e.xid) ? { ...e, beat: Date.now() } : e)));
      }, 5000);
    }
  },
  remove(xid) {
    this.mine.delete(xid);
    if (this.load().some((e) => e.xid === xid)) this.save(this.load().filter((e) => e.xid !== xid));
  },
  // The screen turns off: if the page doesn't come back, it was because of that
  screenOff() {
    if (this.mine.size) this.save(this.load().map((e) => (this.mine.has(e.xid) ? { ...e, off: true, beat: Date.now() } : e)));
  },
  // Sends of an earlier copy of this page: this same tab reloaded, or one that nobody keeps alive any more
  orphans() {
    return this.load().filter((e) => !this.mine.has(e.xid) && (e.tab === tabKey || Date.now() - e.beat > 15000));
  },
  // The banner at the top of the list of devices, for the newest one
  show() {
    const e = this.orphans().pop();
    let el = $('#resume-banner');
    if (!e) {
      el?.remove();
      // Kept alive a moment ago: by another tab, or by this page's earlier copy just before it went. Look again later.
      const recent = this.load().filter((x) => !this.mine.has(x.xid)).map((x) => x.beat);
      if (recent.length) setTimeout(() => this.show(), Math.max(1000, 16000 - (Date.now() - Math.max(...recent))));
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'resume-banner';
      el.className = 'resume-banner';
      el.setAttribute('role', 'status');
      el.innerHTML = `<p></p><div class="row"><button type="button" class="btn small" data-act="repick">${t('Pick the files again')}</button>
        <button type="button" class="link-btn" data-act="dismiss">${t('Not now')}</button></div>`;
      peersEl.before(el);
    }
    const what = e.n > 1 ? `${e.files[0].name} (+${e.n - 1})` : e.files[0]?.name || '';
    $('p', el).textContent = t(e.off ? 'The transfer to {name} stopped when the screen turned off. Pick the same files again to continue where it stopped.'
      : 'The transfer to {name} stopped before it finished. Pick the same files again to continue where it stopped.', { name: e.to }) + (what ? ` (${what})` : '');
    $('[data-act=dismiss]', el).onclick = () => { this.remove(e.xid); this.show(); };
    $('[data-act=repick]', el).onclick = () => this.repick(e);
  },
  repick(e) {
    const peer = [...peers.values()].find((p) => e.pair && p.pairSecret?.startsWith(e.pair)) || [...peers.values()].find((p) => p.info.name === e.to);
    if (!peer) return toast(t('{name} is not online any more', { name: e.to }));
    peer.warmUp();
    fileInput.onchange = async () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      if (!files.length) return;
      const fps = await fingerprints(files, false);
      // The same files (in any order): the same transfer, which the receiver continues without asking
      const order = e.files.map((f) => (f.any ? fps.indexOf(f.any) : -1));
      const same = files.length === e.n && e.files.length === e.n && order.every((i) => i >= 0) && new Set(order).size === order.length;
      this.remove(e.xid);
      this.show();
      if (peers.get(peer.info.id) !== peer) return toast(t('{name} is not online any more', { name: e.to }));
      peer.sendFiles(same ? order.map((i) => files[i]) : files, same ? { xid: e.xid, fps: e.files.map((f) => f.fp) } : {});
    };
    fileInput.click();
  },
};

// ---------- Card at the bottom: a question with a few buttons ----------
// Used for "send the rest to another device" (Handoff) and the rating / share ask after sends (AskAfterSend).
// Only one at a time; a newer one replaces an older one. buttons: [{ label, href?, primary?, onClick }]
const Nudge = {
  owner: null,
  show(owner, title, text, buttons, onClose) {
    const el = $('#nudge');
    this.owner = owner;
    this.onClose = onClose || null;
    $('#nudge-text').innerHTML = `<b>${escapeHtml(title)}</b>${text ? `<span>${escapeHtml(text)}</span>` : ''}`;
    const box = $('.nudge-btns', el);
    box.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement(b.href ? 'a' : 'button');
      btn.className = b.link ? 'link-btn' : `btn small${b.primary ? '' : ' ghost'}${b.href ? ' btn-a' : ''}`;
      if (b.href) Object.assign(btn, { href: b.href, target: '_blank', rel: 'noopener' });
      else btn.type = 'button';
      btn.textContent = b.label;
      if (b.act) btn.dataset.act = b.act;
      btn.onclick = (e) => { if (b.onClick?.(e) !== false) this.hide(owner); };
      box.appendChild(btn);
    }
    $('.nudge-x', el).onclick = () => { this.onClose?.(); this.hide(owner); };
    el.hidden = false;
  },
  hide(owner) {
    if (owner && this.owner !== owner) return;
    $('#nudge').hidden = true;
    this.owner = null;
    this.onClose = null;
  },
};

// The device a send was going to went away in the middle (closed, out of battery, out of range). If it doesn't
// come back within a few seconds and another paired device is online, offer to send the rest of the files there.
// Files that fully arrived on the first device are left out; the one in the middle is sent from its start.
// If the first device comes back first, the transfer continues there by itself as before (AutoResume).
const HANDOFF_DELAY = 6000;
const Handoff = {
  candidates(e) {
    return [...peers.values()].filter((p) => p.pairSecret && p.info.id !== e.peerId && p.pairSecret !== e.secret);
  },
  check() {
    if (String(Nudge.owner).startsWith('handoff:')) return; // already asking about one
    for (const [xid, e] of AutoResume.jobs) {
      if (e.handoff || Date.now() - e.at < HANDOFF_DELAY - 500 || Date.now() - e.at > RESUME_WINDOW) continue;
      if (peers.has(e.peerId)) continue; // still here: AutoResume is on it
      const others = this.candidates(e).slice(0, 3);
      if (!others.length) continue;
      e.handoff = 'offered';
      const rest = e.files.slice(e.doneFiles);
      const restSize = rest.reduce((s, f) => s + f.size, 0);
      Nudge.show(`handoff:${xid}`,
        t('{name} went offline before the transfer finished', { name: e.name }),
        t('Send the rest ({n} file(s), {size}) to another of your devices? It also continues by itself if {name} comes back.', { n: rest.length, size: formatSize(restSize), name: e.name }),
        [...others.map((p, i) => ({ label: t('Send to {name}', { name: p.info.name }), primary: i === 0, onClick: () => this.go(xid, p) })),
          { label: t('Wait for {name}', { name: e.name }), link: true }]);
      return;
    }
  },
  go(xid, peer) {
    const e = AutoResume.jobs.get(xid);
    if (!e) return toast(t('That transfer already continued by itself'));
    if (peers.get(peer.info.id) !== peer) return toast(t('{name} is not online any more', { name: peer.info.name }));
    AutoResume.jobs.delete(xid);
    Outgoing.remove(xid);
    const rest = e.files.slice(e.doneFiles);
    toast(t('Sending the rest to {name}', { name: peer.info.name }));
    wsSend({ type: 'stat', kind: 'handoff' });
    peer.sendFiles(rest);
  },
  hide(xid) { Nudge.hide(`handoff:${xid}`); },
};

// After sends that went well, now and then ask for a rating (where there's a store page: the Windows app, or
// Chrome with the extension) or to tell a friend (a link that shows up as "friend" in the visitor sources).
// From the 3rd successful send, at most every 21 days, and never within 14 days of the "Worked well?" card
// under received files; off after "Not now" three times, or once they rated or shared.
const ASK_KEY = 'omnibeam-ask';
const FRIEND_URL = () => `${location.origin}${document.documentElement.lang && document.documentElement.lang !== 'en' ? `/${document.documentElement.lang}/` : '/'}?utm_source=friend`;
// Where this device can rate OmniBeam: { href, store: true for the Windows Store app } or null
function rateTarget() {
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const phone = isIOS || /Android/.test(ua);
  const chromium = /Chrome\//.test(ua) && !/OPR\/|SamsungBrowser/.test(ua);
  if (standalone && /Windows/.test(ua) && !phone) return { href: RATE_WINDOWS_WEB, store: true };
  if (extensionHere && chromium && !phone) return { href: RATE_CHROME, store: false };
  return null;
}
// Opens the review form in the Microsoft Store app; its web page if the Store doesn't open (focus never leaves here)
function openWindowsReview(e) {
  e?.preventDefault();
  let left = false;
  const away = () => { left = true; };
  window.addEventListener('blur', away, { once: true });
  location.href = RATE_WINDOWS_STORE;
  setTimeout(() => {
    window.removeEventListener('blur', away);
    if (!left && !document.hidden) window.open(RATE_WINDOWS_WEB, '_blank', 'noopener');
  }, 1500);
}
async function tellFriend() {
  const url = FRIEND_URL();
  const text = t('I send files between my phone and computer with OmniBeam. Free, nothing to install:');
  if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: 'OmniBeam', text, url }).catch(() => {});
  else {
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast(t('Link copied')); } catch { toast(url); }
  }
}
const AskAfterSend = {
  load() { try { return JSON.parse(localStorage.getItem(ASK_KEY) || '{}') || {}; } catch { return {}; } },
  save(st) { try { localStorage.setItem(ASK_KEY, JSON.stringify(st)); } catch {} },
  sent() {
    const st = this.load();
    st.n = (st.n || 0) + 1;
    this.save(st);
    let loopAt = 0;
    try { loopAt = (JSON.parse(localStorage.getItem(LOOP_KEY) || '{}') || {}).at || 0; } catch {}
    if (st.n < 3 || st.done || (st.no || 0) >= 3 || Date.now() - (st.at || 0) < 21 * 864e5 || Date.now() - loopAt < 14 * 864e5) return;
    // A moment after the "Sent" message, so it doesn't feel like part of it; not in the middle of something else
    setTimeout(() => {
      if (Nudge.owner || transferActive()) return; // next time
      const now = this.load();
      now.at = Date.now();
      this.save(now);
      this.show();
    }, 1500);
  },
  show() {
    const stat = (act) => wsSend({ type: 'stat', kind: 'ask', act });
    const done = () => { const st = this.load(); st.done = true; this.save(st); };
    const rate = rateTarget();
    const buttons = [];
    if (rate) {
      buttons.push({ label: t('Rate OmniBeam'), href: rate.href, primary: true, act: 'rate',
        onClick: (e) => { stat('rate'); done(); if (rate.store) openWindowsReview(e); } });
    }
    buttons.push({ label: t('Tell a friend'), primary: !rate, act: 'share', onClick: () => { stat('share'); done(); tellFriend(); } });
    buttons.push({ label: t('Not now'), link: true, act: 'no', onClick: () => { const st = this.load(); st.no = (st.no || 0) + 1; this.save(st); stat('no'); } });
    Nudge.show('ask', t('Sent! Glad it worked.'),
      rate ? t('OmniBeam is free and made by one person. A quick rating helps others find it.')
        : t('OmniBeam is free and made by one person. Telling a friend helps others find it.'),
      buttons, () => { const st = this.load(); st.no = (st.no || 0) + 1; this.save(st); stat('no'); });
    stat('shown');
  },
};

// Identifies a file across page reloads (the sender has to pick it again, so it's a new File object)
// dated: false leaves out the file's date, which changes when the same file is picked again on an iPhone (the photo
// picker makes a new copy each time): used to recognise files picked again after a reload (see Outgoing)
async function fingerprint(file, dated = true) {
  const enc = new TextEncoder();
  const parts = [enc.encode(`${pathOf(file)}|${file.size}|${dated ? file.lastModified || 0 : 'any'}|`)];
  if (file.size > 0) parts.push(await file.slice(0, 8192).arrayBuffer());
  if (file.size > 8192) parts.push(await file.slice(-8192).arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer()));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function fingerprints(files, dated = true) {
  if (!crypto.subtle || files.length > 2000) return files.map(() => null);
  try {
    return await Promise.all(files.map((f) => fingerprint(f, dated)));
  } catch {
    return files.map(() => null);
  }
}

// ---------- Received-files history ----------
// Files received recently, so they can be saved again later. Files kept on disk survive a reload
// (for HISTORY_DAYS); files kept in memory only last until the page is closed.
const HISTORY_KEY = 'omnibeam-history';
const HISTORY_DAYS = 7;
const History = {
  items: [], // { id?, name, size, mime, from, at, blob? }
  onChange: null, // set while the history dialog is open
  stored() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  },
  // Re-read the list other tabs may have changed, keeping this tab's memory-only files and loaded blobs
  sync() {
    const blobs = new Map(this.items.filter((f) => f.id && f.blob).map((f) => [f.id, f.blob]));
    const stored = this.stored().filter((f) => f.id).map((f) => (blobs.has(f.id) ? { ...f, blob: blobs.get(f.id) } : f));
    this.items = [...this.items.filter((f) => !f.id), ...stored].sort((a, b) => b.at - a.at);
  },
  load() {
    this.items = this.stored();
    const cutoff = Date.now() - HISTORY_DAYS * 864e5;
    const old = this.items.filter((f) => f.at < cutoff);
    old.forEach((f) => f.id && Store.remove(f.id));
    this.items = this.items.filter((f) => f.at >= cutoff && f.id);
    this.save();
    // Remove stored files the history no longer knows about (e.g. a transfer interrupted by closing the tab).
    // Only ones older than a day: newer ones may still be arriving in another tab. Ids start with the time.
    const dayAgo = Date.now() - 864e5;
    Partials.cleanup();
    Store.list().then((ids) => ids.forEach((id) => {
      if (parseInt(id, 10) < dayAgo && !this.stored().some((f) => f.id === id) && !Partials.load().some((p) => p.id === id)) Store.remove(id);
    }));
    this.updateButton();
  },
  save() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(this.items.filter((f) => f.id).map(({ blob, ...f }) => f))); } catch {}
  },
  // pair: the pairing secret of the device it came from, if any (the chat view finds a device's files by it)
  add(file, from, pair) {
    this.sync();
    if (file.id) this.items = this.items.filter((f) => f.id !== file.id); // an interrupted file that has now arrived in full
    this.items.unshift({ id: file.id, name: file.name, size: file.size, mime: file.mime, from, at: Date.now(), blob: file.blob, ...(pair ? { pair: pair.slice(0, 16) } : {}) });
    this.save();
    this.updateButton();
    chatChanged();
  },
  remove(item) {
    this.sync();
    this.items = this.items.filter((f) => f !== item && !(item.id && f.id === item.id));
    if (item.id) Store.remove(item.id);
    this.save();
    this.updateButton();
  },
  async blobOf(item) {
    if (item.blob) return item.blob;
    const file = item.id && (await Store.get(item.id));
    return file ? new Blob([file], { type: item.mime || 'application/octet-stream' }) : null;
  },
  updateButton() {
    const btn = $('#btn-history');
    if (btn) btn.classList.toggle('has-items', this.items.length + Messages.items.length > 0);
  },
};

// ---------- Received messages ----------
// The last messages received, kept on this device for HISTORY_DAYS like received files
const MESSAGES_KEY = 'omnibeam-messages';
const MAX_MESSAGES = 100;
const Messages = {
  items: [], // { text, from, at }, newest first
  load() {
    try { this.items = JSON.parse(localStorage.getItem(MESSAGES_KEY)) || []; } catch { this.items = []; }
    const cutoff = Date.now() - HISTORY_DAYS * 864e5;
    this.items = this.items.filter((m) => m && typeof m.text === 'string' && m.at >= cutoff);
  },
  save() {
    try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(this.items)); } catch {}
    History.updateButton();
    chatChanged();
  },
  add(text, from, pair) {
    this.load();
    this.items.unshift({ text: text.slice(0, 20000), from, at: Date.now(), ...(pair ? { pair: pair.slice(0, 16) } : {}) });
    this.items = this.items.slice(0, MAX_MESSAGES);
    this.save();
    History.onChange?.();
  },
  remove(m) {
    this.load();
    this.items = this.items.filter((x) => !(x.at === m.at && x.text === m.text));
    this.save();
  },
  clear() {
    this.items = [];
    this.save();
  },
};

// ---------- Sent files ----------
// What this device sent in the last HISTORY_DAYS, for the Sent tab of the history: Send again, and the export.
// Kept here: the names and sizes, which device, when, and how it went (and the text of messages). The files
// themselves stay in this page's memory only; after the page is closed, Send again asks to choose them again.
const SENT_KEY = 'omnibeam-sent';
const MAX_SENT = 200;
const sentFiles = new Map(); // entry id -> the File objects (this page only)
const Sent = {
  items: [], // { id, at, to, device, pair?, files: [{ name, size }], n, bytes, result, xid?, text? }, newest first
  load() {
    try { this.items = JSON.parse(localStorage.getItem(SENT_KEY)) || []; } catch { this.items = []; }
    const cutoff = Date.now() - HISTORY_DAYS * 864e5;
    this.items = this.items.filter((e) => e && e.id && e.at >= cutoff);
  },
  save() {
    try { localStorage.setItem(SENT_KEY, JSON.stringify(this.items.slice(0, MAX_SENT))); } catch {}
    History.onChange?.();
    chatChanged();
  },
  // files: the File objects sent, or { text } for a message. result: ok, declined, failed or cancelled.
  // xid: a transfer that continued by itself after a drop updates its first entry instead of adding one.
  add(peer, files, result, xid) {
    if (files.text === undefined) peer.lastSendResult = result; // for Auto-send a folder
    this.load();
    const old = xid && this.items.find((e) => e.xid === xid);
    if (old) {
      old.result = result;
      old.at = Date.now();
      this.save();
      return;
    }
    const entry = { id: randomHex(8), at: Date.now(), to: peer.info.name, device: peer.info.device, result };
    if (peer.pairSecret) entry.pair = peer.pairSecret.slice(0, 16);
    if (files.text !== undefined) {
      entry.text = String(files.text).slice(0, 5000);
    } else {
      entry.files = files.slice(0, 50).map((f) => ({ name: pathOf(f), size: f.size }));
      entry.n = files.length;
      entry.bytes = files.reduce((s, f) => s + f.size, 0);
      if (xid) entry.xid = xid;
      sentFiles.set(entry.id, files);
    }
    this.items.unshift(entry);
    this.save();
  },
  remove(id) {
    this.load();
    this.items = this.items.filter((e) => e.id !== id);
    sentFiles.delete(id);
    this.save();
  },
  clear() {
    this.items = [];
    sentFiles.clear();
    this.save();
  },
};
window.addEventListener('storage', (e) => { if (e.key === SENT_KEY) History.onChange?.(); });

// ---------- Chat view: everything sent to and received from one device, in time order (chat.js) ----------
// Made from the history above (received files, received messages, the Sent list), nothing else is kept and nothing
// goes to the server. A paired device is found by its pairing (the first 16 characters of the secret, so its
// thread survives a new name); any other device by its name. The view itself is in chat.js, loaded when opened;
// here: which items belong to a device, and the unread count on its card (received since the chat was last open).
const CHAT_READ_KEY = 'omnibeam-chat-read';
const loadChat = () => loadScript('/chat.js?v=5');
// The chat with this device is open and on screen: its messages, files and requests show up there, not in windows
const chatShowing = (peer) => document.visibilityState === 'visible' && !!window.Chat?.showing?.(peer);
// { pair, name }: the thread of a Peer, or of a remembered pairing ({ secret, name })
function chatWho(x) {
  if (!x) return null;
  if (x.info) return { pair: x.pairSecret ? x.pairSecret.slice(0, 16) : '', name: x.info.name, peer: x };
  if (typeof x.pair === 'string' && !x.secret) return x; // already a thread (e.g. from the banner of a device that left)
  return { pair: x.secret ? x.secret.slice(0, 16) : '', name: x.name || '' };
}
const chatKey = (who) => (who.pair ? 'p:' + who.pair : 'n:' + who.name);
// An item of the history is this device's: same pairing, or (when it has none) the same name. A paired device's
// old items from before it was paired match its saved name too.
function chatMine(who, item, nameField) {
  if (item.pair) return !!who.pair && item.pair === who.pair;
  if (!who.pair) return item[nameField] === who.name;
  const saved = loadPaired().find((p) => p.secret.startsWith(who.pair));
  return item[nameField] === who.name || (!!saved && item[nameField] === saved.name);
}
function chatItems(who) {
  Messages.load();
  Sent.load();
  return [
    ...History.items.filter((f) => chatMine(who, f, 'from')).map((f) => ({ kind: 'file', dir: 'in', at: f.at, item: f })),
    ...Messages.items.filter((m) => chatMine(who, m, 'from')).map((m) => ({ kind: 'text', dir: 'in', at: m.at, item: m })),
    ...Sent.items.filter((e) => chatMine(who, e, 'to')).map((e) => ({ kind: e.text !== undefined ? 'text' : 'file', dir: 'out', at: e.at, item: e })),
  ].sort((a, b) => a.at - b.at);
}
function chatRead() {
  try { return JSON.parse(localStorage.getItem(CHAT_READ_KEY)) || {}; } catch { return {}; }
}
function markChatRead(who) {
  const read = chatRead();
  read[chatKey(who)] = Date.now();
  // Keep the list short: only the 50 most recent threads
  const keep = Object.entries(read).sort((a, b) => b[1] - a[1]).slice(0, 50);
  try { localStorage.setItem(CHAT_READ_KEY, JSON.stringify(Object.fromEntries(keep))); } catch {}
  updateChatBadges();
}
function chatUnread(who) {
  const since = chatRead()[chatKey(who)] || 0;
  const recent = (m) => m.at > since && chatMine(who, m, 'from');
  return History.items.filter(recent).length + Messages.items.filter(recent).length;
}
// The small number on a device's card (and on the greyed card of a paired device that is offline)
function updateChatBadges() {
  if (typeof peers === 'undefined' || !peersEl) return;
  const paint = (el, who) => {
    if (!el || !who) return;
    const n = chatUnread(who);
    let badge = el.querySelector(':scope > .chat-badge');
    if (!n) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'chat-badge';
      badge.dataset.act = 'chat';
      el.appendChild(badge);
    }
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.setAttribute('aria-label', t('{n} new in the chat with {name}', { n, name: who.name }));
    badge.title = badge.getAttribute('aria-label');
  };
  for (const p of peers.values()) paint(p.el, chatWho(p));
  for (const el of peersEl.querySelectorAll('.peer.offline')) {
    const pair = loadPaired().find((x) => x.secret.startsWith(el.dataset.pair));
    if (pair) paint(el, chatWho(pair));
  }
}
let chatTimer = 0;
// Something was added to the history: the badges, and the chat view if it is open
function chatChanged() {
  clearTimeout(chatTimer);
  chatTimer = setTimeout(() => {
    updateChatBadges();
    window.Chat?.refresh();
  }, 50);
}
window.addEventListener('storage', (e) => { if ([HISTORY_KEY, MESSAGES_KEY, SENT_KEY, CHAT_READ_KEY].includes(e.key)) { if (e.key === HISTORY_KEY) History.sync(); chatChanged(); } });
// The chat view is the one place to write and read messages: every "Send message" opens it (draft: text to put
// in its box, e.g. Send again of a message from the history)
async function openChat(x, draft) {
  const who = chatWho(x);
  if (!who) return;
  hideMessageBanner();
  try {
    await loadChat();
  } catch (err) {
    return toast(err.message);
  }
  wsSend({ type: 'stat', kind: 'chat' });
  window.Chat.open(who, draft);
}
// The chat of a thread key (chatKey above), e.g. from a notification: the device if it is here, else its pairing
function openChatByKey(key) {
  if (typeof key !== 'string' || !/^[pn]:/.test(key)) return;
  const val = key.slice(2);
  const here = [...peers.values()];
  const peer = key[0] === 'p' ? here.find((p) => p.pairSecret?.startsWith(val)) : here.find((p) => p.info.name === val);
  if (peer) return openChat(peer);
  if (key[0] === 'p') { const pairing = loadPaired().find((p) => p.secret.startsWith(val)); if (pairing) return openChat(pairing); }
  else openChat({ name: val });
}
// A message arrived while its chat isn't open: a small banner at the top, "Name: the first words · Open", that opens
// the chat (no window over the page). The card's number counts it; a notification too when the page is hidden.
let bannerTimer = 0;
function hideMessageBanner() {
  clearTimeout(bannerTimer);
  const el = document.getElementById('msg-banner');
  if (el) el.classList.remove('show');
}
// link: the message is only a web address; the banner then opens it (and its last button opens the chat)
function messageBanner(peer, text, link) {
  const who = chatWho(peer);
  const flat = (link ? linkLabel(link) : text).replace(/\s+/g, ' ').trim();
  const short = flat.length > 60 ? flat.slice(0, 60).trimEnd() + '…' : flat;
  let el = document.getElementById('msg-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'msg-banner';
    el.className = 'msg-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = '<button type="button" class="msg-banner-open"><b></b> <span class="msg-banner-text"></span> <span class="msg-banner-act"></span></button>'
      + '<button type="button" class="msg-banner-chat" hidden></button>'
      + '<button type="button" class="msg-banner-x"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
    $('.msg-banner-x', el).onclick = hideMessageBanner;
  }
  // Inside the window that is open (if any), so it shows above it and can be tapped
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (el.parentNode !== host) host.appendChild(el);
  $('b', el).textContent = peer.info.name + ':';
  $('.msg-banner-text', el).textContent = short;
  $('.msg-banner-act', el).textContent = '· ' + t(link ? 'Open link' : 'Open chat');
  $('.msg-banner-x', el).setAttribute('aria-label', t('Close'));
  const toChat = () => { hideMessageBanner(); openChat(peers.get(peer.info.id) === peer ? peer : who); };
  el.classList.toggle('is-link', !!link);
  $('.msg-banner-open', el).onclick = link ? () => { hideMessageBanner(); if (!openLink(link)) toChat(); } : toChat;
  const chatBtn = $('.msg-banner-chat', el);
  chatBtn.hidden = !link;
  chatBtn.textContent = t('Chat');
  chatBtn.onclick = toChat;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideMessageBanner, link ? 20000 : 9000);
}
// A link shown short: the site and the start of the path (example.com/watch?v=…)
function linkLabel(url) {
  try {
    const u = new URL(url);
    const rest = (u.pathname === '/' ? '' : u.pathname) + u.search;
    return u.host.replace(/^www\./, '') + (rest.length > 40 ? rest.slice(0, 40) + '…' : rest);
  } catch { return url; }
}
// The person is in the middle of something: a window is open (another chat, an accept prompt, Settings, Scan…), a file
// picker is open, or they are typing somewhere. Then a new message must not take over the screen.
let pickingFiles = 0;
document.addEventListener('click', (e) => { if (e.target?.matches?.('input[type=file]')) pickingFiles = Date.now(); }, true);
for (const ev of ['change', 'cancel']) document.addEventListener(ev, (e) => { if (e.target?.matches?.('input[type=file]')) pickingFiles = 0; }, true);
addEventListener('focus', () => { if (pickingFiles) setTimeout(() => { pickingFiles = 0; }, 1000); });
function userBusy() {
  if (document.querySelector('dialog[open]')) return true;
  if (pickingFiles && Date.now() - pickingFiles < 120000) return true;
  const a = document.activeElement;
  const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file', 'range'].includes(a.type)) || a.isContentEditable);
  return !!typing && !!(a.value || a.textContent);
}
// A message from a device whose chat isn't on screen: its chat opens by itself (also while the page is hidden, so it
// is there when the person comes back), unless they are busy: then the banner. A notification whenever the chat
// can't be seen (page hidden, or the banner instead of the chat).
function messageArrived(peer, text) {
  const busy = userBusy();
  if (document.visibilityState !== 'visible' || busy) {
    notify(t('Message from {name}', { name: peer.info.name }), text.slice(0, 100), { chat: chatKey(chatWho(peer)), always: true });
  }
  if (busy) return messageBanner(peer, text);
  openChat(peer);
}
// A message that is only a link, while its chat isn't on screen: opened by itself when Settings -> Open links allows it
// (paired devices only, page on screen, the browser lets the page open tabs), else the banner "Name: example.com ·
// Open link" (one tap opens it), and a notification whose tap opens it when the page is hidden. Never the chat
// window over the page: the link is in the chat anyway, with an Open link button.
function linkArrived(peer, link) {
  const name = peer.info.name;
  if (openLinksAuto && peer.pairSecret && document.visibilityState === 'visible' && !userBusy()) {
    if (openLink(link)) return toast(t('Opened a link from {name}', { name }));
    toast(t('Your browser blocked opening the link by itself. Allow pop-ups for {host} to open links right away.', { host: location.host }), 7000);
  }
  if (document.visibilityState !== 'visible') {
    notify(t('Link from {name}', { name }), linkLabel(link), { chat: chatKey(chatWho(peer)), always: true, link });
  }
  messageBanner(peer, link, link);
}
// Clear chat (chat view): the messages and file entries with that device go from this device's history only (nothing
// is sent to the other device). For 6 seconds Undo brings them back; then received files are deleted from storage.
function clearChat(who) {
  History.sync();
  Messages.load();
  Sent.load();
  const files = History.items.filter((f) => chatMine(who, f, 'from'));
  const msgs = Messages.items.filter((m) => chatMine(who, m, 'from'));
  const sent = Sent.items.filter((e) => chatMine(who, e, 'to'));
  if (!files.length && !msgs.length && !sent.length) return false;
  History.items = History.items.filter((f) => !files.includes(f));
  History.save();
  History.updateButton();
  Messages.items = Messages.items.filter((m) => !msgs.includes(m));
  Messages.save();
  Sent.items = Sent.items.filter((e) => !sent.includes(e));
  Sent.save();
  History.onChange?.();
  let undone = false;
  const forget = setTimeout(() => { if (!undone) files.forEach((f) => f.id && Store.remove(f.id)); }, 6500);
  undoToast(t('Chat with {name} cleared', { name: who.name }), () => {
    undone = true;
    clearTimeout(forget);
    const back = (list, add) => [...list, ...add].sort((a, b) => b.at - a.at);
    History.sync();
    History.items = back(History.items, files);
    History.save();
    History.updateButton();
    Messages.load();
    Messages.items = back(Messages.items, msgs);
    Messages.save();
    Sent.load();
    Sent.items = back(Sent.items, sent);
    Sent.save();
    History.onChange?.();
  });
  return true;
}
// A message at the bottom with an Undo button, for 6 seconds (inside the open window, so it can be tapped)
let undoTimer = 0;
function undoToast(text, undo) {
  let el = document.getElementById('undo-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'undo-toast';
    el.className = 'undo-toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span></span><button type="button"></button>';
  }
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (el.parentNode !== host) host.appendChild(el);
  $('span', el).textContent = text;
  const btn = $('button', el);
  btn.textContent = t('Undo');
  btn.onclick = () => { clearTimeout(undoTimer); el.classList.remove('show'); undo(); };
  el.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => el.classList.remove('show'), 6000);
}
// A tapped notification of a message opens its chat (the service worker passes it on, or ?chat= in a new tab)
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data?.type === 'open-chat') openChatByKey(e.data.chat); });
// Scan to PDF (scan.js), loaded when first used
const loadScan = () => loadScript('/scan.js?v=1');
async function openScan(peer) {
  try {
    await loadScan();
  } catch (err) {
    return toast(err.message);
  }
  window.Scan.open(peer);
}
// The "Photos: Original / Smaller" buttons (More… window, chat view): the same choice as in Settings
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shrink]');
  if (!b) return;
  setShrink(b.dataset.shrink === 'off' ? 'off' : shrinkMode === 'all' ? 'all' : 'photos');
  toast(shrinkMode === 'off' ? t('Photos are sent in their original size') : t('Photos are made smaller before sending (up to 2048 px)'));
});

// Send again: to the same device if it's here (a paired device is recognised even with a new name), otherwise
// to one picked from the devices here. Files from this visit go straight away; after a reload they're chosen again.
async function sendAgain(entry) {
  const here = [...peers.values()];
  const named = here.filter((p) => p.info.name === entry.to);
  let peer = here.find((p) => entry.pair && p.pairSecret?.startsWith(entry.pair)) || (named.length === 1 ? named[0] : null);
  if (!peer) peer = await chooseDevice();
  if (!peer || peers.get(peer.info.id) !== peer) return;
  $('#dlg-history').close();
  wsSend({ type: 'stat', kind: 'again' });
  if (entry.text !== undefined) return openChat(peer, entry.text);
  const files = sentFiles.get(entry.id);
  if (files) return peer.sendFiles(files);
  toast(t('Choose the same files again: they are only kept while this page is open'), 5000);
  pickAndSend(fileInput, [peer]);
}
// A list of the devices here to choose from; resolves to the chosen Peer, or null
function chooseDevice() {
  const dlg = $('#dlg-choose');
  const list = $('.choose-list', dlg);
  list.innerHTML = '';
  $('.empty-choose', dlg).hidden = peers.size > 0;
  return new Promise((resolve) => {
    let chosen = null;
    for (const p of peers.values()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choose-item';
      b.innerHTML = `<span class="avatar" aria-hidden="true">${avatarHtml(p.info.avatar, p.info.device)}</span><span><b></b><small class="muted"></small></span>`;
      $('.avatar', b).style.background = colorFor(p.info.name);
      $('b', b).textContent = p.info.name;
      $('small', b).textContent = p.info.device;
      b.onclick = () => { chosen = p; dlg.close(); };
      list.appendChild(b);
    }
    dlg.onclose = () => resolve(chosen);
    dlg.showModal();
  });
}

// ---------- Export the history ----------
// A spreadsheet (CSV, opens in Excel, Numbers and Google Sheets) of everything sent and received in the last
// HISTORY_DAYS: one row per file or message. Made on this device; nothing is uploaded.
function exportHistory() {
  History.sync();
  Messages.load();
  Sent.load();
  const pad = (n) => String(n).padStart(2, '0');
  const when = (at) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const results = { ok: t('Sent'), declined: t('Declined'), failed: t('Not finished'), cancelled: t('Cancelled') };
  const rows = [];
  for (const e of Sent.items) {
    if (e.text !== undefined) rows.push([e.at, t('Sent'), e.to, t('Message'), e.text, '', results[e.result] || '']);
    else {
      for (const f of e.files || []) rows.push([e.at, t('Sent'), e.to, t('File'), f.name, f.size, results[e.result] || '']);
      if ((e.n || 0) > (e.files || []).length) rows.push([e.at, t('Sent'), e.to, t('File'), t('… and {n} more', { n: e.n - e.files.length }), '', results[e.result] || '']);
    }
  }
  for (const f of History.items) rows.push([f.at, t('Received'), f.from, t('File'), f.name, f.size, t('Received')]);
  for (const m of Messages.items) rows.push([m.at, t('Received'), m.from, t('Message'), m.text, '', t('Received')]);
  if (!rows.length) return toast(t('Nothing to export yet'));
  rows.sort((a, b) => b[0] - a[0]);
  // Quoted cells; a leading = + - @ is made plain text, so a spreadsheet never runs a file name as a formula
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [t('Date'), t('Direction'), t('Device'), t('Type'), t('Name or text'), t('Size (bytes)'), t('Result')];
  const csv = [head, ...rows.map((r) => [when(r[0]), ...r.slice(1)])].map((r) => r.map(cell).join(',')).join('\r\n');
  const d = new Date();
  // The byte order mark lets Excel read accents and Arabic, Hindi… correctly
  downloadBlob({ name: `omnibeam-history-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`,
    blob: new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) });
  toast(t('History exported: {n} rows', { n: rows.length }));
  wsSend({ type: 'stat', kind: 'export' });
}

// ---------- Gallery ----------
// The photos and videos among received files: a grid of thumbnails in the history (and Gallery in the received
// dialog), each one full size in the viewer (arrows, arrow keys or a swipe for the next one), and Save all:
// into Photos on iPhone and iPad, as one ZIP elsewhere. Files kept on disk are only read when they come into view.
const isMediaFile = (f) => !!mediaType(f);
const Gallery = {
  urls: [],
  urlOf(blob) {
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  },
  // Thumbnails for items: [{ name, mime, size, blob?, load?() }]. Returns the items it shows.
  render(box, items) {
    this.observer?.disconnect();
    box.innerHTML = '';
    const media = items.filter(isMediaFile);
    const fill = async (btn, f) => {
      const blob = f.blob || (f.load && (await f.load()));
      if (!blob) { btn.classList.add('gone'); return; }
      f.blob = blob;
      const video = /^video\//.test(mediaType(f));
      const el = document.createElement(video ? 'video' : 'img');
      if (video) { el.muted = true; el.preload = 'metadata'; el.playsInline = true; el.src = this.urlOf(blob) + '#t=0.1'; }
      else { el.alt = ''; el.decoding = 'async'; el.src = this.urlOf(blob); }
      // A photo this browser can't show (HEIC outside Safari): its name instead
      el.onerror = () => { el.remove(); btn.classList.add('no-preview'); };
      btn.prepend(el);
    };
    this.observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this.observer.unobserve(e.target);
        fill(e.target, e.target._item).catch(() => {});
      }
    }, { root: box.closest('dialog'), rootMargin: '200px' }) : null;
    media.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'thumb';
      btn.title = f.name;
      btn.innerHTML = `<span class="thumb-name"></span>${/^video\//.test(mediaType(f)) ? '<span class="play" aria-hidden="true">▶</span>' : ''}`;
      $('.thumb-name', btn).textContent = f.name.split('/').pop();
      btn.setAttribute('aria-label', f.name);
      btn._item = f;
      btn.onclick = () => this.view(media, i);
      box.appendChild(btn);
      if (this.observer) this.observer.observe(btn);
      else fill(btn, f).catch(() => {});
    });
    // On iPhone the share sheet must open straight from the tap, so the files are read before Save all is tapped
    if (isIOS) media.slice(0, 60).forEach((f) => { if (!f.blob && f.load) f.load().then((b) => { if (b) f.blob = b; }).catch(() => {}); });
    return media;
  },
  clear() {
    this.observer?.disconnect();
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
  },
  // Full size, one at a time
  async view(items, at) {
    const dlg = $('#dlg-viewer');
    const stage = $('.viewer-stage', dlg);
    let i = at;
    let url = null;
    const show = async () => {
      const f = items[i];
      stage.querySelector('video')?.pause();
      stage.innerHTML = '';
      if (url) { URL.revokeObjectURL(url); url = null; }
      $('.viewer-name', dlg).textContent = `${f.name.split('/').pop()} · ${i + 1} / ${items.length}`;
      $('[data-act=prev]', dlg).disabled = i === 0;
      $('[data-act=next]', dlg).disabled = i === items.length - 1;
      const blob = f.blob || (f.load && (await f.load()));
      if (items[i] !== f) return; // moved on meanwhile
      if (!blob) { stage.textContent = t('This file is no longer available'); return; }
      f.blob = blob;
      url = URL.createObjectURL(blob);
      const video = /^video\//.test(mediaType(f));
      const el = document.createElement(video ? 'video' : 'img');
      if (video) { el.controls = true; el.playsInline = true; el.autoplay = true; }
      else el.alt = f.name;
      el.onerror = () => { stage.textContent = t('This browser can\'t show this file. Save it to open it.'); };
      el.src = url;
      stage.appendChild(el);
      const save = $('[data-act=save]', dlg);
      save.textContent = canSaveToPhotos([{ ...f, blob }]) ? t('Save to Photos') : t('Save');
    };
    const go = (d) => { const n = i + d; if (n >= 0 && n < items.length) { i = n; show(); } };
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'prev') go(-1);
      if (act === 'next') go(1);
      if (act === 'close') dlg.close();
      if (act === 'save') {
        const f = items[i];
        if (!f.blob) return;
        if (canSaveToPhotos([f])) saveToPhotos([f]);
        else downloadBlob(f);
      }
    };
    // Right-to-left languages: the next one is on the left
    const rtl = document.documentElement.dir === 'rtl';
    dlg.onkeydown = (e) => {
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1);
    };
    let x0 = null;
    stage.onpointerdown = (e) => { x0 = e.clientX; };
    stage.onpointerup = (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) go((dx < 0) !== rtl ? 1 : -1);
    };
    dlg.onclose = () => { stage.querySelector('video')?.pause(); stage.innerHTML = ''; if (url) URL.revokeObjectURL(url); url = null; };
    if (!dlg.open) dlg.showModal();
    await show();
  },
};

// Save all of these files: into Photos on iPhone and iPad when they're all photos and videos, as one ZIP when
// there are several (phones often block or bury many downloads), else one download each
async function saveAllFiles(files, btn) {
  if (canSaveToPhotos(files)) return saveToPhotos(files);
  const asZip = files.length > 1 || files.some((f) => f.name.includes('/'));
  if (asZip && files.reduce((s, f) => s + f.size, 0) < 0xffffffff) {
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = t('Preparing ZIP…'); }
    try {
      await loadMore();
      downloadBlob({ name: More.zipName(files), blob: await More.makeZip(files) });
    } catch (err) {
      toast(t('Could not create the ZIP') + ` (${err.message})`);
      files.forEach((f, i) => setTimeout(() => downloadBlob(f), i * 300));
    }
    if (btn) { btn.disabled = false; btn.textContent = label; }
  } else {
    files.forEach((f, i) => setTimeout(() => downloadBlob(f), i * 300));
  }
}

// ---------- Folders ----------
// A file sent from a folder carries its path inside it ("Holiday/day 1/photo.jpg"); the receiver gets a ZIP
// with the same folders.
const folderInput = document.createElement('input');
folderInput.type = 'file';
folderInput.multiple = true;
folderInput.hidden = true;
const CAN_PICK_FOLDER = 'webkitdirectory' in folderInput && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
folderInput.webkitdirectory = true;
document.body.appendChild(folderInput);
const pathOf = (f) => f.relPath || f.webkitRelativePath || f.name;
// Names from another device: keep the folders, never anything that could leave them ("..", "/", "C:")
function safePath(name) {
  const parts = String(name || '').split(/[\\/]+/)
    .map((p) => p.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .slice(-20);
  return parts.join('/').slice(0, 500) || 'file';
}
// Dropped files and folders. Folders are read recursively (empty ones are skipped).
async function filesFromDrop(dt) {
  // Entries must be taken during the drop event: the list empties once the event is over
  const entries = [...(dt.items || [])].map((i) => i.kind === 'file' && i.webkitGetAsEntry?.()).filter(Boolean);
  const plain = [...dt.files];
  if (!entries.some((e) => e.isDirectory)) return plain;
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      file.relPath = path + file.name;
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${path}${entry.name}/`);
      }
    }
  };
  try {
    for (const e of entries) await walk(e, '');
  } catch (err) {
    toast(t('Could not read the folder') + ` (${err.message || err})`);
  }
  return out;
}
// Pick files (or a folder) and send them to these devices
function pickAndSend(input, targets) {
  input.onchange = () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    for (const p of targets) if (peers.get(p.info.id) === p) p.sendFiles(files);
  };
  input.click();
}

// ---------- Auto-accept from remembered devices ----------
// When sending, a device proves which pairings it has with an HMAC of both device ids under each pairing
// secret. Only the two paired devices know the secret (the server never sees it), so the proof can't be faked.
async function pairProof(secret, from, to) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`omnibeam-auto:${from}>${to}`)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// info: the receiving device, when sending files: also proves the team rooms shared with it (for teams whose
// devices accept files from each other without asking)
async function pairProofs(from, to, info) {
  if (!crypto.subtle || !from || !to) return [];
  try {
    const secrets = [...loadPaired(), ...(info ? Teams.shared(info) : [])].map((p) => p.secret);
    return await Promise.all(secrets.map((secret) => pairProof(secret, from, to)));
  } catch {
    return [];
  }
}
async function autoAcceptFrom(from, proofs) {
  if (!Array.isArray(proofs) || !proofs.length || !crypto.subtle) return false;
  // TV mode takes files from every paired device: pairing needs the QR code on the TV screen
  const auto = [...loadPaired(), ...Teams.list()].filter((p) => p.auto || IS_TV);
  for (const p of auto) {
    try {
      if (proofs.includes(await pairProof(p.secret, from, me.id))) return true;
    } catch {}
  }
  return false;
}

// ---------- Copy a received image ----------
const CAN_COPY_IMAGE = !!(window.ClipboardItem && navigator.clipboard?.write);
async function toPng(blob) {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('convert'))), 'image/png'));
}
function copyImage(blob) {
  // Safari needs the clipboard write to start right away, with the image as a promise
  navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(blob) })])
    .then(() => toast(t('Image copied')), () => toast(t('Could not copy')));
}

// ---------- Clipboard sync ----------
// With Clipboard sync on (Settings) on both devices, text copied on one lands on the other's clipboard. Only
// paired devices take part, and each message proves the pairing (pairProof), so nobody else on the network can
// receive it or push text onto this clipboard. Browsers only let a page read the clipboard while it's in front:
// Chrome and Edge (once allowed) are checked every couple of seconds then, so anything copied anywhere is sent;
// other browsers send what is copied on this page, and the Paste button in the message box sends the rest.
// Writing to the clipboard also needs the page in front (and a tap on iPhone), else the text is shown to copy.
const CLIP_KEY = 'omnibeam-clip';
const CLIP_MAX = 100000;
const CLIP_EVERY = 1500;
let clipSync = (() => { try { return localStorage.getItem(CLIP_KEY) === 'on'; } catch { return false; } })();
let lastClip = null; // the last text sent or received, so it isn't sent twice (or back where it came from)
let clipReadable = false; // allowed to read the clipboard without asking each time (Chrome, Edge)
let pendingClip = null; // arrived while the page was in the background: copied once it's in front again
let clipPerm = 'unsupported'; // Chrome's clipboard-read permission: granted, denied, prompt (or unsupported: Safari, Firefox)
let clipDeniedTold = false;

// Clipboard history: the last CLIPS_MAX texts sent or received by Clipboard sync, newest first, in the History
// window (Clipboard tab) with Copy and Send again. Kept only on this device (localStorage); Settings can turn it off.
const CLIPS_KEY = 'omnibeam-clips';
const CLIPS_OFF_KEY = 'omnibeam-clips-off';
const CLIPS_MAX = 20;
const ClipHistory = {
  items: [],
  get on() { try { return localStorage.getItem(CLIPS_OFF_KEY) !== '1'; } catch { return true; } },
  set on(v) {
    try { if (v) localStorage.removeItem(CLIPS_OFF_KEY); else localStorage.setItem(CLIPS_OFF_KEY, '1'); } catch {}
    if (!v) this.clear();
  },
  load() {
    try { this.items = JSON.parse(localStorage.getItem(CLIPS_KEY) || '[]').filter((c) => c && typeof c.text === 'string').slice(0, CLIPS_MAX); } catch { this.items = []; }
    return this.items;
  },
  save() {
    try { localStorage.setItem(CLIPS_KEY, JSON.stringify(this.items)); } catch {}
    this.onChange?.();
  },
  // dir: 'in' (from who) or 'out' (to who)
  add(text, dir, who) {
    if (!this.on || !text.trim()) return;
    this.load();
    // The same text again moves to the top instead of being listed twice
    this.items = [{ id: randomHex(8), text: text.slice(0, CLIP_MAX), dir, who: String(who || '').slice(0, 120), at: Date.now() },
      ...this.items.filter((c) => c.text !== text)].slice(0, CLIPS_MAX);
    this.save();
  },
  remove(id) { this.load(); this.items = this.items.filter((c) => c.id !== id); this.save(); },
  clear() { this.items = []; try { localStorage.removeItem(CLIPS_KEY); } catch {} this.onChange?.(); },
};
// Send again from the history: to every paired device online now, even with sync off here (a device with sync
// off shows it as a message)
function resendClip(text) {
  const targets = [...peers.values()].filter((p) => p.pairSecret);
  if (!targets.length) return toast(loadPaired().length ? t('Not sent: no paired device is online right now.') : t('Not sent: pair your devices first (link button at the top).'));
  lastClip = text;
  for (const p of targets) p.sendClip(text);
  ClipHistory.add(text, 'out', targets.map((p) => p.info.name).join(', '));
  wsSend({ type: 'stat', kind: 'cliphist' });
  toast(t(targets.length > 1 ? 'Clipboard sent to {n} devices' : 'Clipboard sent to {name}', { n: targets.length, name: targets[0].info.name }));
}

function sendClip(text, force) {
  if (!clipSync || typeof text !== 'string' || !text.trim() || text.length > CLIP_MAX || (text === lastClip && !force)) return;
  lastClip = text;
  const targets = [...peers.values()].filter((p) => p.pairSecret);
  for (const p of targets) p.sendClip(text);
  if (targets.length) ClipHistory.add(text, 'out', targets.map((p) => p.info.name).join(', '));
  // Say why nothing happened, so a copy never just vanishes
  if (!targets.length) return toast(loadPaired().length ? t('Not sent: no paired device is online right now.') : t('Not sent: pair your devices first (link button at the top).'));
  toast(t(targets.length > 1 ? 'Clipboard sent to {n} devices' : 'Clipboard sent to {name}', { n: targets.length, name: targets[0].info.name }));
}
async function readClip(first) {
  if (!clipSync || !navigator.clipboard?.readText || !document.hasFocus()) return;
  if (!first && !clipReadable) {
    if (clipPerm === 'denied' && !clipDeniedTold) {
      clipDeniedTold = true;
      toast(t('This browser blocked clipboard access, so only text copied on this page is sent. See Settings.'));
    }
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    // What was already on the clipboard when sync started isn't news: only later copies are sent
    if (first) lastClip = text;
    else sendClip(text);
  } catch {}
}
async function watchClipPermission() {
  try {
    const st = await navigator.permissions.query({ name: 'clipboard-read' });
    clipPerm = st.state;
    clipReadable = st.state === 'granted';
    st.onchange = () => { clipPerm = st.state; clipReadable = st.state === 'granted'; updateClipUi(); };
  } catch {}
  updateClipUi();
}
async function writeClip(text) {
  if (!navigator.clipboard?.writeText || document.hidden) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
async function onClip(peer, msg) {
  const text = String(msg.text || '').slice(0, CLIP_MAX);
  if (!text.trim()) return;
  const pair = clipSync && (await matchPairing(peer.info.id, [].concat(msg.proofs || []).slice(0, 60)));
  if (!pair) {
    // Sync is off here, or the sender isn't paired with us: just show it, like any message
    Messages.add(text, peer.info.name, peer.pairSecret);
    messageSound();
    if (!chatShowing(peer)) messageArrived(peer, text);
    return;
  }
  lastClip = text;
  ClipHistory.add(text, 'in', peer.info.name);
  if (await writeClip(text)) return toast(t('Clipboard from {name} copied', { name: peer.info.name }));
  pendingClip = { peer, text };
  if (document.hidden) notify(t('Clipboard from {name}', { name: peer.info.name }), text.slice(0, 100));
  else showText(peer, text); // iPhone: one tap on Copy
}
// Back in front: copy what arrived meanwhile, and send what was copied elsewhere meanwhile
async function onClipFocus() {
  if (!clipSync) return;
  if (pendingClip && !document.hidden) {
    const { peer, text } = pendingClip;
    pendingClip = null;
    if (await writeClip(text)) toast(t('Clipboard from {name} copied', { name: peer.info.name }));
    else showText(peer, text);
  }
  readClip(false);
}
window.addEventListener('focus', onClipFocus);
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(onClipFocus, 200); });
setInterval(() => { if (clipSync && !document.hidden) readClip(false); }, CLIP_EVERY);
// Copied on this page (works in every browser, no permission needed)
for (const type of ['copy', 'cut']) {
  document.addEventListener(type, () => setTimeout(() => {
    const el = document.activeElement;
    const text = el && typeof el.selectionStart === 'number' && el.value
      ? el.value.slice(el.selectionStart, el.selectionEnd) : String(document.getSelection() || '');
    sendClip(text);
  }, 0));
}
function updateClipUi() {
  const box = $('#clip-sync');
  if (!box) return;
  box.checked = clipSync;
  const paired = loadPaired().length;
  $('#clip-note').textContent = !paired ? t('Pair your devices first (link button at the top). Clipboard sync only works between paired devices.')
    : clipReadable ? t('This browser sends anything you copy while OmniBeam is the open tab.')
      : t('This browser only shows OmniBeam what you copy on this page. To send other text, tap Send my clipboard now.');
  // What sync would do right now: who gets it, and whether this browser lets OmniBeam read the clipboard
  const online = [...peers.values()].filter((p) => p.pairSecret).map((p) => p.info.name);
  const lines = [online.length ? t('Paired and online: {names}', { names: online.join(', ') }) : t('No paired device is online right now.')];
  if (clipSync) {
    lines.push(clipPerm === 'granted' ? t('Clipboard access: allowed.')
      : clipPerm === 'denied' ? t('Clipboard access: blocked. Click the icon at the left of the address bar, set Clipboard to Allow, then reload.')
        : clipPerm === 'prompt' ? t('Clipboard access: not allowed yet. Tap Send my clipboard now and choose Allow.')
          : t('This browser only lets OmniBeam read the clipboard when you tap a button.'));
  }
  $('#clip-status').textContent = lines.join(' ');
  $('#clip-now').hidden = !clipSync || !navigator.clipboard?.readText;
  $('#clip-history').checked = ClipHistory.on;
}
// Send my clipboard now: a tap lets every browser read the clipboard (iPhone shows a Paste bubble)
async function sendClipNow() {
  let text;
  try { text = await navigator.clipboard.readText(); } catch { return toast(t('Could not read the clipboard')); }
  watchClipPermission();
  if (!text?.trim()) return toast(t('Your clipboard is empty'));
  sendClip(text, true);
}
async function setClipSync(on) {
  clipSync = on;
  try { localStorage.setItem(CLIP_KEY, on ? 'on' : 'off'); } catch {}
  if (on) {
    await readClip(true); // asks for permission in Chrome and Edge (this runs from the tap)
    await watchClipPermission();
    toast(t('Clipboard sync is on. Turn it on on your other device too.'));
  }
  updateClipUi();
}
if (clipSync) { watchClipPermission(); setTimeout(() => readClip(true), 1000); }

// History: what arrived (files and messages), the photos and videos among them as a gallery, and what this
// device sent (with Send again). Opens on the tab used last.
const HISTORY_TAB_KEY = 'omnibeam-history-tab';
function openHistory() {
  const dlg = $('#dlg-history');
  const box = $('.received:not(.messages):not(.sent-list)', dlg);
  const msgBox = $('.messages', dlg);
  const sentBox = $('.sent-list', dlg);
  const clipBox = $('.clip-list', dlg);
  const galleryBox = $('.gallery', dlg);
  let tab = 'received';
  try { tab = localStorage.getItem(HISTORY_TAB_KEY) || 'received'; } catch {}
  if (!['received', 'gallery', 'sent', 'clips'].includes(tab)) tab = 'received';
  if (openHistory.tab) { tab = openHistory.tab; openHistory.tab = ''; }
  let galleryItems = [];
  let galleryCounted = false;
  const when = (at) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const renderReceived = () => {
    box.innerHTML = '';
    msgBox.innerHTML = '';
    Messages.load();
    $('.empty-history', dlg).hidden = History.items.length + Messages.items.length > 0;
    $('.messages-title', dlg).hidden = Messages.items.length === 0;
    for (const m of Messages.items) {
      const item = document.createElement('div');
      item.className = 'item message';
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<div class="msg-text"></div><div class="muted"></div>';
      info.children[0].innerHTML = linkify(m.text);
      info.children[1].textContent = `${t('from {name}', { name: m.from })} · ${when(m.at)}`;
      const copy = document.createElement('button');
      copy.className = 'btn small';
      copy.textContent = t('Copy');
      copy.onclick = () => navigator.clipboard.writeText(m.text).then(() => toast(t('Copied to clipboard')), () => toast(t('Could not copy')));
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = t('Delete');
      del.onclick = () => { Messages.remove(m); render(); };
      // Messages are read and answered in the chat of the device: the row (or its Chat button) opens it
      const chat = document.createElement('button');
      chat.className = 'btn small';
      chat.textContent = t('Chat');
      chat.dataset.chat = m.pair ? 'p:' + m.pair : 'n:' + m.from;
      const toChat = () => { dlg.close(); openChatByKey(chat.dataset.chat); };
      chat.onclick = toChat;
      info.classList.add('msg-open');
      info.onclick = (e) => { if (!e.target.closest('a')) toChat(); };
      item.append(info, chat, copy, del);
      msgBox.appendChild(item);
    }
    for (const f of History.items) {
      const item = document.createElement('div');
      item.className = 'item';
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<div></div><div class="muted"></div>';
      info.children[0].textContent = f.name;
      info.children[1].textContent = `${formatSize(f.size)} · ${t('from {name}', { name: f.from })} · ${when(f.at)}`;
      item.appendChild(info);
      const save = saveButton(f, () => History.blobOf(f).then((blob) => {
        if (blob) return blob;
        toast(t('This file is no longer available')); History.remove(f); render();
        return null;
      }));
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = t('Delete');
      del.onclick = () => { History.remove(f); render(); };
      if (previewKind(f)) item.append(previewButton(f, () => History.blobOf(f).then((blob) => {
        if (blob) return blob;
        toast(t('This file is no longer available')); History.remove(f); render();
        return null;
      })));
      item.append(save, del);
      box.appendChild(item);
    }
  };
  const renderGallery = () => {
    Gallery.clear();
    const items = History.items.map((f) => ({ name: f.name, mime: f.mime, size: f.size, blob: f.blob, load: () => History.blobOf(f) }));
    galleryItems = Gallery.render(galleryBox, items);
    if (!galleryCounted && galleryItems.length) { galleryCounted = true; wsSend({ type: 'stat', kind: 'gallery' }); }
    $('.empty-gallery', dlg).hidden = galleryItems.length > 0;
  };
  const results = { ok: '✓ ' + t('Sent'), declined: t('Declined'), failed: t('Not finished'), cancelled: t('Cancelled') };
  const renderSent = () => {
    Sent.load();
    sentBox.innerHTML = '';
    $('.empty-sent', dlg).hidden = Sent.items.length > 0;
    for (const e of Sent.items) {
      const item = document.createElement('div');
      item.className = 'item sent ' + (e.result || '');
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<div${e.text !== undefined ? ' class="msg-text"' : ''}></div><div class="muted"></div>`;
      const files = e.files || [];
      info.children[0].textContent = e.text !== undefined ? e.text
        : files.length === 1 && e.n === 1 ? files[0].name
        : t('{n} files', { n: e.n }) + ': ' + files.slice(0, 3).map((f) => f.name.split('/').pop()).join(', ') + (e.n > 3 ? '…' : '');
      info.children[1].textContent = [e.text !== undefined ? t('Message') : formatSize(e.bytes || 0), t('to {name}', { name: e.to }), when(e.at), results[e.result] || '']
        .filter(Boolean).join(' · ');
      const again = document.createElement('button');
      again.className = 'btn small';
      again.dataset.again = e.id;
      again.textContent = t('Send again');
      again.title = e.text !== undefined || sentFiles.has(e.id) ? '' : t('You will choose the files again');
      again.onclick = () => sendAgain(e);
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = t('Delete');
      del.onclick = () => { Sent.remove(e.id); };
      item.append(info, again, del);
      sentBox.appendChild(item);
    }
  };
  const renderClips = () => {
    ClipHistory.load();
    clipBox.innerHTML = '';
    $('.empty-clips', dlg).hidden = ClipHistory.items.length > 0;
    for (const c of ClipHistory.items) {
      const item = document.createElement('div');
      item.className = 'item message clip ' + c.dir;
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<div class="msg-text"></div><div class="muted"></div>';
      info.children[0].textContent = c.text.length > 400 ? c.text.slice(0, 400) + '…' : c.text;
      info.children[1].textContent = `${c.dir === 'in' ? '↓ ' + t('from {name}', { name: c.who }) : '↑ ' + t('to {name}', { name: c.who })} · ${when(c.at)}`;
      const copy = document.createElement('button');
      copy.className = 'btn small ghost';
      copy.textContent = t('Copy');
      copy.onclick = () => navigator.clipboard.writeText(c.text).then(() => { lastClip = c.text; toast(t('Copied to clipboard')); }, () => toast(t('Could not copy')));
      const again = document.createElement('button');
      again.className = 'btn small';
      again.dataset.clipAgain = c.id;
      again.textContent = t('Send again');
      again.onclick = () => resendClip(c.text);
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.textContent = t('Delete');
      del.onclick = () => ClipHistory.remove(c.id);
      item.append(info, copy, again, del);
      clipBox.appendChild(item);
    }
  };
  const render = () => {
    for (const b of dlg.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const pane of dlg.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== tab;
    if (tab === 'received') renderReceived();
    if (tab === 'gallery') renderGallery();
    if (tab === 'sent') renderSent();
    if (tab === 'clips') renderClips();
    const count = tab === 'sent' ? Sent.items.length : tab === 'gallery' ? galleryItems.length : tab === 'clips' ? ClipHistory.items.length : History.items.length + Messages.items.length;
    $('.history-note', dlg).textContent = tab === 'clips'
      ? (ClipHistory.on ? t('The last {n} texts sent or received with Clipboard sync, kept only on this device.', { n: CLIPS_MAX }) : t('Clipboard history is off (Settings).'))
      : tab === 'sent'
      ? t('Names and sizes are kept for {n} days. The files themselves only while this page is open.', { n: HISTORY_DAYS })
      : Store.kind === 'memory'
      ? t('This browser can\'t store files, so this list is cleared when you close or reload the page.')
      : t('Files are kept on this device for {n} days.', { n: HISTORY_DAYS });
    $('[data-act=clear]', dlg).hidden = tab === 'gallery' || count === 0;
    $('[data-act=gallery-save]', dlg).hidden = tab !== 'gallery' || galleryItems.length === 0;
    $('[data-act=gallery-save]', dlg).textContent = canSaveToPhotos(galleryItems.filter((f) => f.blob)) && galleryItems.every((f) => f.blob)
      ? t('Save all to Photos') : t('Save all');
    Sent.load();
    $('[data-act=export]', dlg).hidden = History.items.length + Messages.items.length + Sent.items.length === 0;
  };
  render();
  History.onChange = () => { if (tab !== 'gallery') render(); };
  ClipHistory.onChange = () => { if (tab === 'clips') render(); };
  dlg.onclose = () => { History.onChange = ClipHistory.onChange = null; Gallery.clear(); };
  dlg.onclick = async (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      try { localStorage.setItem(HISTORY_TAB_KEY, tab); } catch {}
      render();
      return;
    }
    const act = e.target.dataset?.act;
    if (act === 'close') dlg.close();
    if (act === 'export') exportHistory();
    if (act === 'clear') {
      if (tab === 'sent') Sent.clear();
      else if (tab === 'clips') ClipHistory.clear();
      else { [...History.items].forEach((f) => History.remove(f)); Messages.clear(); }
      render();
    }
    if (act === 'gallery-save') {
      const btn = e.target;
      // Photos and videos still on disk are read first (they're already read on iPhone, see Gallery.render)
      if (!isIOS) await Promise.all(galleryItems.map(async (f) => { if (!f.blob) f.blob = await f.load(); }));
      const files = galleryItems.filter((f) => f.blob);
      if (files.length) saveAllFiles(files, btn);
    }
  };
  // Arrow keys move between the tabs
  dlg.querySelector('.tabs').onkeydown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...dlg.querySelectorAll('[data-tab]')];
    const next = tabs[(tabs.indexOf(document.activeElement) + ((e.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl') ? 1 : tabs.length - 1)) % tabs.length];
    next?.focus();
    next?.click();
  };
  dlg.showModal();
}

// ---------- Dialogs ----------
function askAccept(peer, files) {
  if (chatShowing(peer) && window.Chat.ask) return window.Chat.ask(peer, files);
  const dlg = $('#dlg-request');
  $('.who', dlg).textContent = peer.info.name;
  const list = $('.file-list', dlg);
  list.innerHTML = '';
  const shown = files.length > 60 ? files.slice(0, 50) : files;
  const rows = shown.map((f) => [f.name, formatSize(f.size)]);
  if (shown.length < files.length) {
    rows.push([t('… and {n} more', { n: files.length - shown.length }), formatSize(files.slice(shown.length).reduce((s, f) => s + f.size, 0))]);
  }
  if (files.length > 1) rows.push([t('{n} files in total', { n: files.length }), formatSize(files.reduce((s, f) => s + f.size, 0))]);
  for (const [name, size] of rows) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><span></span>';
    li.children[0].textContent = name;
    li.children[1].textContent = size;
    list.appendChild(li);
  }
  return new Promise((resolve) => {
    // The sender can cancel while we're still asking
    const finish = (ok) => { peer.asking = null; if (dlg.open) dlg.close(); resolve(ok); };
    peer.asking = finish;
    dlg.onclick = (e) => {
      const act = e.target.dataset?.act;
      if (act) finish(act === 'accept');
    };
    dlg.oncancel = () => finish(false);
    dlg.showModal();
  });
}

function downloadBlob(file) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name.split('/').pop(); // a file from a folder: just its own name
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// iPhone and iPad: Safari puts every download in the Files app, never in Photos, and a web page can't write to
// Photos itself. The share sheet can: it offers "Save Image" / "Save Video" (and still "Save to Files"), so
// received photos and videos are handed to it instead of downloaded. Must run straight from a tap.
const MEDIA_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v' };
const mediaType = (f) => (/^(image|video)\//.test(f.mime || '') ? f.mime : MEDIA_TYPES[(f.name.match(/\.(\w+)$/) || [])[1]?.toLowerCase()]);
const toShareFile = (f) => new File([f.blob], f.name.split('/').pop(), { type: mediaType(f) });
// What a received file can be previewed as before saving it (the preview itself is in media.js)
const TEXT_EXT = /\.(txt|log|md|markdown|csv|tsv|json|xml|ya?ml|toml|ini|cfg|conf|env|properties|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|swift|sh|bash|zsh|ps1|bat|cmd|sql|html?|css|scss|less|vue|svelte|lua|r|dart|pl|gradle|dockerfile|gitignore|srt|vtt)$/i;
function previewKind(f) {
  const mime = f.mime || f.type || '';
  const name = f.name || '';
  if (/^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/.test(mime) || /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(name)) return 'image';
  if (/^video\//.test(mime) || /\.(mp4|m4v|mov|webm)$/i.test(name)) return 'video';
  if (/^audio\//.test(mime) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(name)) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (/^text\//.test(mime) || /^application\/(json|xml|javascript|x-sh|sql|x-yaml|toml)/.test(mime) || TEXT_EXT.test(name) || /(^|\/)(Dockerfile|Makefile|\.env[\w.]*)$/.test(name)) return 'text';
  return '';
}
function previewButton(f, load) {
  const btn = document.createElement('button');
  btn.className = 'btn ghost small';
  btn.textContent = t('Preview');
  btn.onclick = () => media('preview')(f, load).catch(() => {});
  return btn;
}
function canSaveToPhotos(files) {
  if (!isIOS || !navigator.canShare || !files.length || !files.every(mediaType)) return false;
  try { return navigator.canShare({ files: files.map(toShareFile) }); } catch { return false; }
}
function saveToPhotos(files) {
  navigator.share({ files: files.map(toShareFile) }).catch((err) => {
    if (err.name === 'AbortError') return; // the menu was closed
    toast(t('Could not open the Photos menu, so it was saved to Files instead'));
    files.forEach((f, i) => setTimeout(() => downloadBlob(f), i * 300));
  });
}
// The Save button of one received file: "Save to Photos" for photos and videos on iPhone and iPad.
// A file from the saved history is read from storage first (on iPhone right away, so the tap can open the menu).
function saveButton(f, loadBlob) {
  const btn = document.createElement('button');
  btn.className = 'btn small';
  const photos = isIOS && !!navigator.canShare && !!mediaType(f) && (!f.blob || canSaveToPhotos([f]));
  btn.textContent = photos ? t('Save to Photos') : t('Save');
  let blob = f.blob;
  const load = () => blob || (blob = loadBlob().then((b) => (blob = b)));
  if (photos && !blob) load();
  btn.onclick = async () => {
    const b = blob instanceof Blob ? blob : await load();
    if (!b) return;
    if (photos) saveToPhotos([{ name: f.name, mime: f.mime, blob: b }]);
    else downloadBlob({ name: f.name, blob: b });
  };
  return btn;
}

// Size line of a received file, with the result of the "file intact" check once there is one
const intactEls = new WeakMap();
function showIntact(f) {
  const el = intactEls.get(f);
  if (!el) return;
  el.textContent = formatSize(f.size);
  el.classList.toggle('intact', f.intact === true);
  el.classList.toggle('damaged', f.intact === false);
  if (f.intact === true) el.textContent += ` · ✓ ${t('Intact')}`;
  if (f.intact === false) el.textContent += ` · ⚠ ${t('Damaged: ask for it again')}`;
  el.title = f.intact === true ? t('Checked: every byte matches the original') : '';
}
function showReceived(peer, files) {
  if (IS_TV) return Tv.received(peer, files);
  const dlg = $('#dlg-received');
  $('.who', dlg).textContent = peer.info.name;
  const box = $('.received', dlg);
  box.innerHTML = '';
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'item';
    const kind = (f.mime || '').split('/')[0];
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f.blob);
      img.alt = '';
      item.appendChild(img);
    } else if (kind === 'video' || kind === 'audio') {
      // Play received videos and audio right in the dialog
      const media = document.createElement(kind);
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
      media.src = URL.createObjectURL(f.blob);
      media.className = 'preview-media';
      item.classList.add('has-media');
      item.appendChild(media);
    }
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<div></div><div class="muted"></div>';
    info.children[0].textContent = f.name;
    intactEls.set(f, info.children[1]);
    showIntact(f);
    item.appendChild(info);
    if (['pdf', 'text'].includes(previewKind(f))) item.appendChild(previewButton(f));
    if (kind === 'image' && CAN_COPY_IMAGE) {
      const copy = document.createElement('button');
      copy.className = 'btn ghost small';
      copy.textContent = t('Copy');
      copy.onclick = () => copyImage(f.blob);
      item.appendChild(copy);
    }
    item.appendChild(saveButton(f));
    box.appendChild(item);
  }
  // iPhone and iPad: photos and videos go to Photos through the share sheet (see saveToPhotos)
  const toPhotos = canSaveToPhotos(files);
  const anyPhotos = toPhotos || files.some((f) => canSaveToPhotos([f]));
  let hint = $('.photos-hint', dlg);
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'muted photos-hint';
    box.after(hint);
  }
  hint.hidden = !anyPhotos;
  hint.textContent = t('In the menu that opens, tap “Save Image” or “Save Video” to put it in Photos.');
  const saveAll = $('[data-act=save-all]', dlg);
  const asZip = !toPhotos && (files.length > 1 || files.some((f) => f.name.includes('/')));
  saveAll.textContent = toPhotos ? (files.length > 1 ? t('Save all to Photos') : t('Save to Photos'))
    : asZip ? t('Save all as ZIP') : t('Save');
  // Several photos or videos: see them one by one, full size
  const media = files.filter(isMediaFile);
  $('[data-act=gallery]', dlg).hidden = media.length < 2;
  dlg.onclick = async (e) => {
    const act = e.target.dataset?.act;
    if (act === 'close') { dlg.querySelectorAll('video, audio').forEach((m) => m.pause()); dlg.close(); }
    if (act === 'gallery') { dlg.querySelectorAll('video, audio').forEach((m) => m.pause()); Gallery.view(media, 0); }
    if (act === 'save-all') {
      await saveAllFiles(files, saveAll);
      dlg.querySelectorAll('video, audio').forEach((m) => m.pause());
      dlg.close();
    }
  };
  showLoop(dlg);
  if (!dlg.open) dlg.showModal();
  chime();
  notify(t('Received files from {name}', { name: peer.info.name }), files.map((f) => f.name).join(', '));
}

// "Worked well? Tell a friend" card in the received-files dialog: from the second time files arrive, then at most
// every 14 days, never after "Not now" three times. Offers the app that fits this device (Windows app, Chrome
// extension, or installing the site on a phone) unless OmniBeam already runs as an installed app.
const LOOP_KEY = 'omnibeam-loop';
const RATE_WINDOWS_STORE = 'ms-windows-store://review/?ProductId=9PLR2PMX3SQZ';
const RATE_WINDOWS_WEB = 'https://apps.microsoft.com/detail/9PLR2PMX3SQZ';
const RATE_CHROME = 'https://chromewebstore.google.com/detail/dgcknmaoidknhocfgdoglmmpophmilki/reviews';
function showLoop(dlg) {
  const box = $('.loop', dlg);
  let st = {};
  try { st = JSON.parse(localStorage.getItem(LOOP_KEY) || '{}') || {}; } catch {}
  st.n = (st.n || 0) + 1;
  const save = () => { try { localStorage.setItem(LOOP_KEY, JSON.stringify(st)); } catch {} };
  const show = st.n >= 2 && (st.no || 0) < 3 && Date.now() - (st.at || 0) > 14 * 86400000;
  box.hidden = !show;
  if (show) st.at = Date.now();
  save();
  if (!show) return;
  const ua = navigator.userAgent;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const phone = isIOS || /Android/.test(ua);
  const chromium = /Chrome\//.test(ua) && !/OPR\/|SamsungBrowser/.test(ua);
  const storeApp = standalone && /Windows/.test(ua) && !phone;
  $('[data-app=windows]', box).hidden = standalone || phone || !/Windows/.test(ua);
  $('[data-app=chrome]', box).hidden = phone || !chromium || extensionHere || /Windows/.test(ua) && !standalone;
  $('[data-act=install]', box).hidden = standalone || !phone;
  // "Rate OmniBeam" only where there's a store page to rate it on: the Windows app (Microsoft Store), or Chrome
  // with the OmniBeam extension (Chrome Web Store)
  const rate = $('[data-app=rate]', box);
  rate.href = storeApp ? RATE_WINDOWS_WEB : RATE_CHROME;
  rate.hidden = !storeApp && !(extensionHere && chromium && !phone);
  box.onclick = async (e) => {
    if (storeApp && e.target.closest('[data-app=rate]')) return openWindowsReview(e);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'tell') tellFriend();
    if (act === 'install') window.dispatchEvent(new Event('omnibeam-install'));
    if (act === 'loop-no') { st.no = (st.no || 0) + 1; save(); box.hidden = true; }
  };
}

// ---------- Share menu (Android, when OmniBeam is installed as an app) ----------
// sw.js receives the shared files and opens /?share=1; the next tapped device gets them.
let shared = null; // { files, text }
async function loadShared() {
  if (!/[?&]share=1/.test(location.search)) return;
  history.replaceState(null, '', location.pathname + location.hash);
  try {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('omnibeam-share', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('shared');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const item = await new Promise((resolve, reject) => {
      const tx = db.transaction('shared', 'readwrite');
      const st = tx.objectStore('shared');
      const g = st.get('pending');
      st.delete('pending');
      tx.oncomplete = () => resolve(g.result);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    if (item && (item.files?.length || item.text)) setShared({ files: item.files || [], text: item.text || '' });
  } catch (err) {
    console.warn('Could not read shared files', err);
  }
}
function setShared(item) {
  shared = item;
  const banner = $('#share-banner');
  banner.hidden = !item;
  if (!item) return;
  $('span', banner).textContent = item.files.length
    ? t('Tap a device to send {n} shared file(s)', { n: item.files.length })
    : t('Tap a device to send the shared text');
}
function sendShared(peer) {
  if (peer.busy) return toast(t('Transfer in progress…'));
  const { files, text } = shared;
  setShared(null);
  // Text shared together with files (e.g. a caption) goes as a message after the files
  if (files.length) peer.sendFiles(files).then(() => text && peer.sendText(text));
  else if (text) peer.sendText(text);
}

// Everything that can be sent to a device, from the card's "More…" button or a long press on a phone
function openActions(peer) {
  const dlg = $('#dlg-actions');
  $('.who', dlg).textContent = peer.info.name;
  $('[data-act=folder]', dlg).hidden = !CAN_PICK_FOLDER;
  $('[data-act=voice]', dlg).hidden = !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia;
  // Phones and tablets can't share their screen from a browser; they can still watch one
  $('[data-act=screen]', dlg).hidden = !navigator.mediaDevices?.getDisplayMedia || isPhone;
  updateShrinkUi();
  dlg.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    dlg.close();
    if (peers.get(peer.info.id) !== peer) return toast(t('{name} is no longer available', { name: peer.info.name }));
    peer.warmUp();
    if (act === 'files') pickAndSend(fileInput, [peer]);
    else if (act === 'folder') pickAndSend(folderInput, [peer]);
    else if (act === 'message') openChat(peer);
    else if (act === 'photo') media('snapPhoto')(peer);
    else if (act === 'voice') media('recordVoice')(peer);
    else if (act === 'screen') media('shareScreen')(peer);
    else if (act === 'secret') media('secretNote')(peer);
    else if (act === 'speed') checkSpeedWith(peer.info.id);
    else if (act === 'scan') openScan(peer);
    else if (act === 'chat') openChat(peer);
    else if (act === 'ring') ringDevice(peer);
  };
  if (!dlg.open) dlg.showModal();
}

function showText(peer, text) {
  const dlg = $('#dlg-text');
  $('.who', dlg).textContent = peer.info.name;
  $('.text-body', dlg).innerHTML = linkify(text);
  dlg.onclick = async (e) => {
    const act = e.target.dataset?.act;
    if (act === 'close') dlg.close();
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        toast(t('Copied to clipboard'));
      } catch {
        toast(t('Could not copy'));
      }
      dlg.close();
    }
  };
  if (!dlg.open) dlg.showModal();
}

// Screen sharing (media.js): its messages are handled one after the other, once media.js has loaded
let screenQueue = Promise.resolve();
function onScreenSignal(from, data) {
  if (!data || typeof data !== 'object') return;
  screenQueue = screenQueue.then(() => media('onScreenSignal')(from, data)).catch(() => {});
}

// Pairing with a 6-digit code
const pairDlg = $('#dlg-pair');
// The pairing window shows one part at a time: Scan (QR), Code (6 digits), Rooms (public and team rooms) and
// Devices (only when some are remembered). It opens on the part used last, or on Code while a code is active.
const PAIR_TAB_KEY = 'omnibeam-pair-tab';
const PairTabs = {
  names: ['scan', 'code', 'rooms', 'devices'],
  now: 'scan',
  visible() { return this.names.filter((n) => !$(`#pair-tab-${n}`).hidden); },
  show(name, { save = false, focus = false } = {}) {
    if (!this.visible().includes(name)) name = 'scan';
    this.now = name;
    for (const n of this.names) {
      const on = n === name;
      const tab = $(`#pair-tab-${n}`);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#pair-pane-${n}`).hidden = !on;
    }
    if (focus) $(`#pair-tab-${name}`).focus();
    if (save) { try { localStorage.setItem(PAIR_TAB_KEY, name); } catch {} }
  },
  // Devices tab only while there are remembered devices
  refresh() {
    $('#pair-tab-devices').hidden = $('#paired-section').hidden;
    if (!this.visible().includes(this.now)) this.show('scan');
  },
  opening() {
    this.refresh();
    let last = '';
    try { last = localStorage.getItem(PAIR_TAB_KEY) || ''; } catch {}
    this.show(pairedCode ? 'code' : (this.names.includes(last) ? last : 'scan'));
  },
};
$('.pair-tabs').onclick = (e) => {
  const tab = e.target.closest('[data-pair-tab]');
  if (tab) PairTabs.show(tab.dataset.pairTab, { save: true });
};
$('.pair-tabs').onkeydown = (e) => {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const list = PairTabs.visible();
  let i = list.indexOf(PairTabs.now);
  const k = keys[e.key];
  if (k === 'first') i = 0;
  else if (k === 'last') i = list.length - 1;
  else i = (i + (document.documentElement.dir === 'rtl' ? -k : k) + list.length) % list.length;
  PairTabs.show(list[i], { save: true, focus: true });
};
const pairInput = $('#pair-code');
function updatePairUi() {
  $('#btn-pair').classList.toggle('active', !!pairedCode);
  $('#pair-active').hidden = !pairedCode;
  $('#pair-idle').hidden = !!pairedCode;
  $('#pair-leave').hidden = !pairedCode;
  $('#pair-show').textContent = pairedCode ? pairedCode.replace(/(\d{3})(\d{3})/, '$1 $2') : '';
  $('#pair-link').textContent = pairedCode ? pairLink(pairedCode) : '';
  renderPairQr();
  renderPairedList();
  updatePublicUi();
  Teams.render();
  PairTabs.refresh();
}

// ---------- Several tabs in one browser ----------
// Tabs tell each other their ids (privately, never via the server) so a tab can label the others,
// and keep the received-files history in step.
const otherTabs = new Set();
const tabChannel = 'BroadcastChannel' in window ? new BroadcastChannel('omnibeam-tabs') : null;
if (tabChannel) {
  tabChannel.onmessage = ({ data }) => {
    if (!data?.id || data.id === me.id) return;
    otherTabs.add(data.id);
    peers.get(data.id)?.markTab();
    if (data.ask && me.id) tabChannel.postMessage({ id: me.id });
  };
}
window.addEventListener('storage', (e) => {
  if (e.key !== HISTORY_KEY) return;
  History.sync();
  History.updateButton();
  History.onChange?.();
});

// ---------- Device name (rename) ----------
const NAME_KEY = 'omnibeam-name';
function customName() {
  let name = '';
  try { name = localStorage.getItem(NAME_KEY) || ''; } catch {}
  return name || (IS_TV ? 'TV' : ''); // TV mode: "TV" unless it was given a name
}
// The name and picture other devices see. The picture is one of AVATARS, or the device icon.
const AVATAR_KEY = 'omnibeam-avatar';
function customAvatar() {
  try { const a = localStorage.getItem(AVATAR_KEY) || ''; return AVATARS.includes(a) || (Supporter.on() && SUPPORTER_AVATARS.includes(a)) ? a : ''; } catch { return ''; }
}
function showMyAvatar() {
  for (const el of [$('#me-avatar'), $('#set-avatar')]) el.innerHTML = avatarHtml(customAvatar(), deviceName());
  $('#set-name').textContent = me.name || '';
}
function openMeDialog() {
  const dlg = $('#dlg-me');
  const input = $('#me-name-input');
  input.value = me.name || customName();
  let pick = customAvatar();
  const box = $('#avatar-pick');
  box.innerHTML = '';
  for (const a of ['', ...AVATARS, ...(Supporter.on() ? SUPPORTER_AVATARS : [])]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-opt';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(a === pick));
    b.setAttribute('aria-label', a || t('Device icon'));
    b.dataset.avatar = a;
    b.innerHTML = avatarHtml(a, deviceName());
    b.onclick = () => {
      pick = a;
      for (const x of box.children) x.setAttribute('aria-checked', String(x === b));
    };
    box.appendChild(b);
  }
  input.onkeydown = (e) => { if (e.key === 'Enter') $('[data-act=save]', dlg).click(); };
  dlg.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'random') { input.value = ''; input.focus(); }
    if (act !== 'save') return;
    const clean = input.value.replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 40);
    try {
      if (clean) localStorage.setItem(NAME_KEY, clean); else localStorage.removeItem(NAME_KEY);
      if (pick) localStorage.setItem(AVATAR_KEY, pick); else localStorage.removeItem(AVATAR_KEY);
    } catch {}
    // An empty name: the server picks a new random one
    wsSend(clean ? { type: 'rename', name: clean, avatar: pick } : { type: 'rename', random: true, avatar: pick });
    showMyAvatar();
    dlg.close();
    toast(t('Saved. Other devices now see the new name and picture.'));
  };
  dlg.showModal();
  input.select();
}
$('#me-rename').onclick = openMeDialog;
// The tab shows this device's name, but only once someone uses the page (or switches tabs, or opens the installed
// app): search engines and SEO checkers run the page without touching it, so they keep the page's real title
const IS_BOT = /bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent);
let tabName = '';
let tabTitleOn = false;
function setTabTitle(name) {
  tabName = name;
  if (tabTitleOn && !IS_BOT) document.title = `OmniBeam · ${name}`;
}
function tabTitleNow() {
  if (tabTitleOn) return;
  tabTitleOn = true;
  for (const e of ['pointerdown', 'keydown']) removeEventListener(e, tabTitleNow, true);
  if (tabName) setTabTitle(tabName);
}
for (const e of ['pointerdown', 'keydown']) addEventListener(e, tabTitleNow, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) tabTitleNow(); });
if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true) tabTitleOn = true;
// This device's avatar colour goes in a style sheet instead of a style="" attribute (SEO checkers flag those)
const avatarSheet = (() => {
  try {
    const sheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return sheet;
  } catch { return null; }
})();
function paintMyAvatar(name) {
  if (avatarSheet) avatarSheet.replaceSync(`#me-avatar { background: ${colorFor(name)}; }`);
  else $('#me-avatar').style.background = colorFor(name);
}
function setMyName(name) {
  me.name = name;
  $('#me-name').textContent = name;
  $('#set-name').textContent = name;
  paintMyAvatar(name);
  setTabTitle(name);
}

// ---------- Remembered pairings (like PairDrop: a long random secret per device pair) ----------
const PAIRED_KEY = 'omnibeam-paired';
function loadPaired() {
  try { return JSON.parse(localStorage.getItem(PAIRED_KEY)) || []; } catch { return []; }
}
function savePaired(list) {
  try { localStorage.setItem(PAIRED_KEY, JSON.stringify(list)); } catch {}
}
function rememberPairing(secret, name) {
  const old = loadPaired().find((p) => p.secret === secret);
  const list = loadPaired().filter((p) => p.secret !== secret);
  list.push({ secret, name, at: Date.now(), seen: Date.now(), auto: !!old?.auto, trusted: !!old?.trusted });
  savePaired(list);
  wsSend({ type: 'join-secrets', secrets: [secret] });
  renderPairedList();
  // Tell the devices already in view which pairing they share with us
  for (const p of peers.values()) sendPairHello(p);
  sendPushSub();
}
function forgetPairing(secret) {
  // Tell the other device too, if it's here, so it forgets this pairing as well
  for (const p of peers.values()) {
    if (p.pairSecret !== secret) continue;
    pairProof(secret, me.id, p.info.id).then((proof) => wsSend({ type: 'signal', to: p.info.id, data: { pairForget: proof } }), () => {});
    p.pairSecret = null;
    p.markTrusted();
  }
  savePaired(loadPaired().filter((p) => p.secret !== secret));
  wsSend({ type: 'leave-secret', secret });
  waiting.delete(secret);
  renderPairedList();
  renderOffline();
  sendPushSub();
}
function updatePairing(secret, change) {
  savePaired(loadPaired().map((x) => (x.secret === secret ? { ...x, ...change } : x)));
}
function renderPairedList() {
  const list = loadPaired();
  const box = $('#paired-list');
  $('#paired-section').hidden = list.length === 0;
  // The Devices tab of the pairing window (PairTabs) only while there are some; the last one forgotten -> Scan
  $('#pair-tab-devices').hidden = list.length === 0;
  if (!list.length && !$('#pair-pane-devices').hidden) $('#pair-tab-scan').click();
  box.innerHTML = '';
  const online = new Set([...peers.values()].map((p) => p.pairSecret).filter(Boolean));
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'paired-row';
    row.innerHTML = `<i class="dot" aria-hidden="true"></i><span class="paired-name" dir="auto"></span>`
      + `<label class="auto-toggle" title="${t('Your own device: always shown here, files accepted without asking')}"><input type="checkbox" data-k="trusted"> ${t('Trusted')}</label>`
      + `<label class="auto-toggle" title="${t('Accept files from this device without asking')}"><input type="checkbox" data-k="auto"> ${t('Auto-accept')}</label>`
      + `<span class="paired-acts"><button class="btn ghost small" data-chat>${t('Chat')}</button>`
      + `<button class="btn ghost small" data-forget>${t('Forget')}</button></span>`;
    $('.paired-name', row).textContent = p.name;
    const isOn = online.has(p.secret);
    $('.dot', row).classList.toggle('on', isOn);
    row.title = isOn ? t('Online now') : p.seen ? t('Last seen {time}', { time: timeAgo(p.seen) }) : '';
    const trusted = $('[data-k=trusted]', row);
    const auto = $('[data-k=auto]', row);
    trusted.checked = !!p.trusted;
    auto.checked = !!p.auto || !!p.trusted;
    auto.disabled = !!p.trusted;
    trusted.onchange = () => {
      updatePairing(p.secret, trusted.checked ? { trusted: true, auto: true } : { trusted: false });
      // Ask the browser to keep this site's data (pairings) even when space runs low
      if (trusted.checked) navigator.storage?.persist?.().catch(() => {});
      renderPairedList();
      renderOffline();
      for (const peer of peers.values()) peer.markTrusted();
    };
    auto.onchange = () => updatePairing(p.secret, { auto: auto.checked });
    $('[data-forget]', row).onclick = () => forgetPairing(p.secret);
    $('[data-chat]', row).onclick = () => { $('#dlg-pair')?.close?.(); openChat(p); };
    box.appendChild(row);
  }
}
function timeAgo(at) {
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 90) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.round(s / 60) });
  if (s < 86400 * 2) return t('{n} h ago', { n: Math.round(s / 3600) });
  return t('{n} days ago', { n: Math.round(s / 86400) });
}

// ---------- Trusted devices ----------
// Paired devices find each other on any network through their pairing secret's room on the server. When two of
// them meet, each proves which pairing they share (pairProof, so neither the server nor anyone else can fake
// it): that keeps the saved name up to date, marks the card, and for devices marked Trusted ("my own phone")
// shows a greyed card while they're offline, so they're always in the same place.
async function sendPairHello(peer) {
  const list = loadPaired();
  if (!list.length || !me.id) return;
  const proofs = await pairProofs(me.id, peer.info.id);
  // push: this device can be woken with a notification, so it stays on the other device's screen while it's closed
  if (proofs.length && peers.get(peer.info.id) === peer) wsSend({ type: 'signal', to: peer.info.id, data: { pairHello: proofs, push: pushOn() } });
}
async function matchPairing(from, proofs) {
  if (!Array.isArray(proofs) || !crypto.subtle) return null;
  for (const p of loadPaired()) {
    try {
      if (proofs.includes(await pairProof(p.secret, from, me.id))) return p;
    } catch {}
  }
  return null;
}
async function onPairHello(from, proofs, data = {}) {
  proofs = [].concat(proofs).slice(0, 60);
  const pair = await matchPairing(from, proofs);
  const peer = peers.get(from);
  if (!pair || !peer) return;
  peer.pairSecret = pair.secret;
  updatePairing(pair.secret, { name: peer.info.name, device: peer.info.device, avatar: peer.info.avatar, seen: Date.now(), push: data.push === true });
  peer.markTrusted();
  renderPairedList();
  renderOffline(); // (updates the chat badges too: the card is now known by its pairing)
  sendWaiting(peer);
}
async function onPairForget(from, proof) {
  const pair = await matchPairing(from, [proof]);
  if (!pair) return;
  savePaired(loadPaired().filter((p) => p.secret !== pair.secret));
  wsSend({ type: 'leave-secret', secret: pair.secret });
  const peer = peers.get(from);
  if (peer) { peer.pairSecret = null; peer.markTrusted(); }
  renderPairedList();
  renderOffline();
  toast(t('{name} removed the pairing', { name: pair.name }));
}
// Greyed cards for trusted devices that aren't online. Shown a moment after connecting, so devices that are
// online have time to say hello first.
let offlineReady = false;
function renderOffline() {
  const online = new Set([...peers.values()].map((p) => p.pairSecret).filter(Boolean));
  const want = offlineReady && ws && ws.readyState === WebSocket.OPEN
    ? loadPaired().filter((p) => (p.trusted || p.push || waiting.has(p.secret)) && !online.has(p.secret)) : [];
  const keep = new Set(want.map((p) => p.secret.slice(0, 16)));
  for (const el of peersEl.querySelectorAll('.peer.offline')) if (!keep.has(el.dataset.pair)) el.remove();
  for (const p of want) {
    let el = peersEl.querySelector(`.peer.offline[data-pair="${p.secret.slice(0, 16)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'peer offline';
      el.dataset.pair = p.secret.slice(0, 16);
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.innerHTML = `<div class="avatar-wrap"><div class="avatar">${ICONS[deviceType(p.device || '')]}</div></div><div class="name"></div><div class="device"></div><span class="tag"></span><div class="status"></div>`;
      // Choose files now: they wait here, the device gets a notification (if it has them on), and they go
      // as soon as it opens OmniBeam
      const pick = () => {
        const secret = p.secret;
        fileInput.onchange = () => {
          const files = [...fileInput.files];
          fileInput.value = '';
          const pair = loadPaired().find((x) => x.secret === secret);
          if (files.length && pair) sendWhenOnline(pair, files);
        };
        fileInput.click();
      };
      el.onclick = (e) => {
        const pair = loadPaired().find((x) => x.secret === p.secret);
        if (e.target.closest('.chat-badge')) { if (pair) openChat(pair); return; }
        pick();
      };
      el.onkeydown = (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(); } };
      el.title = t('{name} is offline. Choose files: they go as soon as it opens OmniBeam.', { name: p.name });
      peersEl.appendChild(el);
    }
    $('.name', el).textContent = p.name;
    $('.avatar', el).style.background = colorFor(p.name);
    $('.avatar', el).innerHTML = avatarHtml(p.avatar, p.device);
    $('.device', el).textContent = p.seen ? `${t('Offline')} · ${timeAgo(p.seen)}` : t('Offline');
    $('.tag', el).textContent = p.trusted ? t('Trusted') : t('Paired');
    const w = waiting.get(p.secret);
    $('.status', el).textContent = w ? t('{n} file(s) waiting to send', { n: w.files.length }) : '';
    el.classList.toggle('waiting', !!w);
  }
  updateChatBadges();
  updateSendAll();
}
// QR code for one-tap pairing (see startQrPair): scan it with the other device's camera to pair
function renderPairQr() {
  const box = $('#pair-qr');
  box.innerHTML = '';
  if (!qrPair) { if (IS_TV) Tv.drawQr(); return; }
  if (typeof qrcode !== 'function') { loadQr().then(renderPairQr, () => {}); return; }
  try {
    const qr = qrcode(0, 'M');
    qr.addData(qrPairLink());
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {}
  if (IS_TV) Tv.drawQr();
}
function randomSecret() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function pairLink(code) {
  return `${location.origin}${appPath()}#pair=${code}`;
}
let createdCode = false;   // this device created the current code (it hands out the secret)
let finishingPair = false; // suppress the "left" toast when a code is swapped for a secret
const codePartners = new Set(); // devices met through the current pairing code
function onCodePartner(id) {
  codePartners.add(id);
  if (createdCode) return offerSecret(id);
  // Both devices typed the same code (e.g. 123456), so neither created it: after a moment, if the partner hasn't
  // handed us a secret, the device with the lower ID does it, so exactly one side does
  setTimeout(() => { if (codePartners.has(id) && !pendingSecrets.has(id) && me.id && me.id < id) offerSecret(id); }, 1500);
}
function offerSecret(id) {
  const secret = randomSecret();
  wsSend({ type: 'signal', to: id, data: { pairSecret: secret, name: me.name } });
  const waitForPeer = () => peers.get(id) ? peers.get(id).info.name : t('Paired device');
  // Remember after the partner confirms, so both sides switch rooms together
  pendingSecrets.set(id, { secret, name: waitForPeer() });
}
const pendingSecrets = new Map(); // partner id -> secret we offered
function onPairSignal(from, data) {
  const peerName = peers.get(from)?.info.name || data.name || t('Paired device');
  // Only accept pairing messages from a device we actually met through our pairing code
  if (!codePartners.has(from)) return;
  if (data.pairSecret && /^[0-9a-f]{64}$/.test(data.pairSecret)) {
    rememberPairing(data.pairSecret, peerName);
    wsSend({ type: 'signal', to: from, data: { pairSaved: true } });
    finishPairing(peerName);
  } else if (data.pairSaved && pendingSecrets.has(from)) {
    const { secret } = pendingSecrets.get(from);
    pendingSecrets.delete(from);
    rememberPairing(secret, peerName);
    finishPairing(peerName);
  }
}
function finishPairing(peerName) {
  codePartners.clear();
  finishingPair = true;
  createdCode = false;
  wsSend({ type: 'leave-code' });
  if (pairDlg.open) pairDlg.close();
  toast(t('Paired with {name} – you\'ll find each other automatically from now on', { name: peerName }));
}
let joiningTypedCode = false; // true when the user typed someone else's code (vs. created one)
let pendingCode = null; // code to join as soon as the socket (re)connects
function joinCode(code, typed = false) {
  joiningTypedCode = typed;
  createdCode = !typed;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    pendingCode = code;
    toast(t('Connecting to the server… the code will be used automatically'));
    ensureConnected();
    return;
  }
  wsSend({ type: 'join-code', code });
}
$('#btn-pair').onclick = () => {
  pairInput.value = '';
  startQrPair();
  updatePairUi();
  PairTabs.opening();
  pairDlg.showModal();
  if (!pairedCode) pairInput.blur();
};
pairInput.oninput = () => {
  pairInput.value = pairInput.value.replace(/\D/g, '').slice(0, 6);
  if (pairInput.value.length === 6) joinCode(pairInput.value, true);
};
pairInput.onkeydown = (e) => {
  if (e.key === 'Enter') e.target.closest('dialog').querySelector('[data-act=join]').click();
};
pairDlg.onclick = (e) => {
  const act = e.target.dataset?.act;
  if (act === 'close') pairDlg.close();
  if (act === 'create') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    joinCode(String(arr[0] % 1000000).padStart(6, '0'));
  }
  if (act === 'join') {
    if (pairInput.value.length !== 6) return toast(t('Enter the 6-digit code from the other device'));
    joinCode(pairInput.value, true);
  }
  if (act === 'leave') wsSend({ type: 'leave-code' });
  if (act === 'public-create') joinPublic(randomRoomCode(), $('#public-pass').value);
  if (act === 'public-join') joinPublic($('#public-code').value, $('#public-pass').value);
  if (act === 'public-leave') wsSend({ type: 'leave-public' });
  if (act === 'team-create') Teams.create($('#team-name').value);
  if (act === 'public-share' && publicRoom) {
    const url = publicLink(publicRoom);
    if (navigator.share) navigator.share({ title: t('Join my OmniBeam room'), url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast(publicLocked ? t('Link copied. Send the password separately: it is not in the link.') : t('Link copied')), () => toast(url));
  }
  if (act === 'copy-link' && pairedCode) {
    const url = pairLink(pairedCode);
    if (navigator.share) navigator.share({ title: t('Pair with OmniBeam'), url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast(t('Link copied')), () => toast(url));
  }
};

// Theme: Automatic (follows the system's light or dark mode), Light or Dark. Chosen in Settings; the ⋯ menu
// switches between light and dark. Other open tabs follow.
const themeKey = 'omnibeam-theme';
// The browser's bar colour (theme-color) for each, in the classic look and in Liquid Glass
const THEME_BAR = { light: '#e6e9f0', dark: '#2b2e38' };
const GLASS_BAR = { light: '#eef1f8', dark: '#12152a' };
function applyTheme(theme) {
  theme = ['light', 'dark'].includes(theme) ? theme : '';
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  paintBar();
}
// Each theme-color tag is for the system's light or dark mode (its media); a chosen theme wins over the system's
function paintBar() {
  const bar = document.documentElement.dataset.look === 'glass' ? GLASS_BAR : THEME_BAR;
  const theme = document.documentElement.dataset.theme;
  for (const m of document.querySelectorAll('meta[name=theme-color]')) {
    const mode = theme || (/dark/.test(m.media) ? 'dark' : 'light');
    m.content = bar[mode];
  }
}
// Style: Classic (the soft raised look) or Liquid Glass (frosted see-through panels, style.css). Works with every
// theme; look.js puts the saved one on the page before it is drawn.
const lookKey = 'omnibeam-look';
function applyLook(look) {
  if (look === 'glass') document.documentElement.dataset.look = 'glass';
  else delete document.documentElement.dataset.look;
  paintBar();
}
function setLook(look) {
  applyLook(look);
  try { if (look === 'glass') localStorage.setItem(lookKey, 'glass'); else localStorage.removeItem(lookKey); } catch {}
  updateThemeUi();
}
try { applyLook(localStorage.getItem(lookKey)); } catch {}
try { applyTheme(localStorage.getItem(themeKey)); } catch {}
const isDarkTheme = () => (document.documentElement.dataset.theme
  ? document.documentElement.dataset.theme === 'dark'
  : matchMedia('(prefers-color-scheme: dark)').matches);
function setTheme(theme) {
  applyTheme(theme);
  try { if (theme) localStorage.setItem(themeKey, theme); else localStorage.removeItem(themeKey); } catch {}
  updateThemeUi();
}
function updateThemeUi() {
  const now = document.documentElement.dataset.theme || '';
  for (const r of document.querySelectorAll('#theme-choice input')) r.checked = r.value === now;
  if (typeof updateBarTheme === 'function' && $('#bar-theme')) updateBarTheme();
  const look = document.documentElement.dataset.look || '';
  for (const r of document.querySelectorAll('#look-choice input')) r.checked = r.value === look;
}
$('#btn-theme').onclick = () => setTheme(isDarkTheme() ? 'light' : 'dark');
// The Light/Dark button in the top bar: a sun while dark (press for light), a moon while light
function updateBarTheme() {
  const dark = isDarkTheme();
  const b = $('#bar-theme');
  b.classList.toggle('is-dark', dark);
  const label = t(dark ? 'Light mode' : 'Dark mode');
  b.title = label;
  b.setAttribute('aria-label', label);
}
$('#bar-theme').onclick = () => { setTheme(isDarkTheme() ? 'light' : 'dark'); updateBarTheme(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', updateBarTheme);
updateBarTheme();
$('#theme-choice').onchange = (e) => setTheme(e.target.value);
$('#look-choice').onchange = (e) => setLook(e.target.value);
window.addEventListener('storage', (e) => {
  if (e.key === themeKey) { applyTheme(e.newValue); updateThemeUi(); }
  if (e.key === lookKey) { applyLook(e.newValue); updateThemeUi(); }
});

// ---------- Menu (the ⋯ button at the top) ----------
// The top bar keeps what most visits need (pairing and received files); everything else is in this menu.
// Each item has its own click handler; any click (on an item or outside the menu) then closes it.
const menuBtn = $('#btn-menu');
const menuEl = $('#menu');
const menuItems = () => [...menuEl.querySelectorAll('.menu-item:not([hidden])')];
function setMenu(open) {
  menuEl.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.classList.toggle('active', open);
  if (!open) return;
  $('#btn-theme span').textContent = t(isDarkTheme() ? 'Light mode' : 'Dark mode');
  menuItems()[0]?.focus({ preventScroll: true });
}
menuBtn.onclick = (e) => {
  e.stopPropagation();
  setMenu(menuEl.hidden);
};
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && (!menuEl.contains(e.target) || e.target.closest('.menu-item'))) setMenu(false);
});
menuEl.addEventListener('keydown', (e) => {
  const items = menuItems();
  const at = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
  if (e.key === 'Escape' || e.key === 'Tab') {
    setMenu(false);
    if (e.key === 'Escape') menuBtn.focus();
  }
});
$('#menu-speed').onclick = () => checkSpeedWith(peers.size === 1 ? [...peers.keys()][0] : null);
$('#menu-check').onclick = () => runConnectionCheck();
$('#menu-tour').onclick = () => openTour();
// Invite a friend: a picture with a QR code to share or save (invite.js, loaded on first use)
const loadInvite = () => loadScript('/invite.js?v=1');
async function openInvite() {
  try {
    await Promise.all([loadInvite(), loadQr()]);
  } catch (err) {
    return toast(err.message);
  }
  wsSend({ type: 'stat', kind: 'invite' });
  window.Invite.open(FRIEND_URL().replace('utm_source=friend', 'utm_source=invite'));
}
$('#menu-invite').onclick = () => openInvite();
if ($('#share-card')) $('#share-card').onclick = () => openInvite();

// ---------- Signaling ----------
function addPeer(info) {
  if (peers.has(info.id)) return;
  const p = new Peer(info);
  peers.set(info.id, p);
  peersEl.insertBefore(p.el, peersEl.querySelector('.peer.offline')); // online devices first
  p.markTrusted();
  if (pairDlg.open) Teams.render();
  updateSendAll();
  if (AutoResume.size) AutoResume.offer(p).catch(() => {});
  if (AutoResume.size) setTimeout(() => Handoff.check(), 2500); // once its pairing is known
  if ([...AutoResume.jobs.values()].some((e) => e.name === info.name)) p.showWaiting(t('Resuming…'), 20000);
  // Back from a screen that was off, with a new connection: the other device continues what it was sending us
  if (Date.now() - wokeAt < 30000) wsSend({ type: 'signal', to: info.id, data: { awake: true } });
  sendPairHello(p).catch(() => {});
  sendQrHello(p).catch(() => {});
  tellExtension();
  updateChatBadges();
}
// "Send to all my devices": every device here, and the paired ones that are offline (their greyed cards), when
// there are two or more. It opens a short list (untick any) with Files and Message. Files dropped on the button go
// to all of them at once.
function sendAllTargets() {
  const online = [...peers.values()];
  const here = new Set(online.map((p) => p.pairSecret).filter(Boolean));
  const shown = new Set([...peersEl.querySelectorAll('.peer.offline')].map((el) => el.dataset.pair));
  const offline = loadPaired().filter((p) => !here.has(p.secret) && shown.has(p.secret.slice(0, 16)));
  return [...online.map((peer) => ({ peer, name: peer.info.name })), ...offline.map((pair) => ({ pair, name: pair.name }))];
}
function updateSendAll() {
  const btn = document.getElementById('btn-send-all');
  if (!btn || !peersEl) return;
  const n = sendAllTargets().length;
  btn.hidden = n < 2;
  if (n >= 2) {
    const label = t('Send to all my devices ({n})', { n });
    if ($('span', btn)) $('span', btn).textContent = label; else btn.textContent = label;
  }
}
// Files (or a message) to every chosen device: now to those here, as soon as they open OmniBeam to the others
function sendToAll(targets, files, text) {
  let now = 0, later = 0;
  for (const x of targets) {
    if (x.peer) {
      if (peers.get(x.peer.info.id) !== x.peer) continue;
      now++;
      if (files.length) x.peer.sendFiles(files).then(() => text && x.peer.sendText(text));
      else if (text) x.peer.sendText(text);
    } else if (x.pair) {
      const pair = loadPaired().find((p) => p.secret === x.pair.secret);
      if (!pair) continue;
      later++;
      const w = waiting.get(pair.secret);
      const joinText = (a, b) => (a && b ? a + '\n\n' + b : a || b || '');
      sendWhenOnline(pair, [...(w ? w.files : []), ...files], joinText(w?.text, text));
    }
  }
  wsSend({ type: 'stat', kind: 'sendall', n: now + later });
  if (later) toast(now ? t('Sending to {n} device(s) now; {m} more get it as soon as they open OmniBeam.', { n: now, m: later })
    : t('{m} device(s) get it as soon as they open OmniBeam. Keep this page open.', { m: later }), 5000);
}
function openSendAll(dropped) {
  const all = sendAllTargets();
  if (all.length < 2) return;
  if (dropped?.length) return sendToAll(all, dropped, '');
  const dlg = $('#dlg-send-all');
  const list = $('.send-all-list', dlg);
  list.innerHTML = '';
  all.forEach((x, i) => {
    const row = document.createElement('label');
    row.className = 'send-all-row';
    row.innerHTML = '<input type="checkbox" checked> <span class="send-all-name"></span> <small class="muted"></small>';
    $('input', row).dataset.i = i;
    $('.send-all-name', row).textContent = x.name;
    $('small', row).textContent = x.peer ? t('Online now') : t('Offline');
    list.appendChild(row);
  });
  const ta = $('textarea', dlg);
  ta.value = '';
  const chosen = () => [...list.querySelectorAll('input:checked')].map((el) => all[Number(el.dataset.i)]);
  const paint = () => {
    const n = chosen().length;
    for (const b of dlg.querySelectorAll('[data-act=files], [data-act=message]')) b.disabled = !n;
  };
  list.onchange = paint;
  paint();
  dlg.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'files') {
      const targets = chosen();
      for (const x of targets) x.peer?.warmUp();
      fileInput.onchange = () => {
        const files = [...fileInput.files];
        fileInput.value = '';
        if (files.length) { dlg.close(); sendToAll(targets, files, ''); }
      };
      fileInput.click();
    } else if (act === 'message') {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return toast(t('Write a message first')); }
      dlg.close();
      sendToAll(chosen(), [], text);
    }
  };
  if (!dlg.open) dlg.showModal();
}
function removePeer(id) {
  const p = peers.get(id);
  if (!p) return;
  p.destroy();
  peers.delete(id);
  window.dispatchEvent(new CustomEvent('omnibeam-peer-left', { detail: id })); // ends screen sharing with it (media.js)
  updateSendAll();
  tellExtension();
  if (p.pairSecret) {
    updatePairing(p.pairSecret, { seen: Date.now() });
    renderPairedList();
  }
  renderOffline();
}

let socketFailures = 0;
let myPublicIp = null;   // this device's public address as the server sees it (for the connection check)
let myNetworkId = null;
let build = null; // frontend version reported by the server on connect
const PAGE_BUILD = document.querySelector('meta[name="omnibeam-build"]')?.content || null; // version this page was built from
let reconnectTimer = null;
let connectTimer = null;

// ---------- HTTP long-polling fallback ----------
// Antivirus web scanning (e.g. Kaspersky) and some proxies break WebSockets while normal HTTPS works.
// PollTransport offers the same interface as a WebSocket, so the rest of the app doesn't care which is used.
function b64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
class PollTransport {
  constructor() {
    this.readyState = WebSocket.CONNECTING;
    this.bufferedAmount = 0;
    this.binaryType = 'arraybuffer';
    this.sid = null;
    this.sendChain = Promise.resolve();
    this.start();
  }
  async start() {
    try {
      const r = await fetch('/poll/open', { method: 'POST', cache: 'no-store' });
      if (!r.ok) throw new Error('open failed');
      this.sid = (await r.json()).sid;
      if (this.readyState !== WebSocket.CONNECTING) return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.();
      this.receiveLoop();
    } catch {
      this.fail();
    }
  }
  async receiveLoop() {
    while (this.readyState === WebSocket.OPEN) {
      try {
        const r = await fetch(`/poll/recv?sid=${this.sid}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('recv failed');
        for (const m of await r.json()) {
          if (this.readyState !== WebSocket.OPEN) return;
          this.onmessage?.({ data: typeof m === 'string' ? m : b64ToBuffer(m.b) });
        }
      } catch {
        return this.fail();
      }
    }
  }
  send(data) {
    if (this.readyState !== WebSocket.OPEN) return;
    const binary = typeof data !== 'string';
    const size = binary ? data.byteLength : data.length;
    this.bufferedAmount += size;
    // Requests are chained so messages arrive in order
    this.sendChain = this.sendChain
      .then(() => fetch(`/poll/${binary ? 'bin' : 'send'}?sid=${this.sid}`, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': binary ? 'application/octet-stream' : 'text/plain' },
      }))
      .then((r) => { if (!r.ok) throw new Error('send failed'); })
      .catch(() => this.fail())
      .finally(() => { this.bufferedAmount -= size; });
  }
  fail() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({});
  }
  close() {
    if (this.sid && this.readyState !== WebSocket.CLOSED) navigator.sendBeacon?.(`/poll/close?sid=${this.sid}`);
    this.fail(); // like WebSocket.close(): fires onclose (callers that don't want it clear onclose first)
  }
}

// Use polling once WebSockets have failed twice without ever connecting (remembered for this tab)
const POLL_KEY = 'omnibeam-transport';
let usePolling = /[?&]transport=poll/.test(location.search);
try { if (Number(localStorage.getItem(POLL_KEY)) > Date.now()) usePolling = true; } catch {}
let wsFailsBeforeOpen = 0;

// A random key for this tab, kept across reconnects and reloads (sessionStorage is per tab). The server uses it
// to drop this tab's previous connection at once, so it never shows up here as another device.
const TAB_KEY = 'omnibeam-tab';
function newTabKey() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const key = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem(TAB_KEY, key); } catch {}
  return key;
}
let tabKey = null;
try { tabKey = sessionStorage.getItem(TAB_KEY); } catch {}
if (!/^[0-9a-f]{32}$/.test(tabKey || '')) tabKey = newTabKey();

function connectSocket() {
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = usePolling ? new PollTransport() : new WebSocket(`${proto}://${location.host}/ws`);
  sock.everOpened = false;
  ws = sock;
  ws.binaryType = 'arraybuffer';
  // Some proxies leave a failed handshake hanging; give up and retry
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => { if (sock.readyState === WebSocket.CONNECTING) sock.close(); }, 8000);
  ws.onopen = () => {
    clearTimeout(connectTimer);
    sock.everOpened = true;
    if (!usePolling) wsFailsBeforeOpen = 0;
    socketFailures = 0;
    setOffline(false);
    wsSend({ type: 'intro', device: deviceName(), name: customName(), avatar: customAvatar() || undefined, tab: tabKey, supporter: Supporter.code() || undefined });
    const secrets = loadPaired().map((p) => p.secret);
    for (const q of [qrPair, qrScan]) if (q && q.until > Date.now()) secrets.push(q.secret);
    if (secrets.length) wsSend({ type: 'join-secrets', secrets });
    sendPushSub();
    const code = pendingCode || pairedCode;
    pendingCode = null;
    if (code) wsSend({ type: 'join-code', code });
    if (wantedPublicRoom) wsSend({ type: 'join-public', code: wantedPublicRoom, pass: wantedPublicPass || undefined });
    Teams.join();
    window.dispatchEvent(new Event('omnibeam-ws-open')); // request.js: which request links to watch
    setTimeout(() => { if (ws === sock && sock.readyState === WebSocket.OPEN) { offlineReady = true; renderOffline(); } }, 2500);
  };
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      // Relayed file chunk: [36-byte sender id][chunk]
      const from = String.fromCharCode(...new Uint8Array(e.data, 0, 36));
      const peer = peers.get(from);
      if (peer) peer.onRelay(e.data.slice(36), true);
      return;
    }
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'hello': {
        // The site was updated while this tab was open (the server restarts on deploy): load the new version
        if (build && msg.build && msg.build !== build && ![...peers.values()].some((p) => p.busy) && !AutoResume.size) {
          location.reload();
          return;
        }
        // This page came from the copy saved on the device (offline or a very slow network) and the site has been
        // updated since: load the new version once (sw.js always asks the network first)
        if (!build && msg.build && PAGE_BUILD && msg.build !== PAGE_BUILD && !sessionStorage.getItem('omnibeam-build-' + msg.build)) {
          try { sessionStorage.setItem('omnibeam-build-' + msg.build, '1'); } catch {}
          navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}).finally(() => location.reload());
          return;
        }
        build = msg.build || build;
        me = { id: msg.id, name: msg.name };
        myPublicIp = msg.ip || null;
        myNetworkId = msg.networkId || null;
        tabChannel?.postMessage({ id: me.id, ask: true });
        $('#me-name').textContent = me.name;
        const av = $('#me-avatar');
        paintMyAvatar(me.name);
        av.innerHTML = avatarHtml(customAvatar(), deviceName());
        showMyAvatar();
        setTabTitle(me.name);
        $('#me-network').textContent = msg.networkId
          ? ` · ${t('ID')} ${msg.networkId}`
          : ` · ${t('use Pair to connect')}`;
        break;
      }
      case 'pong':
        sock.pongAt = Date.now();
        sock.onPong?.();
        break;
      case 'request-files':
        // Files arrived on a request link this device made (request.js picks them up)
        window.dispatchEvent(new CustomEvent('omnibeam-request-files', { detail: { id: msg.id } }));
        break;
      case 'peers':
        msg.peers.forEach(addPeer);
        break;
      case 'peer-joined':
        addPeer(msg.peer);
        if (pairedCode && pairDlg.open) {
          pairDlg.close();
          toast(t('{name} connected', { name: msg.peer.name }));
        }
        break;
      case 'name':
        setMyName(msg.name);
        break;
      case 'supporter':
        Supporter.onServer(msg);
        break;
      case 'replaced':
        // Another tab connected with this tab's key (a duplicated tab copies sessionStorage): take a new one
        tabKey = newTabKey();
        break;
      case 'peer-updated': {
        const p = peers.get(msg.peer.id);
        if (p) {
          p.info.name = msg.peer.name;
          p.info.avatar = msg.peer.avatar;
          p.info.teams = msg.peer.teams;
          p.info.supporter = msg.peer.supporter;
          p.paintSupporter();
          $('.name', p.el).textContent = msg.peer.name;
          $('.avatar', p.el).style.background = colorFor(msg.peer.name);
          $('.avatar', p.el).innerHTML = avatarHtml(msg.peer.avatar, p.info.device);
          p.markTrusted();
          p.el.setAttribute('aria-label', msg.peer.name);
          $('.peer-main', p.el).setAttribute('aria-label', t('Send to {name}', { name: msg.peer.name }));
        }
        if (p?.pairSecret) { updatePairing(p.pairSecret, { name: msg.peer.name, avatar: msg.peer.avatar }); renderPairedList(); }
        if (p && pairDlg.open) Teams.render();
        tellExtension();
        break;
      }
      case 'peer-left':
        removePeer(msg.id);
        if (pairDlg.open) Teams.render();
        break;
      case 'team-error':
        toast(msg.reason === 'full' ? t('That team room is full') : t('Too many team rooms on this device'));
        break;
      case 'signal':
        if (msg.data && (msg.data.pairSecret || msg.data.pairSaved)) onPairSignal(msg.from, msg.data);
        else if (msg.data && msg.data.pairHello) onPairHello(msg.from, msg.data.pairHello, msg.data);
        else if (msg.data && typeof msg.data.qrPair === 'string') onQrPair(msg.from, msg.data.qrPair);
        else if (msg.data && typeof msg.data.qrOk === 'string') onQrOk(msg.from, msg.data);
        else if (msg.data && typeof msg.data.pairForget === 'string') onPairForget(msg.from, msg.data.pairForget);
        else if (msg.data && msg.data.screen) onScreenSignal(msg.from, msg.data.screen);
        else if (msg.data && msg.data.e2e) peers.get(msg.from)?.onE2E(msg.data);
        else if (msg.data && msg.data.resume) peers.get(msg.from)?.onResume(msg.data.resume);
        else if (msg.data && msg.data.resumeOffer) AutoResume.onOffer(msg.from, msg.data.resumeOffer).catch(() => {});
        else if (msg.data && msg.data.resumeYes) AutoResume.onYes(msg.from, msg.data).catch(() => {});
        else if (msg.data && msg.data.asleep) {
          const p = peers.get(msg.from);
          if (p) p.asleepAt = Date.now();
          // An iPhone's page stops at once: pause cleanly now rather than send into a connection that's about to die
          if (p && p.busy && msg.data.freeze && (p.job?.send || p.incoming)) p.pause(t(PAUSED_OTHER, { name: p.info.name }));
          else if (p && p.busy) toast(t('The screen of {name} turned off, which pauses the transfer. It continues by itself when {name} is back.', { name: p.info.name }), 6000);
        }
        else if (msg.data && msg.data.awake) {
          // Its screen is back on: continue what we were sending to it
          const p = peers.get(msg.from);
          if (p) {
            p.asleepAt = 0;
            if ([...AutoResume.jobs.values()].some((e) => e.name === p.info.name)) p.showWaiting(t('Resuming…'), 20000);
            AutoResume.offer(p).catch(() => {});
          }
        }
        else if (msg.data && msg.data.resumeAsk) {
          const p = peers.get(msg.from);
          if (p && p.incoming) p.sendResumePoint();
        }
        else if (msg.data && msg.data.abort) {
          const p = peers.get(msg.from);
          if (p && p.asking) { p.asking(false); toast(t('{name} cancelled', { name: p.info.name })); }
          // Paused because a screen turned off: no error, it continues by itself
          else if (p && p.busy && msg.data.pause && msg.data.keep) p.abort(t(screenWasOff() ? PAUSED_SELF : PAUSED_OTHER, { name: p.info.name }), false, true, 'lost', true);
          else if (p && p.busy) p.abort(t('Transfer stopped on {name}', { name: p.info.name }) + `: ${t(String(msg.data.abort).slice(0, 80))}`, false, !!msg.data.keep,
            msg.data.abort === 'Transfer cancelled' ? 'cancel' : '');
        }
        else peers.get(msg.from)?.onSignal(msg.data);
        break;
      case 'code-partner':
        onCodePartner(msg.id);
        break;
      case 'push-result':
        onPushResult(msg);
        break;
        break;
      case 'relay':
        peers.get(msg.from)?.onRelay(msg.data);
        break;
      case 'joined-code':
        pairedCode = msg.code;
        updatePairUi();
        if (joiningTypedCode) {
          // The server sends the peer list before this message, so we know if anyone was waiting
          joiningTypedCode = false;
          pairDlg.close();
          toast(peers.size ? t('Paired! Tap the device to send files') : t('Code {code} joined – waiting for the other device', { code: msg.code }));
        } else {
          toast(t('Pairing code {code} active', { code: msg.code }));
        }
        break;
      case 'joined-public':
        publicRoom = msg.code;
        wantedPublicRoom = msg.code;
        publicLocked = !!msg.locked;
        if (!publicLocked) wantedPublicPass = null;
        try {
          localStorage.setItem(PUBLIC_KEY, msg.code);
          if (wantedPublicPass) localStorage.setItem(PUBLIC_PASS_KEY, wantedPublicPass);
          else localStorage.removeItem(PUBLIC_PASS_KEY);
        } catch {}
        $('#public-pass').value = '';
        updatePublicUi();
        toast(t('You are in public room {code}', { code: msg.code.toUpperCase() }));
        break;
      case 'left-public':
        publicRoom = wantedPublicRoom = wantedPublicPass = null;
        publicLocked = false;
        try { localStorage.removeItem(PUBLIC_KEY); localStorage.removeItem(PUBLIC_PASS_KEY); } catch {}
        updatePublicUi();
        toast(t('You left the public room'));
        break;
      case 'public-error':
        wantedPublicRoom = publicRoom;
        if (msg.reason === 'password' || msg.reason === 'wrong-password') {
          // Ask for the password: open the room section with the code filled in
          wantedPublicPass = null;
          try { localStorage.removeItem(PUBLIC_KEY); localStorage.removeItem(PUBLIC_PASS_KEY); } catch {}
          if (!pairDlg.open) { PairTabs.refresh(); pairDlg.showModal(); }
          PairTabs.show('rooms');
          $('#public-code').value = String(msg.code || '').toUpperCase();
          $('#public-pass').focus();
          toast(msg.reason === 'password' ? t('This room needs a password') : t('Wrong password'));
          break;
        }
        toast(msg.reason === 'full' ? t('That public room is full') : t('Too many attempts. Wait a few minutes and try again.'));
        break;
      case 'code-error':
        joiningTypedCode = false;
        toast(t(msg.reason));
        break;
      case 'left-code':
        pairedCode = null;
        updatePairUi();
        if (!finishingPair) toast(t('Stopped pairing'));
        finishingPair = false;
        break;
    }
  };
  ws.onclose = (e) => {
    if (e?.code === 4001) tabKey = newTabKey(); // a duplicated tab: the server kept the other one under this key
    if (ws !== sock) return;
    clearTimeout(connectTimer);
    // Server restarts, network changes, phone sleeping: reset and reconnect quickly
    offlineReady = false;
    for (const id of [...peers.keys()]) removePeer(id);
    publicRoom = null; // the server forgets rooms on disconnect; rejoined on reconnect
    socketFailures++;
    if (!usePolling && !sock.everOpened && ++wsFailsBeforeOpen >= 2) {
      console.info('WebSocket blocked (antivirus or proxy?) – switching to HTTPS polling');
      usePolling = true;
      report('socket', 'WebSocket blocked, switched to HTTPS polling');
      try { localStorage.setItem(POLL_KEY, String(Date.now() + 24 * 3600 * 1000)); } catch {}
    }
    setOffline(true);
    const delay = [500, 1000, 2000, 3000, 5000][Math.min(socketFailures - 1, 4)];
    reconnectTimer = setTimeout(connectSocket, delay);
  };
}

function ensureConnected() {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    socketFailures = 0;
    connectSocket();
  }
}

function setOffline(off) {
  $('#me-scope').textContent = off
    ? t('Connecting…')
    : pairedCode ? t('Pairing with code {code}', { code: pairedCode })
    : publicRoom ? t('In public room {code}', { code: publicRoom.toUpperCase() })
    : t('Visible on this network');
}

// ---------- Team rooms ----------
// A fixed link for a family or an office (omnibeam.site/#team=<secret>&n=<name>). A device that opens it once keeps
// the team and joins it every time OmniBeam opens, on any network, so the team's devices always see each other:
// no codes, no pairing again. The secret only travels in the link (after #, which browsers never send to the
// server); the server gets a hash of it as the room's name. Anyone with the link can join, like a house key, so
// a device only accepts a team's files without asking when that's turned on for the team on that device.
const TEAMS_KEY = 'omnibeam-teams';
const MAX_TEAMS = 5;
const cleanTeamName = (n) => String(n || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 30);
const Teams = {
  list() {
    try {
      return (JSON.parse(localStorage.getItem(TEAMS_KEY)) || []).filter((x) => /^[0-9a-f]{64}$/.test(x?.secret || '') && /^[0-9a-f]{64}$/.test(x?.id || ''));
    } catch { return []; }
  },
  save(list) { try { localStorage.setItem(TEAMS_KEY, JSON.stringify(list)); } catch {} },
  update(secret, change) { this.save(this.list().map((x) => (x.secret === secret ? { ...x, ...change } : x))); },
  link: (team) => `${location.origin}/#team=${team.secret}&n=${encodeURIComponent(team.name)}`,
  // Teams this device shares with another one (the server lists the rooms they're both in)
  shared(info) {
    const ids = new Set([].concat(info?.teams || []));
    return ids.size ? this.list().filter((x) => ids.has(x.id.slice(0, 16))) : [];
  },
  join(list = this.list()) {
    if (list.length && ws && ws.readyState === WebSocket.OPEN) wsSend({ type: 'join-team', ids: list.map((x) => x.id) });
  },
  async add(secret, name) {
    const list = this.list();
    const old = list.find((x) => x.secret === secret);
    if (old) { this.join([old]); toast(t('You are in the team room {name}', { name: old.name })); return old; }
    if (list.length >= MAX_TEAMS) { toast(t('You can be in up to {n} team rooms. Leave one first.', { n: MAX_TEAMS }), 5000); return null; }
    const team = { secret, id: await sha256Hex(`omnibeam-team:${secret}`), name: cleanTeamName(name) || t('Team'), at: Date.now(), auto: false };
    this.save([...list, team]);
    this.join([team]);
    this.render();
    // Keep this site's data (the team) even when the device runs low on space
    navigator.storage?.persist?.().catch(() => {});
    return team;
  },
  async create(name) {
    name = cleanTeamName(name);
    if (!name) { $('#team-name').focus(); return toast(t('Give the team room a name, like Family or Office')); }
    const team = await this.add(randomSecret(), name);
    if (!team) return;
    $('#team-name').value = '';
    wsSend({ type: 'stat', kind: 'team' });
    toast(t('Team room {name} created. Share its link with your devices.', { name: team.name }), 5000);
    this.share(team);
  },
  leave(secret) {
    const team = this.list().find((x) => x.secret === secret);
    if (!team) return;
    this.save(this.list().filter((x) => x.secret !== secret));
    wsSend({ type: 'leave-team', id: team.id });
    this.render();
    toast(t('You left the team room {name}', { name: team.name }));
  },
  share(team) {
    const url = this.link(team);
    if (navigator.share) navigator.share({ title: t('Join our OmniBeam team room {name}', { name: team.name }), url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast(t('Link copied. Open it once on each device of the team.'), 5000), () => toast(url));
  },
  qrOpen: null, // the team whose QR code is showing
  render() {
    const box = $('#team-list');
    if (!box) return;
    const list = this.list();
    box.innerHTML = '';
    $('.team-new').hidden = list.length >= MAX_TEAMS;
    for (const team of list) {
      const here = [...peers.values()].filter((p) => this.shared(p.info).some((x) => x.secret === team.secret));
      const row = document.createElement('div');
      row.className = 'paired-row team-row';
      row.innerHTML = `<div class="team-top"><i class="dot" aria-hidden="true"></i><span class="team-name"></span><small class="muted team-here"></small></div>`
        + `<div class="team-btns"><button class="btn small" data-team="share">${t('Share link')}</button>`
        + `<button class="btn ghost small" data-team="qr">${t('QR code')}</button>`
        + `<button class="btn ghost small" data-team="leave">${t('Leave')}</button>`
        + `<label class="auto-toggle" title="${t('Accept files from this team without asking')}"><input type="checkbox" data-k="auto"> ${t('Auto-accept')}</label></div>`;
      $('.team-name', row).textContent = team.name;
      $('.team-here', row).textContent = here.length ? t('{n} here now', { n: here.length }) : t('nobody else here now');
      $('.dot', row).classList.toggle('on', here.length > 0);
      const auto = $('[data-k=auto]', row);
      auto.checked = !!team.auto;
      auto.onchange = () => this.update(team.secret, { auto: auto.checked });
      row.onclick = (e) => {
        const act = e.target.closest('[data-team]')?.dataset.team;
        if (act === 'share') this.share(team);
        if (act === 'leave') { if (confirm(t('Leave the team room {name}? Open its link again to come back.', { name: team.name }))) this.leave(team.secret); }
        if (act === 'qr') { this.qrOpen = this.qrOpen === team.secret ? null : team.secret; this.render(); }
      };
      box.appendChild(row);
      if (this.qrOpen === team.secret) {
        const qrBox = document.createElement('div');
        qrBox.className = 'pair-qr team-qr';
        qrBox.setAttribute('role', 'img');
        qrBox.setAttribute('aria-label', t('QR code of the team room link'));
        box.appendChild(qrBox);
        const draw = () => {
          try {
            const qr = qrcode(0, 'M');
            qr.addData(this.link(team));
            qr.make();
            qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
          } catch {}
        };
        if (typeof qrcode === 'function') draw(); else loadQr().then(draw, () => {});
      }
    }
  },
};
$('#team-name').onkeydown = (e) => { if (e.key === 'Enter') Teams.create(e.target.value); };
window.addEventListener('storage', (e) => { if (e.key === TEAMS_KEY && pairDlg.open) Teams.render(); });

// ---------- Public rooms ----------
// A 5-letter code anyone can join, from any network, and stay in (remembered across visits) until leaving.
// password (optional): creating a room sets it; joining a room that has one needs it
async function joinPublic(code, password = '') {
  code = String(code || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 5);
  if (code.length !== 5) return toast(t('A public room code has 5 letters'));
  const pass = password ? await roomPassHash(code, password) : null;
  wantedPublicRoom = code;
  wantedPublicPass = pass;
  wsSend({ type: 'join-public', code, pass: pass || undefined });
}
async function roomPassHash(code, password) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-room:${code}:${password}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomRoomCode() {
  const letters = 'abcdefghjkmnpqrstuvwxyz'; // no i, l, o: easy to read out loud
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return [...b].map((x) => letters[x % letters.length]).join('');
}
function publicLink(code) {
  return `${location.origin}${appPath()}#room=${code}`;
}
function updatePublicUi() {
  $('#public-idle').hidden = !!publicRoom;
  $('#public-active').hidden = !publicRoom;
  $('#public-show').textContent = publicRoom ? publicRoom.toUpperCase() : '';
  $('#public-lock').hidden = !publicRoom || !publicLocked;
  setOffline(!ws || ws.readyState !== WebSocket.OPEN);
}

// Phones drop sockets when locked or in the background: reconnect as soon as we're back
document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureConnected(); });
window.addEventListener('online', ensureConnected);
window.addEventListener('pageshow', (e) => { if (e.persisted) ensureConnected(); });

// Leave cleanly so other devices remove us right away
window.addEventListener('pagehide', () => {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  for (const id of [...peers.keys()]) removePeer(id);
});

// Paste anywhere -> send to the only peer if there's exactly one
document.addEventListener('paste', (e) => {
  if (document.querySelector('dialog[open]') || peers.size !== 1) return;
  const peer = [...peers.values()][0];
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) peer.sendFiles(files);
  else {
    const text = e.clipboardData?.getData('text');
    if (text) peer.sendText(text);
  }
});

// Ask for notification permission on first interaction
document.addEventListener('click', () => {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, { once: true });

// ---------- Fast Wi-Fi mode (iPhone / iPad) ----------
// Safari hides the device's local network address from WebRTC unless the page has been allowed to use the
// microphone or camera. Without it, two devices on the same Wi-Fi can only reach each other through the
// router's public address, which many home routers don't allow, so transfers fall back to the server.
// Allowing the microphone once lets Safari share the local address. Nothing is recorded: the microphone
// stream is stopped immediately.
let fastWifi = false;
async function enableFastWifi(ask) {
  if (fastWifi || !navigator.mediaDevices?.getUserMedia) return fastWifi;
  if (!ask) {
    // On page load only when already allowed, so nobody gets a prompt they didn't ask for
    try {
      const st = await navigator.permissions?.query({ name: 'microphone' });
      if (!st || st.state !== 'granted') return false;
    } catch {
      return false;
    }
    // Chrome, Edge and Firefox share the local address as soon as the permission is granted; only Safari needs
    // the microphone to have been opened on this page
    if (!isIOS && !/^((?!Chrome|Android).)*Safari/.test(navigator.userAgent)) {
      fastWifi = true;
      updateFastButton();
      return true;
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    fastWifi = true;
    // Earlier connection attempts were made without the local address: let the next send try direct again
    for (const p of peers.values()) {
      if (p.busy || p.direct) continue;
      p.closePc();
      p.directFailedAt = 0;
      p.useRelay = false;
    }
  } catch {}
  updateFastButton();
  return fastWifi;
}
// The button is always offered on iPhone/iPad (Safari needs it for any direct local connection), and on other
// devices once a transfer to a device on the same Wi-Fi didn't go directly
let sameNetIndirect = false;
function noteIndirect() {
  if (sameNetIndirect) return;
  sameNetIndirect = true;
  updateFastButton();
}
function updateFastButton() {
  $('#btn-fast').hidden = fastWifi || !navigator.mediaDevices?.getUserMedia || !(isIOS || sameNetIndirect);
}
// A sudden "wants to use your microphone" on a file-sharing site is alarming: first a small window says why, and
// only "Continue" opens the browser's question. Resolves to true when fast Wi-Fi is on.
function askFastWifi() {
  const dlg = $('#dlg-fast');
  return new Promise((resolve) => {
    dlg.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      dlg.onclose = null;
      dlg.close();
      if (act !== 'go') return resolve(false);
      const on = await enableFastWifi(true);
      toast(on ? t('Fast Wi-Fi transfers are on') : t('Microphone access was not allowed, so transfers may go through the server'));
      resolve(on);
    };
    dlg.onclose = () => resolve(false);
    dlg.showModal();
  });
}
window.askFastWifi = askFastWifi;
$('#btn-fast').onclick = () => askFastWifi();
updateFastButton();
enableFastWifi(false);

// ---------- Connection check ----------
// Opened from the network ID next to this device's name, and the speed test from a device card, Settings or the
// menu. Both are in more.js.
const runConnectionCheck = more('runConnectionCheck');
const checkSpeedWith = more('checkSpeedWith');
$('#me-network').onclick = () => runConnectionCheck();

// ---------- One-tap pairing with a QR code ----------
// The pairing dialog shows a QR code whose link holds a one-time secret (after #, so it is never sent to the server
// as part of an address). The phone's camera opens the link; OmniBeam there joins the secret's room and proves it
// has the secret. This device answers with its own proof and a new pairing secret, which both save, and the
// one-time secret is dropped: each QR code pairs one device, within 10 minutes, and an old link pairs nobody.
const QR_PAIR_MS = 10 * 60 * 1000;
let qrPair = null; // the QR code this device shows: { secret, until }
let qrScan = null; // a QR code scanned to open this page: { secret, name, until }
function startQrPair() {
  if (qrPair && qrPair.until > Date.now() + 60000) return renderPairQr();
  if (qrPair) wsSend({ type: 'leave-secret', secret: qrPair.secret });
  qrPair = { secret: randomSecret(), until: Date.now() + QR_PAIR_MS, pin: IS_TV ? tvPin() : '', bad: 0 };
  wsSend({ type: 'join-secrets', secrets: [qrPair.secret] });
  renderPairQr();
}
function qrPairLink() {
  return `${location.origin}${appPath()}#qr=${qrPair.secret}&n=${encodeURIComponent((me.name || customName() || deviceName()).slice(0, 40))}${qrPair.pin ? '&p=1' : ''}`;
}
setInterval(() => {
  if (qrPair && qrPair.until < Date.now() && !loadPaired().some((p) => p.secret === qrPair.secret)) {
    wsSend({ type: 'leave-secret', secret: qrPair.secret });
    qrPair = null;
    renderPairQr();
  }
}, 60000);
// Like pairProof, for a different message, so a proof made for one can't be used as the other
// With a PIN (TV mode), the PIN is part of the key: the QR code alone can't pair, and the PIN never travels.
async function qrProof(secret, from, to, what, pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin ? `${secret}|${pin}` : secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`omnibeam-qr-${what}:${from}>${to}`)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// On the phone: prove to the devices here that we scanned their code
async function sendQrHello(peer) {
  if (!qrScan || qrScan.until < Date.now() || !me.id || !crypto.subtle) return;
  const proof = await qrProof(qrScan.secret, me.id, peer.info.id, 'scan', qrScan.pin);
  if (peers.get(peer.info.id) === peer) wsSend({ type: 'signal', to: peer.info.id, data: { qrPair: proof, name: me.name } });
}
// On the device showing the code: the phone proved it scanned it
async function onQrPair(from, proof) {
  if (!qrPair || qrPair.until < Date.now() || typeof proof !== 'string' || !crypto.subtle) return;
  if (proof !== await qrProof(qrPair.secret, from, me.id, 'scan', qrPair.pin)) {
    // A wrong PIN: after 5 tries the code is replaced, so it can't be guessed
    if (qrPair.pin && ++qrPair.bad >= 5) {
      wsSend({ type: 'leave-secret', secret: qrPair.secret });
      qrPair = null;
      renderPairQr();
    }
    return;
  }
  const name = peers.get(from)?.info.name || t('Paired device');
  const once = qrPair.secret;
  const pin = qrPair.pin;
  qrPair = null;
  const secret = randomSecret();
  wsSend({ type: 'signal', to: from, data: { qrOk: await qrProof(once, me.id, from, 'ok', pin), newSecret: secret, name: me.name } });
  wsSend({ type: 'leave-secret', secret: once });
  rememberPairing(secret, name);
  renderPairQr();
  if (pairDlg.open) pairDlg.close();
  toast(t('Paired with {name} – you\'ll find each other automatically from now on', { name }));
}
// On the phone: the device that showed the code proved it did, and sent the pairing secret to keep
async function onQrOk(from, data) {
  if (!qrScan || !crypto.subtle || !peers.get(from) || typeof data.qrOk !== 'string' || !/^[0-9a-f]{64}$/.test(data.newSecret || '')) return;
  if (data.qrOk !== await qrProof(qrScan.secret, from, me.id, 'ok', qrScan.pin)) return;
  const once = qrScan.secret;
  qrScan = null;
  wsSend({ type: 'leave-secret', secret: once });
  const name = peers.get(from).info.name;
  rememberPairing(data.newSecret, name);
  toast(t('Paired with {name} – you\'ll find each other automatically from now on', { name }));
}
function scanFromLink(secret, name, needPin) {
  let pin = '';
  if (needPin) {
    pin = (prompt(t('{name} has a PIN. Type the PIN to pair:', { name: name || t('the other device') })) || '').trim();
    if (!pin) return;
  }
  qrScan = { secret, name, pin, until: Date.now() + QR_PAIR_MS };
  toast(t('Pairing with {name}…', { name: name || t('the other device') }));
  if (ws && ws.readyState === WebSocket.OPEN) {
    wsSend({ type: 'join-secrets', secrets: [secret] });
    for (const p of peers.values()) sendQrHello(p);
  }
  setTimeout(() => {
    if (qrScan?.secret !== secret) return;
    qrScan = null;
    wsSend({ type: 'leave-secret', secret });
    toast(pin ? t('Could not pair. Check the PIN and scan the QR code again.') : t('Could not pair. Keep OmniBeam open on the other device and scan its QR code again.'));
  }, pin ? 12000 : 20000);
}

// ---------- TV mode (omnibeam.site/tv) ----------
// For a smart TV's browser: no sending, just a big QR code. A phone scans it with its camera, which opens OmniBeam
// there and pairs it with the TV (the one-tap QR pairing above); then the phone taps the TV and picks photos.
// Phones on the same Wi-Fi see the TV without scanning. Paired devices' files are accepted by themselves. Photos and
// videos play as a full-screen slideshow (newest first in line); a TV remote works it: ◀ ▶ browse, OK pauses,
// Back returns to the QR code. Each QR code pairs one phone, so a new one appears right after each pairing.
const TV_PHOTO_MS = 8000;
const TV_PIN_KEY = 'omnibeam-tv-pin';
function tvPin() { try { return localStorage.getItem(TV_PIN_KEY) || ''; } catch { return ''; } }
const TV_MAX_SLIDES = 60; // TVs have little memory: older slides are let go
const Tv = {
  slides: [], at: 0, timer: null, paused: false, open: false,
  start() {
    document.title = `${t('TV mode')} · OmniBeam`;
    $('#tv').hidden = false;
    keepAwake('tv', true);
    startQrPair();
    $('#tv-host').textContent = location.host;
    $('#tv-name').onclick = openMeDialog;
    $('#tv-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
    $('#tv-photos').onclick = () => this.show(this.at);
    $('#tv-pin').onclick = () => this.setPin();
    this.pinNote();
    $('#tv-shut').onclick = () => this.close();
    setInterval(() => this.status(), 500);
    document.addEventListener('keydown', (e) => this.key(e));
    // The remote's first press should land on something
    setTimeout(() => { if (!document.querySelector('dialog[open]')) $('#tv-photos').hidden ? $('#tv-full').focus() : $('#tv-photos').focus(); }, 500);
  },
  drawQr() {
    if (!qrPair) { startQrPair(); return; } // a phone just used it, or it ran out: show a new one
    const box = $('#tv-qr');
    if (!box || typeof qrcode !== 'function') return;
    const link = qrPairLink();
    if (box.dataset.link === link) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      box.dataset.link = link;
    } catch {}
  },
  // Who is here, and what is arriving
  status() {
    $('#tv-name b').textContent = me.name || 'TV';
    this.drawQr(); // again once the name is known (it is in the code's link)
    const names = [...peers.values()].map((p) => p.info.name);
    $('#tv-peers').textContent = names.length ? t('Connected: {names}', { names: names.join(', ') }) : t('No phone connected yet');
    const p = [...peers.values()].find((x) => x.prog && !x.prog.sending);
    const text = p ? t('Receiving from {name}… {pct}%', { name: p.info.name, pct: Math.floor((Math.min(p.prog.done, p.prog.total) / (p.prog.total || 1)) * 100) }) : '';
    for (const el of [$('#tv-status'), $('#tv-show-status')]) { el.textContent = text; el.hidden = !text; }
    $('#tv-photos').hidden = !this.slides.length;
    $('#tv-photos span').textContent = t('Show photos ({n})', { n: this.slides.length });
  },
  // Optional PIN: phones must type it after scanning. Setting or changing it unpairs every phone.
  setPin() {
    const v = prompt(t('Choose a PIN of 4 to 8 digits for this TV. Phones must type it to pair. Leave it empty to turn the PIN off.'), '');
    if (v === null) return;
    const pin = v.trim();
    if (pin && !/^\d{4,8}$/.test(pin)) return toast(t('The PIN must be 4 to 8 digits.'));
    try { pin ? localStorage.setItem(TV_PIN_KEY, pin) : localStorage.removeItem(TV_PIN_KEY); } catch {}
    for (const p of loadPaired()) forgetPairing(p.secret);
    if (qrPair) wsSend({ type: 'leave-secret', secret: qrPair.secret });
    qrPair = null;
    startQrPair();
    this.pinNote();
    toast(pin ? t('PIN set. Phones paired before must scan the code again and type the PIN.') : t('PIN turned off.'), 6000);
  },
  pinNote() {
    const on = !!tvPin();
    $('#tv-pin-note').hidden = !on;
    $('#tv-pin').textContent = on ? t('Change PIN') : t('Set a PIN');
    $('#tv-alt').hidden = on; // with a PIN, phones on the same Wi-Fi must pair first too
  },
  received(peer, files) {
    chime();
    const media = files.filter((f) => /^(image|video)\//.test(f.mime || mediaType(f) || '') && f.blob && !/hei[cf]/i.test(f.mime || ''));
    const other = files.length - media.length;
    if (other) toast(t('Other files received: {n}. TV mode shows photos and videos only; they are kept in Received files.', { n: other }), 6000);
    if (!media.length) return;
    const first = this.slides.length;
    for (const f of media) {
      this.slides.push({ url: URL.createObjectURL(f.blob), video: /^video\//.test(f.mime || mediaType(f) || ''), from: peer.info.name });
    }
    let start = first;
    while (this.slides.length > TV_MAX_SLIDES) {
      URL.revokeObjectURL(this.slides.shift().url);
      start--;
      if (this.at > 0) this.at--;
    }
    this.show(Math.max(0, start)); // new photos show at once
  },
  show(i) {
    if (!this.slides.length) return;
    this.at = (i + this.slides.length) % this.slides.length;
    this.open = true;
    const box = $('#tv-show');
    box.hidden = false;
    clearTimeout(this.timer);
    const s = this.slides[this.at];
    const stage = $('#tv-stage');
    stage.querySelectorAll('video').forEach((v) => v.pause());
    stage.innerHTML = '';
    const el = document.createElement(s.video ? 'video' : 'img');
    el.src = s.url;
    el.alt = '';
    if (s.video) {
      el.playsInline = true;
      el.onended = () => this.next();
      el.onerror = () => this.next();
      // With sound if the TV allows it, otherwise muted
      el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    } else {
      el.onerror = () => this.schedule();
      this.schedule();
    }
    stage.appendChild(el);
    $('#tv-caption').textContent = `${this.at + 1} / ${this.slides.length} · ${t('from {name}', { name: s.from })}${this.paused ? ` · ${t('Paused')}` : ''}`;
    box.classList.remove('idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => box.classList.add('idle'), 4000);
  },
  schedule() {
    clearTimeout(this.timer);
    if (!this.paused && this.slides.length > 1) this.timer = setTimeout(() => this.next(), TV_PHOTO_MS);
  },
  next() { if (this.open) this.show(this.at + 1); },
  close() {
    this.open = false;
    clearTimeout(this.timer);
    $('#tv-stage').querySelectorAll('video').forEach((v) => v.pause());
    $('#tv-show').hidden = true;
    $('#tv-photos').focus();
  },
  togglePause() {
    this.paused = !this.paused;
    const v = $('#tv-stage video');
    if (v) this.paused ? v.pause() : v.play().catch(() => {});
    this.show(this.at);
  },
  key(e) {
    if (!this.open || document.querySelector('dialog[open]')) return;
    // Back on TV remotes: Escape, Backspace, Samsung (10009), LG (461)
    const back = ['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(e.key) || [10009, 461].includes(e.keyCode);
    if (back) { e.preventDefault(); return this.close(); }
    if (e.key === 'ArrowRight' || e.key === 'MediaTrackNext') { e.preventDefault(); return this.show(this.at + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'MediaTrackPrevious') { e.preventDefault(); return this.show(this.at - 1); }
    if (['Enter', ' ', 'MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(e.key)) { e.preventDefault(); return this.togglePause(); }
    this.show(this.at); // any other key: show the caption again
  },
};
$('#tv-show').addEventListener('click', (e) => {
  if (e.target.closest('#tv-shut')) return;
  const x = e.clientX / innerWidth;
  if (x < 0.25) Tv.show(Tv.at - 1);
  else if (x > 0.75) Tv.show(Tv.at + 1);
  else Tv.togglePause();
});

// ---------- First-visit walkthrough ----------
// Three short steps for new visitors: open it on the other device, pair if it doesn't show up, tap to send.
// Shown once (Settings has "Show the quick tour"), and not to visitors who arrived through a pairing or shared link.
const TOUR_KEY = 'omnibeam-tour';
const tourDlg = $('#dlg-tour');
let tourStep = 0;
function showTourStep(n) {
  tourStep = n;
  const steps = tourDlg.querySelectorAll('.tour-step');
  steps.forEach((s, i) => { s.hidden = i !== n; });
  tourDlg.querySelectorAll('.tour-dots i').forEach((d, i) => d.classList.toggle('on', i === n));
  $('[data-tour=back]', tourDlg).hidden = n === 0;
  $('[data-tour=skip]', tourDlg).hidden = n === steps.length - 1;
  $('[data-tour=next]', tourDlg).textContent = n === steps.length - 1 ? t('Start') : t('Next');
}
function openTour() {
  showTourStep(0);
  if (!tourDlg.open) tourDlg.showModal();
}
tourDlg.onclose = () => { try { localStorage.setItem(TOUR_KEY, 'done'); } catch {} };
tourDlg.onclick = (e) => {
  const act = e.target.closest('[data-tour]')?.dataset.tour;
  const last = tourDlg.querySelectorAll('.tour-step').length - 1;
  if (act === 'next') { if (tourStep < last) showTourStep(tourStep + 1); else tourDlg.close(); }
  if (act === 'back' && tourStep > 0) showTourStep(tourStep - 1);
  if (act === 'skip') tourDlg.close();
  if (act === 'pair') { tourDlg.close(); $('#btn-pair').click(); }
};
function maybeShowTour() {
  let seen = true;
  try { seen = !!localStorage.getItem(TOUR_KEY); } catch {}
  const arrivedByLink = /(pair|qr|room|shortcut)=/.test(location.hash) || /[?&](share|wake)=/.test(location.search);
  if (seen || arrivedByLink || IS_TV || /bot|crawl|spider|slurp|lighthouse|inspectiontool/i.test(navigator.userAgent)) return;
  setTimeout(() => { if (!document.querySelector('dialog[open]')) openTour(); }, 1200);
}
$('#tour-open').onclick = () => { $('#dlg-settings').close(); openTour(); };

// ---------- Notifications while OmniBeam is closed (web push) ----------
// With notifications on, a paired device that wants to send files while OmniBeam is closed here wakes this device
// with a notification (through the server and the browser's push service), and so do files from the iPhone
// Shortcut. Tapping the notification opens OmniBeam and the files arrive. On iPhone and iPad this only works
// in OmniBeam added to the Home Screen (iOS 16.4 or later): Safari tabs can't get notifications.
const PUSH_KEY = 'omnibeam-push';
let pushPublicKey = null; // the server's key, from /config.json
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
const pushOn = () => { try { return localStorage.getItem(PUSH_KEY) === 'on' && Notification.permission === 'granted'; } catch { return false; } };
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
// Was this subscription made with another server key (after the keys were changed, or moving servers)?
const oldPushKey = (sub) => {
  const key = sub?.options?.applicationServerKey;
  return !!(key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== pushPublicKey);
};
async function sendPushSub() {
  if (!pushPublicKey || !pushSupported() || !pushOn() || !ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // The server's key changed: drop the old subscription (the old key can't reach this device any more) and make
    // a new one without asking (notifications are already allowed). If the browser won't, they show as off.
    if (sub && oldPushKey(sub)) {
      await sub.unsubscribe();
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(pushPublicKey) });
      } catch {
        try { localStorage.setItem(PUSH_KEY, 'off'); } catch {}
        updatePushUi();
        return;
      }
    }
    if (sub) wsSend({ type: 'push-sub', sub: sub.toJSON(), secrets: loadPaired().map((p) => p.secret), requests: window.requestLinksForPush?.() || [], lang: window.I18N?.lang || 'en' });
  } catch {}
}
async function enablePush() {
  if (isIOS && !isStandalone()) return updatePushUi(t('On iPhone and iPad, first add OmniBeam to the Home Screen: tap Share, then Add to Home Screen. Open it from there and turn notifications on.'));
  if (!pushSupported() || !pushPublicKey) return updatePushUi(t('This browser can\'t show notifications while OmniBeam is closed.'));
  // Asked right away, while the tap still counts (Safari only asks after a tap)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return updatePushUi(t('Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.'));
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Made with an older server key (e.g. after moving servers): make a new one
    if (sub && oldPushKey(sub)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(pushPublicKey) });
    try { localStorage.setItem(PUSH_KEY, 'on'); } catch {}
    await sendPushSub();
    for (const p of peers.values()) sendPairHello(p); // tell paired devices: they can wake this one now
    updatePushUi();
    toast(t('Notifications are on'));
  } catch (err) {
    updatePushUi(t('Could not turn notifications on') + ` (${err.message})`);
  }
}
async function disablePush() {
  try { localStorage.setItem(PUSH_KEY, 'off'); } catch {}
  wsSend({ type: 'push-unsub' });
  try { await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch {}
  for (const p of peers.values()) sendPairHello(p);
  updatePushUi();
}
function updatePushUi(note) {
  const on = pushOn();
  $('#push-on').hidden = on;
  $('#push-off').hidden = !on;
  $('#push-state').textContent = on ? t('On: paired devices can wake this one.') : '';
  $('#push-note').textContent = note || (isIOS && !isStandalone() ? t('On iPhone and iPad this works in OmniBeam added to the Home Screen (iOS 16.4 or later).') : '');
}
$('#push-on').onclick = enablePush;
$('#push-off').onclick = disablePush;

// Sending to a paired device that's offline: keep the files here, wake it with a notification, and send them
// as soon as it shows up (the page must stay open until then)
const waiting = new Map(); // pairing secret -> { files, text }
function sendWhenOnline(pair, files, text = '') {
  waiting.set(pair.secret, { files, text });
  wsSend({ type: 'push-wake', secret: pair.secret, files: files.length });
  renderOffline();
}
function onPushResult(msg) {
  const pair = loadPaired().find((p) => p.secret === msg.secret);
  if (pair && msg.ring) {
    if (msg.online || !ringWaiting.has(msg.secret)) return;
    if (msg.limited) return toast(t('Too many attempts. Wait a few minutes and try again.'));
    return toast(msg.sent ? t('{name} got a notification. It rings as soon as it opens OmniBeam.', { name: pair.name })
      : t('{name} is offline and has no notifications on. It rings if it opens OmniBeam in the next 2 minutes.', { name: pair.name }), 6000);
  }
  if (!pair || !waiting.has(msg.secret)) return;
  if (msg.online) return; // it's here after all: the files go when it says hello
  if (msg.limited) return toast(t('Too many attempts. Wait a few minutes and try again.'));
  toast(msg.sent
    ? t('{name} got a notification. Keep this page open: the files go as soon as it opens OmniBeam.', { name: pair.name })
    : t('{name} is offline and has no notifications on. Keep this page open: the files go when it opens OmniBeam.', { name: pair.name }));
}
function sendWaiting(peer) {
  ringIfWaiting(peer);
  const w = peer.pairSecret && waiting.get(peer.pairSecret);
  if (!w) return;
  waiting.delete(peer.pairSecret);
  renderOffline();
  if (w.files.length) peer.sendFiles(w.files).then(() => w.text && peer.sendText(w.text));
  else if (w.text) peer.sendText(w.text);
}

// The iPhone Shortcut was removed (2026-11-03). Forget an inbox link an older version saved.
try { localStorage.removeItem('omnibeam-inbox'); } catch {}

// ---------- Chrome extension (tools/omnibeam-chrome) ----------
// The extension's helper script on this page hands over what to send (the page, a link, selected text or an image)
// and is told which devices are here, for its right-click menu and its toolbar button. They talk through
// window.postMessage on this page; nothing else can reach it.
let extensionHere = false;
function tellExtension() {
  if (!extensionHere) return;
  const list = [...peers.values()].map((p) => ({ id: p.info.id, name: p.info.name, device: p.info.device }));
  window.postMessage({ omnibeamPage: 'peers', peers: list }, location.origin);
}
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || e.origin !== location.origin || !d || typeof d.omnibeamExt !== 'string') return;
  if (d.omnibeamExt === 'hello') {
    extensionHere = true;
    tellExtension();
  } else if (d.omnibeamExt === 'send') {
    const item = d.item || {};
    const files = [];
    if (item.file && typeof item.file.base64 === 'string') {
      const bytes = Uint8Array.from(atob(item.file.base64), (c) => c.charCodeAt(0));
      files.push(new File([bytes], safePath(String(item.file.name || 'image')), { type: String(item.file.type || '') }));
    }
    const text = typeof item.text === 'string' ? item.text.slice(0, 100000) : '';
    if (!files.length && !text) return;
    const peer = d.to && peers.get(d.to);
    if (peer) {
      if (files.length) peer.sendFiles(files).then(() => text && peer.sendText(text));
      else peer.sendText(text);
    } else {
      setShared({ files, text });
      window.focus();
    }
  }
});

// Pairing links: omnibeam.site/#pair=123456 joins that code (on load, or if the page is already open)
function joinCodeFromLink() {
  const team = location.hash.match(/team=([0-9a-f]{64})(?:&n=([^&]*))?/);
  if (team) {
    history.replaceState(null, '', location.pathname + location.search);
    let name = '';
    try { name = decodeURIComponent(team[2] || ''); } catch {}
    const known = Teams.list().some((x) => x.secret === team[1]);
    Teams.add(team[1], name).then((tm) => { if (tm && !known) toast(t('You joined the team room {name}. Its devices will always show up here.', { name: tm.name }), 6000); });
    return;
  }
  const room = (location.hash.match(/room=([a-z]{5})/i) || [])[1];
  if (room) {
    history.replaceState(null, '', location.pathname + location.search);
    if (ws && ws.readyState === WebSocket.OPEN) joinPublic(room);
    else if (wantedPublicRoom !== room.toLowerCase()) {
      wantedPublicRoom = room.toLowerCase();
      wantedPublicPass = null;
    }
    return;
  }
  const qr = location.hash.match(/qr=([0-9a-f]{64})(?:&n=([^&]*))?(&p=1)?/);
  if (qr) {
    history.replaceState(null, '', location.pathname + location.search);
    let name = '';
    try { name = decodeURIComponent(qr[2] || '').slice(0, 40); } catch {}
    if (!loadPaired().some((p) => p.secret === qr[1])) scanFromLink(qr[1], name, !!qr[3]);
    return;
  }
  const code = (location.hash.match(/pair=(\d{6})/) || [])[1];
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  joinCode(code, true);
}
window.addEventListener('hashchange', joinCodeFromLink);
if (/(room=[a-z]{5}|qr=[0-9a-f]{64}|team=[0-9a-f]{64})/i.test(location.hash)) joinCodeFromLink();
// Opened from a notification: nothing to do but be here (the waiting device sends once it sees this one)
if (/[?&]wake=1/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
// Opened from the notification of a message (no OmniBeam tab was open): its chat, once the devices had a moment to show up
{
  const chatKeyFromLink = new URLSearchParams(location.search).get('chat');
  if (chatKeyFromLink) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => openChatByKey(chatKeyFromLink), 1500);
  }
}
maybeShowTour();
$('#public-code').onkeydown = (e) => { if (e.key === 'Enter') joinPublic(e.target.value, $('#public-pass').value); };
$('#public-pass').onkeydown = (e) => { if (e.key === 'Enter') joinPublic($('#public-code').value, e.target.value); };
const linkCode = (location.hash.match(/pair=(\d{6})/) || [])[1];
if (linkCode) {
  history.replaceState(null, '', location.pathname + location.search);
  pendingCode = linkCode;
  joiningTypedCode = true;
  createdCode = false;
}
renderPairedList();
$('#share-banner button').onclick = () => setShared(null);
loadShared();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
Store.init().then(() => History.load());
try { if (JSON.parse(localStorage.getItem('omnibeam-autosend') || '{}').on) setTimeout(() => loadAutoSend().catch(() => {}), 1500); } catch {}
$('#btn-history').onclick = openHistory;

// Settings shows one group at a time: Device, Transfers, Clipboard, Apps. It opens on the group used last.
const SET_TAB_KEY = 'omnibeam-settings-tab';
const SetTabs = {
  names: ['device', 'transfers', 'clipboard', 'apps'],
  now: 'device',
  show(name, { save = false, focus = false } = {}) {
    if (!this.names.includes(name)) name = 'device';
    this.now = name;
    for (const n of this.names) {
      const on = n === name;
      const tab = $(`#set-tab-${n}`);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`#set-pane-${n}`).hidden = !on;
    }
    const body = $('#dlg-settings .set-body');
    if (body) body.scrollTop = 0;
    if (focus) $(`#set-tab-${name}`).focus();
    if (save) { try { localStorage.setItem(SET_TAB_KEY, name); } catch {} }
  },
  opening() {
    let last = '';
    try { last = localStorage.getItem(SET_TAB_KEY) || ''; } catch {}
    this.show(last);
  },
};
$('.set-tabs').onclick = (e) => {
  const tab = e.target.closest('[data-set-tab]');
  if (tab) SetTabs.show(tab.dataset.setTab, { save: true });
};
$('.set-tabs').onkeydown = (e) => {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const list = SetTabs.names;
  let i = list.indexOf(SetTabs.now);
  const k = keys[e.key];
  if (k === 'first') i = 0;
  else if (k === 'last') i = list.length - 1;
  else i = (i + (document.documentElement.dir === 'rtl' ? -k : k) + list.length) % list.length;
  SetTabs.show(list[i], { save: true, focus: true });
};

// Settings: shrinking photos and videos before sending
$('#btn-settings').onclick = () => {
  const dlg = $('#dlg-settings');
  SetTabs.opening();
  updateShrinkUi();
  $('#shrink-video-note').hidden = !VIDEO_TYPE;
  $('#shrink-video-none').hidden = !!VIDEO_TYPE;
  updateClipUi();
  updatePushUi();
  updateThemeUi();
  Supporter.apply();
  $('#bg-audio').checked = BgAudio.on;
  $('#bg-audio-section').hidden = !isIOS;
  showMyAvatar();
  loadAutoSend().then(() => window.AutoSend?.render(), () => {});
  dlg.showModal();
};
$('#set-me').onclick = () => { $('#dlg-settings').close(); openMeDialog(); };
// Settings -> Supporter
$('#supporter-unlock').onclick = async () => {
  const input = $('#supporter-code');
  const msg = $('#supporter-msg');
  if (!input.value.trim()) return input.focus();
  const btn = $('#supporter-unlock');
  btn.disabled = true;
  msg.textContent = t('Checking…');
  try {
    const ok = await Supporter.unlock(input.value);
    msg.textContent = ok ? '' : t('This code doesn\'t work. Check it and try again, or ask for a new one.');
    if (ok) { input.value = ''; toast(t('Thank you for supporting OmniBeam! ♥ The supporter perks are on.'), 5000); }
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
};
$('#supporter-code').onkeydown = (e) => { if (e.key === 'Enter') $('#supporter-unlock').click(); };
$('#supporter-colors').onclick = (e) => { const b = e.target.closest('[data-color]'); if (b) Supporter.setColor(b.dataset.color); };
$('#supporter-remove').onclick = () => { Supporter.remove(); toast(t('The supporter code was removed from this device.')); };
$('#clip-sync').onchange = (e) => setClipSync(e.target.checked);
$('#clip-now').onclick = sendClipNow;
$('#clip-history').onchange = (e) => { ClipHistory.on = e.target.checked; toast(e.target.checked ? t('Clipboard history is on') : t('Clipboard history is off and cleared')); };
$('#clip-history-open').onclick = () => { $('#dlg-settings').close(); openHistory.tab = 'clips'; openHistory(); };
$('#bg-audio').onchange = (e) => BgAudio.set(e.target.checked);
$('#speed-open').onclick = () => {
  $('#dlg-settings').close();
  checkSpeedWith(peers.size === 1 ? [...peers.keys()][0] : null);
};
$('#shrink-choice').onchange = (e) => setShrink(e.target.value);
$('#open-links').checked = openLinksAuto;
$('#open-links').onchange = (e) => {
  openLinksAuto = e.target.checked;
  try { localStorage.setItem(OPEN_LINKS_KEY, openLinksAuto ? 'on' : 'off'); } catch {}
  toast(openLinksAuto ? t('Links from your paired devices open by themselves') : t('Links show an Open link button'));
};
$('#msg-sound').checked = msgSound;
$('#msg-sound').onchange = (e) => { setMsgSound(e.target.checked); if (e.target.checked) { unlockAudio(); chime(); } };
Messages.load();
$('#btn-send-all').onclick = () => {
  for (const p of peers.values()) p.warmUp();
  openSendAll();
};
$('#btn-send-all').ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('drag'); };
$('#btn-send-all').ondragleave = (e) => e.currentTarget.classList.remove('drag');
$('#btn-send-all').ondrop = async (e) => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag');
  const files = await filesFromDrop(e.dataTransfer);
  if (files.length) openSendAll(files);
};
window.addEventListener('storage', (e) => { if (e.key === MESSAGES_KEY) { Messages.load(); History.updateButton(); History.onChange?.(); } });
$('#site-host').textContent = location.host;
// Language menu: each language in its own name
if (window.I18N) {
  const sel = $('#btn-lang');
  // index.html already lists the languages (so the footer doesn't change size when this runs)
  if (!sel.options.length) {
    for (const [code, name] of Object.entries(I18N.languages)) {
      const opt = new Option(name, code, false, code === I18N.lang);
      opt.lang = code;
      sel.appendChild(opt);
    }
  }
  sel.value = I18N.lang;
  sel.onchange = () => I18N.set(sel.value);
} else $('#btn-lang').hidden = true;
$('#btn-pair-empty').onclick = () => $('#btn-pair').click();
// ---------- Intro video ----------
// One video per language (public/media/intro-<lang>.mp4, text and voice translated), so it plays in the language
// the page is in. The tall version on screens held upright, the wide one otherwise. It starts with sound: browsers
// allow that because the tap that opened it counts. Closing the window stops it.
const introDlg = $('#dlg-intro');
const introVideo = $('#intro-video');
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-open="dlg-intro"]') || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const tall = innerHeight > innerWidth;
  const name = `intro-${(window.I18N && I18N.lang) || 'en'}${tall ? '-tall' : ''}`;
  introDlg.classList.toggle('tall', tall);
  if (!introVideo.src.includes(`/${name}.mp4`)) {
    introVideo.poster = `/media/${name}.webp?v=4`;
    introVideo.src = `/media/${name}.mp4?v=4`;
  }
  introVideo.currentTime = 0;
  introVideo.play().catch(() => {});
});
// A language whose video isn't on the server (missing, or blocked): play the English one instead of a dead player.
introVideo.addEventListener('error', () => {
  const m = /\/media\/intro-([a-z]+)(-tall)?\.mp4/.exec(introVideo.src);
  if (!m || m[1] === 'en') return;
  introVideo.poster = `/media/intro-en${m[2] || ''}.webp?v=4`;
  introVideo.src = `/media/intro-en${m[2] || ''}.mp4?v=4`;
  if (introDlg.open) introVideo.play().catch(() => {});
});
introDlg.addEventListener('close', () => introVideo.pause());
// The same video on the home page (the learn section): a poster until it is pressed, so no video byte is fetched
// before. Then it plays in the same 16:9 box (nothing moves), with subtitles when the server found a file for them.
document.addEventListener('click', (e) => {
  const link = e.target.closest('.intro-play');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  e.preventDefault();
  const video = document.createElement('video');
  video.className = 'intro-inline';
  video.controls = true;
  video.playsInline = true;
  video.poster = link.querySelector('img')?.currentSrc || '';
  video.setAttribute('aria-labelledby', 'intro-title');
  if (link.dataset.captions) {
    const track = Object.assign(document.createElement('track'), { kind: 'captions', src: link.dataset.captions, srclang: (window.I18N && I18N.lang) || 'en', default: true });
    track.label = link.dataset.captionsLabel || 'Subtitles';
    video.appendChild(track);
  }
  video.src = link.href;
  link.replaceWith(video);
  video.play().catch(() => {});
  video.focus();
});
// Footer links open their dialog (the links themselves go to the full pages, for search engines and new tabs),
// and [data-close] buttons close the dialog they're in. Done here, not in onclick="", which the site's
// Content Security Policy blocks.
// Help, Terms, Privacy and About aren't in the page at first (less to load on every visit): they come from the
// server, already translated, the first time one of them is opened.
const INFO_DIALOGS = ['dlg-how', 'dlg-terms', 'dlg-privacy', 'dlg-about'];
let infoLoad = null;
function loadInfoDialogs() {
  infoLoad ||= fetch(`/info-dialogs?lang=${(window.I18N && I18N.lang) || 'en'}&v=4`)
    .then((r) => { if (!r.ok) throw new Error(); return r.text(); })
    .then((html) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      tpl.content.querySelectorAll('dialog').forEach((dlg, i) => {
        const h = dlg.querySelector('h1, h2, h3');
        if (h && !dlg.hasAttribute('aria-labelledby')) { h.id = h.id || `dlg-info-title-${i}`; dlg.setAttribute('aria-labelledby', h.id); }
      });
      tpl.content.querySelectorAll('.text-body').forEach((el) => { el.tabIndex = 0; });
      // "Cookie settings" in Privacy, when the statistics banner is on (consent.js)
      tpl.content.querySelectorAll('[data-cookie-settings]').forEach((el) => {
        if (!window.OBConsent) return;
        el.hidden = false;
        el.addEventListener('click', () => window.OBConsent.show());
      });
      document.body.appendChild(tpl.content);
    })
    .catch(() => {
      infoLoad = null;
      throw new Error(t('Could not load this part of OmniBeam. Check the internet connection and try again.'));
    });
  return infoLoad;
}
window.loadInfoDialogs = loadInfoDialogs;
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-open]');
  if (open && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    const id = open.dataset.open;
    if (!document.getElementById(id) && INFO_DIALOGS.includes(id)) {
      loadInfoDialogs().then(() => document.getElementById(id)?.showModal(), (err) => toast(err.message));
    } else document.getElementById(id)?.showModal();
  }
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog')?.close();
});

// Connect to the server right away; the ICE settings arrive in parallel (devices take a moment to show up anyway)
// ---------- Support OmniBeam ----------
// A link to the owner's donation page (SUPPORT_URL in server.js), in the ⋯ menu and the footer. After a few
// successful sends, one short thank-you note mentions it, once.
const SUPPORT_NUDGE_KEY = 'omnibeam-support-nudge';
const SUPPORT_NUDGE_AFTER = 5;
function showSupport(url) {
  if (!/^https:\/\//.test(url || '')) return;
  for (const el of [$('#btn-support'), $('#menu-support'), $('#footer-support')]) { el.href = url; el.hidden = false; }
  document.querySelectorAll('.support-link').forEach((el) => { el.hidden = false; });
  window.addEventListener('omnibeam-sent', () => {
    let n = 0;
    try { n = Number(localStorage.getItem(SUPPORT_NUDGE_KEY)) || 0; } catch { return; }
    if (n < 0) return; // already shown
    n++;
    try { localStorage.setItem(SUPPORT_NUDGE_KEY, String(n >= SUPPORT_NUDGE_AFTER ? -1 : n)); } catch {}
    if (n >= SUPPORT_NUDGE_AFTER) setTimeout(() => toast(t('Enjoying OmniBeam? It\'s free with no ads. You can support it from the ⋯ menu ♥'), 7000), 3500);
  });
}

$('#menu-tv').href = appPath() + 'tv'; // TV mode in this page's language
$('#bar-tv').setAttribute('href', $('#menu-tv').getAttribute('href'));
$('#bar-settings').onclick = () => $('#btn-settings').onclick();
if (IS_TV) Tv.start();
connectSocket();
Outgoing.show();
fetch('/config.json', { cache: 'no-store' })
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg.iceServers?.length) RTC_CONFIG = { iceServers: cfg.iceServers };
    pushPublicKey = cfg.push || null;
    $('#push-section').hidden = !pushPublicKey;
    sendPushSub();
    RELAY_ENABLED = cfg.relay !== false;
    showSupport(cfg.support);
    $('#supporter-section').hidden = !cfg.supporter && !Supporter.on();
    window.dispatchEvent(new CustomEvent('omnibeam-config', { detail: cfg })); // for drop.js (share by link)
  })
  .catch(() => {});
