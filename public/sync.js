// OmniBeam: keep a folder the same on two computers. Loaded by app.js the first time it's needed.
// On each computer, ⋯ menu > Sync a folder: choose a folder and the paired computer to sync with. While OmniBeam is
// open on both, files that are new or changed on one computer are copied to the other by themselves, straight from
// one tab to the other (end to end encrypted, nothing kept on the server). Subfolders are included.
// - Each computer only ever pulls: it asks the other for its list of files, compares it with what it remembers from
//   the last sync, and asks for the files that changed there. So both computers have to turn it on, each with the other.
// - A file deleted on one computer stays on the other (a slip can't empty both folders).
// - Changed on both since the last sync: the newer one keeps the name, the older one is kept next to it as
//   "name (computer date).ext", and that copy then syncs too. Nothing is overwritten that wasn't synced before.
// - Names starting with ".", unfinished downloads and temporary files (.crdownload, .part, .tmp, ~$…) are left out,
//   and so is a file still being written (changed in the last few seconds).
// Chrome and Edge only (File System Access API, with permission to change the folder). The folder handle is kept in
// IndexedDB; after a restart the browser asks once more (a card at the bottom).
// Messages over the device connection:
//   sy-ls { id, have } -> sy-list { id, v, i, n, files: [[path, size, modified]] } (n parts) or { id, v, same: 1 }
//   sy-get { paths, want } -> a normal transfer with { want } in its request (file names are the paths), or sy-busy
//   sy-done { items: [[path, theirSize, theirModified, mySize, myModified]] }: "I copied these from you"
//   sy-poke: "my folder changed", sy-no { why: off | other | paused }
'use strict';
(function () {
  const LS = 'omnibeam-fsync'; // { on, secret (the pairing it syncs with), name (folder name), copied }
  const EVERY = 15000;
  const MAX_FILES = 20000;
  const MAX_GET = 50;
  const SETTLE = 3000; // a file changed this recently may still be being written: next time
  const PAGE = 60000;  // characters of file list per message
  const SKIP = /^(\.|~\$|desktop\.ini$|thumbs\.db$)|\.(crdownload|crswap|part|partial|download|tmp|temp|lock|opdownload)$/i;
  const BAD = /[\\\x00-\x1f\x7f<>:"|?*]|[. ]$|^ /; // names one of the computers couldn't save
  const supported = typeof window.showDirectoryPicker === 'function';

  let root = null;     // FileSystemDirectoryHandle
  let perm = 'none';   // granted | prompt | denied | none
  let idx = new Map(); // path -> { ls, lm, rs, rm }: this copy and theirs (size, modified) as of the last sync
  let timer = 0;
  let busy = false;    // a sync round is running
  let again = false;   // asked to run again while one was running
  let scanCache = null; // { at, files: Map path -> { s, m, h }, v, more }
  let lastV = '';      // my folder's version at the last scan (a change pokes the other computer)
  let theirV = '';     // their folder's version at the last round (unchanged: nothing to do)
  let status = '';     // what the dialog shows under the state line
  let checked = 0;     // when the last round ended without trouble
  let copiedNow = 0;   // files copied since this page opened
  let quick = 0;       // quick retries in a row
  let waiting = null;  // { want, paths: Map name -> { p, s, m }, conflicts: Set, resolve, at }
  const lists = new Map(); // id -> { parts: [], resolve }

  const load = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null') || {}; } catch { return {}; } };
  const save = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch {} };

  // The folder handle and what was synced, in IndexedDB (a handle can't go in localStorage)
  function db(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('omnibeam-fsync', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        let tx;
        let r;
        try {
          tx = req.result.transaction('h', mode);
          r = fn(tx.objectStore('h'));
        } catch (err) { req.result.close(); return reject(err); }
        tx.oncomplete = () => { req.result.close(); resolve(r && 'result' in r ? r.result : undefined); };
        tx.onerror = tx.onabort = () => { req.result.close(); reject(tx.error); };
      };
    });
  }
  let saveTimer = 0;
  function saveIdx() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db('readwrite', (st) => st.put([...idx], 'idx')).catch(() => {}), 500);
  }

  const target = (c = load()) => loadPaired().find((p) => p.secret === c.secret) || null;
  const targetPeer = (c = load()) => (c.secret && [...peers.values()].find((p) => p.pairSecret && p.pairSecret === c.secret)) || null;

  async function checkPerm(ask = false) {
    if (!root) return (perm = 'none');
    try {
      perm = await root.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && ask) perm = await root.requestPermission({ mode: 'readwrite' });
    } catch { perm = 'denied'; }
    return perm;
  }

  // ---- My folder ----
  const cleanPath = (p) => {
    const parts = String(p || '').split('/');
    if (!parts.length || parts.length > 30 || parts.some((x) => !x || x === '.' || x === '..' || SKIP.test(x) || BAD.test(x) || x.length > 255)) return null;
    return parts;
  };
  // A short fingerprint of the whole list: the same list gives the same one
  function version(files) {
    let h = 0x811c9dc5;
    const keys = [...files.keys()].sort();
    for (const k of keys) {
      const f = files.get(k);
      const line = `${k}|${f.s}|${f.m}\n`;
      for (let i = 0; i < line.length; i++) h = Math.imul(h ^ line.charCodeAt(i), 16777619);
    }
    return `${keys.length}.${(h >>> 0).toString(16)}`;
  }
  // Every file in the folder and its subfolders: path -> { s, m, h }
  async function scan(fresh = false) {
    if (!fresh && scanCache && Date.now() - scanCache.at < 2000) return scanCache;
    const files = new Map();
    let more = false;
    const now = Date.now();
    async function walk(dir, prefix, depth) {
      for await (const [name, h] of dir.entries()) {
        if (SKIP.test(name) || BAD.test(name)) continue;
        if (files.size >= MAX_FILES) { more = true; return; }
        const p = prefix + name;
        if (h.kind === 'directory') { if (depth < 29) await walk(h, p + '/', depth + 1); continue; }
        try {
          const f = await h.getFile();
          if (now - f.lastModified < SETTLE) continue;
          files.set(p, { s: f.size, m: f.lastModified, h });
        } catch {} // removed or locked while we looked
      }
    }
    await walk(root, '', 0);
    scanCache = { at: Date.now(), files, v: version(files), more };
    return scanCache;
  }
  async function dirAt(parts, create) {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  }
  async function fileAt(parts) {
    const dir = await dirAt(parts.slice(0, -1), false);
    return (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  }
  async function writeAt(parts, blob) {
    const dir = await dirAt(parts.slice(0, -1), true);
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    try { await w.write(blob); await w.close(); } catch (err) { await w.abort?.().catch(() => {}); throw err; }
    return fh.getFile();
  }
  // "report.docx" -> "report (Laptop 2026-11-14 0930).docx", next to it
  function conflictName(p, m, n = 1) {
    const d = new Date(m || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    const who = String(me.name || 'OmniBeam').replace(/[\\/<>:"|?*\x00-\x1f]/g, '').slice(0, 40).trim();
    const parts = p.split('/');
    const name = parts.pop();
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return [...parts, `${base} (${who} ${stamp}${n > 1 ? ` ${n}` : ''})${ext}`].join('/');
  }

  // ---- Answering the other computer ----
  function refuse(peer) {
    const c = load();
    if (!c.on || !root) return 'off';
    if (!peer.pairSecret || peer.pairSecret !== c.secret) return 'other';
    if (perm !== 'granted') return 'paused';
    return '';
  }
  async function answer(peer, msg) {
    const why = refuse(peer);
    if (why) {
      if (msg.t === 'sy-done' || msg.t === 'sy-poke') return;
      return peer.sendJson({ t: 'sy-no', why, id: typeof msg.id === 'string' ? msg.id.slice(0, 40) : undefined, want: typeof msg.want === 'string' ? msg.want : undefined });
    }
    if (msg.t === 'sy-ls') {
      const id = String(msg.id || '').slice(0, 40);
      let list;
      try { list = await scan(); } catch (err) { return failed(err, peer, id); }
      if (msg.have && msg.have === list.v) return peer.sendJson({ t: 'sy-list', id, v: list.v, same: 1 });
      // In parts, so no message gets too big
      const pages = [];
      let page = [];
      let size = 0;
      for (const [p, f] of list.files) {
        page.push([p, f.s, f.m]);
        size += p.length + 30;
        if (size > PAGE) { pages.push(page); page = []; size = 0; }
      }
      pages.push(page);
      pages.forEach((files, i) => peer.sendJson({ t: 'sy-list', id, v: list.v, i, n: pages.length, files }));
    } else if (msg.t === 'sy-get') {
      if (!Array.isArray(msg.paths) || typeof msg.want !== 'string' || !/^[0-9a-f]{32}$/.test(msg.want)) return;
      if (peer.busy) return peer.sendJson({ t: 'sy-busy', want: msg.want });
      const files = [];
      for (const p of msg.paths.slice(0, MAX_GET)) {
        const parts = cleanPath(p);
        if (!parts) continue;
        try {
          const f = await fileAt(parts);
          f.relPath = parts.join('/'); // the name it's sent with (see pathOf in app.js)
          files.push(f);
        } catch {}
      }
      if (!files.length) return peer.sendJson({ t: 'sy-busy', want: msg.want, gone: 1 });
      if (peer.busy) return peer.sendJson({ t: 'sy-busy', want: msg.want });
      peer.lastSendResult = '';
      await peer.sendFiles(files, { want: msg.want, sync: true });
      // Declined (it had started a transfer of its own just then) or broken off: it asks again
      if (peer.lastSendResult !== 'ok') peer.sendJson({ t: 'sy-busy', want: msg.want });
    } else if (msg.t === 'sy-done') {
      // They copied these from me: remember both sides, so neither copies it back
      for (const it of (Array.isArray(msg.items) ? msg.items : []).slice(0, MAX_GET)) {
        if (!Array.isArray(it) || !cleanPath(it[0])) continue;
        const [p, ls, lm, rs, rm] = it.map((x, i) => (i ? Number(x) || 0 : x));
        idx.set(p, { ls, lm, rs, rm });
      }
      saveIdx();
    } else if (msg.t === 'sy-poke') {
      setTimeout(round, 300);
    }
  }
  function failed(err, peer, id) {
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') { perm = 'prompt'; askAgain(); }
    else if (err?.name === 'NotFoundError') status = t('The folder was moved or deleted. Choose it again.');
    render();
    if (peer) peer.sendJson({ t: 'sy-no', why: 'paused', id });
  }

  // ---- Pulling from the other computer ----
  function theirList(peer) {
    const id = randomHex(8);
    return new Promise((resolve) => {
      const done = (v) => { clearTimeout(timeout); lists.delete(id); resolve(v); };
      const timeout = setTimeout(() => done(null), 60000);
      lists.set(id, { parts: [], done });
      peer.sendJson({ t: 'sy-ls', id, have: theirV || undefined });
    });
  }
  function onList(msg) {
    const l = lists.get(String(msg.id || ''));
    if (!l) return;
    if (msg.t === 'sy-no') return l.done({ no: msg.why });
    if (msg.same) return l.done({ v: String(msg.v || ''), same: true });
    const n = Math.min(1000, Math.max(1, Number(msg.n) || 1));
    const i = Number(msg.i) || 0;
    l.parts[i] = Array.isArray(msg.files) ? msg.files : [];
    if (l.parts.filter(Boolean).length < n) return;
    const files = new Map();
    for (const part of l.parts) {
      for (const it of part || []) {
        if (!Array.isArray(it) || files.size >= MAX_FILES || !cleanPath(it[0])) continue;
        files.set(it[0], { s: Math.max(0, Number(it[1]) || 0), m: Number(it[2]) || 0 });
      }
    }
    l.done({ v: String(msg.v || ''), files });
  }

  // What to take from them: [{ p, s, m, conflict }]
  function plan(mine, theirs) {
    const get = [];
    for (const [p, r] of theirs) {
      const rec = idx.get(p);
      if (rec && rec.rs === r.s && rec.rm === r.m) continue; // not changed there since the last sync
      const loc = mine.get(p);
      if (!loc) { get.push({ p, s: r.s, m: r.m }); continue; }
      // The same file on both already (same size, saved within a couple of seconds): just remember it
      if (loc.s === r.s && Math.abs(loc.m - r.m) < 2000) { idx.set(p, { ls: loc.s, lm: loc.m, rs: r.s, rm: r.m }); continue; }
      const mineChanged = !rec || rec.ls !== loc.s || rec.lm !== loc.m;
      if (!mineChanged) { get.push({ p, s: r.s, m: r.m }); continue; }
      // Changed on both: the newer one keeps the name, the older one is kept beside it
      if (r.m > loc.m) get.push({ p, s: r.s, m: r.m, conflict: true });
      else idx.set(p, { ls: loc.s, lm: loc.m, rs: r.s, rm: r.m }); // mine is newer: they take mine (and keep theirs)
    }
    return get;
  }

  async function round() {
    let retry = false;
    const c = load();
    if (!c.on || !root) return;
    if (busy) { again = true; return; }
    const peer = targetPeer(c);
    if (perm !== 'granted' && (await checkPerm()) !== 'granted') { askAgain(); return render(); }
    busy = true;
    try {
      const mine = await scan(true);
      const changed = lastV && mine.v !== lastV;
      lastV = mine.v;
      if (!peer) { status = t('Waiting for {name} to open OmniBeam.', { name: target(c)?.name || t('Device') }); return; }
      if (peer.busy) return; // a transfer is running: next time
      await peer.connect();
      // My folder changed since the last look: tell them, so they take it now and not at their next round
      if (changed) peer.sendJson({ t: 'sy-poke' });
      const theirs = await theirList(peer);
      if (!theirs) { status = t('Connection lost'); return; }
      if (theirs.no) {
        status = theirs.no === 'paused'
          ? t('{name} paused syncing. On {name}: ⋯ > Sync a folder > Allow.', { name: peer.info.name })
          : t('{name} isn\'t syncing with this computer yet. On {name}: ⋯ > Sync a folder, choose a folder and this computer.', { name: peer.info.name });
        return;
      }
      if (theirs.same) { checked = Date.now(); status = ''; return; }
      const get = plan(mine.files, theirs.files);
      saveIdx();
      let ok = true;
      for (let i = 0; i < get.length && ok; i += MAX_GET) {
        const batch = get.slice(i, i + MAX_GET);
        status = t('Copying {n} files from {name}…', { n: get.length - i, name: peer.info.name });
        render();
        ok = await take(peer, batch);
      }
      if (ok) { theirV = theirs.v; checked = Date.now(); status = ''; } else retry = true;
      if (mine.more || theirs.files.size >= MAX_FILES) status = t('Only the first {n} files are synced.', { n: MAX_FILES });
    } catch (err) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.name === 'NotFoundError') failed(err);
      else status = t(err?.message || 'Connection lost');
    } finally {
      busy = false;
      render();
      if (again) { again = false; setTimeout(round, 500); }
      // Both computers asked at the same moment: try again soon, at a random moment so they don't clash again
      else if (retry && quick++ < 3) setTimeout(round, 2000 + Math.random() * 4000);
      if (!retry) quick = 0;
    }
  }
  // Ask for some files and wait until they're in the folder. False: try again at the next round.
  function take(peer, batch) {
    const want = randomHex(16);
    return new Promise((resolve) => {
      const paths = new Map(batch.map((b) => [safePath(b.p), b]));
      const w = { want, peer: peer.info.id, paths, resolve: null, at: Date.now() };
      // Gave up if nothing arrives: the other computer went away, or it never started sending
      const watch = setInterval(() => {
        if (peers.get(peer.info.id) !== peer) return w.resolve(false);
        if (peer.incoming?.sync === want) w.at = Date.now();
        else if (Date.now() - w.at > 60000) w.resolve(false);
      }, 5000);
      w.resolve = (v) => { clearInterval(watch); if (waiting === w) waiting = null; resolve(v); };
      waiting = w;
      try { peer.sendJson({ t: 'sy-get', paths: batch.map((b) => b.p), want }); } catch { w.resolve(false); }
    });
  }
  // app.js: a transfer this computer asked for arrived (all of it is in the browser's storage): into the folder
  async function received(peer, files, want) {
    const w = waiting && waiting.want === want ? waiting : null;
    const done = [];
    try {
      if (!w) return;
      for (const f of files) {
        const b = w.paths.get(f.name);
        if (!b || !f.blob) continue;
        const parts = cleanPath(b.p);
        if (!parts) continue;
        try {
          const mineNow = await fileAt(parts).catch(() => null);
          // Exactly the same as the file here (two folders that were copies already): nothing to save
          if (mineNow && await same(mineNow, f.blob)) {
            idx.set(b.p, { ls: mineNow.size, lm: mineNow.lastModified, rs: b.s, rm: b.m });
            done.push([b.p, b.s, b.m, mineNow.size, mineNow.lastModified]);
            continue;
          }
          // Changed here too: keep this one next to it under another name first
          if (b.conflict && mineNow) {
            let cp = conflictName(b.p, mineNow.lastModified);
            for (let n = 2; n < 50 && (await fileAt(cp.split('/')).then(() => true, () => false)); n++) cp = conflictName(b.p, mineNow.lastModified, n);
            const kept = await writeAt(cp.split('/'), mineNow);
            idx.set(cp, { ls: kept.size, lm: kept.lastModified, rs: -1, rm: -1 });
          }
          const got = await writeAt(parts, f.blob);
          idx.set(b.p, { ls: got.size, lm: got.lastModified, rs: b.s, rm: b.m });
          done.push([b.p, b.s, b.m, got.size, got.lastModified]);
        } catch (err) {
          console.warn('Folder sync: could not save', b.p, err);
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') { failed(err); break; }
          toast(t('Could not save {file} in the folder.', { file: b.p }), 6000);
        }
      }
    } finally {
      files.forEach((f) => f.id && Store.remove(f.id));
    }
    if (!w) return;
    saveIdx();
    scanCache = null;
    if (done.length) {
      copiedNow += done.length;
      const c = load();
      c.copied = (c.copied || 0) + done.length;
      save(c);
      peer.sendJson({ t: 'sy-done', items: done });
      wsSend({ type: 'stat', kind: 'fsyncf', n: done.length });
    }
    w.resolve(done.length === w.paths.size);
  }

  // The same bytes? (Read a piece at a time; very big files count as different)
  async function same(a, b) {
    if (a.size !== b.size || a.size > 512 * 1024 * 1024) return false;
    const STEP = 4 * 1024 * 1024;
    for (let i = 0; i < a.size; i += STEP) {
      const [x, y] = await Promise.all([a.slice(i, i + STEP).arrayBuffer(), b.slice(i, i + STEP).arrayBuffer()]);
      const u = new Uint8Array(x);
      const v = new Uint8Array(y);
      for (let k = 0; k < u.length; k++) if (u[k] !== v[k]) return false;
    }
    return true;
  }

  // ---- Turning it on and off ----
  function start() {
    clearInterval(timer);
    if (!load().on || !root) return;
    timer = setInterval(round, EVERY);
    setTimeout(round, 300);
  }
  function askAgain() {
    if (!load().on || !root) return;
    render();
    if (Nudge.owner === 'fsync') return;
    Nudge.show('fsync', t('Folder sync is paused'), t('Allow OmniBeam to use the folder “{name}” again to keep it in sync.', { name: root.name }), [
      { label: t('Allow'), primary: true, onClick: () => { resume(); } },
      { label: t('Turn off'), onClick: () => { setOn(false); } },
    ]);
  }
  async function resume() {
    if ((await checkPerm(true)) === 'granted') { Nudge.hide('fsync'); start(); }
    render();
  }
  async function setOn(on) {
    const c = load();
    if (on && !root) return toast(t('Choose a folder first.'));
    if (on && !target(c)) return toast(t('Choose the computer to sync with.'));
    if (on && (await checkPerm(true)) !== 'granted') return toast(t('OmniBeam needs permission to change the folder.'));
    c.on = on;
    save(c);
    if (on) {
      toast(t('Folder sync is on: “{folder}” stays the same as on {name}.', { folder: root.name, name: target(c).name }), 5000);
      wsSend({ type: 'stat', kind: 'fsync' });
      start();
      // Tell them now, so they start at once
      const peer = targetPeer(c);
      if (peer) peer.connect().then(() => peer.sendJson({ t: 'sy-poke' })).catch(() => {});
    } else {
      clearInterval(timer);
      Nudge.hide('fsync');
      status = '';
      toast(t('Folder sync is off.'));
    }
    render();
  }
  async function chooseFolder() {
    let h;
    try { h = await window.showDirectoryPicker({ id: 'omnibeam-sync', mode: 'readwrite' }); } catch (err) {
      if (err.name !== 'AbortError') toast(t('Could not open the folder.'));
      return;
    }
    const same = root && (await root.isSameEntry?.(h).catch(() => false));
    root = h;
    perm = 'granted';
    await db('readwrite', (st) => st.put(h, 'root')).catch(() => {});
    if (!same) {
      // Another folder: nothing synced from it yet
      idx = new Map();
      theirV = lastV = '';
      scanCache = null;
      saveIdx();
    }
    const c = load();
    c.name = h.name;
    save(c);
    if (c.on) { theirV = ''; start(); } else if (target(c)) await setOn(true);
    render();
  }

  // ---- The dialog ----
  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-fsync';
    dlg.setAttribute('aria-labelledby', 'fsync-title');
    dlg.innerHTML = `<h3 id="fsync-title"></h3>
      <p class="muted" data-k="about"></p>
      <p class="fs-state" data-k="state" role="status"></p>
      <p class="muted small" data-k="status" aria-live="polite"></p>
      <h4 data-k="folder-h"></h4>
      <div class="row fs-row"><span class="fsync-folder" data-k="folder"></span><button type="button" class="btn ghost small" data-act="pick"></button></div>
      <h4><label for="fsync-to" data-k="to-h"></label></h4>
      <select id="fsync-to"></select>
      <p class="muted small" data-k="note"></p>
      <div class="row fs-row">
        <button type="button" class="btn" data-act="on"></button>
        <button type="button" class="btn" data-act="allow" hidden></button>
        <button type="button" class="btn ghost" data-act="now" hidden></button>
        <button type="button" class="btn ghost" data-act="off" hidden></button>
      </div>
      <div class="row"><button type="button" class="btn ghost" data-act="close"></button></div>`;
    $('#fsync-title', dlg).textContent = t('Sync a folder');
    $('[data-k=about]', dlg).textContent = t('Keep a folder the same on two of your computers. New and changed files copy over by themselves while OmniBeam is open on both. Nothing is uploaded.');
    $('[data-k=folder-h]', dlg).textContent = t('Folder');
    $('[data-k=to-h]', dlg).textContent = t('Sync with');
    $('[data-k=note]', dlg).textContent = t('Do the same on the other computer, choosing this one. A file deleted on one computer stays on the other. If both changed the same file, both versions are kept.');
    $('[data-act=on]', dlg).textContent = t('Start syncing');
    $('[data-act=allow]', dlg).textContent = t('Allow');
    $('[data-act=now]', dlg).textContent = t('Sync now');
    $('[data-act=off]', dlg).textContent = t('Stop syncing');
    $('[data-act=close]', dlg).textContent = t('Close');
    dlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'pick') chooseFolder();
      else if (act === 'on') setOn(true);
      else if (act === 'off') setOn(false);
      else if (act === 'allow') resume();
      else if (act === 'now') { theirV = ''; round(); }
    });
    $('#fsync-to', dlg).addEventListener('change', (e) => {
      const c = load();
      const changed = c.secret !== e.target.value;
      c.secret = e.target.value;
      if (!c.secret) c.on = false;
      if (changed) { idx = new Map(); theirV = ''; saveIdx(); } // another computer: start from scratch
      save(c);
      if (c.on) start(); else clearInterval(timer);
      render();
    });
    document.body.append(dlg);
    return dlg;
  }
  function render() {
    if (!dlg) return;
    const c = load();
    const tgt = target(c);
    const sel = $('#fsync-to', dlg);
    const paired = loadPaired();
    sel.innerHTML = '';
    sel.append(new Option(paired.length ? t('Choose a device') : t('Pair a device first'), ''));
    for (const p of paired) sel.append(new Option(p.name || t('Device'), p.secret));
    sel.value = tgt ? tgt.secret : '';
    $('[data-k=folder]', dlg).textContent = root ? root.name : t('No folder chosen');
    $('[data-act=pick]', dlg).textContent = root ? t('Choose another folder') : t('Choose folder');
    const on = !!c.on && !!root && !!tgt;
    const paused = on && perm !== 'granted';
    $('[data-k=state]', dlg).textContent = !on ? t('Not syncing.')
      : paused ? t('Paused: OmniBeam needs permission to use the folder again.')
        : t('Syncing “{folder}” with {name}.', { folder: root.name, name: tgt.name });
    const lines = [];
    if (on && !paused) {
      if (status) lines.push(status);
      else if (checked) lines.push(t('Up to date. Last checked {time}.', { time: new Date(checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }));
      if (copiedNow) lines.push(t('{n} files copied since this page opened.', { n: copiedNow }));
    } else if (status && !on) lines.push(status);
    $('[data-k=status]', dlg).textContent = lines.join(' ');
    $('[data-act=on]', dlg).hidden = on;
    $('[data-act=on]', dlg).disabled = !root || !tgt;
    $('[data-act=allow]', dlg).hidden = !paused;
    $('[data-act=now]', dlg).hidden = !on || paused;
    $('[data-act=off]', dlg).hidden = !on;
  }

  // At the start (app.js loads this when sync was set up before)
  let restoring = null;
  function restore() {
    if (!restoring) restoring = supported ? restoreNow() : Promise.resolve();
    return restoring;
  }
  async function restoreNow() {
    root = (await db('readonly', (st) => st.get('root')).catch(() => null)) || null;
    const saved = await db('readonly', (st) => st.get('idx')).catch(() => null);
    if (Array.isArray(saved)) idx = new Map(saved.filter((x) => Array.isArray(x) && x[1]));
    if (root) await checkPerm();
    if (load().on && root) {
      if (perm === 'granted') start();
      else setTimeout(askAgain, 3000);
    }
    render();
  }

  window.Sync = {
    supported,
    restore,
    async open() { await restore(); dialog(); render(); if (!dlg.open) dlg.showModal(); },
    onMsg(peer, msg) {
      if (msg.t === 'sy-list' || (msg.t === 'sy-no' && lists.has(String(msg.id || '')))) return onList(msg);
      if (msg.t === 'sy-no' || msg.t === 'sy-busy') {
        if (waiting && waiting.want === msg.want && waiting.peer === peer.info.id) waiting.resolve(false);
        return;
      }
      restore().then(() => answer(peer, msg)).catch((err) => console.warn('Folder sync', err));
    },
    // app.js: is this incoming transfer one this computer asked for? (accepted without asking, saved into the folder)
    wanted(peerId, want) {
      return !!(waiting && typeof want === 'string' && waiting.want === want && waiting.peer === peerId);
    },
    received,
  };
})();
