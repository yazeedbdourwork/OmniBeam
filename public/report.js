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
  const CRASH_GAP_TAB = 15 * 60e3; // a crashed tab whose page is opened again in a new tab
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
    // The last buttons tapped (their code names, never what is typed) and how much memory the page used
    if (taps.length) parts.push('last taps: ' + taps.join(' > '));
    try {
      const used = performance.memory && performance.memory.usedJSHeapSize;
      if (used) parts.push('memory ' + Math.round(used / 1048576) + ' MB' + (navigator.deviceMemory ? ' of ' + navigator.deviceMemory + ' GB' : ''));
      else if (navigator.deviceMemory) parts.push('device ' + navigator.deviceMemory + ' GB');
    } catch {}
    return parts.join(', ').slice(0, 190);
  };
  const taps = [];
  const tapName = (el) => {
    const b = el && el.closest && el.closest('[data-act], [data-rc], [data-pr], [data-sb], [data-a], button[id], a[id]');
    if (!b) return '';
    const n = b.dataset.act || b.dataset.rc || b.dataset.pr || b.dataset.sb || b.dataset.a || b.id;
    return /^[\w-]{1,24}$/.test(n || '') ? n : '';
  };
  // Phones and tablets only: on a computer the window often has no focus while the page is in plain view
  const touch = (() => { try { return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch { return false; } })();
  const shown = () => !document.hidden && (!touch || document.hasFocus());
  const note = (state) => {
    let busy = false;
    try { busy = !!(window.omniBusy && window.omniBusy()); } catch {}
    const n = { state, at: started, seen: Date.now(), busy, page, v: version, id, d: doing() };
    try { sessionStorage.setItem(CK, JSON.stringify(n)); } catch {}
    // A copy for the other tabs of this site: a crashed tab that is never reopened is found by the next OmniBeam
    // page opened in a new tab (sessionStorage dies with its tab)
    tabs((all) => { if (state === 'closed') delete all[id]; else all[id] = n; });
  };
  const TK = 'omnibeam-alive-tabs';
  function tabs(change) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(TK) || '{}') || {}; } catch {}
    if (typeof all !== 'object' || Array.isArray(all)) all = {};
    for (const k of Object.keys(all)) if (!all[k] || Date.now() - (all[k].seen || 0) > 864e5) delete all[k];
    const out = change ? change(all) : all;
    try { if (Object.keys(all).length) localStorage.setItem(TK, JSON.stringify(all)); else localStorage.removeItem(TK); } catch {}
    return out;
  }
  addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'file') picking = Date.now();
    const n = tapName(t);
    if (n && taps[taps.length - 1] !== n) { taps.push(n); if (taps.length > 4) taps.shift(); }
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
  const crashed = (n, how) => report('crash', 'The page stopped without closing (browser crash or out of memory)', {
    busy: !!n.busy, up: Math.round(((n.seen || n.at) - n.at) / 60000), page: n.page, v: n.v || version,
    d: [how, n.d].filter(Boolean).join(', ').slice(0, 200),
  });
  // Is the page that wrote this note still running? (it answers on the BroadcastChannel)
  function stillOpen(nid, then) {
    let ask = null;
    try { ask = nid && new BroadcastChannel(CK); } catch {}
    if (!ask) return then(false);
    let alive = false;
    ask.onmessage = (e) => { if (e.data && e.data.alive === nid) alive = true; };
    ask.postMessage({ ask: nid });
    setTimeout(() => { ask.close(); then(alive); }, 1500);
  }
  if (prev && prev.state === 'visible' && Date.now() - (prev.seen || 0) < CRASH_GAP && !document.wasDiscarded) {
    // A new or duplicated tab gets a copy of this tab's sessionStorage: if the page that wrote the note answers,
    // it is still running
    stillOpen(prev.id, (alive) => { if (!alive) crashed(prev, ''); });
  }
  if (prev && prev.id) tabs((all) => { delete all[prev.id]; });
  // Other tabs that were on screen a short while ago and stopped without closing: reported from this new tab
  // ("found in a new tab"). This tab's own earlier note is checked above, from sessionStorage.
  const others = tabs((all) => Object.keys(all).filter((k) => k !== id && all[k].state === 'visible' && Date.now() - (all[k].seen || 0) < CRASH_GAP_TAB).map((k) => all[k]));
  for (const o of others) {
    stillOpen(o.id, (alive) => {
      if (alive) return;
      let mine = false;
      tabs((all) => { if (all[o.id]) { delete all[o.id]; mine = true; } });
      if (mine) crashed(o, 'found in a new tab');
    });
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
