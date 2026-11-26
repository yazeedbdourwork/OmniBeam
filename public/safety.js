// OmniBeam: a safety code both devices show, to check you are sending to the right device and nobody is in between
// (More… on a device → Safety code). Loaded by app.js when first used.
// The code is made from the keys of the connection itself: over a direct connection, the DTLS fingerprints of both
// browsers (in the offer and answer they swapped); through the server, the two public keys of the end-to-end
// encryption (E2E). Both devices put the two in the same order and hash them, so they show the same 12 digits. If
// someone (even the server) had put itself in between, each side would have that someone's key instead, and the
// codes would differ. A new code for every connection: the keys are new each time a page opens.
// Messages (inside the connection): {t:'sf-show', m: 'd' | 'r'} asks the other device to show its code too.
// It uses app.js's helpers ($, t, toast, sha256Hex, E2E…) directly.
'use strict';
(function () {
  const KEY = 'omnibeam-safety'; // { pairing secret (first 16): checked at }
  const STYLE = `
.safety-dialog { width: min(440px, 100vw); max-width: 100vw; text-align: center; }
.sf-code { font: 700 clamp(26px, 8vw, 36px)/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .06em; margin: 14px 0 6px; font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; }
.sf-code.wait { opacity: .5; }
.sf-how { font-size: 13px; margin: 0 0 12px; }
.sf-state { min-height: 1.4em; margin: 8px 0; font-weight: 600; }
.sf-state.good { color: #1a9a4b; }
.sf-state.bad { color: #d23c3c; }
.safety-dialog .row { flex-wrap: wrap; justify-content: center; }
.safety-dialog .row .btn { flex: 1 1 140px; }
`;
  let styled = false;
  let dlg = null;
  let cur = null; // { peer, mode, code }
  let lastShowAsk = 0;
  const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const pairKey = (peer) => (peer.pairSecret ? peer.pairSecret.slice(0, 16) : '');

  function fingerprints(sdp) {
    const m = /a=fingerprint:(\S+) ([0-9A-Fa-f:]+)/.exec(sdp || '');
    return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : '';
  }
  // The code for this connection: 'd' (direct) or 'r' (through the server). null if it can't be worked out.
  async function codeFor(peer, mode) {
    let a, b;
    if (mode === 'd') {
      const pc = peer.pc;
      a = fingerprints((pc?.currentLocalDescription || pc?.localDescription)?.sdp);
      b = fingerprints((pc?.currentRemoteDescription || pc?.remoteDescription)?.sdp);
    } else {
      await peer.e2eKey();
      a = E2E.pub;
      b = peer.theirPub;
    }
    if (!a || !b) return null;
    const hex = await sha256Hex('omnibeam-safety-v1|' + [a, b].sort().join('|'));
    // 12 digits, in 3 groups of 4
    const six = (h) => String(parseInt(h, 16) % 1000000).padStart(6, '0');
    const n = six(hex.slice(0, 10)) + six(hex.slice(10, 20));
    return n.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  // Connect (direct if possible, else through the server) and pick the mode in use
  async function connectFor(peer) {
    await peer.connect();
    return peer.direct ? 'd' : 'r';
  }

  function addStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  function dialog() {
    if (dlg) return dlg;
    addStyle();
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-safety';
    dlg.className = 'safety-dialog';
    dlg.setAttribute('aria-labelledby', 'sf-title');
    dlg.innerHTML = `<h3 id="sf-title"></h3>
      <p class="muted" data-k="about"></p>
      <div class="sf-code" role="status" aria-live="polite"></div>
      <p class="muted sf-how"></p>
      <p class="sf-state" role="status"></p>
      <p class="muted small" data-k="last"></p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="show"></button>
      </div>
      <div class="row">
        <button type="button" class="btn ghost" data-act="bad"></button>
        <button type="button" class="btn" data-act="good"></button>
      </div>
      <div class="row"><button type="button" class="btn ghost" data-act="close"></button></div>`;
    $('[data-act=bad]', dlg).textContent = t('They are different');
    $('[data-act=good]', dlg).textContent = t('They match');
    $('[data-act=close]', dlg).textContent = t('Close');
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'close') return dlg.close();
      if (!cur) return;
      if (act === 'show') askShow();
      else if (act === 'good') verdict(true);
      else if (act === 'bad') verdict(false);
    });
    document.body.append(dlg);
    return dlg;
  }
  function state(text, kind = '') {
    const el = $('.sf-state', dlg);
    el.textContent = text;
    el.className = 'sf-state' + (kind ? ' ' + kind : '');
  }
  async function open(peer, mode = null) {
    dialog();
    const name = peer.info.name;
    cur = { peer, mode: null, code: null };
    const me = cur;
    $('#sf-title', dlg).textContent = t('Safety code with {name}', { name });
    $('[data-k=about]', dlg).textContent = t('Check that {name} shows the same code. If it does, you are connected straight to {name} and nobody is in between.', { name });
    $('[data-act=show]', dlg).textContent = t('Show it on {name} too', { name });
    const code = $('.sf-code', dlg);
    code.textContent = '···· ···· ····';
    code.classList.add('wait');
    $('.sf-how', dlg).textContent = '';
    state('');
    const when = readAll()[pairKey(peer)];
    $('[data-k=last]', dlg).textContent = when ? t('You last checked this with {name} on {date}.', { name, date: new Date(when).toLocaleDateString() }) : '';
    for (const b of dlg.querySelectorAll('[data-act=show],[data-act=good],[data-act=bad]')) b.disabled = true;
    if (!dlg.open) dlg.showModal();
    try {
      const m = mode || (await connectFor(peer));
      const value = await codeFor(peer, m);
      if (cur !== me) return;
      if (!value) throw new Error('no keys');
      me.mode = m;
      me.code = value;
      code.textContent = value;
      code.classList.remove('wait');
      $('.sf-how', dlg).textContent = m === 'd' ? t('Direct connection, encrypted') : t('Through the OmniBeam server, end-to-end encrypted');
      for (const b of dlg.querySelectorAll('[data-act=show],[data-act=good],[data-act=bad]')) b.disabled = false;
      wsSend({ type: 'stat', kind: 'safety' });
    } catch {
      if (cur !== me) return;
      code.textContent = '—';
      state(t('Could not connect to {name}. Keep OmniBeam open on both devices and try again.', { name }), 'bad');
    }
  }
  function askShow() {
    const peer = cur.peer;
    try {
      peer.sendJson({ t: 'sf-show', m: cur.mode });
      state(t('Look at {name}: the same code should be on its screen now.', { name: peer.info.name }));
    } catch {
      state(t('Could not connect to {name}. Keep OmniBeam open on both devices and try again.', { name: peer.info.name }), 'bad');
    }
  }
  function verdict(ok) {
    const peer = cur.peer;
    const name = peer.info.name;
    if (ok) {
      const k = pairKey(peer);
      if (k) {
        const all = readAll();
        all[k] = Date.now();
        try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
      }
      state(t('Good: you are connected straight to {name}. Your files go only there.', { name }), 'good');
      wsSend({ type: 'stat', kind: 'safetyok' });
    } else {
      state(t('Don\'t send anything now. Close OmniBeam on both devices, open it again and compare a new code. If it still differs, use the same Wi-Fi or pair the devices with a QR code.'), 'bad');
      wsSend({ type: 'stat', kind: 'safetybad' });
    }
  }
  // The other device asked to show the code here too
  function onMsg(peer, msg) {
    if (msg.t !== 'sf-show' || IS_TV) return;
    if (Date.now() - lastShowAsk < 3000) return;
    lastShowAsk = Date.now();
    const mode = msg.m === 'd' && peer.direct ? 'd' : 'r';
    open(peer, mode);
  }
  window.addEventListener('omnibeam-peer-left', (e) => {
    if (cur && cur.peer.info.id === e.detail && dlg?.open) state(t('{name} left', { name: cur.peer.info.name }), 'bad');
  });

  window.Safety = { open, onMsg, codeFor };
})();
