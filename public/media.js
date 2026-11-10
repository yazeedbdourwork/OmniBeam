// OmniBeam: camera, microphone and screen, loaded by app.js the first time one is used (see media() in app.js):
//   - Take a photo (or a document scan) and send it at once
//   - Voice notes: hold the button to record, let go to stop
//   - Share my screen with a device: a separate WebRTC connection that carries the video, set up through the
//     server's usual signalling ({screen: …} messages, see onScreenSignal). Nothing passes through the server
//     except, when no direct route exists, the TURN relay, which only sees encrypted media.
//   - Secret notes: shown once on the other device, never kept in its history
//   - Previews of received files: pictures, video, audio, PDF, text and code
// It uses app.js's helpers and state ($, t, toast, peers, me, wsSend, RTC_CONFIG, keepAwake…) directly.
'use strict';
(function () {
  const stat = (kind) => wsSend({ type: 'stat', kind });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
  };
  const stopStream = (s) => s && s.getTracks().forEach((tr) => tr.stop());
  // A dialog made on first use (its English text goes through t() so it shows in the page's language)
  function dialog(id, cls, html) {
    let dlg = document.getElementById(id);
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = id;
      dlg.className = cls;
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = html;
    return dlg;
  }
  const live = (peer) => peer && peers.get(peer.info.id) === peer;

  // ---------- Take a photo ----------
  // The camera opens inside the page; "Document" makes a sharp black-and-white scan of a page or whiteboard.
  // When the camera can't be opened here, the phone's own camera app is offered instead (a file input with capture).
  async function snapPhoto(peer) {
    let stream = null;
    let facing = 'environment';
    let shot = null; // the photo taken, as a Blob
    const dlg = dialog('dlg-camera', 'camera-dialog', `
      <h3>${esc(t('Take a photo for {name}', { name: peer.info.name }))}</h3>
      <div class="camera-stage">
        <video playsinline muted autoplay></video>
        <img alt="" hidden>
        <p class="camera-msg muted" hidden></p>
      </div>
      <label class="check camera-doc"><input type="checkbox" data-act="doc"> <span>${esc(t('Document scan (sharp black and white)'))}</span></label>
      <div class="row camera-live">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
        <button type="button" class="btn ghost" data-act="flip" hidden>${esc(t('Switch camera'))}</button>
        <button type="button" class="btn" data-act="snap">${esc(t('Take photo'))}</button>
      </div>
      <div class="row camera-done" hidden>
        <button type="button" class="btn ghost" data-act="retake">${esc(t('Retake'))}</button>
        <button type="button" class="btn" data-act="send">${esc(t('Send'))}</button>
      </div>
      <div class="row camera-fallback" hidden>
        <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
        <button type="button" class="btn" data-act="app">${esc(t('Use the camera app'))}</button>
      </div>`);
    const video = $('video', dlg);
    const img = $('img', dlg);
    const msg = $('.camera-msg', dlg);
    const show = (part) => {
      $('.camera-live', dlg).hidden = part !== 'live';
      $('.camera-done', dlg).hidden = part !== 'done';
      $('.camera-fallback', dlg).hidden = part !== 'fallback';
      video.hidden = part !== 'live';
      img.hidden = part !== 'done';
      msg.hidden = part !== 'fallback';
      $('.camera-doc', dlg).hidden = part === 'fallback';
    };
    const start = async () => {
      stopStream(stream);
      stream = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('none');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (!dlg.open) return stopStream(stream);
        video.srcObject = stream;
        await video.play().catch(() => {});
        show('live');
        const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
        $('[data-act=flip]', dlg).hidden = cams.length < 2;
      } catch (err) {
        msg.textContent = err && err.name === 'NotAllowedError'
          ? t('Camera access was not allowed. You can use the camera app instead, or allow the camera in the browser settings.')
          : t('The camera could not be opened here. You can use the camera app instead.');
        show('fallback');
      }
    };
    const close = () => {
      stopStream(stream);
      stream = null;
      if (img.src) URL.revokeObjectURL(img.src);
      img.removeAttribute('src');
      if (dlg.open) dlg.close();
    };
    dlg.onclose = () => { stopStream(stream); stream = null; };
    dlg.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'flip') { facing = facing === 'environment' ? 'user' : 'environment'; start(); }
      else if (act === 'snap') {
        if (!video.videoWidth) return;
        shot = await capture(video, $('[data-act=doc]', dlg).checked);
        if (!shot) return toast(t('Could not take the photo. Try again.'));
        if (img.src) URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(shot);
        show('done');
      }
      else if (act === 'retake') show('live');
      else if (act === 'send') {
        const doc = $('[data-act=doc]', dlg).checked;
        const file = new File([shot], `${doc ? t('Scan') : t('Photo')} ${stamp()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
        close();
        if (!live(peer)) return toast(t('{name} is no longer available', { name: peer.info.name }));
        stat('photo');
        peer.sendFiles([file]);
      }
      else if (act === 'app') {
        // The phone's camera app: the photo comes back like any picked file
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture', 'environment');
        input.onchange = () => {
          const files = [...input.files];
          if (files.length && live(peer)) { stat('photo'); peer.sendFiles(files); }
        };
        close();
        input.click();
      }
    };
    show('live');
    dlg.showModal();
    start();
  }
  // The current video frame as a JPEG. Document: grey, with strong contrast, so text and lines stand out.
  async function capture(video, doc) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: doc });
    ctx.drawImage(video, 0, 0);
    if (doc) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = data.data;
      // Stretch from the darkest to the brightest grey actually in the picture (ignoring the extreme 1%)
      const hist = new Uint32Array(256);
      for (let i = 0; i < px.length; i += 4) hist[(px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8]++;
      const total = px.length / 4;
      let lo = 0, hi = 255, acc = 0;
      while (lo < 254 && (acc += hist[lo]) < total * 0.01) lo++;
      acc = 0;
      while (hi > lo + 1 && (acc += hist[hi]) < total * 0.05) hi--;
      const range = Math.max(1, hi - lo);
      for (let i = 0; i < px.length; i += 4) {
        const g = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
        let v = ((g - lo) / range) * 255;
        v = v > 200 ? 255 : v < 40 ? 0 : (v - 40) * 1.6; // paper white, ink black
        px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, v));
      }
      ctx.putImageData(data, 0, 0);
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  }

  // ---------- Voice notes ----------
  // Hold the round button to record and let go to send-ready; a short tap starts it and a second tap stops it
  // (easier with a keyboard or for long notes). Up to 10 minutes. The microphone is off again as soon as it stops.
  const VOICE_MAX = 10 * 60 * 1000;
  const VOICE_TYPES = [['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm'], ['audio/webm', 'webm'], ['audio/ogg;codecs=opus', 'ogg']];
  function recordVoice(peer) {
    const dlg = dialog('dlg-voice', 'voice-dialog', `
      <h3>${esc(t('Voice note for {name}', { name: peer.info.name }))}</h3>
      <div class="voice-stage">
        <button type="button" class="voice-btn" aria-label="${esc(t('Record'))}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>
        </button>
        <div class="voice-time" aria-live="polite">0:00</div>
        <p class="muted small voice-hint">${esc(t('Hold to record, let go to stop. Or tap once to start and again to stop.'))}</p>
        <audio controls hidden></audio>
      </div>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
        <button type="button" class="btn ghost" data-act="again" hidden>${esc(t('Record again'))}</button>
        <button type="button" class="btn" data-act="send" hidden>${esc(t('Send'))}</button>
      </div>`);
    const btn = $('.voice-btn', dlg);
    const time = $('.voice-time', dlg);
    const hint = $('.voice-hint', dlg);
    const audio = $('audio', dlg);
    let state = 'idle'; // idle | starting | rec | done
    let stream = null, rec = null, chunks = [], recAt = 0, tapMode = false, released = false, timer = 0, note = null, type = VOICE_TYPES[0];
    const fmt = (ms) => `${Math.floor(ms / 60000)}:${pad(Math.floor(ms / 1000) % 60)}`;
    const setUi = () => {
      btn.classList.toggle('rec', state === 'rec');
      btn.setAttribute('aria-label', state === 'rec' ? t('Stop recording') : t('Record'));
      audio.hidden = state !== 'done';
      $('[data-act=send]', dlg).hidden = state !== 'done';
      $('[data-act=again]', dlg).hidden = state !== 'done';
      btn.hidden = state === 'done';
      hint.textContent = state === 'rec' && tapMode ? t('Recording… tap to stop.')
        : state === 'rec' ? t('Recording… let go to stop.')
        : state === 'done' ? t('Listen, then send it.')
        : t('Hold to record, let go to stop. Or tap once to start and again to stop.');
    };
    const cleanup = () => {
      clearInterval(timer);
      if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch {} }
      stopStream(stream);
      stream = rec = null;
      keepAwake('voice', false);
    };
    const start = async () => {
      state = 'starting';
      released = false;
      tapMode = false;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (err) {
        state = 'idle';
        setUi();
        return toast(err && err.name === 'NotAllowedError' ? t('Microphone access was not allowed') : t('The microphone could not be opened here'));
      }
      if (!dlg.open) return cleanup();
      type = VOICE_TYPES.find(([m]) => MediaRecorder.isTypeSupported?.(m)) || [ '', 'webm' ];
      chunks = [];
      try {
        rec = new MediaRecorder(stream, type[0] ? { mimeType: type[0], audioBitsPerSecond: 64000 } : {});
      } catch {
        rec = new MediaRecorder(stream);
      }
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const mime = (rec && rec.mimeType) || type[0] || 'audio/webm';
        note = new Blob(chunks, { type: mime.split(';')[0] });
        cleanup();
        if (audio.src) URL.revokeObjectURL(audio.src);
        audio.src = URL.createObjectURL(note);
        state = 'done';
        setUi();
      };
      rec.start(1000);
      recAt = Date.now();
      state = 'rec';
      keepAwake('voice', true);
      // Let go while the browser was still asking for the microphone: keep recording until the next tap
      if (released) tapMode = true;
      timer = setInterval(() => {
        const ms = Date.now() - recAt;
        time.textContent = fmt(ms);
        if (ms >= VOICE_MAX) stop();
      }, 250);
      setUi();
    };
    const stop = () => {
      if (state !== 'rec' || !rec) return;
      clearInterval(timer);
      if (Date.now() - recAt < 500) { // too short to be a note: start over
        rec.onstop = null;
        cleanup();
        state = 'idle';
        time.textContent = '0:00';
        setUi();
        return toast(t('Too short. Hold the button while you speak.'));
      }
      rec.stop();
    };
    btn.onpointerdown = (e) => {
      if (e.button) return;
      e.preventDefault();
      if (state === 'rec' && tapMode) return stop();
      if (state === 'idle') start();
    };
    btn.onpointerup = btn.onpointercancel = () => {
      if (state === 'starting') released = true;
      else if (state === 'rec' && !tapMode) {
        if (Date.now() - recAt < 700) { tapMode = true; setUi(); } // a short tap: keep recording
        else stop();
      }
    };
    btn.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (state === 'idle') { start().then(() => { tapMode = true; setUi(); }); } else if (state === 'rec') stop();
    };
    btn.oncontextmenu = (e) => e.preventDefault();
    dlg.onclose = () => { cleanup(); audio.pause(); if (audio.src) URL.revokeObjectURL(audio.src); };
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      if (act === 'again') { audio.pause(); state = 'idle'; time.textContent = '0:00'; setUi(); }
      if (act === 'send' && note) {
        const file = new File([note], `${t('Voice note')} ${stamp()}.${type[1]}`, { type: note.type, lastModified: Date.now() });
        dlg.close();
        if (!live(peer)) return toast(t('{name} is no longer available', { name: peer.info.name }));
        stat('voice');
        peer.sendFiles([file]);
      }
    };
    setUi();
    dlg.showModal();
    btn.focus();
  }

  // ---------- Share my screen ----------
  // The sharer asks ({t:'ask'}), the other device answers ({t:'yes'|'no'|'busy'}), then the sharer makes the offer
  // ({t:'sdp'}) and both exchange routes ({t:'ice'}). {t:'stop'} from either side ends it. sid tells apart the
  // shares that follow each other. One screen at a time is shared, to as many devices as wanted.
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const signal = (to, data) => wsSend({ type: 'signal', to, data: { screen: data } });
  let share = null; // this device's screen: { stream, viewers: Map(peerId -> { sid, name, pc, state, pending }) }
  let watch = null; // the screen this device is watching: { from, sid, name, pc, pending }
  const nameOf = (id) => peers.get(id)?.info.name || t('the other device');

  function newPc(to, sid, onState) {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (e) => { if (e.candidate) signal(to, { t: 'ice', sid, c: e.candidate }); };
    pc.onconnectionstatechange = () => onState(pc.connectionState);
    return pc;
  }
  async function addIce(entry, c) {
    if (!entry.pc) return;
    if (!entry.pc.remoteDescription) { (entry.pending ||= []).push(c); return; }
    try { await entry.pc.addIceCandidate(c); } catch {}
  }
  async function flushIce(entry) {
    for (const c of entry.pending || []) { try { await entry.pc.addIceCandidate(c); } catch {} }
    entry.pending = [];
  }

  async function shareScreen(peer) {
    if (!navigator.mediaDevices?.getDisplayMedia) return toast(t('This browser can\'t share its screen. Try Chrome, Edge or Firefox on a computer.'));
    if (share?.viewers.has(peer.info.id)) return toast(t('{name} is already watching your screen', { name: peer.info.name }));
    if (!share) {
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
      } catch {
        return toast(t('Screen sharing was cancelled'));
      }
      share = { stream, viewers: new Map() };
      stream.getVideoTracks()[0]?.addEventListener('ended', () => stopSharing());
      keepAwake('screen', true);
      stat('screen');
    }
    if (!live(peer)) return toast(t('{name} is no longer available', { name: peer.info.name }));
    const sid = randomId();
    share.viewers.set(peer.info.id, { sid, name: peer.info.name, pc: null, state: 'asking' });
    signal(peer.info.id, { t: 'ask', sid, name: me.name });
    renderShareBar();
    toast(t('Asking {name} to watch your screen…', { name: peer.info.name }));
    setTimeout(() => {
      const v = share?.viewers.get(peer.info.id);
      if (v && v.sid === sid && v.state === 'asking') {
        dropViewer(peer.info.id, true);
        toast(t('{name} didn\'t answer', { name: peer.info.name }));
      }
    }, 60000);
  }
  function dropViewer(id, tell) {
    const v = share?.viewers.get(id);
    if (!v) return;
    if (tell) signal(id, { t: 'stop', sid: v.sid });
    try { v.pc?.close(); } catch {}
    share.viewers.delete(id);
    if (!share.viewers.size) stopSharing();
    else renderShareBar();
  }
  function stopSharing() {
    if (!share) return;
    const s = share;
    share = null;
    for (const [id, v] of s.viewers) {
      signal(id, { t: 'stop', sid: v.sid });
      try { v.pc?.close(); } catch {}
    }
    stopStream(s.stream);
    keepAwake('screen', false);
    renderShareBar();
  }
  // The bar at the bottom while this screen is shared: who is watching, and Stop
  function renderShareBar() {
    let bar = document.getElementById('share-bar');
    if (!share) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'share-bar';
      bar.className = 'share-bar';
      bar.setAttribute('role', 'status');
      bar.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="share-who"></span><button type="button" class="btn small">${esc(t('Stop sharing'))}</button>`;
      $('button', bar).onclick = () => stopSharing();
      document.body.appendChild(bar);
    }
    const watching = [...share.viewers.values()].filter((v) => v.state === 'on').map((v) => v.name);
    const asking = [...share.viewers.values()].filter((v) => v.state !== 'on').map((v) => v.name);
    $('.share-who', bar).textContent = watching.length
      ? t('Sharing your screen with {names}', { names: watching.join(', ') })
      : t('Waiting for {names} to accept…', { names: asking.join(', ') });
  }

  // The window that shows another device's screen
  function viewer() {
    let dlg = document.getElementById('dlg-screen');
    if (dlg) return dlg;
    dlg = dialog('dlg-screen', 'screen-dialog', `
      <div class="screen-stage"><video playsinline autoplay></video><p class="screen-msg"></p></div>
      <div class="row screen-bar">
        <b class="screen-title"></b>
        <button type="button" class="btn ghost small" data-act="sound" hidden>${esc(t('Turn on sound'))}</button>
        <button type="button" class="btn ghost small" data-act="full">${esc(t('Full screen'))}</button>
        <button type="button" class="btn small" data-act="stop">${esc(t('Stop watching'))}</button>
      </div>`);
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const video = $('video', dlg);
      if (act === 'stop') dlg.close();
      if (act === 'full') (video.requestFullscreen || video.webkitEnterFullscreen || (() => {})).call(video)?.catch?.(() => {});
      if (act === 'sound') { video.muted = false; video.play().catch(() => {}); e.target.hidden = true; }
    };
    dlg.addEventListener('close', () => {
      if (watch) { signal(watch.from, { t: 'stop', sid: watch.sid }); endWatch(); }
    });
    return dlg;
  }
  function endWatch(message) {
    const w = watch;
    watch = null;
    if (w) try { w.pc?.close(); } catch {}
    keepAwake('watch', false);
    const dlg = document.getElementById('dlg-screen');
    if (dlg) {
      const video = $('video', dlg);
      video.srcObject = null;
      if (dlg.open) dlg.close();
    }
    if (message) toast(message);
  }
  function askToWatch(name) {
    const dlg = dialog('dlg-screen-ask', 'screen-ask', `
      <h3>${esc(t('{name} wants to show you their screen', { name }))}</h3>
      <p class="muted">${esc(t('You see it here, live. Nothing is recorded, and you can stop watching at any time.'))}</p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="no">${esc(t('No thanks'))}</button>
        <button type="button" class="btn" data-act="yes">${esc(t('Watch'))}</button>
      </div>`);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { dlg.onclose = null; if (dlg.open) dlg.close(); resolve(false); }, 55000);
      dlg.onclick = (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        clearTimeout(timer);
        dlg.onclose = null;
        dlg.close();
        resolve(act === 'yes');
      };
      dlg.onclose = () => { clearTimeout(timer); resolve(false); };
      dlg.showModal();
      chime();
      notify(t('{name} wants to show you their screen', { name }), t('Open OmniBeam to watch it.'));
    });
  }

  async function onScreenSignal(from, d) {
    const sid = typeof d.sid === 'string' ? d.sid.slice(0, 32) : '';
    if (!sid) return;
    // --- On the device that watches ---
    if (d.t === 'ask') {
      if (!peers.has(from)) return;
      if (watch) return signal(from, { t: 'busy', sid });
      const name = nameOf(from);
      watch = { from, sid, name, pc: null, asking: true };
      const yes = await askToWatch(name);
      if (!watch || watch.sid !== sid) return; // stopped while asking
      if (!yes) { watch = null; return signal(from, { t: 'no', sid }); }
      watch.asking = false;
      const dlg = viewer();
      const video = $('video', dlg);
      $('.screen-title', dlg).textContent = t('{name}\'s screen', { name });
      $('.screen-msg', dlg).textContent = t('Connecting…');
      $('.screen-msg', dlg).hidden = false;
      $('[data-act=sound]', dlg).hidden = true;
      const w = watch;
      w.pc = newPc(from, sid, (st) => {
        if (watch !== w) return;
        if (st === 'connected') $('.screen-msg', dlg).hidden = true;
        if (st === 'failed') endWatch(t('Could not connect to {name} to show the screen.', { name }));
      });
      w.pc.ontrack = (e) => {
        if (watch !== w) return;
        if (video.srcObject !== e.streams[0]) {
          video.srcObject = e.streams[0];
          video.muted = false;
          // Some browsers only play it without sound until the next tap
          video.play().catch(() => { video.muted = true; video.play().catch(() => {}); $('[data-act=sound]', dlg).hidden = false; });
        }
      };
      keepAwake('watch', true);
      dlg.showModal();
      return signal(from, { t: 'yes', sid });
    }
    if (watch && watch.from === from && watch.sid === sid) {
      if (d.t === 'sdp' && d.sdp?.type === 'offer' && watch.pc) {
        const w = watch;
        try {
          await w.pc.setRemoteDescription(d.sdp);
          await flushIce(w);
          await w.pc.setLocalDescription(await w.pc.createAnswer());
          signal(from, { t: 'sdp', sid, sdp: w.pc.localDescription });
        } catch {
          endWatch(t('Could not connect to {name} to show the screen.', { name: w.name }));
        }
        return;
      }
      if (d.t === 'ice' && d.c) return addIce(watch, d.c);
      if (d.t === 'stop') {
        if (watch.asking) { const dlg = document.getElementById('dlg-screen-ask'); watch = null; if (dlg?.open) dlg.close(); return; }
        return endWatch(t('{name} stopped sharing their screen', { name: watch.name }));
      }
    }
    // --- On the device that shares ---
    const v = share?.viewers.get(from);
    if (!v || v.sid !== sid) return;
    if (d.t === 'no' || d.t === 'busy') {
      toast(d.t === 'busy' ? t('{name} is already watching another screen', { name: v.name }) : t('{name} said no thanks', { name: v.name }));
      return dropViewer(from, false);
    }
    if (d.t === 'stop') {
      toast(t('{name} stopped watching', { name: v.name }));
      return dropViewer(from, false);
    }
    if (d.t === 'yes' && v.state === 'asking') {
      v.state = 'connecting';
      v.pc = newPc(from, sid, (st) => {
        if (share?.viewers.get(from) !== v) return;
        if (st === 'connected' && v.state !== 'on') {
          v.state = 'on';
          renderShareBar();
          toast(t('{name} is watching your screen', { name: v.name }));
        }
        if (st === 'failed') {
          toast(t('Could not connect to {name} to show the screen.', { name: v.name }));
          dropViewer(from, true);
        }
      });
      for (const track of share.stream.getTracks()) v.pc.addTrack(track, share.stream);
      // Prefer a sharp picture over smoothness: text on a shared screen must stay readable
      for (const s of v.pc.getSenders()) {
        if (s.track?.kind !== 'video') continue;
        try { s.track.contentHint = 'detail'; } catch {}
      }
      try {
        await v.pc.setLocalDescription(await v.pc.createOffer());
        signal(from, { t: 'sdp', sid, sdp: v.pc.localDescription });
      } catch {
        dropViewer(from, true);
      }
      return;
    }
    if (d.t === 'sdp' && d.sdp?.type === 'answer' && v.pc) {
      try {
        await v.pc.setRemoteDescription(d.sdp);
        await flushIce(v);
      } catch {
        dropViewer(from, true);
      }
      return;
    }
    if (d.t === 'ice' && d.c) return addIce(v, d.c);
  }
  // A device that left can't watch or share any more
  window.addEventListener('omnibeam-peer-left', (e) => {
    const id = e.detail;
    if (share?.viewers.has(id)) dropViewer(id, false);
    if (watch && watch.from === id) endWatch(t('{name} stopped sharing their screen', { name: watch.name }));
  });

  // ---------- Secret notes ----------
  // Sent straight to the device (encrypted like every transfer); the other side shows it once and keeps nothing.
  function secretNote(peer) {
    const dlg = dialog('dlg-secret-send', 'secret-dialog', `
      <h3>🔒 ${esc(t('Secret note for {name}', { name: peer.info.name }))}</h3>
      <textarea rows="5" maxlength="20000" autocomplete="off" spellcheck="false" placeholder="${esc(t('A Wi-Fi password, a code, an API key…'))}"></textarea>
      <p class="muted small">${esc(t('Shown once on {name}, then gone. Not saved in any history. End-to-end encrypted.', { name: peer.info.name }))}</p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
        <button type="button" class="btn" data-act="send">${esc(t('Send secret note'))}</button>
      </div>`);
    const ta = $('textarea', dlg);
    dlg.onclose = () => { ta.value = ''; };
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      if (act === 'send') {
        const text = ta.value;
        if (!text.trim()) return ta.focus();
        dlg.close();
        if (!live(peer)) return toast(t('{name} is no longer available', { name: peer.info.name }));
        peer.sendSecret(text);
      }
    };
    dlg.showModal();
    ta.focus();
  }
  const secrets = [];
  function showSecret(name, text) {
    secrets.push({ name, text: text.slice(0, 20000) });
    const dlg = document.getElementById('dlg-secret');
    if (!dlg?.open) nextSecret();
  }
  function nextSecret() {
    const s = secrets.shift();
    if (!s) return;
    const dlg = dialog('dlg-secret', 'secret-dialog', `
      <h3>🔒 ${esc(t('Secret note from {name}', { name: s.name }))}</h3>
      <div class="secret-body hidden-note" tabindex="0"><pre></pre><button type="button" class="btn small" data-act="show">${esc(t('Show'))}</button></div>
      <p class="muted small">${esc(t('It disappears when you close this window. It is not saved anywhere.'))}</p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Close'))}</button>
        <button type="button" class="btn" data-act="copy">${esc(t('Copy'))}</button>
      </div>`);
    $('pre', dlg).textContent = s.text;
    dlg.onclose = () => {
      dlg.innerHTML = ''; // the note is gone from the page
      setTimeout(nextSecret, 300);
    };
    dlg.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'show') { $('.secret-body', dlg).classList.remove('hidden-note'); e.target.remove(); }
      if (act === 'close') dlg.close();
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(s.text); toast(t('Copied to clipboard')); } catch { toast(t('Could not copy')); }
      }
    };
    dlg.showModal();
  }

  // ---------- Previews of received files ----------
  // Look at a file before saving it: pictures, video, audio, PDF (in the page on computers, in the phone's own
  // viewer on phones), and text or code with colours (the first 400 KB).
  const TEXT_MAX = 400 * 1024;
  const HIGHLIGHT_MAX = 150 * 1024;
  const KEYWORDS = new Set(('abstract and as async await break case catch class const continue def default del do elif else enum export '
    + 'extends false final finally fn for from func function go if impl implements import in interface is lambda let match mod '
    + 'new nil none not null or package pass private protected pub public raise return self static struct super switch this '
    + 'throw throws true try type typeof undefined use var void while with yield None True False SELECT FROM WHERE INSERT '
    + 'UPDATE DELETE JOIN AND OR NOT NULL CREATE TABLE INTO VALUES').split(' '));
  const ext = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  function commentStyle(e) {
    if (/^(py|rb|sh|bash|zsh|ya?ml|toml|env|ps1|conf|cfg|ini|r|pl|dockerfile|gitignore|properties)$/.test(e)) return 'hash';
    if (/^(html?|xml|svg|vue|svelte)$/.test(e)) return 'html';
    if (/^(txt|log|csv|tsv|md|markdown)$/.test(e)) return 'none';
    if (e === 'sql') return 'sql';
    return 'c';
  }
  function highlight(text, e) {
    const style = commentStyle(e);
    if (style === 'none' || text.length > HIGHLIGHT_MAX) return esc(text);
    const comment = style === 'hash' ? '#[^\\n]*' : style === 'html' ? '<!--[\\s\\S]*?-->' : style === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
    const re = new RegExp(`(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|([A-Za-z_]\\w*)`, 'g');
    let out = '';
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += esc(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[1]) out += `<span class="tk-c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${m[3]}</span>`;
      else if (KEYWORDS.has(m[4])) out += `<span class="tk-k">${m[4]}</span>`;
      else out += esc(m[4]);
    }
    return out + esc(text.slice(last));
  }

  async function preview(f, load) {
    const kind = previewKind(f);
    if (!kind) return;
    let blob = f.blob || null;
    if (!blob && load) blob = await load();
    if (!blob) return;
    stat('preview');
    const url = URL.createObjectURL(kind === 'pdf' ? new Blob([blob], { type: 'application/pdf' }) : blob);
    const dlg = dialog('dlg-preview', 'preview-dialog', `
      <div class="preview-head"><b class="preview-name"></b><span class="muted small preview-size"></span></div>
      <div class="preview-stage"></div>
      <p class="muted small preview-note" hidden></p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Close'))}</button>
        <span class="preview-save"></span>
      </div>`);
    $('.preview-name', dlg).textContent = f.name;
    $('.preview-size', dlg).textContent = formatSize(f.size || blob.size);
    const stage = $('.preview-stage', dlg);
    const note = $('.preview-note', dlg);
    stage.className = `preview-stage preview-${kind}`;
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = f.name;
      stage.appendChild(img);
    } else if (kind === 'video' || kind === 'audio') {
      const el = document.createElement(kind);
      el.controls = true;
      el.playsInline = true;
      el.src = url;
      stage.appendChild(el);
    } else if (kind === 'pdf') {
      if (isPhone) {
        // Phones show only the first page of a PDF inside a page: open it in their own viewer
        const a = document.createElement('a');
        a.className = 'btn wide btn-a';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = t('Open the PDF');
        stage.appendChild(a);
      } else {
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.title = f.name;
        stage.appendChild(frame);
      }
    } else {
      const part = blob.size > TEXT_MAX ? blob.slice(0, TEXT_MAX) : blob;
      const text = (await part.text()).replace(/\r\n?/g, '\n');
      const pre = document.createElement('pre');
      pre.className = 'code';
      pre.tabIndex = 0;
      pre.innerHTML = highlight(text, ext(f.name));
      stage.appendChild(pre);
      const lines = text.split('\n').length;
      note.hidden = false;
      note.textContent = blob.size > TEXT_MAX
        ? t('Showing the first {size}. Save the file to see all of it.', { size: formatSize(TEXT_MAX) })
        : t('{n} lines', { n: lines });
    }
    const saveBox = $('.preview-save', dlg);
    saveBox.appendChild(saveButton(f, load ? () => Promise.resolve(blob) : undefined));
    dlg.onclick = (e) => { if (e.target.closest('[data-act]')?.dataset.act === 'close') dlg.close(); };
    dlg.onclose = () => {
      stage.querySelectorAll('video, audio').forEach((m) => m.pause());
      stage.innerHTML = '';
      setTimeout(() => URL.revokeObjectURL(url), 60000); // a PDF opened in another tab still needs it a moment
    };
    if (!dlg.open) dlg.showModal();
  }

  window.Media = { snapPhoto, recordVoice, shareScreen, onScreenSignal, stopSharing, secretNote, showSecret, preview, highlight };
})();
