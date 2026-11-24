// OmniBeam: voice and video calls between two devices, loaded by app.js the first time a call starts or arrives
// (the phone and camera buttons at the top of a chat). The call is its own WebRTC connection, set up through the
// server's usual signalling ({call: …} messages, see onSignal), like Share my screen: the sound and picture go
// straight between the two devices (encrypted by WebRTC). Only when no direct route exists do they go through the
// TURN relay, which can't read them either. Nothing is recorded or kept.
//   The caller asks ({t:'ask', video}); the other device rings and answers ({t:'yes'|'no'|'busy'}); then the caller
//   makes the offer ({t:'sdp'}) and both exchange routes ({t:'ice'}). {t:'stop'} from either side ends it.
// It uses app.js's helpers and state ($, t, toast, peers, me, wsSend, RTC_CONFIG, keepAwake, notify…) directly.
'use strict';
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const signal = (to, data) => wsSend({ type: 'signal', to, data: { call: data } });
  const stopStream = (s) => s && s.getTracks().forEach((tr) => tr.stop());
  const RING_MS = 45000;
  const STYLE = `
#dlg-call:modal { margin: auto; max-height: 100dvh; transform-origin: 50% 50%; }
@media (max-width: 720px) { #dlg-call:modal { margin: 0; } }
.call-dialog { width: min(720px, 100vw); max-width: 100vw; height: min(760px, 100dvh); max-height: 100dvh; padding: 0; border: 0; border-radius: 22px; overflow: hidden; background: #15171f; color: #fff; }
.call-dialog:not([open]) { display: none; }
@media (max-width: 720px) { .call-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; } }
.call-dialog::backdrop { background: rgba(0,0,0,.6); }
.call-stage { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.call-remote { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
.call-remote[hidden], .call-local[hidden], .call-who[hidden] { display: none; }
.call-local { position: absolute; top: 14px; right: 14px; width: min(30%, 170px); aspect-ratio: 3 / 4; object-fit: cover; border-radius: 14px; background: #333; box-shadow: 0 4px 16px rgba(0,0,0,.5); transform: scaleX(-1); z-index: 2; }
[dir=rtl] .call-local { right: auto; left: 14px; }
.call-local.back { transform: none; }
.call-who { position: relative; z-index: 1; text-align: center; padding: 20px; }
.call-who .avatar { width: 110px; height: 110px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 52px; color: #fff; }
.call-who .avatar svg { width: 56px; height: 56px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.call-who .avatar .emoji { font-size: 56px; }
.call-who.ringing .avatar { animation: call-pulse 1.4s infinite; }
@keyframes call-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.45); } 100% { box-shadow: 0 0 0 26px rgba(255,255,255,0); } }
.call-who h3 { margin: 0 0 6px; font-size: 24px; color: #fff; }
.call-who p { margin: 0; opacity: .8; }
.call-top { position: absolute; top: 14px; left: 16px; z-index: 2; text-shadow: 0 1px 3px #000; }
[dir=rtl] .call-top { left: auto; right: 16px; }
.call-top b { display: block; font-size: 17px; }
.call-top span { font-size: 13px; opacity: .85; font-variant-numeric: tabular-nums; }
.call-top[hidden] { display: none; }
.call-bar { position: absolute; bottom: calc(22px + env(safe-area-inset-bottom)); left: 0; right: 0; z-index: 3; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
.call-bar button { width: 60px; height: 60px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.18); color: #fff; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.call-bar button svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; }
.call-bar button[hidden] { display: none; }
.call-bar button[aria-pressed="true"] { background: #fff; color: #15171f; }
.call-bar .end, .call-bar .no { background: #e53935; }
.call-bar .yes { background: #2fbf71; }
.call-bar .end svg, .call-bar .no svg { transform: rotate(135deg); }
.call-bar button:focus-visible { outline: 3px solid #8fe3ff; outline-offset: 2px; }
`;
  let styled = false;
  const ICON = {
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m23 7-7 5 7 5zM1 5h15v14H1z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 1l22 22M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V4a3 3 0 0 0-5.9-.6M17 16.9A7 7 0 0 1 5 12v-2m14 0v2c0 .8-.1 1.5-.4 2.2M12 19v4M8 23h8"/></svg>',
    camOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 1l22 22M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v3.3l1 1L23 7v10"/></svg>',
    flip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.5 9A9 9 0 0 0 5.6 5.6L1 10m22 4-4.6 4.4A9 9 0 0 1 3.5 15"/></svg>',
  };
  let call = null; // { id (other device), name, sid, video, role, state, pc, local, pending, startedAt, timer }

  function dialog() {
    if (!styled) {
      styled = true;
      document.head.appendChild(Object.assign(document.createElement('style'), { textContent: STYLE }));
    }
    let dlg = document.getElementById('dlg-call');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-call';
    dlg.className = 'call-dialog';
    dlg.setAttribute('aria-labelledby', 'call-name');
    dlg.innerHTML = `
      <div class="call-stage">
        <video class="call-remote" playsinline autoplay hidden></video>
        <video class="call-local" playsinline autoplay muted hidden></video>
        <div class="call-top" hidden><b></b><span class="call-time"></span></div>
        <div class="call-who"><div class="avatar" aria-hidden="true"></div><h3 id="call-name"></h3><p class="call-state" role="status"></p></div>
        <div class="call-bar">
          <button type="button" class="no" data-act="no" title="${esc(t('Decline'))}" aria-label="${esc(t('Decline'))}">${ICON.phone}</button>
          <button type="button" class="yes" data-act="yes-voice" title="${esc(t('Answer'))}" aria-label="${esc(t('Answer'))}">${ICON.phone}</button>
          <button type="button" class="yes" data-act="yes-video" title="${esc(t('Answer with video'))}" aria-label="${esc(t('Answer with video'))}">${ICON.video}</button>
          <button type="button" data-act="mute" aria-pressed="false" title="${esc(t('Mute'))}" aria-label="${esc(t('Mute'))}">${ICON.mic}</button>
          <button type="button" data-act="cam" aria-pressed="false" title="${esc(t('Turn camera off'))}" aria-label="${esc(t('Turn camera off'))}">${ICON.video}</button>
          <button type="button" data-act="flip" title="${esc(t('Switch camera'))}" aria-label="${esc(t('Switch camera'))}">${ICON.flip}</button>
          <button type="button" class="end" data-act="end" title="${esc(t('End call'))}" aria-label="${esc(t('End call'))}">${ICON.phone}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || !call) return;
      if (act === 'no') decline();
      else if (act === 'yes-voice' || act === 'yes-video') answer(act === 'yes-video');
      else if (act === 'end') end(true, t('Call ended'));
      else if (act === 'mute') toggle('audio', e.target.closest('button'));
      else if (act === 'cam') toggle('video', e.target.closest('button'));
      else if (act === 'flip') flip();
    };
    // Esc or the back gesture: hang up (or decline)
    dlg.oncancel = (e) => {
      e.preventDefault();
      if (!call) return dlg.close();
      if (call.state === 'ringing') decline();
      else end(true, t('Call ended'));
    };
    return dlg;
  }
  // What the window shows now
  function paint() {
    const dlg = dialog();
    if (!call) return;
    const peer = peers.get(call.id);
    const av = $('.call-who .avatar', dlg);
    av.style.background = colorFor(call.name);
    av.innerHTML = avatarHtml(peer?.info.avatar, peer?.info.device || '');
    $('#call-name').textContent = call.name;
    const st = call.state;
    const who = $('.call-who', dlg);
    who.classList.toggle('ringing', st === 'ringing' || st === 'calling');
    $('.call-state', dlg).textContent = st === 'calling' ? t('Calling…') : st === 'ringing' ? (call.video ? t('Incoming video call') : t('Incoming voice call'))
      : st === 'connecting' ? t('Connecting…') : '';
    const on = st === 'on';
    const remoteVideo = on && call.remoteVideo;
    $('.call-remote', dlg).hidden = !remoteVideo;
    who.hidden = remoteVideo;
    const top = $('.call-top', dlg);
    top.hidden = !on;
    $('b', top).textContent = call.name;
    const hasCam = !!call.local?.getVideoTracks().length;
    $('.call-local', dlg).hidden = !hasCam || st === 'ringing';
    const bar = (a) => $(`[data-act=${a}]`, dlg);
    bar('no').hidden = st !== 'ringing';
    bar('yes-voice').hidden = st !== 'ringing';
    bar('yes-video').hidden = st !== 'ringing' || !call.video;
    bar('mute').hidden = st === 'ringing';
    bar('cam').hidden = st === 'ringing' || !hasCam;
    bar('flip').hidden = st === 'ringing' || !hasCam || !isPhone;
    bar('end').hidden = st === 'ringing';
    paintTime();
  }
  function paintTime() {
    if (!call || call.state !== 'on') return;
    const s = Math.floor((Date.now() - call.startedAt) / 1000);
    $('.call-time', dialog()).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  // The ring: a soft repeating tone (while calling) or a louder one (an incoming call), made here (no sound files)
  let tone = null;
  function ringTone(incoming) {
    stopTone();
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const beep = () => {
      const now = ctx.currentTime;
      for (const [at, f] of incoming ? [[0, 880], [0.25, 660], [0.5, 880], [0.75, 660]] : [[0, 440], [0.45, 440]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0, now + at);
        g.gain.linearRampToValueAtTime(incoming ? 0.22 : 0.08, now + at + 0.03);
        g.gain.linearRampToValueAtTime(0, now + at + (incoming ? 0.22 : 0.4));
        o.connect(g).connect(ctx.destination);
        o.start(now + at);
        o.stop(now + at + 0.45);
      }
      if (incoming) navigator.vibrate?.([400, 200, 400]);
    };
    beep();
    tone = { ctx, timer: setInterval(beep, incoming ? 2000 : 3000) };
  }
  function stopTone() {
    if (!tone) return;
    clearInterval(tone.timer);
    tone.ctx.close().catch(() => {});
    tone = null;
    navigator.vibrate?.(0);
  }
  async function getMedia(video) {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }
  function showLocal() {
    const v = $('.call-local', dialog());
    if (v.srcObject !== call.local) v.srcObject = call.local;
    v.play().catch(() => {});
  }
  function newPc() {
    const c = call;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pc.onicecandidate = (e) => { if (e.candidate && call === c) signal(c.id, { t: 'ice', sid: c.sid, c: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (call !== c) return;
      const st = pc.connectionState;
      if (st === 'connected' && c.state !== 'on') {
        c.state = 'on';
        c.startedAt = Date.now();
        c.timer = setInterval(paintTime, 1000);
        stopTone();
        paint();
      }
      // A short drop (switching Wi-Fi) can come back by itself: wait a little before giving up
      if (st === 'disconnected') { clearTimeout(c.lost); c.lost = setTimeout(() => { if (call === c && pc.connectionState !== 'connected') end(true, t('The call was lost')); }, 10000); }
      if (st === 'connected') clearTimeout(c.lost);
      if (st === 'failed') end(true, c.state === 'on' ? t('The call was lost') : t('Could not connect the call to {name}', { name: c.name }));
    };
    pc.ontrack = (e) => {
      if (call !== c) return;
      const v = $('.call-remote', dialog());
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (v.srcObject !== stream) v.srcObject = stream;
      v.muted = false;
      v.play().catch(() => {});
      if (e.track.kind === 'video') {
        c.remoteVideo = true;
        e.track.onmute = () => { if (call === c) { c.remoteVideo = false; paint(); } };
        e.track.onunmute = () => { if (call === c) { c.remoteVideo = true; paint(); } };
      }
      paint();
    };
    return pc;
  }
  async function addIce(c) {
    if (!call?.pc) return;
    if (!call.pc.remoteDescription) { (call.pending ||= []).push(c); return; }
    try { await call.pc.addIceCandidate(c); } catch {}
  }
  async function flushIce() {
    for (const c of call?.pending || []) { try { await call.pc.addIceCandidate(c); } catch {} }
    if (call) call.pending = [];
  }

  // ---- Calling ----
  async function start(peer, video) {
    if (call) return toast(t('You are already in a call'));
    if (!navigator.mediaDevices?.getUserMedia) return toast(t('This browser can\'t make calls'));
    let local;
    try {
      local = await getMedia(video);
    } catch {
      return toast(video ? t('Allow the camera and microphone to make a video call') : t('Allow the microphone to make a call'), 5000);
    }
    if (!peers.get(peer.info.id) || call) { stopStream(local); return toast(t('{name} is no longer available', { name: peer.info.name })); }
    call = { id: peer.info.id, name: peer.info.name, sid: randomId(), video, role: 'caller', state: 'calling', local };
    signal(call.id, { t: 'ask', sid: call.sid, video: !!video, name: me.name });
    keepAwake('call', true);
    const dlg = dialog();
    paint();
    if (video) showLocal();
    if (!dlg.open) dlg.showModal();
    ringTone(false);
    const c = call;
    c.noAnswer = setTimeout(() => { if (call === c && c.state === 'calling') end(true, t('{name} didn\'t answer', { name: c.name })); }, RING_MS);
  }
  // ---- Answering ----
  async function answer(video) {
    const c = call;
    stopTone();
    clearTimeout(c.noAnswer);
    try {
      c.local = await getMedia(video);
    } catch {
      // No camera allowed: try with sound only; no microphone either: say so and decline
      try { c.local = video ? await getMedia(false) : null; } catch {}
      if (!c.local) { toast(t('Allow the microphone to answer calls'), 5000); return decline(); }
    }
    if (call !== c) { stopStream(c.local); return; }
    c.state = 'connecting';
    c.pc = newPc();
    keepAwake('call', true);
    paint();
    if (c.local.getVideoTracks().length) showLocal();
    signal(c.id, { t: 'yes', sid: c.sid });
  }
  function decline() {
    const c = call;
    if (!c) return;
    signal(c.id, { t: 'no', sid: c.sid });
    end(false);
  }
  function toggle(kind, btn) {
    const tracks = kind === 'audio' ? call.local?.getAudioTracks() : call.local?.getVideoTracks();
    if (!tracks?.length) return;
    const off = tracks[0].enabled;
    for (const tr of tracks) tr.enabled = !off;
    btn.setAttribute('aria-pressed', String(off));
    if (kind === 'audio') {
      btn.innerHTML = off ? ICON.micOff : ICON.mic;
      btn.title = off ? t('Unmute') : t('Mute');
    } else {
      btn.innerHTML = off ? ICON.camOff : ICON.video;
      btn.title = off ? t('Turn camera on') : t('Turn camera off');
      $('.call-local', dialog()).style.visibility = off ? 'hidden' : '';
    }
    btn.setAttribute('aria-label', btn.title);
  }
  // Front or back camera (phones)
  async function flip() {
    const old = call.local.getVideoTracks()[0];
    if (!old) return;
    const back = (old.getSettings().facingMode || 'user') === 'user';
    let fresh;
    try {
      fresh = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: back ? 'environment' : 'user' } })).getVideoTracks()[0];
    } catch { return toast(t('Could not switch the camera')); }
    fresh.enabled = old.enabled;
    const sender = call.pc?.getSenders().find((s) => s.track === old);
    try { await sender?.replaceTrack(fresh); } catch {}
    call.local.removeTrack(old);
    old.stop();
    call.local.addTrack(fresh);
    $('.call-local', dialog()).classList.toggle('back', back);
    showLocal();
  }
  // tell: tell the other device; message: shown after the window closes
  function end(tell, message) {
    const c = call;
    if (!c) return;
    call = null;
    if (tell) signal(c.id, { t: 'stop', sid: c.sid });
    clearTimeout(c.noAnswer);
    clearTimeout(c.lost);
    clearInterval(c.timer);
    stopTone();
    try { c.pc?.close(); } catch {}
    stopStream(c.local);
    keepAwake('call', false);
    const dlg = document.getElementById('dlg-call');
    if (dlg) {
      for (const v of dlg.querySelectorAll('video')) v.srcObject = null;
      $('.call-local', dlg).style.visibility = '';
      for (const b of dlg.querySelectorAll('[aria-pressed]')) b.setAttribute('aria-pressed', 'false');
      $('[data-act=mute]', dlg).innerHTML = ICON.mic;
      $('[data-act=cam]', dlg).innerHTML = ICON.video;
      if (dlg.open) dlg.close();
    }
    const took = c.startedAt ? Math.floor((Date.now() - c.startedAt) / 1000) : 0;
    if (message) toast(took ? `${message} · ${Math.floor(took / 60)}:${String(took % 60).padStart(2, '0')}` : message, 4000);
  }

  async function onSignal(from, d) {
    const sid = typeof d.sid === 'string' ? d.sid.slice(0, 32) : '';
    if (!sid) return;
    // A new call
    if (d.t === 'ask') {
      const peer = peers.get(from);
      if (!peer) return;
      if (call) return signal(from, { t: 'busy', sid });
      call = { id: from, name: peer.info.name, sid, video: !!d.video, role: 'callee', state: 'ringing' };
      const c = call;
      const dlg = dialog();
      paint();
      if (!dlg.open) dlg.showModal();
      $('[data-act=yes-voice]', dlg).focus();
      ringTone(true);
      notify(c.video ? t('{name} is video calling you', { name: c.name }) : t('{name} is calling you', { name: c.name }), t('Open OmniBeam to answer.'), { always: true, sticky: true });
      c.noAnswer = setTimeout(() => {
        if (call !== c || c.state !== 'ringing') return;
        end(false);
        toast(t('Missed call from {name}', { name: c.name }), 8000);
        notify(t('Missed call from {name}', { name: c.name }), '', { always: true });
      }, RING_MS);
      return;
    }
    if (!call || call.id !== from || call.sid !== sid) return;
    const c = call;
    if (d.t === 'stop') {
      if (c.state === 'ringing') {
        end(false);
        return toast(t('Missed call from {name}', { name: c.name }), 8000);
      }
      return end(false, t('{name} ended the call', { name: c.name }));
    }
    if (d.t === 'no' || d.t === 'busy') return end(false, d.t === 'busy' ? t('{name} is in another call', { name: c.name }) : t('{name} declined the call', { name: c.name }));
    if (d.t === 'ice' && d.c) return addIce(d.c);
    // The caller: the other device answered
    if (d.t === 'yes' && c.role === 'caller' && c.state === 'calling') {
      clearTimeout(c.noAnswer);
      stopTone();
      c.state = 'connecting';
      c.pc = newPc();
      for (const tr of c.local.getTracks()) c.pc.addTrack(tr, c.local);
      paint();
      try {
        await c.pc.setLocalDescription(await c.pc.createOffer());
        signal(c.id, { t: 'sdp', sid, sdp: c.pc.localDescription });
      } catch {
        end(true, t('Could not connect the call to {name}', { name: c.name }));
      }
      return;
    }
    if (d.t === 'sdp' && d.sdp?.type === 'offer' && c.role === 'callee' && c.pc) {
      try {
        await c.pc.setRemoteDescription(d.sdp);
        // This side's microphone (and camera) go on the lines the offer made
        for (const tr of c.local.getTracks()) c.pc.addTrack(tr, c.local);
        await flushIce();
        await c.pc.setLocalDescription(await c.pc.createAnswer());
        signal(c.id, { t: 'sdp', sid, sdp: c.pc.localDescription });
      } catch {
        end(true, t('Could not connect the call to {name}', { name: c.name }));
      }
      return;
    }
    if (d.t === 'sdp' && d.sdp?.type === 'answer' && c.role === 'caller' && c.pc) {
      try {
        await c.pc.setRemoteDescription(d.sdp);
        await flushIce();
      } catch {
        end(true, t('Could not connect the call to {name}', { name: c.name }));
      }
    }
  }
  // The other device left: the call ends
  window.addEventListener('omnibeam-peer-left', (e) => {
    if (call && call.id === e.detail) {
      const c = call;
      end(false, c.state === 'ringing' ? '' : t('{name} ended the call', { name: c.name }));
      if (c.state === 'ringing') toast(t('Missed call from {name}', { name: c.name }), 8000);
    }
  });
  // Leaving the page hangs up
  window.addEventListener('pagehide', () => { if (call) end(true); });

  window.Calls = { start, onSignal, get active() { return !!call; }, get state() { return call?.state || ''; } };
})();
