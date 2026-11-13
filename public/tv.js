'use strict';
// ---------- TV mode (omnibeam.site/tv) ----------
// Loaded after app.js, only on the TV page (server.js tvPage adds it), and on a phone when it opens the TV remote.
// It uses app.js's helpers ($, t, peers, qrPair, startQrPair, History…), which are shared between the two scripts.
//
// For a smart TV's browser: no sending, just a big QR code. A phone scans it with its camera, which opens OmniBeam
// there and pairs it with the TV (the one-tap QR pairing); then the phone taps the TV and picks photos. Phones on the
// same Wi-Fi see the TV without scanning. Paired devices' files are accepted by themselves. Each QR code pairs one
// phone, so a new one appears right after each pairing.
//
// What the TV does with what arrives:
// - Photos and videos: a full-screen slideshow (new ones show at once), and a photo wall (a grid of everything).
// - iPhone photos (HEIC): shown when the TV's browser can read them, else a card that says how to send them.
// - Music: plays in the background, with a "now playing" bar on the home screen and in the slideshow.
// - Messages: shown big on screen; a link also as a QR code, so people in the room can open it on their phones.
// Received files are in the TV's received-files history (Keep history), so a reload brings the slideshow back.
// Clear photos removes them.
//
// The remote: arrows move between the buttons, OK chooses, Back goes back (slideshow -> photo wall -> home).
// Slideshow: ◀ ▶ photos, OK pause, ▲ ▼ previous / next. Video: ◀ ▶ skip 10 s, OK pause, ▲ ▼ previous / next.
// A phone the TV knows (paired, or whose files it took) can also be the remote (TvRemote below).
// After a few quiet minutes on the home screen, a clock screen saver that moves slowly (no burn-in) with the QR code.
(function () {
  const PHOTO_MS = 8000;
  const MAX_SLIDES = 60; // TVs have little memory: older slides are let go
  const MAX_SONGS = 30;
  const SET_KEY = 'omnibeam-tv-show';
  const SPEEDS = [5, 8, 15, 30];
  const SAVERS = [2, 5, 15, 0]; // minutes; 0: off
  const BACK_CODES = [10009, 461]; // Back on Samsung (10009) and LG (461) remotes
  const isBack = (e) => ['Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(e.key) || BACK_CODES.includes(e.keyCode);
  const isOk = (e) => e.key === 'Enter' || e.key === ' ';
  const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const kindOf = (f) => {
    const type = (typeof mediaType === 'function' && mediaType(f)) || f.mime || '';
    if (/^image\/hei[cf]/i.test(type) || /\.(heic|heif)$/i.test(f.name || '')) return 'heic';
    if (/^image\//.test(type)) return 'image';
    if (/^video\//.test(type)) return 'video';
    if (/^audio\//.test(f.mime || '') || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(f.name || '')) return 'audio';
    return '';
  };
  const clock = (s) => {
    if (!isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };
  const baseName = (name) => String(name || '').split('/').pop().replace(/\.[^.]+$/, '');
  const lang = () => (window.I18N && window.I18N.lang) || document.documentElement.lang || 'en';

  // Move the focus to the nearest button in that direction (TV remotes have arrows, not Tab)
  function moveFocus(root, dir) {
    const items = [...root.querySelectorAll('button, a[href], input, select, [tabindex="0"]')]
      .filter((el) => !el.disabled && el.offsetParent !== null && el.getClientRects().length);
    if (!items.length) return false;
    const cur = document.activeElement;
    if (!items.includes(cur)) { items[0].focus(); return true; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      // Along the direction (must be ahead) and across it. Buttons in the same row (or column) come first.
      const along = { left: -dx, right: dx, up: -dy, down: dy }[dir];
      const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 1) continue;
      const sameLine = dir === 'left' || dir === 'right' ? b.top < a.bottom && b.bottom > a.top : b.left < a.right && b.right > a.left;
      const score = (sameLine ? 0 : 1e5) + along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  const Tv = {
    slides: [], // { url, kind: image | video | heic, from, hid (history id), thumb? }
    songs: [], // { url, name, from, hid }
    at: 0, song: -1, timer: null, paused: false, view: 'home', started: false,
    remotes: new Set(), // peers that opened the phone remote: they hear about changes
    known: new WeakSet(), // peers whose files or messages this TV took: they may use the remote
    greeted: new WeakSet(),
    lastActive: Date.now(),
    set: (() => {
      const def = { speed: 8, order: 'order', fade: true, zoom: false, saver: 2 };
      try { return { ...def, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch { return def; }
    })(),

    start() {
      if (this.started) return;
      this.started = true;
      document.title = `${t('TV mode')} · OmniBeam`;
      $('#tv').hidden = false;
      this.build();
      keepAwake('tv', true);
      startQrPair();
      $('#tv-host').textContent = location.host;
      $('#tv-name').onclick = openMeDialog;
      $('#tv-full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())?.catch?.(() => {});
      $('#tv-photos').onclick = () => this.show(this.at);
      $('#tv-pin').onclick = () => this.setPin();
      $('#tv-wall-btn').onclick = () => this.openWall();
      $('#tv-set-btn').onclick = () => this.openSettings();
      $('#tv-clear').onclick = () => this.clearAll();
      this.pinNote();
      $('#tv-shut').onclick = () => this.back();
      setInterval(() => this.status(), 500);
      setInterval(() => this.saverTick(), 1000);
      document.addEventListener('keydown', (e) => this.key(e), true);
      // The press that closed a message (or woke the screen) must not also press the button under it
      document.addEventListener('click', (e) => {
        if (Date.now() - Math.max(this.noteClosed || 0, this.saverClosed || 0) < 500 && !e.target.closest('#tv-note, #tv-saver')) { e.preventDefault(); e.stopPropagation(); }
      }, true);
      for (const ev of ['pointerdown', 'mousemove', 'wheel', 'touchstart']) document.addEventListener(ev, () => this.active(), { passive: true });
      $('#tv-show').addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const x = e.clientX / innerWidth;
        if (x < 0.25) this.step(-1);
        else if (x > 0.75) this.step(1);
        else this.togglePause();
      });
      this.restore();
      // The remote's first press should land on something
      // (without scrolling: on a short TV screen that pushed the title up under the top bar)
      setTimeout(() => { if (!document.querySelector('dialog[open]')) ($('#tv-photos').hidden ? $('#tv-full') : $('#tv-photos')).focus({ preventScroll: true }); }, 500);
    },

    // The parts app.js doesn't have in index.html (made here, so the page everyone else loads stays small)
    build() {
      const buttons = $('#tv .tv-buttons');
      buttons.insertAdjacentHTML('beforeend', `
        <button type="button" class="btn ghost" id="tv-wall-btn" hidden>▦ ${esc(t('Photo wall'))}</button>
        <button type="button" class="btn ghost" id="tv-set-btn">${esc(t('Slideshow settings'))}</button>
        <button type="button" class="btn ghost" id="tv-clear" hidden>${esc(t('Clear photos'))}</button>`);
      // Put the slideshow and wall buttons first: they are what the remote wants most
      buttons.prepend($('#tv-wall-btn'));
      buttons.prepend($('#tv-photos'));
      $('#tv .tv-text').insertAdjacentHTML('beforeend', `
        <div class="tv-music" id="tv-music" hidden>
          <span class="tv-music-title">♪ <b></b> <span></span></span>
          <button type="button" class="btn ghost" id="tv-music-play"></button>
          <button type="button" class="btn ghost" id="tv-music-next">⏭ ${esc(t('Next song'))}</button>
          <audio id="tv-audio" preload="auto"></audio>
        </div>
        <p class="tv-remote-tip">${esc(t('Tip: on a phone paired with this TV, tap the TV and then Remote to work the slideshow from the phone.'))}</p>`);
      // The slideshow covers the whole page, top bar too (inside <main> it stayed under the top bar)
      document.body.appendChild($('#tv-show'));
      // The slideshow: the photo before fades out on its own layer, a bar for videos, and a hint line
      $('#tv-show').insertAdjacentHTML('afterbegin', '<div class="tv-stage tv-prev" id="tv-prev" aria-hidden="true"></div>');
      $('#tv-show').insertAdjacentHTML('beforeend', `
        <div class="tv-bar" id="tv-bar" hidden><div class="tv-bar-track"><span></span></div><b class="tv-bar-time"></b></div>
        <p class="tv-caption tv-hint" id="tv-hint"></p>
        <p class="tv-caption tv-song" id="tv-song" hidden></p>`);
      document.body.insertAdjacentHTML('beforeend', `
        <div id="tv-wall" class="tv-wall" hidden role="region" aria-label="${esc(t('Photo wall'))}">
          <div class="tv-wall-top">
            <h2 class="tv-wall-title"></h2>
            <button type="button" class="btn" id="tv-wall-play">▶ ${esc(t('Slideshow'))}</button>
            <button type="button" class="btn ghost" id="tv-wall-home">${esc(t('Back to the QR code'))}</button>
          </div>
          <div class="tv-grid" id="tv-grid"></div>
        </div>
        <div id="tv-note" class="tv-note" hidden role="alert">
          <div class="tv-note-card">
            <p class="tv-note-from"></p>
            <p class="tv-note-text"></p>
            <div class="tv-note-qr" hidden></div>
            <p class="tv-note-link" hidden></p>
            <p class="tv-note-hint">${esc(t('OK or Back to close'))}</p>
          </div>
        </div>
        <div id="tv-saver" class="tv-saver" hidden aria-hidden="true">
          <div class="tv-saver-box">
            <p class="tv-saver-time"></p>
            <p class="tv-saver-date"></p>
            <p class="tv-saver-song" hidden></p>
            <div class="tv-saver-qr"></div>
            <p class="tv-saver-tip">${esc(t('Scan to send photos to this TV'))}</p>
          </div>
        </div>
        <dialog id="dlg-tv-set" class="tv-set" aria-labelledby="tv-set-title">
          <h2 id="tv-set-title">${esc(t('Slideshow settings'))}</h2>
          <div class="tv-set-rows"></div>
          <div class="row"><button type="button" class="btn" data-act="close">${esc(t('Done'))}</button></div>
        </dialog>`);
      $('#tv-wall-play').onclick = () => this.show(this.at);
      $('#tv-wall-home').onclick = () => this.home();
      $('#tv-grid').addEventListener('click', (e) => {
        const tile = e.target.closest('[data-i]');
        if (tile) this.show(Number(tile.dataset.i));
      });
      $('#tv-note').onclick = () => this.closeNote();
      $('#tv-saver').onclick = () => this.active();
      const audio = $('#tv-audio');
      audio.onended = () => this.playSong(this.song + 1);
      audio.onerror = () => { if (this.songs.length > 1) this.playSong(this.song + 1); };
      audio.onplay = audio.onpause = () => { this.paintMusic(); this.tell(); };
      $('#tv-music-play').onclick = () => this.toggleMusic();
      $('#tv-music-next').onclick = () => this.playSong(this.song + 1);
      const dlg = $('#dlg-tv-set');
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.act === 'close') return dlg.close();
        const k = b.dataset.k;
        let v = b.dataset.v;
        if (k === 'speed' || k === 'saver') v = Number(v);
        if (k === 'fade' || k === 'zoom') v = v === '1';
        this.set[k] = v;
        try { localStorage.setItem(SET_KEY, JSON.stringify(this.set)); } catch {}
        this.paintSettings();
        b.focus({ preventScroll: true });
        if (this.view === 'show') this.schedule();
      });
      dlg.addEventListener('close', () => $('#tv-set-btn').focus({ preventScroll: true }));
    },

    drawQr() {
      if (!qrPair) { startQrPair(); return; } // a phone just used it, or it ran out: show a new one
      const box = $('#tv-qr');
      if (!box) return;
      const link = qrPairLink();
      if (box.dataset.link === link) return;
      if (typeof qrcode === 'function') {
        try {
          const qr = qrcode(0, 'M');
          qr.addData(link);
          qr.make();
          box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
          box.dataset.link = link;
          return;
        } catch {}
      }
      // qrcode.js didn't load (seen on an Android TV browser: slow Wi-Fi at start-up, or its own ad blocker). Before,
      // one failed try left the box empty for good. Now: try again every few seconds, and meanwhile let the server draw it.
      if (this.qrBusy || Date.now() < (this.qrNext || 0)) return;
      this.qrBusy = true;
      this.qrNext = Date.now() + 5000;
      const wait = (ms) => new Promise((resolve, reject) => setTimeout(reject, ms));
      const fromServer = () => fetch('/api/qr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ d: link }) })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
        .then((svg) => {
          if (/^<svg[\s>]/.test(svg) && qrPair && qrPairLink() === link && box.dataset.link !== link) {
            box.innerHTML = svg;
            box.dataset.link = link;
          }
        });
      Promise.race([loadQr(), wait(6000)])
        .catch(() => fromServer())
        .catch(() => {})
        .then(() => { this.qrBusy = false; this.drawQr(); });
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
      if (p) this.active(); // no screen saver while something arrives
      const n = this.slides.length;
      $('#tv-photos').hidden = !n;
      $('#tv-photos span').textContent = t('Show photos ({n})', { n });
      $('#tv-wall-btn').hidden = !n;
      $('#tv-clear').hidden = !n && !this.songs.length;
      // Paired phones here learn that this is a TV, so they offer the remote (once per connection)
      for (const peer of peers.values()) {
        if (!peer.pairSecret || this.greeted.has(peer)) continue;
        this.greeted.add(peer);
        setTimeout(() => this.hello(peer), 2000);
      }
    },
    hello(peer) {
      if (peers.get(peer.info.id) !== peer) return;
      peer.connect().then(() => peer.sendJson({ t: 'tv-hi', state: this.state() })).catch(() => {});
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

    // ----- What arrives -----
    received(peer, files, quiet) {
      if (!quiet) {
        chime();
        this.known.add(peer);
        this.active();
        this.hello(peer);
      }
      const from = peer.info ? peer.info.name : peer.name;
      const media = [];
      const songs = [];
      let other = 0;
      for (const f of files) {
        const kind = f.blob ? kindOf(f) : '';
        if (kind === 'audio') songs.push(f);
        else if (kind) media.push({ f, kind });
        else other++;
      }
      if (other && !quiet) toast(t('Other files received: {n}. TV mode shows photos, videos and music; the rest are kept in Received files.', { n: other }), 6000);
      if (songs.length) this.addSongs(songs, from, quiet);
      if (!media.length) return;
      const first = this.slides.length;
      for (const { f, kind } of media) {
        const s = { url: URL.createObjectURL(f.blob), kind, from, hid: f.id || null };
        this.slides.push(s);
        if (kind === 'heic') this.checkHeic(s);
      }
      let start = first;
      while (this.slides.length > MAX_SLIDES) {
        this.drop(this.slides.shift());
        start--;
        if (this.at > 0) this.at--;
      }
      if (this.view === 'wall') this.paintWall();
      if (!quiet) this.show(Math.max(0, start)); // new photos show at once
      this.makeThumbs();
    },
    drop(s) {
      URL.revokeObjectURL(s.url);
      if (s.thumb && s.thumb !== s.url) URL.revokeObjectURL(s.thumb);
    },
    // A reload brings back what the received-files history still has (Keep history): newest last, like it arrived
    async restore() {
      await Store.ready; // the history is read once storage is ready (app.js: Store.init().then(History.load))
      History.sync();
      const items = History.items.filter((f) => f.id && kindOf(f)).slice(0, MAX_SLIDES + MAX_SONGS).reverse();
      if (!items.length) return;
      const byFrom = [];
      for (const item of items) {
        let blob = null;
        try { blob = await History.blobOf(item); } catch {}
        if (blob) byFrom.push({ from: item.from || '', file: { id: item.id, name: item.name, mime: item.mime, blob } });
      }
      for (const { from, file } of byFrom) this.received({ name: from }, [file], true);
      if (byFrom.length) toast(t('{n} photos and songs from before are back. Clear photos removes them.', { n: byFrom.length }), 5000);
    },
    clearAll() {
      if (!confirm(t('Remove every photo, video and song from this TV?'))) return;
      const ids = new Set([...this.slides, ...this.songs].map((s) => s.hid).filter(Boolean));
      for (const item of History.items.filter((f) => ids.has(f.id))) History.remove(item);
      this.home();
      for (const s of this.slides) this.drop(s);
      for (const s of this.songs) URL.revokeObjectURL(s.url);
      this.slides = [];
      this.songs = [];
      this.song = -1;
      this.at = 0;
      const audio = $('#tv-audio');
      audio.pause();
      audio.removeAttribute('src');
      this.paintMusic();
      this.status();
      $('#tv-full').focus({ preventScroll: true });
      toast(t('Cleared.'));
      this.tell();
    },

    // iPhone photos: most TV browsers can't read HEIC. Try; if not, the slide says how to send them instead.
    // (iPhones sending with OmniBeam turn them into JPG first; HEIC files only come as is from other devices.)
    checkHeic(s) {
      const img = new Image();
      img.onload = () => { s.kind = 'image'; if (this.view === 'show' && this.slides[this.at] === s) this.show(this.at); };
      img.onerror = () => { s.kind = 'heic-no'; if (this.view === 'show' && this.slides[this.at] === s) this.show(this.at); if (this.view === 'wall') this.paintWall(); };
      img.src = s.url;
    },

    // Small pictures for the photo wall, one at a time (a TV has little memory for 60 full-size photos)
    async makeThumbs() {
      if (this.thumbing) return;
      this.thumbing = true;
      try {
        for (;;) {
          const s = this.slides.find((x) => !x.thumb && (x.kind === 'image' || x.kind === 'video'));
          if (!s) break;
          s.thumb = (await this.thumbOf(s).catch(() => null)) || (s.kind === 'image' ? s.url : 'none');
          if (this.view === 'wall') this.paintTile(s);
        }
      } finally { this.thumbing = false; }
    },
    thumbOf(s) {
      return new Promise((resolve) => {
        const done = (el, w, h) => {
          try {
            const scale = Math.min(1, 480 / Math.max(w, h));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w * scale));
            c.height = Math.max(1, Math.round(h * scale));
            c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
            c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.8);
          } catch { resolve(null); }
        };
        setTimeout(() => resolve(null), 8000);
        if (s.kind === 'image') {
          const img = new Image();
          img.onload = () => done(img, img.naturalWidth, img.naturalHeight);
          img.onerror = () => resolve(null);
          img.src = s.url;
        } else {
          const v = document.createElement('video');
          v.muted = true;
          v.preload = 'auto';
          v.playsInline = true;
          v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 4); };
          v.onseeked = () => { done(v, v.videoWidth, v.videoHeight); v.removeAttribute('src'); v.load(); };
          v.onerror = () => resolve(null);
          v.src = s.url;
        }
      });
    },

    // ----- Slideshow -----
    show(i) {
      if (!this.slides.length) return this.home();
      this.closeNote();
      this.at = ((i % this.slides.length) + this.slides.length) % this.slides.length;
      this.view = 'show';
      const box = $('#tv-show');
      box.hidden = false;
      $('#tv-wall').hidden = true;
      clearTimeout(this.timer);
      const s = this.slides[this.at];
      const stage = $('#tv-stage');
      const prev = $('#tv-prev');
      // The slide before fades out on its own layer (and is gone a moment later)
      for (const v of document.querySelectorAll('#tv-stage video, #tv-prev video')) v.pause();
      prev.innerHTML = '';
      const old = stage.firstElementChild;
      if (old && this.set.fade && old.tagName === 'IMG') {
        old.classList.add('out');
        prev.appendChild(old);
        setTimeout(() => { if (old.parentNode === prev) old.remove(); }, 1000);
      }
      stage.innerHTML = '';
      stage.classList.toggle('fade', !!this.set.fade);
      this.duck(false);
      this.mutedByTv = false;
      let el;
      if (s.kind === 'heic' || s.kind === 'heic-no') {
        el = document.createElement('div');
        el.className = 'tv-heic';
        el.innerHTML = `<p>📷 ${esc(t('An iPhone photo (HEIC) this TV can\'t show.'))}</p><p class="muted">${esc(t('Send it from the iPhone with OmniBeam (it becomes a JPG), or set the iPhone camera to Most Compatible.'))}</p>`;
        if (s.kind === 'heic-no' && !this.paused && this.slides.length > 1) this.timer = setTimeout(() => this.next(), 4000);
      } else if (s.kind === 'video') {
        el = document.createElement('video');
        el.src = s.url;
        el.playsInline = true;
        el.onended = () => this.next();
        el.onerror = () => this.next();
        el.ontimeupdate = () => this.paintBar();
        el.onloadedmetadata = () => this.paintBar();
        el.onplay = () => { this.duck(!el.muted); this.tell(); };
        el.onpause = () => this.tell();
        el.onvolumechange = () => { this.duck(!el.muted && !el.paused); this.caption(); this.tell(); };
        // With sound if the TV allows it, otherwise muted (OK then turns the sound on)
        if (!this.paused) {
          el.play().catch(() => {
            el.muted = true;
            this.mutedByTv = true;
            this.caption();
            el.play().catch(() => {});
          });
        }
      } else {
        el = document.createElement('img');
        el.src = s.url;
        el.alt = '';
        el.onerror = () => this.schedule();
        if (this.set.zoom) {
          el.classList.add('kb');
          el.style.setProperty('--kb-time', `${this.set.speed + 2}s`);
          el.style.transformOrigin = `${[20, 50, 80][Math.floor(Math.random() * 3)]}% ${[25, 50, 75][Math.floor(Math.random() * 3)]}%`;
        }
        this.schedule();
      }
      stage.appendChild(el);
      $('#tv-bar').hidden = s.kind !== 'video';
      this.paintBar();
      this.caption();
      this.wake();
      this.tell();
    },
    current() { return $('#tv-stage').firstElementChild; },
    video() { const el = this.current(); return el && el.tagName === 'VIDEO' ? el : null; },
    caption() {
      const s = this.slides[this.at];
      if (!s) return;
      const v = this.video();
      const parts = [`${this.at + 1} / ${this.slides.length}`, t('from {name}', { name: s.from })];
      if (this.paused) parts.push(t('Paused'));
      if (v && v.muted) parts.push(`🔇 ${t('OK: sound on')}`);
      $('#tv-caption').textContent = parts.join(' · ');
      $('#tv-hint').textContent = v ? t('◀ ▶ skip 10 s · OK pause · ▲ ▼ previous / next · Back: photo wall')
        : t('◀ ▶ photos · OK pause · Back: photo wall');
      this.paintMusic();
    },
    // The caption and buttons show for a few seconds after each press, then hide
    wake() {
      const box = $('#tv-show');
      box.classList.remove('idle');
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => box.classList.add('idle'), 4000);
    },
    paintBar() {
      const v = this.video();
      if (!v) return;
      const pct = v.duration ? (v.currentTime / v.duration) * 100 : 0;
      $('#tv-bar span').style.width = `${pct}%`;
      $('.tv-bar-time').textContent = `${clock(v.currentTime)} / ${clock(v.duration)}`;
    },
    schedule() {
      clearTimeout(this.timer);
      const s = this.slides[this.at];
      if (this.paused || this.slides.length < 2 || !s || s.kind === 'video') return;
      this.timer = setTimeout(() => this.next(), (this.set.speed || PHOTO_MS / 1000) * 1000);
    },
    nextIndex(dir) {
      const n = this.slides.length;
      if (this.set.order === 'shuffle' && n > 2 && dir > 0) {
        let i;
        do i = Math.floor(Math.random() * n); while (i === this.at);
        return i;
      }
      return this.at + dir;
    },
    next() { if (this.view === 'show') this.show(this.nextIndex(1)); },
    step(dir) { if (this.view === 'show') this.show(dir > 0 ? this.nextIndex(1) : this.at - 1); },
    togglePause() {
      const v = this.video();
      // A video the TV started without sound: the first OK turns the sound on (a press lets it)
      if (v && v.muted && this.mutedByTv) {
        this.mutedByTv = false;
        v.muted = false;
        v.play().catch(() => {});
        this.caption();
        this.wake();
        return;
      }
      this.paused = !this.paused;
      if (v) this.paused ? v.pause() : v.play().catch(() => {});
      else this.schedule();
      this.caption();
      this.wake();
      this.tell();
    },
    seek(secs) {
      const v = this.video();
      if (!v) return;
      v.currentTime = Math.max(0, Math.min((v.duration || 0) - 0.1, v.currentTime + secs));
      this.paintBar();
      this.wake();
    },
    mute() {
      const v = this.video();
      if (v) { v.muted = !v.muted; this.mutedByTv = false; if (!v.muted) v.play().catch(() => {}); }
      else this.toggleMusic();
      this.caption();
      this.wake();
    },
    volume(d) {
      const v = this.video() || ($('#tv-audio').src ? $('#tv-audio') : null);
      if (!v) return;
      v.volume = Math.max(0, Math.min(1, Math.round((v.volume + d) * 10) / 10));
      v.muted = false;
      toast(`🔊 ${Math.round(v.volume * 100)}%`, 1200);
    },

    // ----- Views: home (QR code) <- photo wall <- slideshow -----
    stopShow() {
      clearTimeout(this.timer);
      for (const v of document.querySelectorAll('#tv-stage video, #tv-prev video')) v.pause();
      $('#tv-stage').innerHTML = '';
      $('#tv-prev').innerHTML = '';
      $('#tv-show').hidden = true;
      this.duck(false);
    },
    openWall() {
      if (!this.slides.length) return this.home();
      this.stopShow();
      this.view = 'wall';
      $('#tv-wall').hidden = false;
      this.paintWall();
      const tile = $(`#tv-grid [data-i="${this.at}"]`) || $('#tv-wall-play');
      tile.focus({ preventScroll: true });
      tile.scrollIntoView({ block: 'nearest' });
      this.tell();
    },
    paintWall() {
      $('.tv-wall-title').textContent = `${t('Photo wall')} · ${this.slides.length}`;
      const grid = $('#tv-grid');
      const had = document.activeElement && grid.contains(document.activeElement) ? document.activeElement.dataset.i : null;
      grid.innerHTML = this.slides.map((s, i) => `<button type="button" class="tv-tile${s.kind === 'video' ? ' is-video' : ''}" data-i="${i}" aria-label="${esc(`${i + 1} / ${this.slides.length} · ${t('from {name}', { name: s.from })}`)}"><span class="tv-tile-from">${esc(s.from)}</span></button>`).join('');
      this.slides.forEach((s) => this.paintTile(s));
      if (had !== null) grid.querySelector(`[data-i="${had}"]`)?.focus({ preventScroll: true });
    },
    paintTile(s) {
      const i = this.slides.indexOf(s);
      const tile = $(`#tv-grid [data-i="${i}"]`);
      if (!tile) return;
      tile.querySelector('img')?.remove();
      if (s.kind === 'heic' || s.kind === 'heic-no') tile.classList.add('is-heic');
      else if (s.thumb && s.thumb !== 'none') {
        const img = document.createElement('img');
        img.src = s.thumb;
        img.alt = '';
        img.loading = 'lazy';
        tile.prepend(img);
      }
    },
    home() {
      this.stopShow();
      $('#tv-wall').hidden = true;
      this.view = 'home';
      const first = $('#tv-photos').hidden ? $('#tv-full') : $('#tv-photos');
      first.focus({ preventScroll: true });
      this.tell();
    },
    back() {
      if (this.view === 'show' && this.slides.length > 1) this.openWall();
      else this.home();
    },

    // ----- Music -----
    addSongs(files, from, quiet) {
      const wasEmpty = !this.songs.length;
      const first = this.songs.length;
      for (const f of files) this.songs.push({ url: URL.createObjectURL(f.blob), name: baseName(f.name), from, hid: f.id || null });
      while (this.songs.length > MAX_SONGS) { URL.revokeObjectURL(this.songs.shift().url); if (this.song > 0) this.song--; }
      const audio = $('#tv-audio');
      // New songs start at once if nothing is playing (not after a reload: the TV waits for a press)
      if (!quiet && (wasEmpty || audio.paused)) this.playSong(Math.min(first, this.songs.length - files.length));
      else if (quiet && this.song < 0) { this.song = 0; audio.src = this.songs[0].url; }
      this.paintMusic();
    },
    playSong(i) {
      if (!this.songs.length) return;
      this.song = ((i % this.songs.length) + this.songs.length) % this.songs.length;
      const audio = $('#tv-audio');
      audio.src = this.songs[this.song].url;
      this.musicWanted = true;
      if (!this.ducked) audio.play().catch(() => toast(t('Press OK on a music button to start the music (this TV blocked sound).'), 5000));
      this.paintMusic();
      this.tell();
    },
    toggleMusic() {
      const audio = $('#tv-audio');
      if (!this.songs.length) return;
      if (this.song < 0) return this.playSong(0);
      if (audio.paused) { this.musicWanted = true; audio.play().catch(() => {}); } else { this.musicWanted = false; audio.pause(); }
    },
    // A video with sound pauses the music; it continues after
    duck(on) {
      const audio = $('#tv-audio');
      if (!audio) return;
      if (on && !this.ducked) { this.ducked = true; if (!audio.paused) { this.musicWanted = true; audio.pause(); } }
      else if (!on && this.ducked) { this.ducked = false; if (this.musicWanted && audio.src) audio.play().catch(() => {}); }
    },
    paintMusic() {
      const audio = $('#tv-audio');
      const s = this.songs[this.song];
      const bar = $('#tv-music');
      bar.hidden = !s;
      $('#tv-song').hidden = !s;
      $('.tv-saver-song').hidden = !s;
      if (!s) return;
      const playing = !audio.paused;
      $('b', bar).textContent = s.name;
      $('.tv-music-title span', bar).textContent = `· ${t('from {name}', { name: s.from })}`;
      $('#tv-music-play').textContent = playing ? `⏸ ${t('Pause music')}` : `▶ ${t('Play music')}`;
      $('#tv-music-next').hidden = this.songs.length < 2;
      $('#tv-song').textContent = `♪ ${s.name}${playing ? '' : ` · ${t('Paused')}`}`;
      $('.tv-saver-song').textContent = `♪ ${s.name}`;
    },

    // ----- Messages: big on screen; a link also as a QR code to scan -----
    note(peer, text) {
      this.known.add(peer);
      this.hello(peer);
      chime();
      this.active();
      const box = $('#tv-note');
      const link = linkOnly(text);
      $('.tv-note-from', box).textContent = t('Message from {name}', { name: peer.info.name });
      const body = $('.tv-note-text', box);
      body.textContent = link ? '' : text;
      body.hidden = !!link;
      body.classList.toggle('long', text.length > 120);
      const qrBox = $('.tv-note-qr', box);
      const linkEl = $('.tv-note-link', box);
      qrBox.hidden = linkEl.hidden = !link;
      qrBox.innerHTML = '';
      if (link) {
        linkEl.textContent = link.length > 90 ? link.slice(0, 88) + '…' : link;
        $('.tv-note-from', box).textContent = t('Link from {name}: scan to open it on your phone', { name: peer.info.name });
        loadQr().then(() => {
          const qr = qrcode(0, 'M');
          qr.addData(link);
          qr.make();
          qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
        }).catch(() => { qrBox.hidden = true; });
      }
      // Over the slideshow too; it pauses meanwhile
      if (this.view === 'show') { clearTimeout(this.timer); this.video()?.pause(); }
      box.hidden = false;
      clearTimeout(this.noteTimer);
      this.noteTimer = setTimeout(() => this.closeNote(), link ? 120000 : 60000);
    },
    closeNote() {
      const box = $('#tv-note');
      if (!box || box.hidden) return false;
      box.hidden = true;
      this.noteClosed = Date.now();
      clearTimeout(this.noteTimer);
      if (this.view === 'show') { const v = this.video(); if (v && !this.paused) v.play().catch(() => {}); else this.schedule(); }
      return true;
    },

    // ----- Slideshow settings -----
    openSettings() {
      this.paintSettings();
      const dlg = $('#dlg-tv-set');
      if (!dlg.open) dlg.showModal();
      $('[aria-pressed="true"]', dlg)?.focus({ preventScroll: true });
    },
    paintSettings() {
      const row = (k, label, opts) => `<div class="tv-set-row" role="group" aria-label="${esc(label)}"><p>${esc(label)}</p><div class="tv-set-opts">${opts
        .map(([v, text]) => `<button type="button" class="btn ghost small" data-k="${k}" data-v="${v}" aria-pressed="${String(String(this.set[k] === true ? 1 : this.set[k] === false ? 0 : this.set[k]) === String(v))}">${esc(text)}</button>`).join('')}</div></div>`;
      $('#dlg-tv-set .tv-set-rows').innerHTML = [
        row('speed', t('Each photo shows for'), SPEEDS.map((s) => [s, t('{n} s', { n: s })])),
        row('order', t('Order'), [['order', t('As they arrived')], ['shuffle', t('Shuffle')]]),
        row('fade', t('Fade between photos'), [[1, t('On')], [0, t('Off')]]),
        row('zoom', t('Slow zoom on photos'), [[1, t('On')], [0, t('Off')]]),
        row('saver', t('Clock screen saver after'), SAVERS.map((m) => [m, m ? t('{n} min', { n: m }) : t('Off')])),
      ].join('');
    },

    // ----- Screen saver: a big clock that moves slowly, so nothing stays in one place on the screen -----
    active() {
      this.lastActive = Date.now();
      if (!$('#tv-saver') || $('#tv-saver').hidden) return false;
      $('#tv-saver').hidden = true;
      this.saverClosed = Date.now();
      return true;
    },
    saverTick() {
      const saver = $('#tv-saver');
      const mins = this.set.saver;
      if (saver.hidden) {
        const quiet = Date.now() - this.lastActive > mins * 60000;
        if (!mins || !quiet || this.view !== 'home' || document.querySelector('dialog[open]') || !$('#tv-note').hidden) return;
        saver.hidden = false;
        this.moved = 0;
      }
      const now = new Date();
      $('.tv-saver-time').textContent = now.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
      $('.tv-saver-date').textContent = now.toLocaleDateString(lang(), { weekday: 'long', day: 'numeric', month: 'long' });
      const qr = $('#tv-qr').innerHTML;
      if ($('.tv-saver-qr').dataset.qr !== $('#tv-qr').dataset.link) { $('.tv-saver-qr').innerHTML = qr; $('.tv-saver-qr').dataset.qr = $('#tv-qr').dataset.link || ''; }
      // A new place every 20 seconds
      if (Date.now() - (this.moved || 0) > 20000) {
        this.moved = Date.now();
        const box = $('.tv-saver-box');
        const x = Math.max(0, innerWidth - box.offsetWidth) * Math.random();
        const y = Math.max(0, innerHeight - box.offsetHeight) * Math.random();
        box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    },

    // ----- The remote (TV remote keys, and commands from a phone) -----
    key(e) {
      // The screen saver: any press only wakes the screen
      if (this.active()) { e.preventDefault(); e.stopPropagation(); return; }
      const dlg = document.querySelector('dialog[open]');
      if (dlg) {
        if (dlg.id === 'dlg-tv-set' && DIRS[e.key]) { e.preventDefault(); moveFocus(dlg, DIRS[e.key]); }
        else if (dlg.id === 'dlg-tv-set' && isBack(e) && e.key !== 'Escape') { e.preventDefault(); dlg.close(); }
        return;
      }
      if (!$('#tv-note').hidden && (isBack(e) || isOk(e))) { e.preventDefault(); e.stopPropagation(); this.closeNote(); return; }
      if (this.view === 'show') return this.showKey(e);
      if (this.view === 'wall') {
        if (isBack(e)) { e.preventDefault(); return this.home(); }
        if (DIRS[e.key]) { e.preventDefault(); moveFocus($('#tv-wall'), DIRS[e.key]); }
        return;
      }
      // Home: arrows move between the buttons (typing in a field is left alone)
      if (DIRS[e.key] && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
        e.preventDefault();
        moveFocus($('#tv'), DIRS[e.key]);
      }
    },
    showKey(e) {
      const v = this.video();
      const k = e.key;
      let done = true;
      if (isBack(e)) this.back();
      else if (k === 'ArrowRight' || k === 'FastForward' || k === 'MediaFastForward') v ? this.seek(10) : this.step(1);
      else if (k === 'ArrowLeft' || k === 'Rewind' || k === 'MediaRewind') v ? this.seek(-10) : this.step(-1);
      else if (k === 'ArrowDown' || k === 'MediaTrackNext' || k === 'ChannelDown') this.step(1);
      else if (k === 'ArrowUp' || k === 'MediaTrackPrevious' || k === 'ChannelUp') this.step(-1);
      else if (isOk(e) || ['MediaPlayPause', 'MediaPlay', 'MediaPause'].includes(k)) this.togglePause();
      else { done = false; this.wake(); } // any other key: show the caption again
      if (done) { e.preventDefault(); e.stopPropagation(); }
    },
    // What a phone remote shows
    state() {
      const v = this.video();
      const s = this.songs[this.song];
      return {
        view: this.view, at: this.at, n: this.slides.length, paused: this.paused,
        video: !!v, muted: !!(v && v.muted),
        music: s ? { name: s.name, playing: !$('#tv-audio').paused, n: this.songs.length } : null,
      };
    },
    // Tell the phones that have the remote open (a moment later, so several changes go as one)
    tell() {
      if (!this.remotes.size || this.telling) return;
      this.telling = setTimeout(() => {
        this.telling = null;
        const state = this.state();
        for (const p of this.remotes) {
          if (peers.get(p.info.id) !== p) { this.remotes.delete(p); continue; }
          try { p.sendJson({ t: 'tv-state', state }); } catch { this.remotes.delete(p); }
        }
      }, 150);
    },
    // Only phones this TV knows: paired with it, or whose files or messages it took
    command(peer, msg) {
      if (!peer.pairSecret && !this.known.has(peer)) return;
      this.remotes.add(peer);
      this.active();
      const c = String(msg.cmd || '');
      if (c !== 'hello' && c !== 'bye') this.closeNote();
      if (c === 'next') this.view === 'show' ? this.step(1) : this.show(this.at);
      else if (c === 'prev') this.view === 'show' ? this.step(-1) : this.show(this.at);
      else if (c === 'pause') this.view === 'show' ? this.togglePause() : this.show(this.at);
      else if (c === 'fwd') this.seek(10);
      else if (c === 'rew') this.seek(-10);
      else if (c === 'mute') this.mute();
      else if (c === 'vol+') this.volume(0.1);
      else if (c === 'vol-') this.volume(-0.1);
      else if (c === 'wall') this.openWall();
      else if (c === 'play') this.show(this.at);
      else if (c === 'home') this.home();
      else if (c === 'music') this.toggleMusic();
      else if (c === 'song') this.playSong(this.song + 1);
      else if (c === 'bye') this.remotes.delete(peer);
      if (c !== 'bye') { try { peer.sendJson({ t: 'tv-state', state: this.state() }); } catch {} }
    },
  };

  // ---------- The phone remote: on a phone, for a TV in TV mode (its card has a Remote button) ----------
  const TvRemote = {
    peer: null, st: null,
    async open(peer) {
      this.peer = peer;
      let dlg = $('#dlg-tv-remote');
      if (!dlg) {
        document.body.insertAdjacentHTML('beforeend', `
          <dialog id="dlg-tv-remote" class="tv-remote" aria-labelledby="tv-remote-title">
            <h2 id="tv-remote-title"></h2>
            <p class="muted tv-remote-now" role="status"></p>
            <div class="tv-remote-pad">
              <button type="button" class="btn ghost" data-cmd="prev" aria-label="${esc(t('Previous'))}">◀</button>
              <button type="button" class="btn" data-cmd="pause"></button>
              <button type="button" class="btn ghost" data-cmd="next" aria-label="${esc(t('Next'))}">▶</button>
            </div>
            <div class="tv-remote-pad tv-remote-video" hidden>
              <button type="button" class="btn ghost" data-cmd="rew">⏪ 10 s</button>
              <button type="button" class="btn ghost" data-cmd="mute"></button>
              <button type="button" class="btn ghost" data-cmd="fwd">10 s ⏩</button>
            </div>
            <div class="tv-remote-pad tv-remote-vol">
              <button type="button" class="btn ghost" data-cmd="vol-" aria-label="${esc(t('Quieter'))}">🔉</button>
              <button type="button" class="btn ghost" data-cmd="vol+" aria-label="${esc(t('Louder'))}">🔊</button>
            </div>
            <div class="tv-remote-row">
              <button type="button" class="btn ghost" data-cmd="play">▶ ${esc(t('Slideshow'))}</button>
              <button type="button" class="btn ghost" data-cmd="wall">▦ ${esc(t('Photo wall'))}</button>
              <button type="button" class="btn ghost" data-cmd="home">⌂ ${esc(t('QR code'))}</button>
            </div>
            <div class="tv-remote-row tv-remote-music" hidden>
              <span class="tv-remote-song"></span>
              <button type="button" class="btn ghost" data-cmd="music"></button>
              <button type="button" class="btn ghost" data-cmd="song">⏭ ${esc(t('Next song'))}</button>
            </div>
            <div class="row"><button type="button" class="btn" data-act="close">${esc(t('Close'))}</button></div>
          </dialog>`);
        dlg = $('#dlg-tv-remote');
        dlg.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.act === 'close') return dlg.close();
          if (b.dataset.cmd) this.send(b.dataset.cmd);
        });
        dlg.addEventListener('close', () => { if (this.peer) this.send('bye'); this.peer = null; });
      }
      $('#tv-remote-title', dlg).textContent = t('TV remote · {name}', { name: peer.info.name });
      this.paint(peer.tvState || null);
      if (!dlg.open) dlg.showModal();
      this.send('hello');
    },
    async send(cmd) {
      const peer = this.peer;
      if (!peer) return;
      if (peers.get(peer.info.id) !== peer) { toast(t('{name} is no longer available', { name: peer.info.name })); return $('#dlg-tv-remote').close(); }
      try {
        await peer.connect();
        peer.sendJson({ t: 'tv-cmd', cmd });
        if (navigator.vibrate && cmd !== 'hello' && cmd !== 'bye') navigator.vibrate(15);
      } catch (err) { toast(t(err.message)); }
    },
    state(peer, st) {
      peer.tvState = st;
      if (this.peer === peer) this.paint(st);
    },
    paint(st) {
      const dlg = $('#dlg-tv-remote');
      if (!dlg) return;
      const now = $('.tv-remote-now', dlg);
      if (!st) now.textContent = t('Connecting…');
      else if (st.view === 'show') now.textContent = `${st.video ? t('Video') : t('Photo')} ${st.at + 1} / ${st.n}${st.paused ? ` · ${t('Paused')}` : ''}`;
      else if (st.view === 'wall') now.textContent = `${t('Photo wall')} · ${st.n}`;
      else now.textContent = st.n ? t('The TV shows its QR code. {n} photos are ready.', { n: st.n }) : t('The TV shows its QR code. Send it photos first.');
      $('[data-cmd=pause]', dlg).textContent = st && st.view === 'show' && !st.paused ? `⏸ ${t('Pause')}` : `▶ ${t('Play')}`;
      $('.tv-remote-video', dlg).hidden = !(st && st.video);
      $('[data-cmd=mute]', dlg).textContent = st && st.muted ? `🔈 ${t('Sound on')}` : `🔇 ${t('Mute')}`;
      const music = st && st.music;
      $('.tv-remote-music', dlg).hidden = !music;
      if (music) {
        $('.tv-remote-song', dlg).textContent = `♪ ${music.name}`;
        $('[data-cmd=music]', dlg).textContent = music.playing ? `⏸ ${t('Pause music')}` : `▶ ${t('Play music')}`;
        $('[data-cmd=song]', dlg).hidden = music.n < 2;
      }
    },
  };

  window.Tv = Tv;
  window.TvRemote = TvRemote;
  if (IS_TV) Tv.start();
})();
