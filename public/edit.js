// OmniBeam: edit a photo before sending it, loaded by the chat view (chat.js) the first time one photo is chosen
// there. The photo shows with Rotate, Crop (drag a box), Draw (with a finger or the mouse, in a few colours), Blur
// (drag a box over a face, a name or a number: it is covered with big squares that can't be undone by the other
// side) and Undo. Send sends it: the original file when nothing was changed, otherwise a new picture made here.
// Everything happens on this device; nothing is uploaded.
'use strict';
(function () {
  const STYLE = `
#dlg-photo-edit:modal { margin: auto; max-height: 100dvh; transform-origin: 50% 50%; }
@media (max-width: 760px) { #dlg-photo-edit:modal { margin: 0; } }
.edit-dialog { width: min(760px, 100vw); max-width: 100vw; height: min(820px, 100dvh); max-height: 100dvh; padding: 0; display: flex; flex-direction: column; overflow: hidden; background: #111318; color: #fff; border: 0; }
.edit-dialog:not([open]) { display: none; }
@media (max-width: 760px) { .edit-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; } }
.edit-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; }
.edit-head b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.edit-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 6px; position: relative; touch-action: none; }
.edit-stage canvas { max-width: 100%; max-height: 100%; display: block; touch-action: none; cursor: crosshair; }
.edit-stage .band { position: absolute; border: 2px dashed #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.45); pointer-events: none; }
.edit-stage .band.blur { box-shadow: none; background: rgba(255,255,255,.18); }
.edit-stage .band[hidden] { display: none; }
.edit-tools { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; padding: 8px 10px 4px; }
.edit-tools button { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 62px; border: 0; border-radius: 12px; padding: 7px 8px; background: rgba(255,255,255,.1); color: #fff; font: inherit; font-size: 12px; cursor: pointer; }
.edit-tools button svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.edit-tools button[aria-pressed="true"] { background: #fff; color: #111318; }
.edit-tools button:disabled { opacity: .4; cursor: default; }
.edit-colors { display: flex; justify-content: center; gap: 10px; padding: 4px 0 2px; }
.edit-colors[hidden] { display: none; }
.edit-colors button { width: 28px; height: 28px; border-radius: 50%; border: 2px solid rgba(255,255,255,.6); cursor: pointer; padding: 0; }
.edit-colors button[aria-pressed="true"] { outline: 3px solid #fff; outline-offset: 2px; }
.edit-hint { text-align: center; font-size: 12.5px; opacity: .8; margin: 2px 10px 0; min-height: 1.3em; }
.edit-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 8px 14px calc(12px + env(safe-area-inset-bottom)); }
.edit-foot .btn.ghost { color: #fff; background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.35); box-shadow: none; }
`;
  const ICON = {
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>',
    crop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.1 1v15.9a1 1 0 0 0 1 1H23M1 6.1h15.9a1 1 0 0 1 1 1V23"/></svg>',
    draw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    blur: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h4v4H3zM10 3h4v4h-4zM17 3h4v4h-4zM3 10h4v4H3zM17 10h4v4h-4zM3 17h4v4H3zM10 17h4v4h-4zM17 17h4v4h-4zM10 10h4v4h-4z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/></svg>',
  };
  const COLORS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000'];
  const MAX_SIDE = 4096;
  let styled = false;

  function dialog() {
    if (!styled) {
      styled = true;
      document.head.appendChild(Object.assign(document.createElement('style'), { textContent: STYLE }));
    }
    let dlg = document.getElementById('dlg-photo-edit');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-photo-edit';
    dlg.className = 'edit-dialog';
    dlg.setAttribute('aria-labelledby', 'edit-title');
    const tool = (act, label) => `<button type="button" data-act="${act}"${act === 'rotate' || act === 'undo' ? '' : ' aria-pressed="false"'}>${ICON[act]}<span>${escapeHtml(t(label))}</span></button>`;
    dlg.innerHTML = `
      <div class="edit-head"><b id="edit-title"></b></div>
      <div class="edit-stage"><canvas aria-label="${escapeHtml(t('Photo'))}"></canvas><div class="band" hidden></div></div>
      <p class="edit-hint" aria-live="polite"></p>
      <div class="edit-colors" hidden role="group" aria-label="${escapeHtml(t('Colour'))}">${COLORS.map((c, i) => `<button type="button" data-color="${c}" aria-pressed="${i === 0}" aria-label="${c}" style="background:${c}"></button>`).join('')}</div>
      <div class="edit-tools">${tool('rotate', 'Rotate')}${tool('crop', 'Crop')}${tool('draw', 'Draw')}${tool('blur', 'Blur')}${tool('undo', 'Undo')}</div>
      <div class="edit-foot"><button type="button" class="btn ghost" data-act="cancel">${escapeHtml(t('Cancel'))}</button><button type="button" class="btn" data-act="send">${escapeHtml(t('Send'))}</button></div>`;
    document.body.appendChild(dlg);
    return dlg;
  }
  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const copyOf = (c) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; };

  // Resolves to the File to send (the same one when nothing changed), or null (Cancel)
  async function open(file, name) {
    const dlg = dialog();
    let img;
    try { img = await loadImage(file); } catch { return file; } // can't be read here: send it as it is
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    if (!w0 || !h0) return file;
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const cv = $('canvas', dlg);
    cv.width = Math.round(w0 * k);
    cv.height = Math.round(h0 * k);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    img.close?.();
    $('#edit-title').textContent = t('Send to {name}', { name });
    const band = $('.band', dlg);
    const hint = $('.edit-hint', dlg);
    const colors = $('.edit-colors', dlg);
    const undoBtn = $('[data-act=undo]', dlg);
    let mode = '';
    let color = COLORS[0];
    let history = [];
    let changed = false;
    const setMode = (m) => {
      mode = mode === m ? '' : m;
      for (const b of dlg.querySelectorAll('.edit-tools [aria-pressed]')) b.setAttribute('aria-pressed', String(b.dataset.act === mode));
      colors.hidden = mode !== 'draw';
      hint.textContent = mode === 'crop' ? t('Drag a box around what to keep')
        : mode === 'draw' ? t('Draw on the photo with your finger or the mouse')
          : mode === 'blur' ? t('Drag a box over what to hide') : '';
    };
    const save = () => {
      history.push(copyOf(cv));
      if (history.length > 12) history.shift();
      undoBtn.disabled = false;
      changed = true;
    };
    const put = (c) => {
      cv.width = c.width;
      cv.height = c.height;
      ctx.drawImage(c, 0, 0);
    };
    undoBtn.disabled = true;
    colors.querySelectorAll('[data-color]').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0)));
    setMode('');
    hint.textContent = '';

    // Where a pointer is on the picture itself (in its own pixels)
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      return { x: Math.max(0, Math.min(cv.width, (e.clientX - r.left) * cv.width / r.width)), y: Math.max(0, Math.min(cv.height, (e.clientY - r.top) * cv.height / r.height)), cx: e.clientX, cy: e.clientY };
    };
    let drag = null;
    cv.onpointerdown = (e) => {
      if (!mode) return;
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      drag = { start: at(e), last: at(e) };
      if (mode === 'draw') {
        save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, Math.round(Math.max(cv.width, cv.height) / 180));
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(drag.start.x, drag.start.y);
        ctx.lineTo(drag.start.x + 0.1, drag.start.y + 0.1);
        ctx.stroke();
      }
    };
    cv.onpointermove = (e) => {
      if (!drag) return;
      const p = at(e);
      if (mode === 'draw') {
        ctx.beginPath();
        ctx.moveTo(drag.last.x, drag.last.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else {
        // The box being dragged, over the picture
        const stage = cv.parentElement.getBoundingClientRect();
        const r = cv.getBoundingClientRect();
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const x1 = clamp(drag.start.cx, r.left, r.right), y1 = clamp(drag.start.cy, r.top, r.bottom);
        const x2 = clamp(p.cx, r.left, r.right), y2 = clamp(p.cy, r.top, r.bottom);
        Object.assign(band.style, { left: Math.min(x1, x2) - stage.left + 'px', top: Math.min(y1, y2) - stage.top + 'px', width: Math.abs(x2 - x1) + 'px', height: Math.abs(y2 - y1) + 'px' });
        band.className = 'band' + (mode === 'blur' ? ' blur' : '');
        band.hidden = false;
      }
      drag.last = p;
    };
    const finish = () => {
      if (!drag) return;
      const { start, last } = drag;
      drag = null;
      band.hidden = true;
      if (mode === 'draw') return;
      const x = Math.round(Math.min(start.x, last.x)), y = Math.round(Math.min(start.y, last.y));
      const w = Math.round(Math.abs(last.x - start.x)), h = Math.round(Math.abs(last.y - start.y));
      if (w < 8 || h < 8) return;
      save();
      if (mode === 'crop') {
        const n = document.createElement('canvas');
        n.width = w;
        n.height = h;
        n.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, w, h);
        put(n);
        setMode('');
      } else {
        // Big squares: the part is drawn very small, then stretched back without smoothing
        const block = Math.max(8, Math.round(Math.max(cv.width, cv.height) / 70));
        const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
        const small = document.createElement('canvas');
        small.width = sw;
        small.height = sh;
        small.getContext('2d').drawImage(cv, x, y, w, h, 0, 0, sw, sh);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
        ctx.restore();
      }
    };
    cv.onpointerup = cv.onpointercancel = finish;

    return new Promise((resolve) => {
      let result = null;
      dlg.onclick = async (e) => {
        const c = e.target.closest('[data-color]');
        if (c) {
          color = c.dataset.color;
          for (const b of colors.children) b.setAttribute('aria-pressed', String(b === c));
          return;
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (!act) return;
        if (act === 'cancel') return dlg.close();
        if (act === 'rotate') {
          save();
          const n = document.createElement('canvas');
          n.width = cv.height;
          n.height = cv.width;
          const g = n.getContext('2d');
          g.translate(n.width, 0);
          g.rotate(Math.PI / 2);
          g.drawImage(cv, 0, 0);
          put(n);
        } else if (act === 'undo') {
          const last = history.pop();
          if (last) put(last);
          undoBtn.disabled = !history.length;
          changed = history.length > 0;
        } else if (act === 'send') {
          if (!changed) { result = file; return dlg.close(); }
          const png = file.type === 'image/png';
          const type = png ? 'image/png' : 'image/jpeg';
          const blob = await new Promise((r) => cv.toBlob(r, type, 0.92));
          if (!blob) { result = file; return dlg.close(); }
          const base = file.name.replace(/\.[^./]*$/, '') || 'photo';
          result = new File([blob], `${base}${png ? '.png' : '.jpg'}`, { type, lastModified: Date.now() });
          dlg.close();
        } else setMode(act);
      };
      dlg.onclose = () => {
        history = [];
        cv.width = cv.height = 1; // let go of the picture's memory
        resolve(result);
      };
      dlg.showModal();
      $('[data-act=send]', dlg).focus();
    });
  }
  window.PhotoEdit = { open };
})();
