// OmniBeam: slides on a computer or TV, and a phone as their remote. Loaded by app.js when first used.
//   - Present slides (⋯ menu on a computer, or slides sent from a phone's remote): a PDF (each page a slide, drawn
//     with PDF.js, public/pdfjs/, Apache-2.0) or photos, full screen. Keys: → / Space / Page Down next, ← / Page Up
//     back, B black screen, F full screen, Esc to stop. A click on the right of the slide goes on, on the left back.
//   - The phone's remote (More… on a computer's card → Remote control): Next and Back, Play / Pause and ±10 s for a
//     video playing in OmniBeam on that computer (a preview, the photo viewer, a shared screen), black screen, and
//     Show slides from this phone (sends a PDF or photos that open as slides there).
// Messages (inside the encrypted connection): {t:'rc', a} from the phone, {t:'rc-state', state} back. A paired
// phone may control at once; any other device is asked about once (Allow / Don't allow) for as long as the page
// stays open. A web page can only work what is inside OmniBeam: not PowerPoint or another tab (export to PDF first).
// It uses app.js's helpers ($, t, toast, peers, isPhone, IS_TV…) directly.
'use strict';
(function () {
  const PDFJS = '/pdfjs/pdf.min.js?v=3.11.174';
  const PDF_WORKER = '/pdfjs/pdf.worker.min.js?v=3.11.174';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clock = (s) => {
    if (!isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const isPdf = (f) => (f.type || f.mime) === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  const isImage = (f) => /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(f.type || f.mime || '') || /\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(f.name || '');
  const STYLE = `
.present-dialog { width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; margin: 0; padding: 0; border: 0; border-radius: 0; background: #000; color: #fff; overflow: hidden; }
.present-dialog:not([open]) { display: none; }
.present-dialog::backdrop { background: #000; }
.pr-stage { position: absolute; top: 0; right: 0; bottom: 0; left: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.pr-stage canvas, .pr-stage img { max-width: 100%; max-height: 100%; display: block; background: #fff; }
.pr-stage img { background: none; object-fit: contain; width: 100%; height: 100%; }
.pr-black { position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: #000; }
.pr-black[hidden] { display: none; }
.pr-bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; background: rgba(20,20,26,.78); transition: opacity .4s; z-index: 2; }
.present-dialog.idle .pr-bar, .present-dialog.idle .pr-hint { opacity: 0; }
.pr-bar button { width: 44px; height: 44px; border-radius: 50%; border: 0; background: rgba(255,255,255,.14); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; }
.pr-bar button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.pr-bar button[aria-pressed="true"] { background: #fff; color: #000; }
.pr-bar .pr-n { min-width: 70px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 700; }
.pr-hint { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 8px 16px; border-radius: 12px; background: rgba(20,20,26,.78); font-size: 14px; text-align: center; transition: opacity .4s; z-index: 2; }
.pr-hint[hidden] { display: none; }
.pr-wait { position: absolute; color: #bbb; }
.remote-dialog { width: min(420px, 100vw); max-width: 100vw; }
.rc-state { min-height: 2.6em; margin: 4px 0 14px; text-align: center; color: var(--muted); }
.rc-big { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.rc-big button { height: 110px; border-radius: 22px; font-size: 1.05rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; }
.rc-big button svg { width: 34px; height: 34px; fill: none; stroke: currentColor; stroke-width: 2.2; }
.rc-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
.rc-row button { height: 62px; border-radius: 18px; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 0.78rem; }
.rc-row button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.rc-row button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); }
.remote-dialog .rc-send { width: 100%; margin-top: 14px; }
`;
  let styled = false;
  function addStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19 2 12l9-7zM22 19l-9-7 9-7z"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 19 9-7-9-7zM2 19l9-7-9-7z"/></svg>',
    black: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  // ---------- Slides ----------
  let show = null; // { kind: 'pdf' | 'images', doc?, urls?, pages, at, black, title, dlg, gen }
  let pdfReady = null;
  function loadPdf() {
    if (!pdfReady) {
      pdfReady = loadScript(PDFJS).then(() => {
        const lib = window.pdfjsLib;
        if (!lib) throw new Error('PDF.js');
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        return lib;
      });
      pdfReady.catch(() => { pdfReady = null; });
    }
    return pdfReady;
  }
  function dialog() {
    let dlg = document.getElementById('dlg-present');
    if (dlg) return dlg;
    addStyle();
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-present';
    dlg.className = 'present-dialog';
    dlg.setAttribute('aria-label', t('Slides'));
    dlg.innerHTML = `<div class="pr-stage" role="img"></div><div class="pr-black" hidden></div><p class="pr-hint" hidden></p>
      <div class="pr-bar">
        <button type="button" data-pr="prev" title="${esc(t('Previous'))}" aria-label="${esc(t('Previous'))}">${ICON.prev}</button>
        <span class="pr-n" aria-live="polite"></span>
        <button type="button" data-pr="next" title="${esc(t('Next'))}" aria-label="${esc(t('Next'))}">${ICON.next}</button>
        <button type="button" data-pr="black" aria-pressed="false" title="${esc(t('Black screen'))}" aria-label="${esc(t('Black screen'))}">${ICON.black}</button>
        <button type="button" data-pr="full" title="${esc(t('Full screen'))}" aria-label="${esc(t('Full screen'))}">${ICON.full}</button>
        <button type="button" data-pr="close" title="${esc(t('Close'))}" aria-label="${esc(t('Close'))}">${ICON.close}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pr]');
      if (b) {
        e.stopPropagation();
        return act(b.dataset.pr);
      }
      if (e.target.closest('.pr-stage, .pr-black')) {
        const r = dlg.getBoundingClientRect();
        const left = e.clientX < r.left + r.width / 3;
        act(left !== (document.documentElement.dir === 'rtl') ? 'prev' : 'next');
      }
    });
    dlg.addEventListener('keydown', (e) => {
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(k)) act('next');
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) act('prev');
      else if (k === 'Home') go(0);
      else if (k === 'End') go(show ? show.pages - 1 : 0);
      else if (k === 'b' || k === 'B' || k === '.') act('black');
      else if (k === 'f' || k === 'F') act('full');
      else return;
      e.preventDefault();
    });
    let idle = 0;
    const wake = () => { dlg.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => dlg.classList.add('idle'), 3000); };
    dlg.addEventListener('pointermove', wake);
    dlg.addEventListener('keydown', wake);
    dlg.addEventListener('close', () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      const s = show;
      show = null;
      if (s) { s.doc?.destroy?.(); (s.urls || []).forEach((u) => URL.revokeObjectURL(u)); }
      $('.pr-stage', dlg).innerHTML = '';
      tellAll();
    });
    window.addEventListener('resize', () => { if (show) draw(); });
    return dlg;
  }
  function act(a) {
    if (!show) return;
    if (a === 'next') go(show.at + 1);
    else if (a === 'prev') go(show.at - 1);
    else if (a === 'first') go(0);
    else if (a === 'black') { show.black = !show.black; paintBar(); tellAll(); }
    else if (a === 'full') {
      const dlg = show.dlg;
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else (dlg.requestFullscreen || dlg.webkitRequestFullscreen)?.call(dlg)?.catch?.(() => {});
    } else if (a === 'close') show.dlg.close();
  }
  function go(n) {
    if (!show) return;
    n = Math.max(0, Math.min(show.pages - 1, n));
    show.black = false;
    if (n === show.at) { paintBar(); return tellAll(); }
    show.at = n;
    draw();
  }
  function paintBar() {
    const dlg = show.dlg;
    $('.pr-n', dlg).textContent = `${show.at + 1} / ${show.pages}`;
    $('[data-pr=prev]', dlg).disabled = show.at === 0;
    $('[data-pr=next]', dlg).disabled = show.at >= show.pages - 1;
    $('.pr-black', dlg).hidden = !show.black;
    $('[data-pr=black]', dlg).setAttribute('aria-pressed', String(!!show.black));
    $('.pr-stage', dlg).setAttribute('aria-label', t('Slide {n} of {total}', { n: show.at + 1, total: show.pages }));
  }
  async function draw() {
    const s = show;
    if (!s) return;
    const gen = ++s.gen;
    const stage = $('.pr-stage', s.dlg);
    paintBar();
    tellAll();
    if (s.kind === 'images') {
      stage.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '';
      img.src = s.urls[s.at];
      stage.appendChild(img);
      return;
    }
    try {
      const page = await s.doc.getPage(s.at + 1);
      if (show !== s || gen !== s.gen) return;
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(window.innerWidth / base.width, window.innerHeight / base.height);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: fit * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = `${Math.floor(vp.width / ratio)}px`;
      canvas.style.height = `${Math.floor(vp.height / ratio)}px`;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      if (show !== s || gen !== s.gen) return;
      stage.innerHTML = '';
      stage.appendChild(canvas);
    } catch (err) {
      if (show === s) toast(t('Could not show this PDF') + ` (${err.message || err})`);
    }
  }
  // files: a PDF, or photos (shown in name order). from: the device that sent them, if any
  async function present(files, from) {
    files = [...files];
    const pdf = files.find(isPdf);
    const images = files.filter(isImage).sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    if (!pdf && !images.length) return toast(t('Choose a PDF or photos to show as slides. (PowerPoint and Keynote can save a PDF.)'), 6000);
    const dlg = dialog();
    if (show) dlg.close();
    const s = { kind: pdf ? 'pdf' : 'images', at: 0, black: false, gen: 0, dlg, title: pdf ? pdf.name : images[0].name, pages: 0 };
    show = s;
    const stage = $('.pr-stage', dlg);
    stage.innerHTML = `<span class="pr-wait">${esc(t('Opening…'))}</span>`;
    if (!dlg.open) dlg.showModal();
    // Phones that control this screen: the remote shows it; a hint once that a phone can be the remote
    const hint = $('.pr-hint', dlg);
    hint.hidden = !!from;
    hint.textContent = t('Use your phone as the remote: on the phone, tap this computer, then More… → Remote control.');
    setTimeout(() => { hint.hidden = true; }, 8000);
    try {
      if (pdf) {
        const lib = await loadPdf();
        const data = new Uint8Array(await (pdf.blob || pdf).arrayBuffer());
        s.doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
        s.pages = s.doc.numPages;
      } else {
        s.urls = await Promise.all(images.map(async (f) => URL.createObjectURL(f.blob || f)));
        s.pages = s.urls.length;
      }
    } catch (err) {
      if (show === s) { dlg.close(); toast(t('Could not show this PDF') + ` (${err.message || err})`); }
      return;
    }
    if (show !== s) return;
    wsSend({ type: 'stat', kind: 'present' });
    draw();
    dlg.focus();
  }
  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf,image/*';
    input.multiple = true;
    input.onchange = () => { if (input.files.length) present([...input.files]); };
    input.click();
  }

  // ---------- This screen, worked by a phone ----------
  const allowedPeers = new WeakSet();
  const deniedPeers = new WeakSet(); // "Don't allow": not asked again until this page reloads
  const controllers = new Set(); // phones that sent a command lately (they get the state when it changes)
  let asking = null;
  function allowed(peer) {
    if (peer.pairSecret || allowedPeers.has(peer)) return Promise.resolve(true);
    if (deniedPeers.has(peer)) return Promise.resolve(false);
    if (asking) return asking.peer === peer ? asking.promise : Promise.resolve(false);
    let dlg = document.getElementById('dlg-rc-ask');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-rc-ask';
      dlg.setAttribute('aria-labelledby', 'rc-ask-title');
      dlg.innerHTML = '<h3 id="rc-ask-title"></h3><p class="muted"></p><div class="row"><button type="button" class="btn ghost" data-a="no"></button><button type="button" class="btn" data-a="yes"></button></div>';
      document.body.appendChild(dlg);
    }
    $('h3', dlg).textContent = t('{name} wants to be the remote of this screen', { name: peer.info.name });
    $('p', dlg).textContent = t('It can go to the next slide, and play or pause videos in OmniBeam. Nothing else.');
    $('[data-a=no]', dlg).textContent = t('Don\'t allow');
    $('[data-a=yes]', dlg).textContent = t('Allow');
    const promise = new Promise((resolve) => {
      const done = (ok) => { asking = null; dlg.onclose = null; if (dlg.open) dlg.close(); (ok ? allowedPeers : deniedPeers).add(peer); resolve(ok); };
      dlg.onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'yes'); };
      dlg.onclose = () => done(false);
    });
    asking = { peer, promise };
    try { peer.sendJson({ t: 'rc-state', state: { mode: 'asking' } }); } catch {}
    dlg.showModal();
    chime();
    return promise;
  }
  // The video playing (or paused) in OmniBeam on this screen, if one shows
  function video() {
    for (const d of [...document.querySelectorAll('dialog[open]')].reverse()) {
      const v = [...d.querySelectorAll('video')].find((x) => (x.currentSrc || x.srcObject) && x.offsetParent !== null);
      if (v) return v;
    }
    return null;
  }
  const viewerOpen = () => document.getElementById('dlg-viewer')?.open ? document.getElementById('dlg-viewer') : null;
  function state() {
    if (show) return { mode: 'slides', page: show.at + 1, pages: show.pages, black: !!show.black, title: String(show.title || '').slice(0, 120) };
    const v = video();
    if (v && !v.srcObject) return { mode: 'video', playing: !v.paused, t: Math.floor(v.currentTime || 0), d: isFinite(v.duration) ? Math.floor(v.duration) : 0 };
    const viewer = viewerOpen();
    if (viewer) return { mode: 'photos', text: $('.viewer-name', viewer)?.textContent || '' };
    if (IS_TV && window.Tv) return { mode: 'tv' };
    return { mode: 'none' };
  }
  function tellAll() {
    for (const p of controllers) {
      if (peers.get(p.info.id) !== p) { controllers.delete(p); continue; }
      try { p.sendJson({ t: 'rc-state', state: state() }); } catch {}
    }
  }
  async function onCmd(peer, msg) {
    const a = String(msg.a || '').slice(0, 10);
    if (!(await allowed(peer))) {
      try { peer.sendJson({ t: 'rc-state', state: { mode: 'denied' } }); } catch {}
      return;
    }
    controllers.add(peer);
    if (show) {
      if (a === 'play') act('next');
      else if (a === 'back' || a === 'fwd') act(a === 'back' ? 'prev' : 'next');
      else act(a);
    } else {
      const v = video();
      const viewer = viewerOpen();
      if (v && !v.srcObject && ['play', 'back', 'fwd'].includes(a)) {
        if (a === 'play') { if (v.paused) v.play().catch(() => {}); else v.pause(); }
        else v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + (a === 'fwd' ? 10 : -10)));
      } else if (viewer && (a === 'next' || a === 'prev')) {
        $(`[data-act=${a}]`, viewer)?.click();
      } else if (v && !v.srcObject && (a === 'next' || a === 'prev')) {
        v.currentTime = Math.max(0, v.currentTime + (a === 'next' ? 10 : -10));
      } else if (a !== 'hi') {
        toast(t('{name} pressed the remote: open slides (⋯ → Present slides) or a video in OmniBeam to work them from there.', { name: peer.info.name }), 5000);
      }
    }
    setTimeout(() => { try { peer.sendJson({ t: 'rc-state', state: state() }); } catch {} }, 120);
  }

  // ---------- The remote, on a phone ----------
  let rc = null; // { peer, dlg, st, timer }
  function remote(peer) {
    addStyle();
    let dlg = document.getElementById('dlg-remote');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-remote';
      dlg.className = 'remote-dialog';
      dlg.setAttribute('aria-labelledby', 'rc-title');
      dlg.innerHTML = `<h3 id="rc-title"></h3><p class="rc-state" role="status"></p>
        <div class="rc-big">
          <button type="button" class="btn ghost" data-rc="prev">${ICON.prev}<span>${esc(t('Back'))}</span></button>
          <button type="button" class="btn" data-rc="next">${ICON.next}<span>${esc(t('Next'))}</span></button>
        </div>
        <div class="rc-row">
          <button type="button" class="btn ghost" data-rc="back">${ICON.back}<span>10 s</span></button>
          <button type="button" class="btn ghost" data-rc="play">${ICON.play}<span>${esc(t('Play'))}</span></button>
          <button type="button" class="btn ghost" data-rc="fwd">${ICON.fwd}<span>10 s</span></button>
          <button type="button" class="btn ghost" data-rc="black" aria-pressed="false">${ICON.black}<span>${esc(t('Black'))}</span></button>
        </div>
        <button type="button" class="btn ghost rc-send" data-rc="send">${esc(t('Show slides from this phone'))}</button>
        <div class="row"><button type="button" class="btn ghost" data-rc="close">${esc(t('Close'))}</button></div>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => {
        const a = e.target.closest('[data-rc]')?.dataset.rc;
        if (!a || !rc) return;
        if (a === 'close') return dlg.close();
        if (peers.get(rc.peer.info.id) !== rc.peer) return toast(t('{name} is no longer available', { name: rc.peer.info.name }));
        if (a === 'send') {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/pdf,.pdf,image/*';
          input.multiple = true;
          input.onchange = () => { if (input.files.length) rc.peer.sendFiles([...input.files], { present: true }); };
          return input.click();
        }
        navigator.vibrate?.(12);
        tell(a);
      });
      dlg.addEventListener('close', () => { if (rc) clearInterval(rc.timer); rc = null; });
    }
    rc = { peer, dlg, st: null, timer: setInterval(() => { if (rc && rc.st?.mode === 'video' && !document.hidden) tell('hi'); }, 2000) };
    $('#rc-title').textContent = t('Remote control · {name}', { name: peer.info.name });
    paintRemote();
    if (!dlg.open) dlg.showModal();
    tell('hi');
  }
  async function tell(a) {
    const p = rc?.peer;
    if (!p) return;
    try {
      await p.connect();
      p.sendJson({ t: 'rc', a });
    } catch (err) { toast(t(err.message)); }
  }
  function paintRemote() {
    if (!rc) return;
    const st = rc.st;
    const name = rc.peer.info.name;
    const line = $('.rc-state', rc.dlg);
    line.textContent = !st ? t('Connecting…')
      : st.mode === 'denied' ? t('{name} did not allow the remote.', { name })
        : st.mode === 'asking' ? t('Waiting for {names} to accept…', { names: name })
        : st.mode === 'slides' ? t('Slide {n} of {total}', { n: st.page, total: st.pages }) + (st.black ? ' · ' + t('Black screen') : '')
          : st.mode === 'video' ? `${st.playing ? '▶' : '⏸'} ${clock(st.t)} / ${clock(st.d)}`
            : st.mode === 'photos' ? st.text
              : t('Open slides (⋯ → Present slides) or a video in OmniBeam on {name}, or show slides from this phone.', { name });
    $('[data-rc=black]', rc.dlg).setAttribute('aria-pressed', String(!!st?.black));
    const playLabel = st?.mode === 'video' && st.playing ? t('Pause') : t('Play');
    $('[data-rc=play] span', rc.dlg).textContent = playLabel;
  }
  function onState(peer, st) {
    if (!rc || rc.peer !== peer || !st || typeof st !== 'object') return;
    rc.st = st;
    paintRemote();
  }
  // TV mode's own remote (tv.js) while slides show on the TV
  function tvKey(c) {
    if (!show) return false;
    if (c === 'next' || c === 'pause') act('next');
    else if (c === 'prev') act('prev');
    else if (c === 'home' || c === 'wall') show.dlg.close();
    else return false;
    return true;
  }

  window.Remote = { present, pick, onCmd, onState, open: remote, tvKey, presenting: () => !!show };
})();
