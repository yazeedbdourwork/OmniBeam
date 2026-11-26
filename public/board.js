// OmniBeam: a shared whiteboard to draw on together with another device (More… on a device → Whiteboard).
// Loaded by app.js when first used. Both devices see the same board: what one draws shows on the other as it is drawn.
// The board is always 1600 × 1000 points, fitted into each screen, so a drawing lands in the same place everywhere.
// Pens in 6 colours and 3 sizes, an eraser, Undo (your own last line), Clear (on both, after asking) and Save picture.
// Nothing is kept on the server: the lines go over the encrypted device connection and live only while it is open.
// Messages: {t:'wb', a:'open'} asks the other device to open the board (it is asked first: Open / Not now);
// a:'all' {s:[strokes]} the lines it already has (in parts); a:'pt' {id, c, w, e, p:[x, y, …]} new points of a line;
// a:'del' {id} undo; a:'clear'; a:'bye' the other closed it. A stroke: { id, c (colour), w (width), e (eraser), p }.
// It uses app.js's helpers ($, t, toast, peers, randomHex…) directly.
'use strict';
(function () {
  const W = 1600, H = 1000;
  const COLORS = ['#111111', '#e5383b', '#1e6ff2', '#1a9a4b', '#f4a100', '#8e44ad'];
  const SIZES = [4, 10, 24];
  const MAX_STROKES = 3000;
  const MAX_POINTS = 4000; // per line
  const STYLE = `
.board-dialog { width: 100vw; height: 100dvh; max-width: 100vw; max-height: 100dvh; margin: 0; padding: 0; border: 0; border-radius: 0; display: flex; flex-direction: column; overflow: hidden; }
.board-dialog:not([open]) { display: none; }
.wb-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid rgba(127,127,127,.25); flex-wrap: wrap; }
.wb-head h3 { flex: 1 1 160px; margin: 0; font-size: 17px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-who { font-size: 13px; opacity: .75; }
.wb-tools { display: flex; align-items: center; gap: 6px; padding: 8px 12px; flex-wrap: wrap; border-bottom: 1px solid rgba(127,127,127,.18); }
.wb-tools .sw { width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(127,127,127,.4); }
.wb-tools .sw[aria-pressed="true"] { border-color: var(--accent, #5248e8); }
.wb-tools .sz, .wb-tools .tl { min-width: 38px; height: 34px; border-radius: 10px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font: inherit; font-size: 13px; padding: 0 8px; }
.wb-tools .sz i { display: block; border-radius: 50%; background: currentColor; }
.wb-tools [aria-pressed="true"].sz, .wb-tools [aria-pressed="true"].tl { background: var(--accent, #5248e8); color: #fff; border-color: transparent; }
.wb-tools .gap { flex: 1; }
.wb-stage { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; background: rgba(127,127,127,.12); overflow: hidden; touch-action: none; }
.wb-stage canvas { background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.18); touch-action: none; cursor: crosshair; display: block; }
.wb-note { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); padding: 6px 14px; border-radius: 10px; background: rgba(20,20,26,.8); color: #fff; font-size: 13px; pointer-events: none; max-width: calc(100% - 24px); text-align: center; }
.wb-note[hidden] { display: none; }
`;
  let styled = false;
  let dlg = null;
  let canvas = null, ctx = null, scale = 1;
  let peer = null;          // the device drawing with this one
  let strokes = [];         // in drawing order
  let live = new Map();     // id -> stroke still being drawn (by anyone)
  let color = COLORS[0], size = SIZES[0], erase = false;
  let mine = null;          // the line this device draws now
  let pending = [];         // its points not sent yet
  let flushTimer = 0;
  let asked = new Map();    // peer id -> time we showed an invite (not twice at once)
  let askDlg = null;

  function addStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style');
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  function send(obj) {
    if (!peer) return false;
    try { peer.sendJson({ t: 'wb', ...obj }); return true; } catch { return false; }
  }
  function note(text) {
    const el = $('.wb-note', dlg);
    el.textContent = text || '';
    el.hidden = !text;
  }

  function dialog() {
    if (dlg) return dlg;
    addStyle();
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-board';
    dlg.className = 'board-dialog';
    dlg.setAttribute('aria-labelledby', 'wb-title');
    const sw = COLORS.map((c, i) => `<button type="button" class="sw" data-color="${c}" style="background:${c}" aria-pressed="${i ? 'false' : 'true'}"></button>`).join('');
    const sz = SIZES.map((s, i) => `<button type="button" class="sz" data-size="${s}" aria-pressed="${i ? 'false' : 'true'}"><i style="width:${Math.min(18, s)}px;height:${Math.min(18, s)}px"></i></button>`).join('');
    dlg.innerHTML = `<div class="wb-head"><h3 id="wb-title"></h3><span class="wb-who" role="status" aria-live="polite"></span>
        <button type="button" class="btn ghost small" data-act="close"></button></div>
      <div class="wb-tools">${sw}<span class="gap"></span>${sz}
        <button type="button" class="tl" data-act="erase" aria-pressed="false"></button>
        <button type="button" class="tl" data-act="undo"></button>
        <button type="button" class="tl" data-act="clear"></button>
        <button type="button" class="tl" data-act="save"></button></div>
      <div class="wb-stage"><canvas width="${W}" height="${H}"></canvas><div class="wb-note" hidden></div></div>`;
    $('[data-act=close]', dlg).textContent = t('Close');
    $('[data-act=erase]', dlg).textContent = t('Eraser');
    $('[data-act=undo]', dlg).textContent = t('Undo');
    $('[data-act=clear]', dlg).textContent = t('Clear');
    $('[data-act=save]', dlg).textContent = t('Save picture');
    for (const b of dlg.querySelectorAll('.sw')) b.setAttribute('aria-label', t('Colour'));
    SIZES.forEach((s, i) => dlg.querySelectorAll('.sz')[i].setAttribute('aria-label', [t('Thin'), t('Medium'), t('Thick')][i]));
    canvas = $('canvas', dlg);
    canvas.setAttribute('aria-label', t('Whiteboard'));
    canvas.setAttribute('role', 'img');
    ctx = canvas.getContext('2d');
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.color) {
        color = b.dataset.color;
        erase = false;
        pressed('.sw', b);
        $('[data-act=erase]', dlg).setAttribute('aria-pressed', 'false');
      } else if (b.dataset.size) {
        size = Number(b.dataset.size);
        pressed('.sz', b);
      } else if (b.dataset.act === 'erase') {
        erase = !erase;
        b.setAttribute('aria-pressed', String(erase));
      } else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'clear') clearAsk();
      else if (b.dataset.act === 'save') savePicture();
      else if (b.dataset.act === 'close') dlg.close();
    });
    dlg.addEventListener('close', () => {
      send({ a: 'bye' });
      peer = null;
      live.clear();
      mine = null;
    });
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('resize', fit);
    document.body.append(dlg);
    return dlg;
  }
  function pressed(sel, on) {
    for (const b of dlg.querySelectorAll(sel)) b.setAttribute('aria-pressed', String(b === on));
  }
  // The board's size on this screen (always W × H points inside)
  function fit() {
    if (!dlg?.open) return;
    const stage = $('.wb-stage', dlg);
    const r = stage.getBoundingClientRect();
    scale = Math.max(0.05, Math.min((r.width - 16) / W, (r.height - 16) / H));
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)];
  }

  // ---- Drawing ----
  function drawStroke(s, from = 0) {
    const p = s.p;
    if (!p.length) return;
    ctx.save();
    ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = s.e ? s.w * 2.5 : s.w;
    ctx.lineCap = ctx.lineJoin = 'round';
    if (p.length <= 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const start = Math.max(0, from - 2);
      ctx.beginPath();
      ctx.moveTo(p[start], p[start + 1]);
      for (let i = start + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  function redraw() {
    ctx.clearRect(0, 0, W, H);
    for (const s of strokes) drawStroke(s);
  }
  function down(e) {
    if (e.button > 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = point(e);
    mine = { id: randomHex(6), c: color, w: size, e: erase ? 1 : 0, p: [x, y], me: 1 };
    strokes.push(mine);
    drawStroke(mine);
    pending = [x, y];
    flush();
  }
  function move(e) {
    if (!mine) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const from = mine.p.length;
    for (const ev of evs.length ? evs : [e]) {
      if (mine.p.length >= MAX_POINTS * 2) break;
      const [x, y] = point(ev);
      const lx = mine.p[mine.p.length - 2], ly = mine.p[mine.p.length - 1];
      if (Math.abs(x - lx) + Math.abs(y - ly) < 2) continue;
      mine.p.push(x, y);
      pending.push(x, y);
    }
    if (mine.p.length > from) drawStroke(mine, from);
    if (!flushTimer) flushTimer = setTimeout(flush, 40);
  }
  function up() {
    if (!mine) return;
    flush();
    mine = null;
    trim();
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = 0;
    if (!mine || !pending.length) return;
    send({ a: 'pt', id: mine.id, c: mine.c, w: mine.w, e: mine.e, p: pending });
    pending = [];
  }
  function trim() {
    if (strokes.length > MAX_STROKES) { strokes = strokes.slice(-MAX_STROKES); redraw(); }
  }
  function undo() {
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (!strokes[i].me) continue;
      const [s] = strokes.splice(i, 1);
      send({ a: 'del', id: s.id });
      redraw();
      return;
    }
  }
  async function clearAsk() {
    if (!strokes.length) return;
    if (!(await confirmBox(t('Clear the whiteboard for both of you?'), t('Clear')))) return;
    strokes = [];
    live.clear();
    redraw();
    send({ a: 'clear' });
  }
  // A small yes/no inside the board (the board is already a modal dialog)
  function confirmBox(text, yes) {
    return new Promise((resolve) => {
      const box = document.createElement('dialog');
      box.className = 'wb-confirm';
      box.innerHTML = '<p></p><div class="row"><button type="button" class="btn ghost" data-v="0"></button><button type="button" class="btn" data-v="1"></button></div>';
      $('p', box).textContent = text;
      $('[data-v="0"]', box).textContent = t('Cancel');
      $('[data-v="1"]', box).textContent = yes;
      box.onclick = (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) box.close(v); };
      box.onclose = () => { resolve(box.returnValue === '1'); box.remove(); };
      dlg.append(box);
      box.showModal();
    });
  }
  function savePicture() {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const o = out.getContext('2d');
    o.fillStyle = '#fff';
    o.fillRect(0, 0, W, H);
    o.drawImage(canvas, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `OmniBeam whiteboard ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }, 'image/png');
  }

  // ---- With the other device ----
  function setPeer(p) {
    peer = p;
    $('#wb-title', dlg).textContent = t('Whiteboard with {name}', { name: p.info.name });
    $('.wb-who', dlg).textContent = '';
  }
  async function open(p) {
    dialog();
    if (peer && peer !== p && dlg.open) dlg.close();
    if (!peer || peer !== p) { strokes = []; live.clear(); }
    setPeer(p);
    if (!dlg.open) dlg.showModal();
    fit();
    redraw();
    note(t('Waiting for {name} to open the whiteboard…', { name: p.info.name }));
    try {
      await p.connect();
      if (peer !== p) return;
      send({ a: 'open' });
      wsSend({ type: 'stat', kind: 'board' });
    } catch {
      note(t('Could not connect to {name}. Keep OmniBeam open on both devices and try again.', { name: p.info.name }));
    }
  }
  function shareAll() {
    const list = strokes.map(({ id, c, w, e, p }) => ({ id, c, w, e, p }));
    for (let i = 0; i < list.length || i === 0; i += 40) send({ a: 'all', s: list.slice(i, i + 40), first: i === 0 ? 1 : 0 });
  }
  const okColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#111111');
  const okPoints = (p) => (Array.isArray(p) ? p.slice(0, MAX_POINTS * 2).map((v) => Math.max(-50, Math.min(W + 50, Math.round(Number(v) || 0)))) : []);
  const okId = (id) => (typeof id === 'string' && /^[0-9a-f]{4,16}$/.test(id) ? id : null);
  function addRemote(s) {
    const id = okId(s.id);
    if (!id || strokes.some((x) => x.id === id)) return null;
    const st = { id, c: okColor(s.c), w: Math.max(1, Math.min(60, Number(s.w) || 4)), e: s.e ? 1 : 0, p: okPoints(s.p) };
    if (st.p.length % 2) st.p.pop();
    if (!st.p.length) return null;
    strokes.push(st);
    return st;
  }

  function invite(p) {
    if (Date.now() - (asked.get(p.info.id) || 0) < 15000) return;
    asked.set(p.info.id, Date.now());
    addStyle();
    if (!askDlg) {
      askDlg = document.createElement('dialog');
      askDlg.id = 'dlg-board-ask';
      askDlg.innerHTML = '<h3></h3><p class="muted"></p><div class="row"><button type="button" class="btn ghost" data-act="no"></button><button type="button" class="btn" data-act="yes"></button></div>';
      $('[data-act=no]', askDlg).textContent = t('Not now');
      $('[data-act=yes]', askDlg).textContent = t('Open the whiteboard');
      document.body.append(askDlg);
    }
    $('h3', askDlg).textContent = t('Whiteboard');
    $('p', askDlg).textContent = t('{name} wants to draw with you on a shared whiteboard.', { name: p.info.name });
    askDlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      askDlg.close();
      if (act === 'yes' && peers.get(p.info.id) === p) open(p);
      else if (act === 'no') { try { p.sendJson({ t: 'wb', a: 'no' }); } catch {} }
    };
    if (!askDlg.open) askDlg.showModal();
    if (document.hidden) notify(t('Whiteboard'), t('{name} wants to draw with you on a shared whiteboard.', { name: p.info.name }));
    messageSound?.();
  }

  function onMsg(p, msg) {
    if (IS_TV) return;
    const here = !!dlg?.open && peer === p;
    if (msg.a === 'open') {
      if (here) { note(''); $('.wb-who', dlg).textContent = t('{name} is here', { name: p.info.name }); shareAll(); send({ a: 'here' }); }
      else invite(p);
      return;
    }
    if (!here) return;
    if (msg.a === 'here') {
      note('');
      $('.wb-who', dlg).textContent = t('{name} is here', { name: p.info.name });
      shareAll();
    } else if (msg.a === 'no') {
      note(t('{name} said not now.', { name: p.info.name }));
    } else if (msg.a === 'bye') {
      $('.wb-who', dlg).textContent = t('{name} closed the whiteboard', { name: p.info.name });
    } else if (msg.a === 'all' && Array.isArray(msg.s)) {
      let added = false;
      for (const s of msg.s.slice(0, 200)) if (addRemote(s)) added = true;
      if (added) { trim(); redraw(); }
    } else if (msg.a === 'pt') {
      const id = okId(msg.id);
      if (!id) return;
      let s = live.get(id) || strokes.find((x) => x.id === id && !x.me);
      if (!s) {
        s = addRemote(msg);
        if (s) { live.set(id, s); drawStroke(s); }
        return;
      }
      const from = s.p.length;
      const more = okPoints(msg.p);
      if (s.p.length + more.length > MAX_POINTS * 2) return;
      s.p.push(...more.slice(0, more.length - (more.length % 2)));
      drawStroke(s, from);
      if (live.size > 20) live.delete(live.keys().next().value);
    } else if (msg.a === 'del') {
      const i = strokes.findIndex((x) => x.id === msg.id && !x.me);
      if (i >= 0) { strokes.splice(i, 1); redraw(); }
    } else if (msg.a === 'clear') {
      strokes = [];
      live.clear();
      redraw();
      toast(t('{name} cleared the whiteboard', { name: p.info.name }));
    }
  }
  window.addEventListener('omnibeam-peer-left', (e) => {
    if (peer && peer.info.id === e.detail && dlg?.open) $('.wb-who', dlg).textContent = t('{name} left', { name: peer.info.name });
  });

  window.Board = { open, onMsg, strokes: () => strokes };
})();
