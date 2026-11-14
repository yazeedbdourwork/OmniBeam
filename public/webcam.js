// OmniBeam: a phone as a webcam or microphone for a computer, loaded by app.js the first time it is used
// (see webcam() in app.js).
//   - On the phone: More… on the computer's card -> "Be its webcam or mic". The camera (front or back, 720p or
//     1080p) and/or the microphone stream live to that computer over a separate WebRTC connection, set up through
//     the server's usual signalling ({cam: …} messages, see onSignal). Nothing passes through the server except,
//     when no direct route exists, the TURN relay, which only sees encrypted media. Nothing is recorded.
//   - On the computer: More… on the phone's card -> "Use as webcam or mic" asks the phone to start ({t:'want'}).
//     The picture shows in a window with Mirror, Pop out and Full screen. "Pop out" opens a clean window called
//     "OmniBeam camera" that OBS can capture (Window Capture); OBS's Virtual Camera then makes it a camera for Zoom,
//     Meet or Teams. A web page can't add a camera to the computer by itself, so this is the practical way.
//     The sound can be sent to another output (setSinkId), e.g. a virtual audio cable used as a meeting microphone.
// Messages: phone -> {t:'ask', sid, name, mode, want}; computer -> {t:'yes'|'no'|'busy', sid}; the phone makes the
// offer ({t:'sdp'}), both exchange routes ({t:'ice'}); {t:'stop'} from either side ends it. {t:'want', sid} from
// the computer asks the phone to start; the phone's ask then carries that sid in `want`, so it is accepted at once.
// It uses app.js's helpers and state ($, t, toast, peers, me, wsSend, RTC_CONFIG, keepAwake, chime, notify…).
'use strict';
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const signal = (to, data) => wsSend({ type: 'signal', to, data: { cam: data } });
  const stopStream = (s) => s && s.getTracks().forEach((tr) => tr.stop());
  const nameOf = (id) => peers.get(id)?.info.name || t('the other device');
  const live = (peer) => peer && peers.get(peer.info.id) === peer;
  const MODES = ['av', 'v', 'a']; // camera and mic, camera only, mic only
  const QUALITY = { 720: { w: 1280, h: 720, bitrate: 2500000 }, 1080: { w: 1920, h: 1080, bitrate: 5000000 } };
  const PREFS = 'omnibeam-webcam';
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } })();
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch {} };

  function dialog(id, cls, html) {
    let dlg = document.getElementById(id);
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = id;
      document.body.appendChild(dlg);
    }
    dlg.className = cls;
    dlg.innerHTML = html;
    return dlg;
  }
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

  // ================= On the phone: send the camera and microphone =================
  let cam = null; // { peer, to, name, sid, want, mode, facing, quality, stream, pc, state: 'setup'|'asking'|'connecting'|'on' }

  function constraints(mode, facing, quality, only) {
    const q = QUALITY[quality] || QUALITY[720];
    const video = mode !== 'a' && only !== 'audio'
      ? { facingMode: { ideal: facing }, width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: 30, max: 30 } } : false;
    const audio = mode !== 'v' && only !== 'video' ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false;
    return { video, audio };
  }
  // Opens the camera/mic for the preview (again after a change of mode or quality, before going live)
  async function openStream() {
    const dlg = document.getElementById('dlg-webcam');
    const msg = $('.camera-msg', dlg);
    const video = $('video', dlg);
    stopStream(cam.stream);
    cam.stream = null;
    video.srcObject = null;
    msg.hidden = false;
    msg.textContent = t('Opening the camera…');
    const c = cam;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(c.mode, c.facing, c.quality));
    } catch (err) {
      if (cam !== c) return;
      msg.textContent = err?.name === 'NotAllowedError'
        ? t('OmniBeam isn\'t allowed to use the camera or microphone. Allow it in the browser\'s settings for this site, then try again.')
        : t('The camera or microphone could not be opened. Close other apps that use it, then try again.');
      $('[data-act=start]', dlg).disabled = true;
      return;
    }
    if (cam !== c) return stopStream(stream);
    c.stream = stream;
    $('[data-act=start]', dlg).disabled = false;
    video.srcObject = stream;
    video.play().catch(() => {});
    video.classList.toggle('mirror', c.facing === 'user');
    video.hidden = c.mode === 'a';
    msg.hidden = c.mode !== 'a';
    if (c.mode === 'a') msg.textContent = `🎙 ${t('Microphone only: no picture is sent.')}`;
  }

  // The window on the phone: pick camera and mic, preview, Start; then Live with Switch camera, Mute and Stop
  function sendCamera(peer, want) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return toast(t('This browser can\'t use the camera here. Try Chrome or Safari.'));
    if (cam && cam.state !== 'setup') {
      if (cam.to === peer.info.id) { const d = document.getElementById('dlg-webcam'); if (d && !d.open) d.showModal(); return; }
      return toast(t('Your camera is already live on {name}. Stop it there first.', { name: cam.name }));
    }
    if (cam) closeCamera(false);
    cam = {
      peer, to: peer.info.id, name: peer.info.name, sid: randomId(), want: want || '', state: 'setup',
      mode: MODES.includes(prefs.mode) ? prefs.mode : 'av', facing: prefs.facing === 'user' ? 'user' : 'environment',
      quality: prefs.quality === 1080 ? 1080 : 720, stream: null, pc: null, pending: [],
    };
    const name = peer.info.name;
    const dlg = dialog('dlg-webcam', 'camera-dialog webcam-dialog', `
      <h3>${esc(t('Webcam and mic for {name}', { name }))}</h3>
      ${want ? `<p class="webcam-asked">${esc(t('{name} asked to use this phone as its webcam or mic.', { name }))}</p>` : ''}
      <div class="camera-stage webcam-stage">
        <video playsinline muted autoplay></video>
        <p class="camera-msg muted" hidden></p>
        <span class="webcam-live-badge" hidden>● ${esc(t('Live'))}</span>
        <button type="button" class="webcam-flip" data-act="flip" title="${esc(t('Switch camera'))}" aria-label="${esc(t('Switch camera'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-3l-2-3H9L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM9 13a3 3 0 0 1 5-2.2M15 13a3 3 0 0 1-5 2.2M14 9v2h-2M10 17v-2h2"/></svg></button>
      </div>
      <div class="webcam-options">
        <div class="seg webcam-modes" role="group" aria-label="${esc(t('Send'))}">
          <button type="button" data-mode="av">${esc(t('Camera and mic'))}</button>
          <button type="button" data-mode="v">${esc(t('Camera only'))}</button>
          <button type="button" data-mode="a">${esc(t('Mic only'))}</button>
        </div>
        <label class="webcam-quality">${esc(t('Quality'))}
          <select>
            <option value="720">720p HD</option>
            <option value="1080">1080p Full HD</option>
          </select>
        </label>
      </div>
      <p class="muted small webcam-status">${esc(t('Put the phone on a stand and keep OmniBeam open on it. The picture and sound go straight to {name}, encrypted, and are never recorded.', { name }))}</p>
      <div class="row webcam-buttons">
        <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
        <button type="button" class="btn ghost" data-act="mute" hidden>${esc(t('Mute mic'))}</button>
        <button type="button" class="btn" data-act="start">${esc(t('Start'))}</button>
      </div>`);
    const setUi = () => {
      if (!cam) return;
      const liveNow = cam.state !== 'setup';
      for (const b of dlg.querySelectorAll('[data-mode]')) {
        b.setAttribute('aria-pressed', String(b.dataset.mode === cam.mode));
        b.disabled = liveNow;
      }
      $('.webcam-quality select', dlg).value = String(cam.quality);
      $('.webcam-quality select', dlg).disabled = liveNow;
      $('.webcam-quality', dlg).hidden = cam.mode === 'a';
      $('[data-act=flip]', dlg).hidden = cam.mode === 'a';
      const audio = cam.stream?.getAudioTracks()[0];
      $('[data-act=mute]', dlg).hidden = !liveNow || !audio;
      $('[data-act=mute]', dlg).textContent = audio && !audio.enabled ? t('Unmute mic') : t('Mute mic');
      $('[data-act=start]', dlg).hidden = liveNow;
      $('[data-act=close]', dlg).textContent = liveNow ? t('Stop') : t('Cancel');
      $('[data-act=close]', dlg).classList.toggle('ghost', !liveNow);
      $('.webcam-live-badge', dlg).hidden = cam.state !== 'on';
      $('.webcam-status', dlg).textContent = cam.state === 'on' ? t('Live on {name}. Keep this screen open; tap Stop when you are done.', { name: cam.name })
        : cam.state === 'asking' ? t('Waiting for {names} to accept…', { names: cam.name })
        : cam.state === 'connecting' ? t('Connecting…')
        : t('Put the phone on a stand and keep OmniBeam open on it. The picture and sound go straight to {name}, encrypted, and are never recorded.', { name: cam.name });
    };
    cam.setUi = setUi;
    dlg.onclick = async (e) => {
      const btn = e.target.closest('[data-act],[data-mode]');
      if (!btn || !cam) return;
      if (btn.dataset.mode && cam.state === 'setup' && btn.dataset.mode !== cam.mode) {
        cam.mode = prefs.mode = btn.dataset.mode;
        savePrefs();
        setUi();
        return openStream();
      }
      const act = btn.dataset.act;
      if (act === 'close') return dlg.close();
      if (act === 'start') return start();
      if (act === 'mute') {
        const a = cam.stream?.getAudioTracks()[0];
        if (a) a.enabled = !a.enabled;
        return setUi();
      }
      if (act === 'flip') return flip();
    };
    $('.webcam-quality select', dlg).onchange = (e) => {
      cam.quality = prefs.quality = Number(e.target.value) === 1080 ? 1080 : 720;
      savePrefs();
      openStream();
    };
    dlg.onclose = () => closeCamera(true);
    setUi();
    dlg.showModal();
    openStream();
  }

  async function flip() {
    const c = cam;
    if (!c || c.mode === 'a' || !c.stream) return;
    const dlg = document.getElementById('dlg-webcam');
    const facing = c.facing === 'user' ? 'environment' : 'user';
    const old = c.stream.getVideoTracks()[0];
    // Phones can't open both cameras at once: let go of the one in use first
    old?.stop();
    let track;
    try {
      track = (await navigator.mediaDevices.getUserMedia(constraints(c.mode, facing, c.quality, 'video'))).getVideoTracks()[0];
      c.facing = prefs.facing = facing;
      savePrefs();
    } catch {
      // No other camera: take the same one back
      try { track = (await navigator.mediaDevices.getUserMedia(constraints(c.mode, c.facing, c.quality, 'video'))).getVideoTracks()[0]; } catch {}
      toast(t('This device has only one camera'));
      if (!track) return;
    }
    if (cam !== c) return track.stop();
    if (old) c.stream.removeTrack(old);
    c.stream.addTrack(track);
    const sender = c.pc?.getSenders().find((s) => s.track === old || s.track?.kind === 'video');
    if (sender) { try { await sender.replaceTrack(track); } catch {} }
    const video = $('video', dlg);
    video.srcObject = c.stream;
    video.play().catch(() => {});
    video.classList.toggle('mirror', c.facing === 'user');
    try { track.contentHint = 'motion'; } catch {}
  }

  function start() {
    const c = cam;
    if (!c || c.state !== 'setup' || !c.stream) return;
    if (!live(c.peer) || !peers.has(c.to)) return toast(t('{name} is no longer available', { name: c.name }));
    c.state = 'asking';
    signal(c.to, { t: 'ask', sid: c.sid, name: me.name, mode: c.mode, want: c.want });
    keepAwake('webcam', true);
    c.setUi();
    setTimeout(() => {
      if (cam === c && c.state === 'asking') {
        toast(t('{name} didn\'t answer', { name: c.name }));
        stopCamera(true);
      }
    }, 60000);
  }
  // Back to the setup state (the computer said no, or stopped watching): the window stays open to try again
  function stopCamera(tell, message) {
    const c = cam;
    if (!c || c.state === 'setup') return;
    if (tell) signal(c.to, { t: 'stop', sid: c.sid });
    try { c.pc?.close(); } catch {}
    c.pc = null;
    c.pending = [];
    c.state = 'setup';
    c.sid = randomId();
    c.want = '';
    keepAwake('webcam', false);
    if (message) toast(message);
    const dlg = document.getElementById('dlg-webcam');
    if (dlg?.open) c.setUi();
    else closeCamera(false);
  }
  // The window closed: everything stops and the camera is let go
  function closeCamera(tell) {
    const c = cam;
    if (!c) return;
    cam = null;
    if (tell && c.state !== 'setup') signal(c.to, { t: 'stop', sid: c.sid });
    else if (tell && c.want) signal(c.to, { t: 'no', sid: c.want });
    try { c.pc?.close(); } catch {}
    stopStream(c.stream);
    keepAwake('webcam', false);
    const dlg = document.getElementById('dlg-webcam');
    if (dlg) {
      const v = $('video', dlg);
      if (v) v.srcObject = null;
      if (dlg.open) { dlg.onclose = null; dlg.close(); }
    }
  }

  async function onPhoneSide(from, d, sid) {
    // The computer asks this phone to be its webcam
    if (d.t === 'want') {
      const peer = peers.get(from);
      if (!peer) return;
      if (cam && cam.state !== 'setup') return signal(from, { t: 'busy', sid });
      sendCamera(peer, sid);
      chime();
      notify(t('{name} wants to use this phone as a webcam', { name: peer.info.name }), t('Open OmniBeam and tap Start.'));
      return true;
    }
    const c = cam;
    if (!c || c.to !== from || c.sid !== sid) return false;
    if (d.t === 'no' || d.t === 'busy') {
      stopCamera(false, d.t === 'busy' ? t('{name} is already watching another camera', { name: c.name }) : t('{name} said no thanks', { name: c.name }));
      return true;
    }
    if (d.t === 'stop') {
      stopCamera(false, t('{name} stopped watching', { name: c.name }));
      return true;
    }
    if (d.t === 'yes' && c.state === 'asking') {
      c.state = 'connecting';
      c.setUi();
      c.pc = newPc(from, sid, (st) => {
        if (cam !== c) return;
        if (st === 'connected' && c.state !== 'on') {
          c.state = 'on';
          c.setUi();
          wsSend({ type: 'stat', kind: 'webcam' });
          toast(t('Your camera is live on {name}', { name: c.name }));
        }
        if (st === 'failed') stopCamera(true, t('Could not connect to {name}.', { name: c.name }));
      });
      for (const track of c.stream.getTracks()) {
        try { track.contentHint = track.kind === 'video' ? 'motion' : 'speech'; } catch {}
        c.pc.addTrack(track, c.stream);
      }
      const q = QUALITY[c.quality] || QUALITY[720];
      for (const s of c.pc.getSenders()) {
        if (s.track?.kind !== 'video') continue;
        try {
          const p = s.getParameters();
          p.encodings = p.encodings?.length ? p.encodings : [{}];
          p.encodings[0].maxBitrate = q.bitrate;
          p.encodings[0].maxFramerate = 30;
          p.degradationPreference = 'maintain-framerate';
          await s.setParameters(p);
        } catch {}
      }
      try {
        await c.pc.setLocalDescription(await c.pc.createOffer());
        signal(from, { t: 'sdp', sid, sdp: c.pc.localDescription });
      } catch {
        stopCamera(true, t('Could not connect to {name}.', { name: c.name }));
      }
      return true;
    }
    if (d.t === 'sdp' && d.sdp?.type === 'answer' && c.pc) {
      try {
        await c.pc.setRemoteDescription(d.sdp);
        await flushIce(c);
      } catch {
        stopCamera(true, t('Could not connect to {name}.', { name: c.name }));
      }
      return true;
    }
    if (d.t === 'ice' && d.c) { await addIce(c, d.c); return true; }
    return false;
  }

  // ================= On the computer: show the phone's camera =================
  let view = null; // { from, sid, name, mode, pc, pending, asking, popup, mirror, meter }
  let wanted = null; // { to, sid } after "Use as webcam or mic", until the phone starts or says no

  function useAsWebcam(peer) {
    if (!window.RTCPeerConnection) return toast(t('This browser can\'t use the camera here. Try Chrome or Safari.'));
    if (view && !view.asking) return toast(t('You are already watching {name}\'s camera', { name: view.name }));
    const sid = randomId();
    wanted = { to: peer.info.id, sid };
    signal(peer.info.id, { t: 'want', sid });
    toast(t('Asked {name}. Tap Start on the phone.', { name: peer.info.name }), 6000);
    setTimeout(() => { if (wanted?.sid === sid) wanted = null; }, 180000);
  }

  function askToWatch(name, mode) {
    const dlg = dialog('dlg-webcam-ask', 'screen-ask', `
      <h3>${esc(mode === 'a' ? t('{name} wants to be your microphone', { name }) : t('{name} wants to be your webcam', { name }))}</h3>
      <p class="muted">${esc(t('You see and hear it here, live. Nothing is recorded, and you can stop at any time.'))}</p>
      <div class="row">
        <button type="button" class="btn ghost" data-act="no">${esc(t('No thanks'))}</button>
        <button type="button" class="btn" data-act="yes">${esc(t('Accept'))}</button>
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
      notify(t('{name} wants to be your webcam', { name }), t('Open OmniBeam to see it.'));
    });
  }

  const HELP = () => `
    <details class="webcam-help">
      <summary>${esc(t('Use it in Zoom, Meet, Teams or OBS'))}</summary>
      <ol>
        <li>${esc(t('OBS: click Pop out, then in OBS add a Window Capture source and pick the window called "OmniBeam camera".'))}</li>
        <li>${esc(t('Zoom, Meet or Teams: in OBS, click Start Virtual Camera, then choose "OBS Virtual Camera" as the camera in the meeting app.'))}</li>
        <li>${esc(t('Microphone: the sound plays on this computer. To use it as the microphone in a meeting app, install a free virtual audio cable (such as VB-CABLE), choose it below, then pick it as the microphone in the meeting app.'))}</li>
      </ol>
      <p class="muted small">${esc(t('A website can\'t add a camera to your computer by itself, so OBS (free) does that part.'))}</p>
      <div class="row webcam-sink" hidden>
        <label>${esc(t('Sound plays on'))} <select></select></label>
        <button type="button" class="btn ghost small" data-act="list-sinks" hidden>${esc(t('Show all sound outputs'))}</button>
      </div>
    </details>`;

  function viewer() {
    let dlg = document.getElementById('dlg-webcam-view');
    if (dlg) return dlg;
    dlg = dialog('dlg-webcam-view', 'screen-dialog webcam-view', `
      <div class="screen-stage"><video playsinline autoplay></video><p class="screen-msg"></p>
        <div class="webcam-meter" hidden aria-hidden="true"><span></span></div></div>
      <div class="row screen-bar">
        <b class="screen-title"></b>
        <button type="button" class="btn ghost small" data-act="sound" hidden>${esc(t('Turn on sound'))}</button>
        <button type="button" class="btn ghost small" data-act="mirror" aria-pressed="false">${esc(t('Mirror'))}</button>
        <button type="button" class="btn ghost small" data-act="popout">${esc(t('Pop out'))}</button>
        <button type="button" class="btn ghost small" data-act="full">${esc(t('Full screen'))}</button>
        <button type="button" class="btn small" data-act="stop">${esc(t('Stop'))}</button>
      </div>${HELP()}`);
    dlg.onclick = (e) => {
      const btn = e.target.closest('[data-act]');
      const act = btn?.dataset.act;
      const video = $('video', dlg);
      if (act === 'stop') dlg.close();
      if (act === 'full') (video.requestFullscreen || video.webkitEnterFullscreen || (() => {})).call(video)?.catch?.(() => {});
      if (act === 'sound') { video.muted = false; video.play().catch(() => {}); btn.hidden = true; view?.meter?.ctx.resume?.().catch?.(() => {}); }
      if (act === 'mirror' && view) setMirror(!view.mirror);
      if (act === 'popout') popOut();
      if (act === 'list-sinks') listSinks(true);
    };
    $('.webcam-help', dlg).addEventListener('toggle', () => listSinks(false));
    $('.webcam-sink select', dlg).onchange = async (e) => {
      const video = $('video', dlg);
      try {
        await video.setSinkId(e.target.value);
        prefs.sink = e.target.value;
        savePrefs();
      } catch {
        toast(t('Could not play the sound there'));
      }
    };
    dlg.addEventListener('close', () => {
      if (view && !view.asking) { signal(view.from, { t: 'stop', sid: view.sid }); endView(); }
    });
    return dlg;
  }
  function setMirror(on) {
    if (!view) return;
    view.mirror = on;
    prefs.mirror = on;
    savePrefs();
    const dlg = document.getElementById('dlg-webcam-view');
    $('video', dlg).classList.toggle('mirror', on);
    $('[data-act=mirror]', dlg).setAttribute('aria-pressed', String(on));
    const pv = view.popup && !view.popup.closed && view.popup.document.querySelector('video');
    if (pv) pv.style.transform = on ? 'scaleX(-1)' : '';
  }
  // Sound outputs (speakers, headphones, a virtual audio cable) the sound can be sent to. Browsers only name them
  // once the page may use a microphone, so "Show all sound outputs" asks for that and lets go of it at once.
  async function listSinks(ask) {
    const dlg = document.getElementById('dlg-webcam-view');
    const box = $('.webcam-sink', dlg);
    if (!('setSinkId' in HTMLMediaElement.prototype) || !navigator.mediaDevices?.enumerateDevices) return;
    if (ask) {
      try { stopStream(await navigator.mediaDevices.getUserMedia({ audio: true })); } catch {}
    }
    let outs = [];
    try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch {}
    const sel = $('select', box);
    const now = $('video', dlg).sinkId || '';
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = t('This computer\'s usual output');
    sel.appendChild(def);
    for (const d of outs) {
      if (!d.deviceId || d.deviceId === 'default') continue;
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || t('Sound output {n}', { n: sel.options.length });
      sel.appendChild(o);
    }
    sel.value = [...sel.options].some((o) => o.value === now) ? now : '';
    box.hidden = false;
    $('[data-act=list-sinks]', box).hidden = outs.some((d) => d.label);
  }
  // A clean window with only the picture, for OBS's Window Capture (its title stays "OmniBeam camera")
  function popOut() {
    if (!view) return;
    const dlg = document.getElementById('dlg-webcam-view');
    const stream = $('video', dlg).srcObject;
    if (!stream) return toast(t('Connecting…'));
    let w = view.popup && !view.popup.closed ? view.popup : null;
    if (!w) {
      w = window.open('', 'omnibeam-camera', 'popup,width=1280,height=720');
      if (!w) return toast(t('Your browser blocked the window. Allow pop-ups for OmniBeam, then try again.'));
      view.popup = w;
    }
    const doc = w.document;
    doc.title = 'OmniBeam camera';
    doc.body.innerHTML = '';
    doc.documentElement.style.cssText = 'height:100%;background:#000';
    doc.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden;cursor:none';
    const v = doc.createElement('video');
    v.autoplay = true;
    v.muted = true; // the sound plays in OmniBeam's own window (and where it was sent)
    v.playsInline = true;
    v.style.cssText = `display:block;width:100vw;height:100vh;object-fit:contain;background:#000${view.mirror ? ';transform:scaleX(-1)' : ''}`;
    v.srcObject = stream;
    v.ondblclick = () => (doc.fullscreenElement ? doc.exitFullscreen() : v.requestFullscreen?.())?.catch?.(() => {});
    doc.body.appendChild(v);
    v.play().catch(() => {});
    w.focus();
  }
  // Mic only: a level bar shows the sound arriving
  function startMeter(stream) {
    const dlg = document.getElementById('dlg-webcam-view');
    const box = $('.webcam-meter', dlg);
    box.hidden = false;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const bar = $('span', box);
      const m = { ctx, raf: 0 };
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
        bar.style.width = `${Math.min(100, Math.round((peak / 128) * 160))}%`;
        m.raf = requestAnimationFrame(tick);
      };
      tick();
      return m;
    } catch { return null; }
  }
  function endView(message) {
    const v = view;
    view = null;
    if (v) {
      try { v.pc?.close(); } catch {}
      if (v.meter) { cancelAnimationFrame(v.meter.raf); v.meter.ctx.close().catch(() => {}); }
      if (v.popup && !v.popup.closed) v.popup.close();
    }
    keepAwake('webcam-view', false);
    const dlg = document.getElementById('dlg-webcam-view');
    if (dlg) {
      $('video', dlg).srcObject = null;
      $('.webcam-meter', dlg).hidden = true;
      if (dlg.open) dlg.close();
    }
    if (message) toast(message);
  }

  async function onComputerSide(from, d, sid) {
    if (d.t === 'ask') {
      if (!peers.has(from)) return;
      if (view) return signal(from, { t: 'busy', sid });
      const name = nameOf(from);
      const mode = MODES.includes(d.mode) ? d.mode : 'av';
      const expected = wanted && wanted.to === from && typeof d.want === 'string' && d.want === wanted.sid;
      wanted = null;
      view = { from, sid, name, mode, pc: null, pending: [], asking: true, mirror: prefs.mirror === true };
      if (!expected) {
        const yes = await askToWatch(name, mode);
        if (!view || view.sid !== sid) return; // stopped while asking
        if (!yes) { view = null; return signal(from, { t: 'no', sid }); }
      }
      view.asking = false;
      const dlg = viewer();
      const video = $('video', dlg);
      $('.screen-title', dlg).textContent = mode === 'a' ? t('{name}\'s microphone', { name }) : t('{name}\'s camera', { name });
      $('.screen-msg', dlg).textContent = t('Connecting…');
      $('.screen-msg', dlg).hidden = false;
      $('[data-act=sound]', dlg).hidden = true;
      for (const a of ['mirror', 'popout', 'full']) $(`[data-act=${a}]`, dlg).hidden = mode === 'a';
      video.classList.toggle('mirror', view.mirror);
      $('[data-act=mirror]', dlg).setAttribute('aria-pressed', String(view.mirror));
      if (prefs.sink && video.setSinkId) video.setSinkId(prefs.sink).catch(() => {});
      const w = view;
      w.pc = newPc(from, sid, (st) => {
        if (view !== w) return;
        if (st === 'connected') {
          if (w.mode === 'a') $('.screen-msg', dlg).textContent = `🎙 ${t('{name}\'s microphone', { name })}`;
          else $('.screen-msg', dlg).hidden = true;
        }
        if (st === 'failed') endView(t('Could not connect to {name}.', { name }));
      });
      w.pc.ontrack = (e) => {
        if (view !== w) return;
        const stream = e.streams[0];
        if (!stream || video.srcObject === stream) return;
        video.srcObject = stream;
        video.muted = false;
        // Some browsers only play it with sound after the next click
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); if (w.mode !== 'v') $('[data-act=sound]', dlg).hidden = false; });
        if (w.mode === 'a' && !w.meter) w.meter = startMeter(stream);
      };
      keepAwake('webcam-view', true);
      if (!dlg.open) dlg.showModal();
      return signal(from, { t: 'yes', sid });
    }
    if (d.t === 'busy' || d.t === 'no') {
      if (wanted && wanted.to === from && wanted.sid === sid) {
        wanted = null;
        toast(d.t === 'busy' ? t('{name} is already used as a webcam', { name: nameOf(from) }) : t('{name} said no thanks', { name: nameOf(from) }));
      }
      return;
    }
    const w = view;
    if (!w || w.from !== from || w.sid !== sid) return;
    if (d.t === 'sdp' && d.sdp?.type === 'offer' && w.pc) {
      try {
        await w.pc.setRemoteDescription(d.sdp);
        await flushIce(w);
        await w.pc.setLocalDescription(await w.pc.createAnswer());
        signal(from, { t: 'sdp', sid, sdp: w.pc.localDescription });
      } catch {
        endView(t('Could not connect to {name}.', { name: w.name }));
      }
      return;
    }
    if (d.t === 'ice' && d.c) return addIce(w, d.c);
    if (d.t === 'stop') {
      if (w.asking) { const dlg = document.getElementById('dlg-webcam-ask'); view = null; if (dlg?.open) dlg.close(); return; }
      return endView(t('{name} stopped the camera', { name: w.name }));
    }
  }

  async function onSignal(from, d) {
    if (!d || typeof d !== 'object') return;
    const sid = typeof d.sid === 'string' ? d.sid.slice(0, 32) : '';
    if (!sid) return;
    if (await onPhoneSide(from, d, sid)) return;
    await onComputerSide(from, d, sid);
  }

  // A device that left can't send or show a camera any more
  window.addEventListener('omnibeam-peer-left', (e) => {
    const id = e.detail;
    if (cam && cam.to === id) closeCamera(false);
    if (view && view.from === id) {
      if (view.asking) { view = null; const dlg = document.getElementById('dlg-webcam-ask'); if (dlg?.open) dlg.close(); }
      else endView(t('{name} stopped the camera', { name: view.name }));
    }
    if (wanted && wanted.to === id) wanted = null;
  });

  window.Webcam = { sendCamera, useAsWebcam, onSignal, state: () => ({ cam: cam && { state: cam.state, mode: cam.mode, facing: cam.facing }, view: view && { mode: view.mode, asking: view.asking } }) };
})();
