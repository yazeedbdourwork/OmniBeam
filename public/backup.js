// Move to a new phone (Settings -> Device): one backup file with this device's paired devices, name and picture,
// settings, pinned notes, chats (the text), clipboard history, groups, request links and share links. Opened in
// OmniBeam on the new phone (or computer), everything is back. Received files themselves aren't in it (they can be
// large and stay where they were saved).
//
// The file is encrypted on this device with a PIN or password chosen for it (PBKDF2-SHA-256, 600 000 rounds ->
// AES-256-GCM), so the pairing secrets in it are useless to anyone who finds the file without it. With App lock on,
// the App lock PIN is asked first, so nobody else can take the pairings out of an unlocked phone. Nothing goes to
// the server. Loaded on demand by app.js (loadBackup).
(function () {
  const ITER = 600000;
  const FILE_KIND = 'omnibeam-backup';
  // Simple settings: the value on the new device becomes the one in the file
  const PLAIN = ['omnibeam-name', 'omnibeam-avatar', 'omnibeam-theme', 'omnibeam-look', 'omnibeam-text', 'omnibeam-contrast', 'omnibeam-color', 'omnibeam-lang',
    'omnibeam-open-links', 'omnibeam-msg-sound', 'omnibeam-keep', 'omnibeam-shrink', 'omnibeam-ask', 'omnibeam-clips-off',
    'omnibeam-bg-audio', 'omnibeam-analytics', 'omnibeam-scan-bw', 'omnibeam-tv-pin', 'omnibeam-supporter',
    'omnibeam-public-room', 'omnibeam-public-pass', 'omnibeam-stats-key', 'omnibeam-req-from'];
  // Lists and maps: merged with what the new device already has (nothing there is lost). The number is how many
  // a list keeps (newest first), as the app itself keeps them.
  const LISTS = { 'omnibeam-paired': 0, 'omnibeam-teams': 5, 'omnibeam-requests': 0, 'omnibeam-links': 0,
    'omnibeam-messages': 100, 'omnibeam-sent': 200, 'omnibeam-clips': 20 };
  const MAPS = ['omnibeam-pins', 'omnibeam-chat-read'];
  const LOCK = 'omnibeam-lock';

  const enc = new TextEncoder();
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const json = (s, fallback) => { try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; } };
  const b64 = (bytes) => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));

  async function keyFor(pass, salt, iter, use) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
  }

  // What goes in the file: { k: the stored text } for every key this device has
  function collect() {
    const keys = {};
    for (const k of [...PLAIN, ...Object.keys(LISTS), ...MAPS]) {
      const v = get(k);
      if (v !== null && v !== '') keys[k] = v;
    }
    // App lock: the same PIN on the new device. Not the fingerprint/face key: that one belongs to this device only.
    const lock = json(get(LOCK), null);
    if (lock?.hash) { delete lock.bio; keys[LOCK] = JSON.stringify(lock); }
    return keys;
  }
  const count = (keys) => (json(keys['omnibeam-paired'], []) || []).length;

  async function makeFile(pass) {
    const keys = collect();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(pass, salt, ITER, 'encrypt');
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ v: 1, at: Date.now(), keys })));
    const file = { kind: FILE_KIND, v: 1, made: new Date().toISOString().slice(0, 10), note: 'OmniBeam backup. Open it in OmniBeam: Settings > Device > Open backup file.',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: ITER, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(data) };
    return { blob: new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), keys };
  }

  // The file's outside, before the PIN: is it a backup file at all
  function readOutside(text) {
    const f = json(text, null);
    if (!f || f.kind !== FILE_KIND || f.v !== 1 || !f.kdf?.salt || !f.cipher?.iv || typeof f.data !== 'string') return null;
    const iter = Number(f.kdf.iter);
    if (!(iter >= 100000 && iter <= 5000000)) return null;
    return f;
  }
  async function decrypt(f, pass) {
    const key = await keyFor(pass, unb64(f.kdf.salt), Number(f.kdf.iter), 'decrypt');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.cipher.iv) }, key, unb64(f.data));
    const inner = json(new TextDecoder().decode(plain), null);
    if (!inner || typeof inner.keys !== 'object') throw new Error('bad');
    return inner.keys;
  }

  // Put the file's contents on this device. Settings are replaced; lists and maps are merged with what is here.
  function apply(keys) {
    const allowed = new Set([...PLAIN, ...Object.keys(LISTS), ...MAPS, LOCK]);
    for (const [k, v] of Object.entries(keys)) {
      if (!allowed.has(k) || typeof v !== 'string') continue;
      if (PLAIN.includes(k)) { set(k, v); continue; }
      if (k === LOCK) {
        // Only when this device has no lock of its own (its PIN stays as it is)
        if (!json(get(LOCK), null)?.hash && json(v, null)?.hash) set(k, v);
        continue;
      }
      if (MAPS.includes(k)) {
        const now = json(get(k), {});
        const from = json(v, {});
        if (from && typeof from === 'object' && !Array.isArray(from)) set(k, JSON.stringify({ ...(typeof now === 'object' && !Array.isArray(now) ? now : {}), ...from }));
        continue;
      }
      const from = json(v, []);
      if (!Array.isArray(from)) continue;
      const now = json(get(k), []);
      const id = (x) => (x && (x.secret || x.id)) || JSON.stringify([x?.at, x?.text, x?.to, x?.from]);
      const merged = new Map();
      for (const x of Array.isArray(now) ? now : []) merged.set(id(x), x);
      for (const x of from) if (x && typeof x === 'object') merged.set(id(x), { ...(merged.get(id(x)) || {}), ...x });
      let list = [...merged.values()];
      if (LISTS[k]) list = list.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, LISTS[k]);
      set(k, JSON.stringify(list));
    }
  }

  const dlg = () => document.getElementById('dlg-backup');
  let mode = null; // { kind: 'save' } or { kind: 'open', file }
  function show(m) {
    mode = m;
    const d = dlg();
    const save = m.kind === 'save';
    d.querySelector('#backup-title').textContent = save ? t('Save a backup file') : t('Open a backup file');
    d.querySelector('#backup-sub').textContent = save
      ? t('Choose a PIN or password for the file. You type it to open the file on the new phone.')
      : t('Type the PIN or password the backup file was saved with.');
    d.querySelector('#backup-b').hidden = !save;
    d.querySelector('#backup-tip').hidden = !save;
    d.querySelector('#backup-a').autocomplete = save ? 'new-password' : 'current-password';
    d.querySelector('#backup-a').value = d.querySelector('#backup-b').value = '';
    d.querySelector('#backup-msg').textContent = '';
    d.querySelector('#backup-go').textContent = save ? t('Save file') : t('Open file');
    d.querySelector('#backup-go').disabled = false;
    if (!d.open) d.showModal();
    d.querySelector('#backup-a').focus();
  }
  async function go() {
    const d = dlg();
    const msg = d.querySelector('#backup-msg');
    const btn = d.querySelector('#backup-go');
    const a = d.querySelector('#backup-a').value;
    if (mode?.kind === 'save') {
      if (a.length < 4) return (msg.textContent = t('Use at least 4 characters.'));
      if (a !== d.querySelector('#backup-b').value) return (msg.textContent = t('The two are not the same.'));
      btn.disabled = true;
      msg.textContent = t('Saving…');
      try {
        const { blob, keys } = await makeFile(a);
        downloadBlob({ name: `omnibeam-backup-${new Date().toISOString().slice(0, 10)}.json`, blob });
        d.close();
        wsSend({ type: 'stat', kind: 'backup' });
        toast(t('Backup file saved, with {n} paired device(s). On the new phone: Settings > Device > Open backup file.', { n: count(keys) }), 8000);
      } catch (err) {
        btn.disabled = false;
        msg.textContent = t('Could not save') + ` (${err.message})`;
      }
      return;
    }
    if (mode?.kind !== 'open') return;
    if (!a) return d.querySelector('#backup-a').focus();
    btn.disabled = true;
    msg.textContent = t('Opening…');
    let keys;
    try {
      keys = await decrypt(mode.file, a);
    } catch {
      btn.disabled = false;
      msg.textContent = t('Wrong PIN or password, or the file is damaged.');
      return d.querySelector('#backup-a').select();
    }
    apply(keys);
    wsSend({ type: 'stat', kind: 'restore' });
    msg.textContent = t('Everything is back: {n} paired device(s). OmniBeam restarts now.', { n: count(keys) });
    setTimeout(() => location.reload(), 1800);
  }

  window.Backup = {
    async save() {
      // App lock on: the PIN first, so nobody else can take the pairings out of an unlocked phone
      if (AppLock.on) {
        const asked = AppLock.lock({ verify: true });
        document.getElementById('lock-sub').textContent = t('To save a backup file, type your PIN first.');
        if (!(await asked)) return;
      }
      show({ kind: 'save' });
    },
    async open(file) {
      if (!file) return;
      let text = '';
      try { text = file.size < 20 * 1048576 ? await file.text() : ''; } catch {}
      const f = readOutside(text);
      if (!f) return toast(t('This isn\'t an OmniBeam backup file.'), 5000);
      show({ kind: 'open', file: f });
    },
    // For the tests
    _collect: collect,
    _apply: apply,
  };
  const d = dlg();
  d.querySelector('#backup-go').onclick = go;
  for (const id of ['#backup-a', '#backup-b']) {
    d.querySelector(id).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  }
})();
