// Problem reports for the site owner's stats page (/stats > Problems): when a transfer fails, a direct connection
// doesn't work, a shared link breaks or a script error happens, the page sends a short note to the server.
// Notes hold what went wrong and which route was used, never file names, contents or messages (the server
// also strips anything that looks like a name, address or code). The browser and system come from the
// User-Agent the server sees anyway. At most a few notes per page load, and each problem only once.
// Crashes: the page notes in this tab's sessionStorage whether it is on screen, and that it closed normally. If the
// tab comes back (the browser reloads a crashed tab, or the page is opened again in it) and the last note says it
// was on screen and never closed, the browser crashed or killed it: that is reported once (kind crash). Not counted:
// a note last refreshed more than CRASH_GAP ago (a crashed tab is reloaded at once; an old 'visible' note is iOS Safari
// restoring its tabs after it was swiped away or killed in the background, which saves sessionStorage without the
// last 'hidden'), a tab the browser discarded on purpose, and a copy of the note in a new or duplicated tab while the
// page that wrote it is still open (it answers on a BroadcastChannel). Phones: a page that lost focus (the Camera app,
// Control Center, the app switcher, another app) is noted 'away', not 'visible': iOS often closes the tab to free
// memory there, without the 'hidden' note, and that is not a crash of ours (2026-11-23: the phone Pair window says to
// scan a computer's code with the Camera app). Stuck
// transfers are reported by app.js (kind stuck). Both also reach the owner on Telegram (see server.js).
'use strict';
(function () {
  if (/bot|crawl|spider|slurp|lighthouse|inspectiontool|headless/i.test(navigator.userAgent) && !/[?&]reports=on/.test(location.search)) return;
  let left = 8;
  const seen = new Set();
  const script = document.querySelector('script[src*="/app.js"], script[src*="/get.js"]');
  const version = ((script && script.src.match(/[?&]v=([\w.-]+)/)) || [])[1] || '';
  // kind: transfer, direct, js, socket, link, storage, shrink, crash or stuck. extra: d (detail), r (route), role, same, size, src, line
  function report(kind, message, extra) {
    const m = String(message == null ? '' : message).slice(0, 300);
    const key = kind + '|' + m;
    if (left <= 0 || seen.has(key)) return;
    seen.add(key);
    left--;
    const body = JSON.stringify(Object.assign({ k: kind, m, v: version }, extra || {}));
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/api/report', new Blob([body], { type: 'application/json' }))) return;
    } catch {}
    try { fetch('/api/report', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {}); } catch {}
  }
  window.omniReport = report;

  // Script errors in our own files (not in browser extensions or other sites' scripts)
  addEventListener('error', (e) => {
    if (!e.filename || !e.filename.startsWith(location.origin)) return;
    report('js', e.message, { src: e.filename.slice(location.origin.length), line: e.lineno });
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && /AbortError|NotAllowedError/.test(r.name)) return; // a closed share sheet, a refused permission
    report('js', 'Unhandled: ' + ((r && (r.name ? r.name + ': ' : '') + (r.message || '')) || String(r)));
  });

  // ---------- Crash check ----------
  const CK = 'omnibeam-alive';
  const started = Date.now();
  const page = document.documentElement.classList.contains('tv') ? 'tv' : /^\/d\//.test(location.pathname) ? 'link'
    : /^\/r\//.test(location.pathname) ? 'request' : 'app';
  const CRASH_GAP = 2 * 60e3; // "seen" is refreshed every 15 s while on screen
  const id = Math.random().toString(36).slice(2, 10);
  const read = () => { try { return JSON.parse(sessionStorage.getItem(CK) || 'null'); } catch { return null; } };
  // What the page was doing, so a crash report says more than "no transfer running": the file or photo picker
  // was open (iPhones often close a tab to free memory while the camera or photo picker is up) and which window
  let picking = 0;
  const doing = () => {
    const parts = [];
    if (picking && Date.now() - picking < 5 * 60e3) parts.push('choosing files');
    try {
      const open = [...document.querySelectorAll('dialog[open]')].map((d) => d.id).filter(Boolean);
      if (open.length) parts.push('window: ' + open.slice(-2).join(', '));
    } catch {}
    return parts.join(', ');
  };
  // Phones and tablets only: on a computer the window often has no focus while the page is in plain view
  const touch = (() => { try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch { return false; } })();
  const shown = () => !document.hidden && (!touch || document.hasFocus());
  const note = (state) => {
    let busy = false;
    try { busy = !!(window.omniBusy && window.omniBusy()); } catch {}
    try { sessionStorage.setItem(CK, JSON.stringify({ state, at: started, seen: Date.now(), busy, page, v: version, id, d: doing() })); } catch {}
  };
  addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'file') picking = Date.now();
    // After the tap has opened or closed a window
    setTimeout(() => { if (shown()) note('visible'); }, 0);
  }, true);
  for (const ev of ['change', 'cancel']) {
    addEventListener(ev, (e) => {
      const t = e.target;
      if (t && t.tagName === 'INPUT' && t.type === 'file' && picking) { picking = 0; note(now()); }
    }, true);
  }
  // Answers "is the page that wrote this note still open?" (closed while the page sits in the back/forward cache)
  let bc = null;
  const listen = () => {
    try { bc = new BroadcastChannel(CK); } catch { return; }
    bc.onmessage = (e) => { if (e.data && e.data.ask === id) bc.postMessage({ alive: id }); };
  };
  listen();
  const prev = read();
  // Only a page that was on screen (a page in the background can be closed by the system without notice), seen
  // just before this load, and not thrown away by the browser on purpose
  if (prev && prev.state === 'visible' && Date.now() - (prev.seen || 0) < CRASH_GAP && !document.wasDiscarded) {
    const send = () => report('crash', 'The page stopped without closing (browser crash or out of memory)', {
      busy: !!prev.busy, up: Math.round(((prev.seen || prev.at) - prev.at) / 60000), page: prev.page, v: prev.v || version,
      ...(prev.d ? { d: String(prev.d).slice(0, 120) } : {}),
    });
    let ask = null;
    try { ask = prev.id && new BroadcastChannel(CK); } catch {}
    if (!ask) send();
    else {
      // A new or duplicated tab gets a copy of this tab's sessionStorage: if the page that wrote the note answers,
      // it is still running
      let alive = false;
      ask.onmessage = (e) => { if (e.data && e.data.alive === prev.id) alive = true; };
      ask.postMessage({ ask: prev.id });
      setTimeout(() => { ask.close(); if (!alive) send(); }, 1500);
    }
  }
  const now = () => (document.hidden ? 'hidden' : shown() ? 'visible' : 'away');
  note(now());
  addEventListener('visibilitychange', () => note(now()));
  if (touch) {
    addEventListener('blur', () => { if (!document.hidden) note('away'); });
    addEventListener('focus', () => note(now()));
  }
  addEventListener('pagehide', () => { note('closed'); if (bc) { bc.close(); bc = null; } });
  addEventListener('pageshow', (e) => { if (e.persisted) { note(now()); if (!bc) listen(); } });
  // Keep "seen" and "a transfer is running" fresh
  setInterval(() => { if (shown()) note('visible'); }, 15000);
})();
