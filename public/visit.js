// OmniBeam's own visitor count, shown to the site owner on /stats: one message when a page opens, then how many
// seconds it has been on screen (every minute while it is, and when it's hidden or closed). No cookies and nothing
// stored in the browser; the server keeps daily totals only (see "Visitors" in server.js). Not sent after
// "No thanks" on the cookie banner, from the owner's devices (?analytics=off), or by automated browsers.
'use strict';
(function () {
  var choice = null;
  try { choice = localStorage.getItem('omnibeam-analytics'); } catch (e) {}
  if (/[?&]analytics=off\b/.test(location.search)) choice = 'off';
  if (choice === 'no' || choice === 'off' || navigator.webdriver || !navigator.sendBeacon) return;

  var id, shown, since, sent;
  var send = function (data) {
    data.id = id;
    try { navigator.sendBeacon('/api/visit', new Blob([JSON.stringify(data)], { type: 'text/plain' })); } catch (e) {}
  };
  var seconds = function () { return Math.round(shown + (since ? Date.now() - since : 0)) / 1000 | 0; };
  // Where the visitor came from: the other site's name only (never the full address), or the link's utm_source
  var source = function () {
    var r = '';
    try { r = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    if (r === location.hostname) r = '';
    var u = (location.search.match(/[?&]utm_source=([^&#]*)/) || [])[1] || '';
    try { u = decodeURIComponent(u); } catch (e) {}
    return { r: r, u: u };
  };
  var open = function () {
    id = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    shown = 0;
    sent = 0;
    since = document.visibilityState === 'visible' ? Date.now() : 0;
    var w = Math.min(screen.width, screen.height);
    var touch = matchMedia('(pointer: coarse)').matches;
    var s = source();
    send({
      t: 'v', p: location.pathname, r: s.r, u: s.u, l: document.documentElement.lang || 'en',
      d: touch && w < 600 ? 'phone' : touch && w < 1100 ? 'tablet' : 'desktop',
      a: matchMedia('(display-mode: standalone)').matches || /^android-app:/.test(document.referrer) ? 1 : 0,
    });
  };
  var report = function (end) {
    var s = seconds();
    if (s > sent || end) send({ t: 't', s: s, end: end ? 1 : 0 });
    sent = s;
  };
  open();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { if (!since) since = Date.now(); return; }
    if (since) { shown += Date.now() - since; since = 0; }
    report(false);
  });
  addEventListener('pagehide', function () {
    if (since) { shown += Date.now() - since; since = 0; }
    report(true);
  });
  // Back from the browser's back/forward cache: a new visit of the page
  addEventListener('pageshow', function (e) { if (e.persisted) open(); });
  setInterval(function () { if (since) report(false); }, 60 * 1000);
})();
