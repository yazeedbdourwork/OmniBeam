// OmniBeam: light file tools before sending (⋯ menu → File tools, or More… on a device → File tools).
// Loaded by app.js when first used. Everything happens in this browser: no file is uploaded anywhere.
//   - Merge PDFs: choose two or more PDFs, put them in order, get one PDF (pdf-lib, public/pdf-lib.js, MIT).
//   - Resize pictures: make photos smaller (longest side 3840 / 2560 / 1920 / 1280 / 800 px) as JPEG, WebP or the
//     same kind, with the quality you pick. The picture's rotation is kept; location and camera details are left out.
// The results can be sent to a device that is here (or the device it was opened from) or saved on this device.
// It uses app.js's helpers ($, t, toast, peers, formatSize…) directly.
'use strict';
(function () {
  const PDFLIB = '/pdf-lib.js?v=1.17.1';
  const MAX_FILES = 100;
  const STYLE = `
.ftools-dialog { width: min(560px, 100vw); max-width: 100vw; max-height: 100dvh; }
@media (max-width: 600px) { .ftools-dialog { width: 100vw; margin: 0; border-radius: 0; height: 100dvh; } }
.ft-tabs { display: flex; gap: 6px; margin: 4px 0 12px; }
.ft-tabs button { flex: 1; padding: 9px 10px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.ft-tabs button[aria-selected="true"] { background: var(--accent, #5248e8); color: #fff; border-color: transparent; }
.ft-pane[hidden] { display: none; }
.ft-list { list-style: none; margin: 8px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 38vh; overflow-y: auto; }
.ft-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 12px; background: rgba(127,127,127,.1); }
.ft-list li .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
.ft-list li small { opacity: .7; white-space: nowrap; }
.ft-list li button { border: 0; background: none; color: inherit; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; }
.ft-list li button:hover { background: rgba(127,127,127,.18); }
.ft-list li button:disabled { opacity: .25; cursor: default; }
.ft-opts { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; align-items: center; margin: 8px 0; }
.ft-opts select, .ft-opts input[type=range] { width: 100%; }
.ft-opts select { padding: 7px 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; }
.ft-state { min-height: 1.4em; margin: 8px 0; }
.ft-out[hidden] { display: none; }
.ft-out h4 { margin: 12px 0 4px; }
.ft-send { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.ft-send select { flex: 1 1 160px; padding: 9px 10px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; }
.ftools-dialog .row { flex-wrap: wrap; }
`;
  let styled = false;
  let dlg = null;
  let tab = 'pdf';
  let pdfs = [];       // File[] in the order chosen
  let pics = [];       // File[]
  let results = [];    // File[] made here
  let target = null;   // the device it was opened from (More…)
  let busy = false;

  const size = (n) => (typeof formatSize === 'function' ? formatSize(n) : `${Math.round(n / 1024)} KB`);
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isPic = (f) => /^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);
  const baseName = (n) => String(n).replace(/\.[^.]+$/, '') || 'file';

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
    dlg.id = 'dlg-ftools';
    dlg.className = 'ftools-dialog';
    dlg.setAttribute('aria-labelledby', 'ft-title');
    dlg.innerHTML = `<h3 id="ft-title"></h3>
      <p class="muted small" data-k="about"></p>
      <div class="ft-tabs" role="tablist">
        <button type="button" role="tab" data-tab="pdf" aria-selected="true"></button>
        <button type="button" role="tab" data-tab="pic" aria-selected="false"></button>
      </div>
      <div class="ft-pane" data-pane="pdf">
        <p class="muted small" data-k="pdf-about"></p>
        <ul class="ft-list" data-list="pdf"></ul>
        <div class="row"><button type="button" class="btn ghost" data-act="add-pdf"></button><button type="button" class="btn" data-act="merge"></button></div>
      </div>
      <div class="ft-pane" data-pane="pic" hidden>
        <p class="muted small" data-k="pic-about"></p>
        <ul class="ft-list" data-list="pic"></ul>
        <div class="ft-opts">
          <label for="ft-max"></label>
          <select id="ft-max"><option value="3840">3840 px (4K)</option><option value="2560">2560 px</option><option value="1920" selected>1920 px (Full HD)</option><option value="1280">1280 px</option><option value="800">800 px</option></select>
          <label for="ft-fmt"></label>
          <select id="ft-fmt"><option value="same"></option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select>
          <label for="ft-q"></label>
          <input id="ft-q" type="range" min="50" max="95" step="5" value="85">
        </div>
        <div class="row"><button type="button" class="btn ghost" data-act="add-pic"></button><button type="button" class="btn" data-act="resize"></button></div>
      </div>
      <p class="ft-state" role="status" aria-live="polite"></p>
      <div class="ft-out" hidden>
        <h4></h4>
        <ul class="ft-list" data-list="out"></ul>
        <div class="ft-send"><select aria-label=""></select><button type="button" class="btn" data-act="send"></button><button type="button" class="btn ghost" data-act="save"></button></div>
      </div>
      <div class="row"><button type="button" class="btn ghost" data-act="close"></button></div>`;
    $('#ft-title', dlg).textContent = t('File tools');
    $('[data-k=about]', dlg).textContent = t('Get files ready before you send them. Everything happens on this device: nothing is uploaded.');
    $('[data-tab=pdf]', dlg).textContent = t('Merge PDFs');
    $('[data-tab=pic]', dlg).textContent = t('Resize pictures');
    $('[data-k=pdf-about]', dlg).textContent = t('Choose two or more PDFs and put them in the order you want. They become one PDF.');
    $('[data-k=pic-about]', dlg).textContent = t('Make photos smaller to send them faster. Location and camera details are left out.');
    $('[data-act=add-pdf]', dlg).textContent = t('Choose PDFs');
    $('[data-act=merge]', dlg).textContent = t('Merge into one PDF');
    $('[data-act=add-pic]', dlg).textContent = t('Choose pictures');
    $('[data-act=resize]', dlg).textContent = t('Resize');
    $('label[for=ft-max]', dlg).textContent = t('Longest side');
    $('label[for=ft-fmt]', dlg).textContent = t('Format');
    $('#ft-fmt option[value=same]', dlg).textContent = t('Same as now');
    $('label[for=ft-q]', dlg).textContent = t('Quality');
    $('.ft-out h4', dlg).textContent = t('Ready');
    $('.ft-send select', dlg).setAttribute('aria-label', t('Send to'));
    $('[data-act=send]', dlg).textContent = t('Send');
    $('[data-act=save]', dlg).textContent = t('Save on this device');
    $('[data-act=close]', dlg).textContent = t('Close');
    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) return showTab(b.dataset.tab);
      const act = b.dataset.act;
      const row = b.closest('li');
      if (row && act) return rowAct(row, act);
      if (act === 'close') dlg.close();
      else if (act === 'add-pdf') pick('application/pdf,.pdf', (fs) => { pdfs = pdfs.concat(fs.filter(isPdf)).slice(0, MAX_FILES); paint(); });
      else if (act === 'add-pic') pick('image/*', (fs) => { pics = pics.concat(fs.filter(isPic)).slice(0, MAX_FILES); paint(); });
      else if (act === 'merge') merge();
      else if (act === 'resize') resize();
      else if (act === 'send') sendOut();
      else if (act === 'save') saveOut();
    });
    document.body.append(dlg);
    return dlg;
  }
  function showTab(name) {
    tab = name;
    for (const b of dlg.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const p of dlg.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== name;
    say('');
  }
  function say(text) { $('.ft-state', dlg).textContent = text; }
  function pick(accept, done) {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept });
    input.onchange = () => { done([...input.files]); input.remove(); };
    input.click();
  }
  function row(f, i, n, moves) {
    const li = document.createElement('li');
    li.dataset.i = i;
    li.innerHTML = '<span class="n"></span><small></small>' + (moves
      ? `<button type="button" data-act="up" ${i ? '' : 'disabled'}>↑</button><button type="button" data-act="down" ${i < n - 1 ? '' : 'disabled'}>↓</button>` : '')
      + '<button type="button" data-act="x">✕</button>';
    $('.n', li).textContent = f.name;
    $('small', li).textContent = f.note || size(f.size);
    if (moves) {
      $('[data-act=up]', li).setAttribute('aria-label', t('Move up'));
      $('[data-act=down]', li).setAttribute('aria-label', t('Move down'));
    }
    $('[data-act=x]', li).setAttribute('aria-label', t('Remove'));
    return li;
  }
  function paint() {
    const lp = $('[data-list=pdf]', dlg), li = $('[data-list=pic]', dlg), lo = $('[data-list=out]', dlg);
    lp.replaceChildren(...pdfs.map((f, i) => row(f, i, pdfs.length, true)));
    li.replaceChildren(...pics.map((f, i) => row(f, i, pics.length, false)));
    lo.replaceChildren(...results.map((f, i) => row(f, i, results.length, false)));
    $('[data-act=merge]', dlg).disabled = busy || pdfs.length < 2;
    $('[data-act=resize]', dlg).disabled = busy || !pics.length;
    $('.ft-out', dlg).hidden = !results.length;
    // Devices to send to: the one it was opened from first, then the others here
    const sel = $('.ft-send select', dlg);
    const list = [...peers.values()];
    if (target && peers.get(target.info.id) !== target) target = null;
    const old = sel.value;
    sel.replaceChildren(...list.map((p) => Object.assign(document.createElement('option'), { value: p.info.id, textContent: p.info.name })));
    if (!list.length) sel.append(Object.assign(document.createElement('option'), { value: '', textContent: t('No device here yet') }));
    sel.value = target ? target.info.id : list.some((p) => p.info.id === old) ? old : (list[0]?.info.id || '');
    $('[data-act=send]', dlg).disabled = !list.length;
  }
  function rowAct(li, act) {
    const i = Number(li.dataset.i);
    const list = li.parentElement.dataset.list;
    const arr = list === 'pdf' ? pdfs : list === 'pic' ? pics : results;
    if (act === 'x') arr.splice(i, 1);
    else if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    paint();
  }

  // ---- Merge PDFs ----
  async function merge() {
    if (busy || pdfs.length < 2) return;
    busy = true;
    paint();
    say(t('Merging {n} PDFs…', { n: pdfs.length }));
    try {
      await loadScript(PDFLIB);
      const { PDFDocument } = window.PDFLib;
      const out = await PDFDocument.create();
      let pages = 0;
      for (const f of pdfs) {
        let src;
        try {
          src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: false });
        } catch (err) {
          throw new Error(/encrypt/i.test(err?.message || '') ? t('{name} is locked with a password. Open it, save a copy without the password, and try again.', { name: f.name })
            : t('{name} could not be read as a PDF.', { name: f.name }));
        }
        const copied = await out.copyPages(src, src.getPageIndices());
        for (const p of copied) out.addPage(p);
        pages += copied.length;
      }
      out.setProducer('OmniBeam (pdf-lib)');
      const bytes = await out.save();
      const file = new File([bytes], `${baseName(pdfs[0].name)} (merged).pdf`, { type: 'application/pdf' });
      file.note = t('{n} pages', { n: pages }) + ' · ' + size(file.size);
      results = [file];
      say(t('Done: one PDF with {n} pages.', { n: pages }));
      wsSend({ type: 'stat', kind: 'ftpdf', n: pdfs.length });
    } catch (err) {
      say(err.message || t('Something went wrong. Try again.'));
    } finally {
      busy = false;
      paint();
    }
  }

  // ---- Resize pictures ----
  async function resizeOne(f, max, fmt, q) {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    let type = fmt === 'same' ? (/^image\/(png|webp)$/.test(f.type) ? f.type : 'image/jpeg') : fmt;
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    let blob = await new Promise((r) => c.toBlob(r, type, q));
    // A browser without WebP writing gives PNG back: say JPEG instead
    if (!blob || blob.type !== type) { type = 'image/jpeg'; blob = await new Promise((r) => c.toBlob(r, type, q)); }
    if (!blob) throw new Error('toBlob');
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const out = new File([blob], `${baseName(f.name)} (${w}x${h}).${ext}`, { type });
    out.note = `${size(f.size)} → ${size(out.size)}`;
    return out;
  }
  async function resize() {
    if (busy || !pics.length) return;
    busy = true;
    paint();
    const max = Number($('#ft-max', dlg).value) || 1920;
    const fmt = $('#ft-fmt', dlg).value;
    const q = (Number($('#ft-q', dlg).value) || 85) / 100;
    const out = [];
    let failed = 0;
    try {
      for (let i = 0; i < pics.length; i++) {
        say(t('Resizing {i} of {n}…', { i: i + 1, n: pics.length }));
        try { out.push(await resizeOne(pics[i], max, fmt, q)); } catch { failed++; }
      }
      results = out;
      const before = pics.reduce((s, f) => s + f.size, 0), after = out.reduce((s, f) => s + f.size, 0);
      say(failed ? t('{n} pictures ready. {bad} could not be opened in this browser.', { n: out.length, bad: failed })
        : t('{n} pictures ready: {before} → {after}.', { n: out.length, before: size(before), after: size(after) }));
      wsSend({ type: 'stat', kind: 'ftimg', n: out.length });
    } finally {
      busy = false;
      paint();
    }
  }

  // ---- What was made ----
  function sendOut() {
    const id = $('.ft-send select', dlg).value;
    const p = peers.get(id);
    if (!p) return toast(t('No device here yet'));
    if (!results.length) return;
    const files = results.slice();
    dlg.close();
    p.sendFiles(files);
  }
  function saveOut() {
    results.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }, i * 300));
  }

  function open(peer = null, which = null) {
    dialog();
    target = peer || null;
    if (which) showTab(which);
    say('');
    paint();
    if (!dlg.open) dlg.showModal();
  }
  window.addEventListener('omnibeam-peer-left', () => { if (dlg?.open) paint(); });

  window.FileTools = { open, merge, resize, add: (kind, files) => { if (kind === 'pdf') pdfs = pdfs.concat(files); else pics = pics.concat(files); paint(); }, results: () => results };
})();
