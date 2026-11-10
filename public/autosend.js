// OmniBeam: auto-send a folder (Settings → Auto-send a folder). Loaded by app.js when it is turned on, or when
// Settings opens.
// Pick a folder on this computer and one paired device (usually your phone). While OmniBeam is open (the tab, or the
// OmniBeam app from the Microsoft Store), new files that appear in that folder are sent to that device by themselves:
// screenshots, scans, exports from a camera app... Uses the browser's File System Access API, so it works in Chrome
// and Edge on computers (and in the Windows app, which runs on Edge). The folder is only read, never changed.
// - Only files added after it was turned on are sent; each file once (name + size + date remembered on this device).
// - A file is sent once its size has stopped changing (it isn't still being copied or saved).
// - Files in sub-folders, hidden files and unfinished downloads (.crdownload, .part, .tmp…) are left out.
// - If the device is offline the files wait and go when it shows up. If it declines, they aren't sent again.
// - After a restart the browser may ask once more for permission to read the folder (a card at the bottom).
'use strict';
(function () {
  const KEY = 'omnibeam-autosend';      // { on, secret (the pairing it sends to), name (folder name), since }
  const SEEN_KEY = 'omnibeam-autosend-seen'; // files already sent or there before: "name|size|lastModified"
  const SEEN_MAX = 3000;
  const EVERY = 5000;
  const BATCH = 20;
  const SKIP = /^(\.|~\$|desktop\.ini$|thumbs\.db$)|\.(crdownload|part|partial|download|tmp|temp|lock|opdownload)$/i;
  const supported = typeof window.showDirectoryPicker === 'function';
  let dir = null;         // FileSystemDirectoryHandle
  let perm = 'none';      // granted | prompt | denied | none
  let timer = 0;
  let scanning = false;
  let sending = false;
  const sizes = new Map(); // key -> size at the last scan (a file is sent once it hasn't changed for one scan)
  let waitingFiles = [];   // found, not sent yet
  let lastError = '';
  let sentCount = 0;

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {} };
  const loadSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); } };
  const saveSeen = (set) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-SEEN_MAX))); } catch {} };
  const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;

  // The folder handle survives a reload in IndexedDB (a database of its own, so the received-files one is untouched)
  function db(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('omnibeam-autosend', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('h');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        let tx;
        let r;
        try {
          tx = req.result.transaction('h', mode);
          r = fn(tx.objectStore('h'));
        } catch (err) { req.result.close(); return reject(err); } // e.g. a handle this browser can't store
        tx.oncomplete = () => { req.result.close(); resolve(r && 'result' in r ? r.result : undefined); };
        tx.onerror = tx.onabort = () => { req.result.close(); reject(tx.error); };
      };
    });
  }
  const saveHandle = (h) => db('readwrite', (st) => st.put(h, 'dir'));
  const loadHandle = () => db('readonly', (st) => st.get('dir')).catch(() => null);
  const dropHandle = () => db('readwrite', (st) => st.delete('dir')).catch(() => {});

  const target = (c = load()) => loadPaired().find((p) => p.secret === c.secret) || null;
  const targetPeer = (c = load()) => [...peers.values()].find((p) => p.pairSecret && p.pairSecret === c.secret) || null;

  async function checkPerm(ask = false) {
    if (!dir) return (perm = 'none');
    try {
      perm = await dir.queryPermission({ mode: 'read' });
      if (perm !== 'granted' && ask) perm = await dir.requestPermission({ mode: 'read' });
    } catch { perm = 'denied'; }
    return perm;
  }

  // Every file directly in the folder: [{ key, file, handle }]
  async function listFolder() {
    const out = [];
    for await (const h of dir.values()) {
      if (h.kind !== 'file' || SKIP.test(h.name)) continue;
      try {
        const file = await h.getFile();
        if (file.size > 0) out.push({ key: fileKey(file), file, name: h.name });
      } catch {} // removed or locked while we looked
    }
    return out;
  }

  // First run in a folder: what's there already is not sent
  async function baseline() {
    const seen = loadSeen();
    for (const f of await listFolder()) seen.add(f.key);
    saveSeen(seen);
  }

  async function scan() {
    const c = load();
    if (!c.on || !dir || scanning) return;
    if (perm !== 'granted' && (await checkPerm()) !== 'granted') return askAgain();
    scanning = true;
    try {
      const seen = loadSeen();
      const found = await listFolder();
      const ready = [];
      for (const f of found) {
        if (seen.has(f.key)) continue;
        // Still being written? Wait until the size is the same twice in a row
        if (sizes.get(f.name) === f.file.size) ready.push(f);
        sizes.set(f.name, f.file.size);
      }
      for (const name of [...sizes.keys()]) if (!found.some((f) => f.name === name)) sizes.delete(name);
      waitingFiles = ready;
      lastError = '';
      if (ready.length) await sendReady(ready);
    } catch (err) {
      lastError = err.message || String(err);
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') { perm = 'prompt'; askAgain(); }
      if (err.name === 'NotFoundError') lastError = t('The folder was moved or deleted. Choose it again.');
    } finally {
      scanning = false;
      render();
    }
  }

  async function sendReady(ready) {
    const c = load();
    const peer = targetPeer(c);
    if (!peer || peer.busy || sending) return; // offline or busy: they wait for the next scan
    sending = true;
    const batch = ready.slice(0, BATCH);
    try {
      peer.lastSendResult = '';
      await peer.sendFiles(batch.map((f) => f.file));
      const result = peer.lastSendResult;
      // Sent, or declined (not offered again): remembered. Failed: tried again on the next scan.
      if (result === 'ok' || result === 'declined') {
        const seen = loadSeen();
        for (const f of batch) seen.add(f.key);
        saveSeen(seen);
        if (result === 'ok') {
          sentCount += batch.length;
          wsSend({ type: 'stat', kind: 'autosend', n: batch.length });
        } else lastError = t('{name} declined. Turn on Auto-accept for this computer there, so files arrive without a tap.', { name: peer.info.name });
      }
    } finally {
      sending = false;
    }
  }

  function askAgain() {
    if (!load().on || !dir) return;
    render();
    if (Nudge.owner === 'autosend') return;
    Nudge.show('autosend', t('Auto-send is paused'), t('Allow OmniBeam to read the folder “{name}” again to keep sending new files.', { name: dir.name }), [
      { label: t('Allow'), primary: true, onClick: () => { resume(); } },
      { label: t('Turn off'), onClick: () => { setOn(false); } },
    ]);
  }
  async function resume() {
    if ((await checkPerm(true)) === 'granted') { Nudge.hide('autosend'); scan(); }
    render();
  }

  function start() {
    clearInterval(timer);
    if (!load().on || !dir) return;
    timer = setInterval(scan, EVERY);
    scan();
  }
  async function setOn(on) {
    const c = load();
    if (on && !dir) return toast(t('Choose a folder first.'));
    if (on && !target(c)) return toast(t('Choose the device to send to.'));
    if (on && (await checkPerm(true)) !== 'granted') return toast(t('OmniBeam needs permission to read the folder.'));
    if (on && !c.since) { await baseline(); c.since = Date.now(); }
    c.on = on;
    save(c);
    if (on) {
      toast(t('Auto-send is on: new files in “{folder}” go to {name}.', { folder: dir.name, name: target(c).name }));
      start();
    } else {
      clearInterval(timer);
      Nudge.hide('autosend');
    }
    render();
  }

  async function chooseFolder() {
    try {
      const h = await window.showDirectoryPicker({ id: 'omnibeam-autosend', mode: 'read' });
      const c = load();
      const same = dir && (await dir.isSameEntry?.(h).catch(() => false));
      dir = h;
      perm = 'granted';
      await saveHandle(h).catch(() => {}); // kept for the next visit (if this browser can store it)
      // A new folder: what's in it now isn't sent
      if (!same) { await baseline(); c.since = Date.now(); }
      c.name = h.name;
      save(c);
      sizes.clear();
      if (c.on) start();
      else if (target(c)) await setOn(true);
    } catch (err) {
      if (err.name !== 'AbortError') toast(t('Could not open the folder.'));
    }
    render();
  }

  // ---------- Settings section ----------
  function render() {
    const box = $('#autosend-section');
    if (!box) return;
    const c = load();
    $('#autosend-none').hidden = supported;
    $('#autosend-ui').hidden = !supported;
    if (!supported) return;
    const sel = $('#autosend-to');
    const paired = loadPaired();
    const value = c.secret || '';
    sel.innerHTML = '';
    sel.append(new Option(paired.length ? t('Choose a device') : t('Pair a device first'), ''));
    for (const p of paired) sel.append(new Option(p.name, p.secret));
    sel.value = paired.some((p) => p.secret === value) ? value : '';
    $('#autosend-folder').textContent = dir ? dir.name : t('No folder chosen');
    $('#autosend-on').checked = !!c.on;
    $('#autosend-on').disabled = !dir || !sel.value;
    const lines = [];
    if (c.on && dir) {
      const peer = targetPeer(c);
      const tgt = target(c);
      if (perm !== 'granted') lines.push(t('Paused: OmniBeam needs permission to read the folder again.'));
      else if (waitingFiles.length && !peer) lines.push(t('{n} file(s) waiting for {name} to come online.', { n: waitingFiles.length, name: tgt?.name || '?' }));
      else lines.push(t('Watching “{folder}” for new files.', { folder: dir.name }));
      if (sentCount) lines.push(t('{n} sent since this page opened.', { n: sentCount }));
    }
    if (lastError) lines.push(lastError);
    $('#autosend-status').textContent = lines.join(' ');
    $('#autosend-resume').hidden = !(c.on && dir && perm !== 'granted');
  }

  function bind() {
    if (!$('#autosend-section') || bind.done) return;
    bind.done = true;
    $('#autosend-pick').onclick = chooseFolder;
    $('#autosend-resume').onclick = resume;
    $('#autosend-to').onchange = (e) => {
      const c = load();
      c.secret = e.target.value;
      if (!c.secret) c.on = false;
      save(c);
      render();
      if (c.on) start();
      else if (c.secret && dir && !c.on) setOn(true);
    };
    $('#autosend-on').onchange = (e) => setOn(e.target.checked);
  }

  (async () => {
    bind();
    if (supported) {
      dir = (await loadHandle()) || null;
      if (dir) await checkPerm();
      if (load().on && dir) {
        if (perm === 'granted') start();
        else setTimeout(askAgain, 3000);
      }
    }
    render();
  })();
  window.AutoSend = { render, scan, supported };
})();
