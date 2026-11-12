// OmniBeam: browse my computer from my phone. Loaded by app.js the first time it's needed.
// On a computer, ⋯ menu > Share a folder: pick a folder and tick which paired devices may look in it. Those devices
// get "Browse files" in the device's More… window: they see the folder's files and subfolders and take the ones they
// want, which arrive like any transfer (end to end encrypted, accepted without asking because they asked for them).
// Nothing is uploaded anywhere: the list and the files go straight from this tab to the device, so this tab has to
// stay open. Only paired devices can look (each proves its pairing, see pairProof in app.js), only the ones ticked
// here, and names starting with "." are never shown.
// Chrome and Edge keep the folder (File System Access API, the handle in IndexedDB) and ask again after a restart;
// other browsers take a copy of the folder's list when it's picked (webkitdirectory) until the tab is closed.
// Messages over the device connection: fs-ls { path } -> fs-dir { path, root, items: [{ n, d, s, m }], more } or
// fs-no { why: off | denied | paused | gone }; fs-get { paths, want } -> a normal transfer with { want } in its request.
'use strict';
(function () {
  const LS = 'omnibeam-fshare'; // { name, kind: 'handle' | 'list', allowed: [pairing secrets] }
  const MAX_ITEMS = 1500;
  const MAX_GET = 50;
  const CAN_HANDLE = typeof window.showDirectoryPicker === 'function';
  let share = null;   // { name, kind, allowed: Set, root (handle) | files (Map path -> File), on }
  const lookedAt = new Set(); // devices told about this session ("… is looking")
  const wants = new Map();    // want id -> { peer id, at }: files this device asked for

  const readLs = () => { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; } };
  const writeLs = (v) => { try { if (v) localStorage.setItem(LS, JSON.stringify(v)); else localStorage.removeItem(LS); } catch {} };
  function persist() {
    writeLs(share ? { name: share.name, kind: share.kind, allowed: [...share.allowed] } : null);
  }
  // The folder handle, kept in IndexedDB (a handle can't go in localStorage)
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('omnibeam-fshare', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction('h', mode);
          const r = fn(tx.objectStore('h'));
          tx.oncomplete = () => { req.result.close(); resolve(r?.result); };
          tx.onerror = () => { req.result.close(); reject(tx.error); };
        } catch (err) { req.result.close(); reject(err); } // e.g. a handle this browser can't store
      };
    });
  }
  const saveHandle = (h) => idb('readwrite', (s) => (h ? s.put(h, 'root') : s.delete('root'))).catch(() => {});
  const loadHandle = () => idb('readonly', (s) => s.get('root')).catch(() => null);

  // At the start (app.js loads this when a folder was shared before): pick the folder up again if the browser still
  // allows it, otherwise wait for a tap on Share again
  async function restore() {
    const saved = readLs();
    if (!saved) return;
    share = { name: saved.name, kind: saved.kind, allowed: new Set(saved.allowed || []), on: false };
    if (saved.kind !== 'handle') { share = null; persist(); return; } // a list from the folder picker is gone after a reload
    const h = await loadHandle();
    if (!h) { share = null; persist(); return; }
    share.root = h;
    try { share.on = (await h.queryPermission({ mode: 'read' })) === 'granted'; } catch {}
    if (!share.on) toast(t('OmniBeam stopped sharing {name} when it closed. Open ⋯ > Share a folder to share it again.', { name: share.name }), 6000);
    render();
  }

  // ---- This computer: the dialog ----
  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-fshare';
    dlg.setAttribute('aria-labelledby', 'fshare-title');
    dlg.innerHTML = `<h3 id="fshare-title"></h3>
      <p class="muted" data-k="about"></p>
      <p class="fs-state" data-k="state" role="status"></p>
      <div class="row fs-row">
        <button type="button" class="btn" data-act="pick"></button>
        <button type="button" class="btn" data-act="again" hidden></button>
        <button type="button" class="btn ghost" data-act="stop" hidden></button>
      </div>
      <h4 data-k="who"></h4>
      <p class="muted small" data-k="who-note"></p>
      <div class="fs-who"></div>
      <div class="row"><button type="button" class="btn ghost" data-act="close"></button></div>`;
    $('#fshare-title', dlg).textContent = t('Share a folder');
    $('[data-k=about]', dlg).textContent = t('Let your other devices look through a folder on this computer and take any file from it, with nothing uploaded. Keep this tab open while you need it.');
    $('[data-k=who]', dlg).textContent = t('Who can look');
    $('[data-k=who-note]', dlg).textContent = t('Only paired devices you tick here. On them: tap this computer, More…, Browse files.');
    $('[data-act=pick]', dlg).textContent = t('Choose folder');
    $('[data-act=again]', dlg).textContent = t('Share again');
    $('[data-act=stop]', dlg).textContent = t('Stop sharing');
    $('[data-act=close]', dlg).textContent = t('Close');
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'pick') pick();
      else if (act === 'again') again();
      else if (act === 'stop') stop();
    });
    dlg.addEventListener('change', (e) => {
      const box = e.target.closest('input[data-secret]');
      if (!box || !share) return;
      if (box.checked) share.allowed.add(box.dataset.secret); else share.allowed.delete(box.dataset.secret);
      persist();
    });
    document.body.append(dlg);
    return dlg;
  }
  function render() {
    if (!dlg) return;
    const state = $('[data-k=state]', dlg);
    state.textContent = !share ? t('Not sharing a folder.')
      : share.on ? t('Sharing: {name}', { name: share.name }) : t('Paused: {name}. Tap Share again.', { name: share.name });
    $('[data-act=pick]', dlg).textContent = share ? t('Choose another folder') : t('Choose folder');
    $('[data-act=pick]', dlg).className = share?.on ? 'btn ghost' : 'btn';
    $('[data-act=again]', dlg).hidden = !share || share.on;
    $('[data-act=stop]', dlg).hidden = !share;
    const who = $('.fs-who', dlg);
    who.innerHTML = '';
    const paired = loadPaired();
    if (!paired.length) {
      who.innerHTML = `<p class="muted small">${escapeHtml(t('Pair your phone first (the Pair button on the main screen), then tick it here.'))}</p>`;
      return;
    }
    for (const p of paired) {
      const label = document.createElement('label');
      label.className = 'auto-toggle fs-dev';
      label.innerHTML = `<input type="checkbox" data-secret="${escapeHtml(p.secret)}"> <span></span>`;
      label.querySelector('span').textContent = p.name || t('Device');
      label.querySelector('input').checked = !!share?.allowed.has(p.secret);
      label.querySelector('input').disabled = !share;
      who.append(label);
    }
  }
  function defaultAllowed() {
    const paired = loadPaired();
    const trusted = paired.filter((p) => p.trusted);
    return new Set((trusted.length ? trusted : paired).map((p) => p.secret));
  }
  async function pick() {
    const allowed = share?.allowed?.size ? share.allowed : defaultAllowed();
    if (CAN_HANDLE) {
      let h;
      try { h = await window.showDirectoryPicker({ id: 'omnibeam-share', mode: 'read' }); } catch { return; } // cancelled
      share = { name: h.name, kind: 'handle', root: h, allowed, on: true };
      saveHandle(h);
    } else {
      const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, webkitdirectory: true });
      const files = await new Promise((resolve) => {
        input.onchange = () => resolve([...input.files]);
        input.addEventListener('cancel', () => resolve([]));
        input.click();
      });
      if (!files.length) return;
      const map = new Map();
      for (const f of files) {
        const parts = (f.webkitRelativePath || f.name).split('/');
        parts.shift(); // the folder's own name
        if (parts.some((p) => p.startsWith('.'))) continue;
        map.set(parts.join('/'), f);
      }
      share = { name: (files[0].webkitRelativePath || '').split('/')[0] || t('Folder'), kind: 'list', files: map, allowed, on: true };
    }
    persist();
    render();
    wsSend({ type: 'stat', kind: 'fshare' });
    toast(t('Sharing {name} with your ticked devices', { name: share.name }));
  }
  async function again() {
    if (!share?.root) return pick();
    try { share.on = (await share.root.requestPermission({ mode: 'read' })) === 'granted'; } catch { share.on = false; }
    render();
    if (share.on) toast(t('Sharing {name} with your ticked devices', { name: share.name }));
  }
  function stop() {
    share = null;
    persist();
    saveHandle(null);
    render();
    toast(t('Stopped sharing the folder'));
  }

  // ---- This computer: answering a device ----
  const cleanPath = (p) => {
    const parts = String(p || '').split('/').filter(Boolean);
    if (parts.length > 30 || parts.some((x) => x === '.' || x === '..' || x.startsWith('.') || /[\\\x00-\x1f]/.test(x))) return null;
    return parts;
  };
  function allowedFor(peer) {
    if (!share) return 'off';
    if (!peer.pairSecret || !share.allowed.has(peer.pairSecret)) return 'denied';
    if (!share.on) return 'paused';
    return '';
  }
  async function dirOf(parts) {
    let d = share.root;
    for (const p of parts) d = await d.getDirectoryHandle(p);
    return d;
  }
  async function list(parts) {
    const items = [];
    let more = false;
    if (share.kind === 'handle') {
      const dir = await dirOf(parts);
      const files = [];
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (items.length + files.length >= MAX_ITEMS) { more = true; break; }
        if (h.kind === 'directory') items.push({ n: name, d: 1 });
        else files.push(h);
      }
      // Sizes and dates, a few at a time
      for (let i = 0; i < files.length; i += 40) {
        const got = await Promise.all(files.slice(i, i + 40).map((h) => h.getFile().then((f) => ({ n: h.name, s: f.size, m: f.lastModified }), () => null)));
        items.push(...got.filter(Boolean));
      }
    } else {
      const prefix = parts.length ? parts.join('/') + '/' : '';
      const dirs = new Set();
      for (const [p, f] of share.files) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length).split('/');
        if (rest.length > 1) dirs.add(rest[0]);
        else items.push({ n: rest[0], s: f.size, m: f.lastModified });
        if (items.length + dirs.size >= MAX_ITEMS) { more = true; break; }
      }
      for (const d of dirs) items.push({ n: d, d: 1 });
    }
    return { items, more };
  }
  async function fileAt(parts) {
    if (share.kind === 'handle') {
      const dir = await dirOf(parts.slice(0, -1));
      return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    }
    const f = share.files.get(parts.join('/'));
    if (!f) throw new Error('gone');
    return f;
  }
  async function answer(peer, msg) {
    const why = allowedFor(peer);
    if (why) return peer.sendJson({ t: 'fs-no', why });
    if (msg.t === 'fs-ls') {
      const parts = cleanPath(msg.path);
      if (!parts) return peer.sendJson({ t: 'fs-no', why: 'gone', path: String(msg.path || '') });
      if (!lookedAt.has(peer.info.id)) {
        lookedAt.add(peer.info.id);
        toast(t('{name} is looking at your shared folder', { name: peer.info.name }), 4000);
        wsSend({ type: 'stat', kind: 'fbrowse' });
      }
      try {
        const { items, more } = await list(parts);
        peer.sendJson({ t: 'fs-dir', path: parts.join('/'), root: share.name, items, more });
      } catch (err) {
        // The browser took the permission back (a long time in the background), or the folder is gone
        if (err?.name === 'NotAllowedError') { share.on = false; render(); return peer.sendJson({ t: 'fs-no', why: 'paused' }); }
        peer.sendJson({ t: 'fs-no', why: 'gone', path: parts.join('/') });
      }
    } else if (msg.t === 'fs-get') {
      if (!Array.isArray(msg.paths) || typeof msg.want !== 'string' || !/^[0-9a-f]{32}$/.test(msg.want)) return;
      const files = [];
      for (const p of msg.paths.slice(0, MAX_GET)) {
        const parts = cleanPath(p);
        if (!parts?.length) continue;
        try { files.push(await fileAt(parts)); } catch {}
      }
      if (!files.length) return peer.sendJson({ t: 'fs-no', why: 'gone' });
      wsSend({ type: 'stat', kind: 'fget', n: files.length });
      peer.sendFiles(files, { want: msg.want });
    }
  }

  // ---- The other device: looking in the folder ----
  let bdlg = null;
  let at = null; // { peer, path, items, root, filter, chosen: Set }
  function browseDialog() {
    if (bdlg) return bdlg;
    bdlg = document.createElement('dialog');
    bdlg.id = 'dlg-browse';
    bdlg.className = 'browse-dialog';
    bdlg.setAttribute('aria-labelledby', 'browse-title');
    bdlg.innerHTML = `<h3 id="browse-title"></h3>
      <div class="fs-path"><button type="button" class="btn ghost small" data-act="up"></button><span class="fs-crumb"></span></div>
      <input type="search" class="fs-search" autocomplete="off">
      <p class="muted small fs-msg" role="status"></p>
      <ul class="fs-list"></ul>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close"></button>
        <button type="button" class="btn" data-act="get" disabled></button>
      </div>`;
    $('[data-act=up]', bdlg).textContent = t('Up');
    $('[data-act=close]', bdlg).textContent = t('Close');
    const search = $('.fs-search', bdlg);
    search.placeholder = t('Search this folder');
    search.setAttribute('aria-label', t('Search this folder'));
    search.addEventListener('input', () => { if (at) { at.filter = search.value.trim().toLowerCase(); draw(); } });
    bdlg.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      const act = el?.dataset.act;
      if (!act || !at) { if (act === 'close') bdlg.close(); return; }
      if (act === 'close') bdlg.close();
      else if (act === 'up') { const p = at.path.split('/').filter(Boolean); p.pop(); ask(at.peer, p.join('/')); }
      else if (act === 'dir') ask(at.peer, [at.path, el.dataset.name].filter(Boolean).join('/'));
      else if (act === 'get') getChosen();
    });
    bdlg.addEventListener('change', (e) => {
      const box = e.target.closest('input[data-name]');
      if (!box || !at) return;
      const p = [at.path, box.dataset.name].filter(Boolean).join('/');
      if (box.checked) at.chosen.add(p); else at.chosen.delete(p);
      updateGet();
    });
    bdlg.addEventListener('close', () => { at = null; });
    document.body.append(bdlg);
    return bdlg;
  }
  const say = (text) => { if (bdlg) $('.fs-msg', bdlg).textContent = text; };
  function updateGet() {
    const b = $('[data-act=get]', bdlg);
    const n = at?.chosen.size || 0;
    b.disabled = !n;
    b.textContent = n > 1 ? t('Get {n} files', { n }) : t('Get file');
  }
  async function ask(peer, path) {
    if (!at || at.peer !== peer) at = { peer, path: '', items: [], root: '', filter: '', chosen: new Set() };
    at.asked = path;
    say(t('Asking {name}…', { name: peer.info.name }));
    try {
      await peer.connect();
      peer.sendJson({ t: 'fs-ls', path });
    } catch (err) {
      say(t(err.message || 'Connection lost'));
    }
  }
  function draw() {
    const d = bdlg;
    $('#browse-title', d).textContent = t('Browse {name}', { name: at.peer.info.name });
    $('.fs-crumb', d).textContent = [at.root, ...at.path.split('/').filter(Boolean)].join(' / ');
    $('[data-act=up]', d).hidden = !at.path;
    const ul = $('.fs-list', d);
    ul.innerHTML = '';
    const shown = at.items.filter((it) => !at.filter || it.n.toLowerCase().includes(at.filter))
      .sort((a, b) => (b.d || 0) - (a.d || 0) || a.n.localeCompare(b.n, undefined, { numeric: true, sensitivity: 'base' }));
    for (const it of shown.slice(0, 800)) {
      const li = document.createElement('li');
      if (it.d) {
        li.innerHTML = `<button type="button" class="fs-item fs-dir" data-act="dir"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span class="fs-n"></span></button>`;
        li.querySelector('button').dataset.name = it.n;
      } else {
        const p = [at.path, it.n].filter(Boolean).join('/');
        li.innerHTML = `<label class="fs-item"><input type="checkbox"><span class="fs-n"></span><span class="fs-s"></span></label>`;
        const box = li.querySelector('input');
        box.dataset.name = it.n;
        box.checked = at.chosen.has(p);
        li.querySelector('.fs-s').textContent = `${formatSize(it.s || 0)}${it.m ? ' · ' + new Date(it.m).toLocaleDateString() : ''}`;
      }
      li.querySelector('.fs-n').textContent = it.n;
      ul.append(li);
    }
    say(!at.items.length ? t('This folder is empty.') : at.more ? t('Showing the first {n} items.', { n: at.items.length }) : '');
    updateGet();
  }
  async function getChosen() {
    const paths = [...at.chosen].slice(0, MAX_GET);
    if (!paths.length) return;
    const want = randomHex(16);
    wants.set(want, { peer: at.peer.info.id, at: Date.now() });
    try {
      await at.peer.connect();
      at.peer.sendJson({ t: 'fs-get', paths, want });
      toast(paths.length > 1 ? t('Asked {name} for {n} files', { name: at.peer.info.name, n: paths.length }) : t('Asked {name} for the file', { name: at.peer.info.name }));
      at.chosen.clear();
      draw();
    } catch (err) { toast(t(err.message || 'Connection lost')); }
  }
  function onReply(peer, msg) {
    if (!at || at.peer !== peer || !bdlg?.open) {
      if (msg.t === 'fs-no' && wants.size) toast(t('{name} could not send it. The file may have moved.', { name: peer.info.name }));
      return;
    }
    if (msg.t === 'fs-dir') {
      at.path = String(msg.path || '');
      at.root = String(msg.root || '').slice(0, 120);
      at.more = !!msg.more;
      at.items = (Array.isArray(msg.items) ? msg.items : []).slice(0, 5000)
        .filter((it) => it && typeof it.n === 'string' && it.n && !/[\/\\]/.test(it.n))
        .map((it) => ({ n: it.n.slice(0, 255), d: it.d ? 1 : 0, s: Math.max(0, Number(it.s) || 0), m: Number(it.m) || 0 }));
      if (at.asked !== at.path) at.filter = '';
      $('.fs-search', bdlg).value = at.filter;
      draw();
      return;
    }
    const name = peer.info.name;
    const why = msg.why;
    if (why === 'off') say(t('{name} isn\'t sharing a folder. On {name}: ⋯ menu > Share a folder.', { name }));
    else if (why === 'denied') say(t('{name} shares a folder, but not with this device. On {name}: ⋯ > Share a folder, tick this device.', { name }));
    else if (why === 'paused') say(t('{name} paused sharing. On {name}: ⋯ > Share a folder > Share again.', { name }));
    else say(t('That folder or file is no longer there.'));
    if (why !== 'gone') { at.items = []; $('.fs-list', bdlg).innerHTML = ''; }
  }

  window.Browse = {
    restore,
    open() { dialog(); render(); if (!dlg.open) dlg.showModal(); },
    look(peer) {
      browseDialog();
      at = null;
      ask(peer, '');
      $('#browse-title', bdlg).textContent = t('Browse {name}', { name: peer.info.name });
      $('.fs-list', bdlg).innerHTML = '';
      $('.fs-crumb', bdlg).textContent = '';
      $('[data-act=up]', bdlg).hidden = true;
      $('.fs-search', bdlg).value = '';
      updateGet();
      if (!bdlg.open) bdlg.showModal();
    },
    onMsg(peer, msg) {
      if (msg.t === 'fs-ls' || msg.t === 'fs-get') return answer(peer, msg).catch((err) => console.warn('Shared folder', err));
      onReply(peer, msg);
    },
    // app.js: an incoming transfer that this device asked for (accepted without asking)
    wanted(peerId, want) {
      for (const [k, v] of wants) if (Date.now() - v.at > 30 * 60000) wants.delete(k);
      const w = typeof want === 'string' && wants.get(want);
      if (!w || w.peer !== peerId) return false;
      wants.delete(want);
      return true;
    },
  };
})();
