// OmniBeam: photo backup that skips repeats. Loaded by app.js the first time it's needed.
// On a computer, ⋯ menu > Photo backup: pick a backup folder and tick which paired phones may back up into it.
// On the phone: tap the computer, More…, Back up photos, and choose photos and videos. The phone sends a short
// fingerprint of each one (its size and a SHA-256 of its first and last 64 KB, never the photo); the computer
// answers which ones it doesn't have yet, and only those are sent, as originals (no shrinking, no HEIC change).
// The computer has a photo when a file in the backup folder (any subfolder) has the same fingerprint, or the same
// name and size, or it saved one with that fingerprint before (an index in IndexedDB, which also covers browsers
// that can't write into a folder: there the photos arrive like any file and only the index is kept).
// New photos go into a subfolder named after the phone. Nothing is uploaded anywhere: phone to computer directly,
// end to end encrypted like any transfer, and only between paired devices the computer ticked.
// Messages over the device connection: bk-check { id, part, last, items: [{ h, n, s }] } (in parts of 300) ->
// bk-need { id, need: [index], want, have } or bk-no { id, why: off | denied | paused | busy | many };
// then a normal transfer with { want } in its request.
'use strict';
(function () {
  const LS = 'omnibeam-pbackup'; // { name, kind: 'handle' | 'index', allowed: [pairing secrets] }
  const LAST = 'omnibeam-pbackup-last'; // phone: { pairing secret: { at, sent, skipped } }
  const MAX_PICK = 2000;  // photos in one backup
  const PART = 300;       // fingerprints per message
  const MAX_SCAN = 60000; // files looked at in the backup folder
  const SLICE = 65536;
  const CAN_HANDLE = typeof window.showDirectoryPicker === 'function';
  let cfg = null;   // { name, kind, allowed: Set, root (handle), on }
  const wants = new Map();   // want id -> { peer id, at, items: [{ h, n, s }] }: what this computer said it needs
  const checks = new Map();  // phone's check id -> { peer id, items, at } (parts still arriving)
  let scanning = Promise.resolve();

  const readLs = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
  const writeLs = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch {} };
  const persist = () => writeLs(LS, cfg ? { name: cfg.name, kind: cfg.kind, allowed: [...cfg.allowed] } : null);

  // ---- Storage on the computer: the folder handle, the index of photos it has, and fingerprints already worked out
  function idb(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('omnibeam-pbackup', 1);
      req.onupgradeneeded = () => { for (const s of ['h', 'idx', 'fp']) req.result.createObjectStore(s); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(store, mode);
          const r = fn(tx.objectStore(store));
          tx.oncomplete = () => { req.result.close(); resolve(r?.result); };
          tx.onerror = () => { req.result.close(); reject(tx.error); };
        } catch (err) { req.result.close(); reject(err); }
      };
    });
  }
  const saveHandle = (h) => idb('h', 'readwrite', (s) => (h ? s.put(h, 'root') : s.delete('root'))).catch(() => {});
  const loadHandle = () => idb('h', 'readonly', (s) => s.get('root')).catch(() => null);
  const allIndex = () => idb('idx', 'readonly', (s) => s.getAll()).catch(() => []);
  const addIndex = (recs) => idb('idx', 'readwrite', (s) => { for (const r of recs) s.put(r, r.h); }).catch(() => {});
  const clearIndex = () => Promise.all([idb('idx', 'readwrite', (s) => s.clear()), idb('fp', 'readwrite', (s) => s.clear())]).catch(() => {});
  const getFps = () => idb('fp', 'readonly', (s) => {
    const out = new Map();
    const c = s.openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out.set(cur.key, cur.value); cur.continue(); } };
    return { get result() { return out; } };
  }).catch(() => new Map());
  const putFps = (m) => (m.size ? idb('fp', 'readwrite', (s) => { for (const [k, v] of m) s.put(v, k); }).catch(() => {}) : null);

  // A photo's fingerprint: its size and a SHA-256 of its first and last 64 KB. The same photo gives the same one on
  // the phone and on the computer, whatever its name or date (an iPhone gives picked photos a new date every time).
  async function fingerprint(file) {
    const parts = [new TextEncoder().encode(`${file.size}|`), await file.slice(0, SLICE).arrayBuffer()];
    if (file.size > SLICE) parts.push(await file.slice(Math.max(SLICE, file.size - SLICE)).arrayBuffer());
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await new Blob(parts).arrayBuffer()));
    return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const okHash = (h) => typeof h === 'string' && /^[0-9a-f]{32}$/.test(h);
  const cleanName = (n) => String(n || '').split(/[\\/]/).pop().replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '_').slice(0, 200) || 'photo';

  // At the start (app.js loads this when backup was set up before): pick the folder up again if the browser allows
  async function restore() {
    const saved = readLs(LS);
    if (!saved) return;
    cfg = { name: saved.name, kind: saved.kind === 'handle' ? 'handle' : 'index', allowed: new Set(saved.allowed || []), on: saved.kind !== 'handle' };
    if (cfg.kind === 'handle') {
      const h = await loadHandle();
      if (!h) { cfg = null; persist(); return; }
      cfg.root = h;
      try { cfg.on = (await h.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch {}
    }
    render();
  }

  // ---- This computer: the dialog ----
  let dlg = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-pbackup';
    dlg.setAttribute('aria-labelledby', 'pbackup-title');
    dlg.innerHTML = `<h3 id="pbackup-title"></h3>
      <p class="muted" data-k="about"></p>
      <p class="fs-state" data-k="state" role="status"></p>
      <p class="muted small" data-k="kept"></p>
      <div class="row fs-row">
        <button type="button" class="btn" data-act="pick"></button>
        <button type="button" class="btn" data-act="again" hidden></button>
        <button type="button" class="btn ghost" data-act="stop" hidden></button>
      </div>
      <p class="muted small" data-k="noFolder" hidden></p>
      <h4 data-k="who"></h4>
      <p class="muted small" data-k="who-note"></p>
      <div class="fs-who"></div>
      <div class="row"><button type="button" class="btn ghost" data-act="close"></button></div>`;
    $('#pbackup-title', dlg).textContent = t('Photo backup');
    $('[data-k=about]', dlg).textContent = t('Back up your phone\'s photos into a folder on this computer. Your phone sends only the photos this computer doesn\'t have yet, so a backup after the first one takes seconds. Keep this tab open while you back up.');
    $('[data-k=noFolder]', dlg).textContent = t('This browser can\'t save into a folder, so backed-up photos arrive like any file. OmniBeam still remembers which ones it got and skips them next time. Chrome and Edge can use a folder.');
    $('[data-k=who]', dlg).textContent = t('Who can back up here');
    $('[data-k=who-note]', dlg).textContent = t('Only paired devices you tick here. On the phone: tap this computer, More…, Back up photos.');
    $('[data-act=again]', dlg).textContent = t('Allow again');
    $('[data-act=stop]', dlg).textContent = t('Turn off');
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
      if (!box || !cfg) return;
      if (box.checked) cfg.allowed.add(box.dataset.secret); else cfg.allowed.delete(box.dataset.secret);
      persist();
    });
    document.body.append(dlg);
    return dlg;
  }
  async function render() {
    if (!dlg) return;
    const state = $('[data-k=state]', dlg);
    state.textContent = !cfg ? t('Photo backup is off.')
      : cfg.kind === 'index' ? t('On: photos arrive like any file')
        : cfg.on ? t('Backing up into: {name}', { name: cfg.name }) : t('Paused: {name}. Tap Allow again.', { name: cfg.name });
    $('[data-act=pick]', dlg).textContent = CAN_HANDLE ? (cfg ? t('Choose another folder') : t('Choose backup folder')) : t('Turn on');
    $('[data-act=pick]', dlg).hidden = !CAN_HANDLE && !!cfg;
    $('[data-act=pick]', dlg).className = cfg?.on ? 'btn ghost' : 'btn';
    $('[data-act=again]', dlg).hidden = !cfg || cfg.on;
    $('[data-act=stop]', dlg).hidden = !cfg;
    $('[data-k=noFolder]', dlg).hidden = CAN_HANDLE;
    const kept = $('[data-k=kept]', dlg);
    kept.textContent = '';
    if (cfg) allIndex().then((all) => { if (all.length) kept.textContent = t('{n} photos backed up here so far', { n: all.length }); });
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
      label.innerHTML = '<input type="checkbox"> <span></span>';
      label.querySelector('input').dataset.secret = p.secret;
      label.querySelector('span').textContent = p.name || t('Device');
      label.querySelector('input').checked = !!cfg?.allowed.has(p.secret);
      label.querySelector('input').disabled = !cfg;
      who.append(label);
    }
  }
  function defaultAllowed() {
    const paired = loadPaired();
    const trusted = paired.filter((p) => p.trusted);
    return new Set((trusted.length ? trusted : paired).map((p) => p.secret));
  }
  async function pick() {
    const allowed = cfg?.allowed?.size ? cfg.allowed : defaultAllowed();
    if (CAN_HANDLE) {
      let h;
      try { h = await window.showDirectoryPicker({ id: 'omnibeam-pbackup', mode: 'readwrite' }); } catch { return; } // cancelled
      cfg = { name: h.name, kind: 'handle', root: h, allowed, on: true };
      saveHandle(h);
    } else {
      cfg = { name: '', kind: 'index', allowed, on: true };
    }
    persist();
    render();
    wsSend({ type: 'stat', kind: 'pbk' });
    toast(cfg.kind === 'handle' ? t('Photo backup on: new photos go into {name}', { name: cfg.name }) : t('Photo backup on'));
  }
  async function again() {
    if (!cfg?.root) return pick();
    try { cfg.on = (await cfg.root.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch { cfg.on = false; }
    render();
  }
  function stop() {
    cfg = null;
    persist();
    saveHandle(null);
    clearIndex();
    render();
    toast(t('Photo backup turned off'));
  }

  // ---- This computer: which photos it has ----
  function allowedFor(peer) {
    if (!cfg) return 'off';
    if (!peer.pairSecret || !cfg.allowed.has(peer.pairSecret)) return 'denied';
    if (!cfg.on) return 'paused';
    return '';
  }
  // Every file in the backup folder (subfolders too, names starting with "." left out): its name and size, and the
  // fingerprint of each one whose size matches a photo the phone asks about (the same photo has the same size, so
  // only those are read; fingerprints are kept, so each file is read once)
  async function scanFolder(sizes) {
    const names = new Set();
    const hashes = new Set();
    if (cfg.kind !== 'handle') return { names, hashes };
    const known = await getFps();
    const fresh = new Map();
    let seen = 0;
    const walk = async (dir, path, depth) => {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.') || seen >= MAX_SCAN) continue;
        if (h.kind === 'directory') { if (depth < 8) await walk(h, path + name + '/', depth + 1); continue; }
        seen++;
        let f;
        try { f = await h.getFile(); } catch { continue; }
        names.add(`${name.toLowerCase()}|${f.size}`);
        if (!sizes.has(f.size)) continue;
        const key = `${path}${name}|${f.size}|${f.lastModified}`;
        let fp = known.get(key);
        if (!fp) { try { fp = await fingerprint(f); fresh.set(key, fp); } catch { continue; } }
        hashes.add(fp);
      }
    };
    await walk(cfg.root, '', 0);
    await putFps(fresh);
    return { names, hashes };
  }
  async function check(peer, items) {
    const [idx, found] = await Promise.all([allIndex(), scanFolder(new Set(items.map((it) => it.s)))]);
    for (const r of idx) found.hashes.add(r.h);
    const need = [];
    items.forEach((it, i) => {
      if (!found.hashes.has(it.h) && !found.names.has(`${it.n.toLowerCase()}|${it.s}`)) need.push(i);
    });
    // The same photo picked twice in one backup goes once
    const once = new Set();
    const uniq = need.filter((i) => !once.has(items[i].h) && once.add(items[i].h));
    let want = '';
    if (uniq.length) {
      want = randomHex(16);
      wants.set(want, { peer: peer.info.id, at: Date.now(), items: uniq.map((i) => items[i]) });
    }
    return { need: uniq, want, have: items.length - need.length };
  }
  async function answer(peer, msg) {
    const id = typeof msg.id === 'string' && /^[0-9a-f]{16,32}$/.test(msg.id) ? msg.id : null;
    if (!id) return;
    const why = allowedFor(peer);
    if (why) return peer.sendJson({ t: 'bk-no', id, why });
    for (const [k, v] of checks) if (Date.now() - v.at > 10 * 60000) checks.delete(k);
    let c = checks.get(id);
    if (!c) { c = { peer: peer.info.id, items: [], at: Date.now() }; checks.set(id, c); }
    if (c.peer !== peer.info.id) return;
    const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, PART)
      .filter((it) => it && okHash(it.h) && Number.isFinite(Number(it.s)))
      .map((it) => ({ h: it.h, n: cleanName(it.n), s: Math.max(0, Math.floor(Number(it.s))) }));
    c.items.push(...items);
    if (c.items.length > MAX_PICK) { checks.delete(id); return peer.sendJson({ t: 'bk-no', id, why: 'many' }); }
    if (!msg.last) return;
    checks.delete(id);
    // One check at a time (a folder is read for each)
    const run = scanning.then(() => check(peer, c.items));
    scanning = run.catch(() => {});
    try {
      const r = await run;
      peer.sendJson({ t: 'bk-need', id, ...r });
      if (!r.need.length) toast(t('{name} checked: all {n} photos are already backed up here', { name: peer.info.name, n: c.items.length }), 4000);
    } catch (err) {
      if (err?.name === 'NotAllowedError') { cfg.on = false; render(); return peer.sendJson({ t: 'bk-no', id, why: 'paused' }); }
      console.warn('Photo backup check', err);
      peer.sendJson({ t: 'bk-no', id, why: 'busy' });
    }
  }

  // ---- This computer: saving what arrived ----
  async function freeName(dir, name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; n < 1000; n++) {
      const tryName = n === 1 ? name : `${base} (${n})${ext}`;
      try { await dir.getFileHandle(tryName); } catch (err) { if (err?.name === 'NotFoundError') return tryName; throw err; }
    }
    return `${base} ${Date.now()}${ext}`;
  }
  // app.js, when a transfer this computer asked for has arrived: write the photos into the phone's subfolder.
  // Resolves to the files that could not be written there (app.js then shows them like any received file).
  async function store(peer, files, info) {
    const recs = [];
    const failed = [];
    let dir = null;
    if (cfg?.kind === 'handle' && cfg.root) {
      try {
        if ((await cfg.root.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('paused');
        dir = await cfg.root.getDirectoryHandle(cleanName(peer.info.name) || 'Phone', { create: true });
      } catch (err) { console.warn('Photo backup folder', err); dir = null; }
    }
    for (const f of files) {
      if (!f.blob) { failed.push(f); continue; }
      let h = null;
      try { h = await fingerprint(f.blob); } catch {}
      if (dir) {
        try {
          const name = await freeName(dir, cleanName(f.name));
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await f.blob.stream().pipeTo(w); // closes the file when done
          f.savedTo = `${cfg.name}/${dir.name}/${name}`;
        } catch (err) { console.warn('Photo backup write', err); failed.push(f); }
      } else failed.push(f);
      if (h) recs.push({ h, n: cleanName(f.name), s: f.size, at: Date.now(), from: peer.info.name });
    }
    await addIndex(recs);
    const saved = files.length - failed.length;
    if (saved) {
      toast(t('Backed up {n} new photos from {name} into {folder}', { n: saved, name: peer.info.name, folder: `${cfg.name}/${dir.name}` }), 6000);
      notify(t('Photo backup done'), t('Backed up {n} new photos from {name} into {folder}', { n: saved, name: peer.info.name, folder: `${cfg.name}/${dir.name}` }));
    }
    wsSend({ type: 'stat', kind: 'pbksave', n: Math.max(1, files.length) });
    if (dlg?.open) render();
    return failed;
  }

  // ---- The phone: backing up ----
  let pdlg = null;
  let job = null; // { peer, id, files, items, resolve }
  function phoneDialog() {
    if (pdlg) return pdlg;
    pdlg = document.createElement('dialog');
    pdlg.id = 'dlg-pbk';
    pdlg.setAttribute('aria-labelledby', 'pbk-title');
    pdlg.innerHTML = `<h3 id="pbk-title"></h3>
      <p class="muted" data-k="about"></p>
      <p class="muted small" data-k="last"></p>
      <p class="fs-state pbk-msg" role="status" aria-live="polite"></p>
      <progress max="1" value="0" hidden></progress>
      <div class="row">
        <button type="button" class="btn ghost" data-act="close"></button>
        <button type="button" class="btn" data-act="pick"></button>
      </div>`;
    $('[data-act=close]', pdlg).textContent = t('Close');
    $('[data-act=pick]', pdlg).textContent = t('Choose photos');
    pdlg.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') pdlg.close();
      else if (act === 'pick' && job?.peer) choose(job.peer);
    });
    pdlg.addEventListener('close', () => { if (job && !job.sending) job.cancelled = true; });
    document.body.append(pdlg);
    return pdlg;
  }
  const say = (text) => { if (pdlg) $('.pbk-msg', pdlg).textContent = text; };
  function bar(done, total) {
    const p = $('progress', pdlg);
    p.hidden = !total;
    p.max = total || 1;
    p.value = done || 0;
  }
  function open(peer) {
    phoneDialog();
    job = { peer };
    $('#pbk-title', pdlg).textContent = t('Back up photos to {name}', { name: peer.info.name });
    $('[data-k=about]', pdlg).textContent = t('Choose photos and videos. Only the ones {name} doesn\'t have yet are sent, at full quality.', { name: peer.info.name });
    const last = (readLs(LAST) || {})[peer.pairSecret];
    $('[data-k=last]', pdlg).textContent = last ? t('Last backup: {date}', { date: new Date(last.at).toLocaleString() }) : '';
    $('[data-act=pick]', pdlg).disabled = false;
    say('');
    bar(0, 0);
    if (!pdlg.open) pdlg.showModal();
  }
  async function choose(peer) {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*,video/*' });
    const files = await new Promise((resolve) => {
      input.onchange = () => resolve([...input.files]);
      input.addEventListener('cancel', () => resolve([]));
      input.click();
    });
    if (files.length) run(peer, files);
  }
  async function run(peer, files) {
    if (!files.length) return;
    if (files.length > MAX_PICK) { say(t('Choose up to {n} photos at a time.', { n: MAX_PICK })); return; }
    if (peer.busy) { say(t('Transfer in progress…')); return; }
    const me = { peer, files, id: randomHex(16), cancelled: false };
    job = me;
    $('[data-act=pick]', pdlg).disabled = true;
    try {
      // Fingerprints, a few at a time
      const items = [];
      for (let i = 0; i < files.length; i += 8) {
        if (me.cancelled) return;
        say(t('Checking {i} of {n}…', { i: Math.min(files.length, i + 8), n: files.length }));
        bar(i, files.length);
        const got = await Promise.all(files.slice(i, i + 8).map((f) => fingerprint(f)));
        got.forEach((h, k) => { const f = files[i + k]; items.push({ h, n: f.name, s: f.size }); });
      }
      bar(0, 0);
      say(t('Asking {name} which ones it already has…', { name: peer.info.name }));
      await peer.connect();
      const reply = new Promise((resolve) => { me.resolve = resolve; });
      for (let i = 0; i < items.length; i += PART) {
        peer.sendJson({ t: 'bk-check', id: me.id, part: i / PART, last: i + PART >= items.length, items: items.slice(i, i + PART) });
      }
      const timer = setTimeout(() => me.resolve?.({ t: 'bk-no', why: 'late' }), 180000);
      const msg = await reply;
      clearTimeout(timer);
      if (me.cancelled && msg.t !== 'bk-need') return;
      const name = peer.info.name;
      if (msg.t === 'bk-no') {
        const why = msg.why;
        say(why === 'off' ? t('{name} isn\'t set up for photo backup. On {name}: ⋯ menu > Photo backup, choose a folder.', { name })
          : why === 'denied' ? t('{name} takes backups, but not from this device. On {name}: ⋯ > Photo backup, tick this device.', { name })
            : why === 'paused' ? t('{name} paused photo backup. On {name}: ⋯ > Photo backup > Allow again.', { name })
              : why === 'many' ? t('Choose up to {n} photos at a time.', { n: MAX_PICK })
                : t('{name} didn\'t answer. Keep OmniBeam open on it and try again.', { name }));
        return;
      }
      const need = (Array.isArray(msg.need) ? msg.need : []).filter((i) => Number.isInteger(i) && i >= 0 && i < files.length);
      const skipped = files.length - need.length;
      wsSend({ type: 'stat', kind: 'pbkrun', n: need.length, skip: skipped });
      const last = readLs(LAST) || {};
      if (!need.length) {
        last[peer.pairSecret] = { at: Date.now(), sent: 0, skipped };
        writeLs(LAST, last);
        say(t('All {n} are already on {name}. Nothing to send.', { n: files.length, name }));
        return;
      }
      if (typeof msg.want !== 'string' || !/^[0-9a-f]{32}$/.test(msg.want)) return say(t('{name} didn\'t answer. Keep OmniBeam open on it and try again.', { name }));
      if (peer.busy) return say(t('Transfer in progress…'));
      say(skipped ? t('Sending {n} new photos. {skip} are already on {name}.', { n: need.length, skip: skipped, name })
        : t('Sending {n} new photos.', { n: need.length }));
      me.sending = true;
      last[peer.pairSecret] = { at: Date.now(), sent: need.length, skipped };
      writeLs(LAST, last);
      // As they are: no shrinking or HEIC change (the request carries want, see sendFiles)
      await peer.sendFiles(need.map((i) => files[i]), { want: msg.want });
    } catch (err) {
      say(t(err.message || 'Connection lost'));
    } finally {
      if (job === me && pdlg) $('[data-act=pick]', pdlg).disabled = false;
    }
  }
  function onReply(peer, msg) {
    if (job && job.peer === peer && job.id === msg.id && job.resolve) {
      const r = job.resolve;
      job.resolve = null;
      r(msg);
    }
  }

  window.PhotoBackup = {
    restore,
    open() { dialog(); render(); if (!dlg.open) dlg.showModal(); },
    look: open,
    run, // tests
    onMsg(peer, msg) {
      if (msg.t === 'bk-check') return answer(peer, msg).catch((err) => console.warn('Photo backup', err));
      onReply(peer, msg);
    },
    // app.js: an incoming transfer this computer asked for. Returns what it said it needs, or null.
    // Only the photos it said it needs: no more of them, and each the size it said
    wanted(peerId, want, files) {
      for (const [k, v] of wants) if (Date.now() - v.at > 3 * 3600000) wants.delete(k);
      const w = typeof want === 'string' && wants.get(want);
      if (!w || w.peer !== peerId) return null;
      const sizes = new Set(w.items.map((it) => it.s));
      if (!Array.isArray(files) || files.length > w.items.length || files.some((f) => !sizes.has(f.size))) return null;
      wants.delete(want);
      return w;
    },
    store,
  };
})();
