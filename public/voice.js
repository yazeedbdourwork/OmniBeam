// OmniBeam: voice messages in a chat (the one with a device, chat.js, and the group chat of a room, group.js).
// Loaded with the chat. The microphone button of the message box records: hold it and let go to send (slide to
// the side to throw it away), or tap it once to record hands-free, then tap Send or the bin. A voice message travels
// inside the chat's own encrypted connection like a text message (Peer.sendVoice in app.js), arrives without asking,
// and plays right in its bubble: play and pause, tap the bars to jump, 1× / 1.5× / 2×. Each device keeps its own
// copy (VoiceStore in app.js), with the chat's messages; nothing is kept on the server.
// It uses app.js's helpers ($, t, toast, keepAwake, VoiceStore…) directly.
'use strict';
(function () {
  const MAX_MS = 5 * 60 * 1000; // five minutes at most, a few MB
  const MIN_MS = 600;
  // AAC in MP4 plays everywhere (iPhone too); Chromium without it records Opus in WebM, Firefox Opus in Ogg
  const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  const RATE_KEY = 'omnibeam-vm-rate';
  const RATES = [1, 1.5, 2];
  const BARS = 28;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clock = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const can = () => !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;
  const STYLE = `
.vm { display: flex; align-items: center; gap: 8px; min-width: min(240px, 62vw); padding: 2px 0; }
.vm-play { flex: none; width: 38px; height: 38px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; background: var(--accent, #6c5ce7); color: #fff; }
.bubble.out .vm-play { background: rgba(255,255,255,.25); }
.vm-play svg { width: 18px; height: 18px; fill: currentColor; }
.vm-bars { flex: 1; display: flex; align-items: center; gap: 2px; height: 30px; cursor: pointer; min-width: 0; touch-action: none; }
.vm-bars i { flex: 1; min-width: 2px; max-width: 4px; border-radius: 2px; background: currentColor; opacity: .3; }
.vm-bars i.on { opacity: .95; }
.bubble.voice .vm { padding-inline-end: 12px; }
.vm-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
.vm-rate { border: 0; border-radius: 999px; padding: 1px 7px; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; background: rgba(127,127,127,.2); color: inherit; }
.vm-rec { position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 0 10px; }
.vm-rec.hold { padding-inline-end: 64px; }
.vm-busy > :not(.vm-rec):not(.holding) { visibility: hidden; }
.vm-rec[hidden] { display: none; }
.vm-rec .dot { width: 10px; height: 10px; border-radius: 50%; background: #e53935; animation: vm-blink 1s infinite; flex: none; }
@keyframes vm-blink { 50% { opacity: .25; } }
.vm-rec .vm-t { font-variant-numeric: tabular-nums; font-weight: 700; min-width: 40px; }
.vm-rec .vm-hint { flex: 1; min-width: 0; font-size: 13px; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vm-rec .vm-bin, .vm-rec .vm-go { flex: none; width: 40px; height: 40px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.vm-rec .vm-bin { background: rgba(229,57,53,.12); color: #e53935; }
.vm-rec .vm-go { background: var(--accent, #6c5ce7); color: #fff; }
.vm-rec .vm-bin svg, .vm-rec .vm-go svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; }
.vm-rec .vm-bin[hidden], .vm-rec .vm-go[hidden] { display: none; }
.vm-rec.away .vm-hint { color: #e53935; opacity: 1; }
[data-act=voice].holding { position: relative; z-index: 4; border-radius: 50%; background: #e53935 !important; color: #fff !important; transform: scale(1.2); }
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
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
    bin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>',
  };

  // ---------- Playing ----------
  // One player for every voice bubble: the chat draws its bubbles again whenever something changes, and the
  // sound must go on meanwhile, so the bubbles only show this player's state (found by data-vid)
  const audio = new Audio();
  audio.preload = 'auto';
  let playing = null; // { id, url, ms }
  let rate = (() => { try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; } })();
  if (!RATES.includes(rate)) rate = 1;
  // Bars of the same voice message always look the same (made from its id)
  function heights(id) {
    let h = 2166136261;
    const out = [];
    for (let i = 0; i < BARS; i++) {
      h ^= (id.charCodeAt(i % id.length) || 7) + i * 31;
      h = Math.imul(h, 16777619) >>> 0;
      out.push(25 + (h % 75));
    }
    return out;
  }
  function paint(id) {
    for (const el of document.querySelectorAll('.vm')) {
      if (el.dataset.vid !== id && !el.classList.contains('vm-on')) continue;
      const on = !!playing && playing.id === el.dataset.vid;
      el.classList.toggle('vm-on', on);
      const btn = $('.vm-play', el);
      const going = on && !audio.paused;
      btn.innerHTML = going ? ICON.pause : ICON.play;
      btn.setAttribute('aria-label', going ? t('Pause') : t('Play'));
      btn.title = btn.getAttribute('aria-label');
      const ms = Number(el.dataset.ms) || 0;
      const dur = on && isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : ms;
      const at = on ? audio.currentTime * 1000 : 0;
      const frac = on && dur ? Math.min(1, at / dur) : 0;
      el.querySelectorAll('.vm-bars i').forEach((b, i) => b.classList.toggle('on', on && (i + 0.5) / BARS <= frac));
      $('.vm-time', el).textContent = clock(on && at > 0 ? at : ms);
      $('.vm-bars', el).setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    }
  }
  audio.ontimeupdate = () => playing && paint(playing.id);
  audio.onplay = audio.onpause = () => playing && paint(playing.id);
  audio.onended = () => {
    const was = playing;
    stop();
    if (was) paint(was.id);
  };
  function stop() {
    if (!playing) return;
    audio.pause();
    if (playing.url) URL.revokeObjectURL(playing.url);
    playing = null;
    audio.removeAttribute('src');
  }
  async function toggle(id, ms, load, at) {
    if (playing && playing.id === id) {
      if (typeof at === 'number') { if (isFinite(audio.duration)) audio.currentTime = at * audio.duration; if (audio.paused) audio.play().catch(() => {}); return; }
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      return;
    }
    const was = playing?.id;
    stop();
    if (was) paint(was);
    let blob = null;
    try { blob = await load(); } catch {}
    if (!blob) return toast(t('This file is no longer available'));
    playing = { id, ms, url: URL.createObjectURL(blob) };
    audio.src = playing.url;
    audio.playbackRate = rate;
    try {
      await audio.play();
      if (typeof at === 'number') audio.addEventListener('loadedmetadata', () => { if (isFinite(audio.duration)) audio.currentTime = at * audio.duration; }, { once: true });
    } catch {
      toast(t('This browser can\'t play this voice message'));
      stop();
    }
    paint(id);
  }
  // The player inside a bubble. opts: { id, ms, load() -> Promise<Blob> }
  function player(opts) {
    addStyle();
    const el = document.createElement('div');
    el.className = 'vm';
    el.dataset.vid = opts.id;
    el.dataset.ms = String(opts.ms || 0);
    el.innerHTML = `<button type="button" class="vm-play">${ICON.play}</button>`
      + `<div class="vm-bars" role="slider" tabindex="0" aria-label="${esc(t('Voice note'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${heights(opts.id).map((h) => `<i style="height:${h}%"></i>`).join('')}</div>`
      + `<div class="vm-side"><span class="vm-time"></span><button type="button" class="vm-rate" title="${esc(t('Playback speed'))}" aria-label="${esc(t('Playback speed'))}">${rate}×</button></div>`;
    const go = (at) => toggle(opts.id, opts.ms, opts.load, at);
    $('.vm-play', el).onclick = (e) => { e.stopPropagation(); go(); };
    const bars = $('.vm-bars', el);
    bars.onclick = (e) => {
      e.stopPropagation();
      const r = bars.getBoundingClientRect();
      let frac = (e.clientX - r.left) / (r.width || 1);
      if (getComputedStyle(bars).direction === 'rtl') frac = 1 - frac;
      go(Math.max(0, Math.min(0.99, frac)));
    };
    bars.onkeydown = (e) => {
      if (!playing || playing.id !== opts.id) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5));
      } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    };
    $('.vm-rate', el).onclick = (e) => {
      e.stopPropagation();
      rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
      try { localStorage.setItem(RATE_KEY, String(rate)); } catch {}
      audio.playbackRate = rate;
      document.querySelectorAll('.vm-rate').forEach((b) => { b.textContent = `${rate}×`; });
    };
    // Its look right away (also when it is the one playing now)
    queueMicrotask(() => paint(opts.id));
    const btn = $('.vm-play', el);
    btn.setAttribute('aria-label', t('Play'));
    btn.title = t('Play');
    $('.vm-time', el).textContent = clock(opts.ms || 0);
    return el;
  }

  // ---------- Recording ----------
  // Wires the microphone button of a message box. box: the element the recording bar covers (the message box row);
  // opts.send(blob, ms) sends it; opts.allowed() says whether sending is possible now.
  function wire(btn, box, opts) {
    addStyle();
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    let bar = box.querySelector(':scope > .vm-rec');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'vm-rec';
      bar.hidden = true;
      bar.innerHTML = `<button type="button" class="vm-bin" title="${esc(t('Delete'))}" aria-label="${esc(t('Delete'))}">${ICON.bin}</button>`
        + '<span class="dot" aria-hidden="true"></span><span class="vm-t" role="timer">0:00</span><span class="vm-hint" aria-live="polite"></span>'
        + `<button type="button" class="vm-go" title="${esc(t('Send'))}" aria-label="${esc(t('Send'))}">${ICON.send}</button>`;
      box.appendChild(bar);
    }
    let st = null; // { stream, rec, chunks, at, timer, mode: 'hold' | 'tap', startX, state }
    const hint = $('.vm-hint', bar);
    const ui = () => {
      bar.hidden = !st;
      box.classList.toggle('vm-busy', !!st);
      bar.classList.toggle('hold', !!st && st.mode === 'hold');
      btn.classList.toggle('holding', !!st && st.mode === 'hold');
      if (!st) return;
      $('.vm-go', bar).hidden = st.mode === 'hold';
      $('.vm-bin', bar).hidden = st.mode === 'hold';
      hint.textContent = st.state === 'starting' ? t('Waiting…')
        : st.mode === 'hold' ? t('Release to send, slide to the side to cancel') : t('Recording… tap to stop.');
    };
    const finish = (send) => {
      const s = st;
      if (!s) return;
      st = null;
      clearInterval(s.timer);
      keepAwake('voice', false);
      const ms = s.at ? Date.now() - s.at : 0;
      const end = () => s.stream?.getTracks().forEach((tr) => tr.stop());
      if (!s.rec || s.rec.state === 'inactive') { end(); ui(); return; }
      s.rec.onstop = () => {
        end();
        if (!send) return;
        if (ms < MIN_MS) return toast(t('Too short. Hold the button while you speak.'));
        const mime = (s.rec.mimeType || s.type || 'audio/webm').split(';')[0];
        const blob = new Blob(s.chunks, { type: mime });
        if (!blob.size) return toast(t('The microphone could not be opened here'));
        opts.send(blob, Math.min(ms, MAX_MS));
      };
      try { s.rec.stop(); } catch { end(); }
      ui();
    };
    const start = async (mode, x) => {
      if (st || !can() || (opts.allowed && !opts.allowed())) return;
      const s = { mode, startX: x || 0, state: 'starting', chunks: [] };
      st = s;
      ui();
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        if (st === s) { st = null; ui(); }
        return toast(err && err.name === 'NotAllowedError' ? t('Microphone access was not allowed') : t('The microphone could not be opened here'));
      }
      if (st !== s) { stream.getTracks().forEach((tr) => tr.stop()); return; } // let go (or cancelled) while asking
      s.stream = stream;
      s.type = TYPES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
      try { s.rec = new MediaRecorder(stream, s.type ? { mimeType: s.type, audioBitsPerSecond: 48000 } : {}); } catch { s.rec = new MediaRecorder(stream); }
      s.rec.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
      s.rec.start(1000);
      s.at = Date.now();
      s.state = 'rec';
      // Let go while the browser was still asking for the microphone: keep recording until Send
      if (s.released) s.mode = 'tap';
      keepAwake('voice', true);
      navigator.vibrate?.(20);
      s.timer = setInterval(() => {
        const ms = Date.now() - s.at;
        $('.vm-t', bar).textContent = clock(ms);
        if (ms >= MAX_MS) finish(true);
      }, 200);
      $('.vm-t', bar).textContent = '0:00';
      ui();
    };
    btn.onpointerdown = (e) => {
      if (e.button) return;
      e.preventDefault();
      if (st) return;
      try { btn.setPointerCapture(e.pointerId); } catch {}
      start('hold', e.clientX);
    };
    btn.onpointermove = (e) => {
      if (!st || st.mode !== 'hold') return;
      const away = Math.abs(e.clientX - st.startX) > 90;
      bar.classList.toggle('away', away);
      if (away) hint.textContent = t('Let go to delete');
      else ui();
    };
    const up = (e) => {
      if (!st || st.mode !== 'hold') return;
      if (st.state === 'starting') { st.released = true; return; }
      const away = e && Math.abs(e.clientX - st.startX) > 90;
      bar.classList.remove('away');
      // A short tap: keep recording hands-free (Send or the bin end it)
      if (!away && Date.now() - st.at < 700) { st.mode = 'tap'; ui(); return; }
      finish(!away);
    };
    btn.onpointerup = up;
    btn.onpointercancel = () => { if (st && st.mode === 'hold') { st.mode = 'tap'; ui(); } };
    btn.oncontextmenu = (e) => e.preventDefault();
    btn.onclick = (e) => e.preventDefault();
    btn.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (!st) start('tap');
    };
    $('.vm-go', bar).onclick = (e) => { e.stopPropagation(); finish(true); };
    $('.vm-bin', bar).onclick = (e) => { e.stopPropagation(); finish(false); };
    bar.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    return { cancel: () => finish(false), get busy() { return !!st; } };
  }

  window.Voice = { can, player, wire, stop, clock };
})();
