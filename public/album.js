// OmniBeam: event photo albums (⋯ menu, Event photo album), loaded by app.js the first time the menu item is used.
// Makes an album on the server (server.js: handleAlbum) and shows its QR code; guests open omnibeam.site/e/<id>#<key>
// (event.html + event.js), add photos and see everyone's. The key after # never reaches the server: the album's name
// is sealed with it here ({ v, name, q }, [12-byte IV] + AES-GCM, base64url), and every photo is encrypted with it on
// the guest's device. This device keeps { id, token, key, url, name, expires } in localStorage (omnibeam-albums);
// the token lets the album page here stop uploads and delete photos or the album.
'use strict';
(function () {
  const dlg = $('#dlg-album');
  const KEY = 'omnibeam-albums';
  let cfg = null;
  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return b64u(out);
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter((a) => a.expires > Date.now()); } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  }
  const hostUrl = (a) => `${a.url.split('#')[0]}#${a.key}.${a.token}`;
  const posterUrl = (a) => `${a.url.split('#')[0]}?poster=1#${a.key}`;
  function left(a) {
    const days = Math.round((a.expires - Date.now()) / 86400000);
    if (days >= 2) return t('{n} days left', { n: days });
    const h = Math.max(1, Math.round((a.expires - Date.now()) / 3600000));
    return t('{n} h left', { n: h });
  }
  function show(view) {
    $('#album-new').hidden = view !== 'new';
    $('#album-done').hidden = view !== 'done';
  }
  let current = null;
  function render() {
    const list = load();
    $('#album-mine').hidden = !list.length;
    const box = $('#album-list');
    box.innerHTML = '';
    for (const a of list.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="meta"><div class="fname"></div><div class="fsize"></div></div>
        <button class="btn small ghost" data-one="qr">${escapeHtml(t('QR code'))}</button>
        <button class="btn small" data-one="open">${escapeHtml(t('Open album'))}</button>`;
      $('.fname', item).textContent = a.name;
      $('.fsize', item).textContent = left(a);
      item.querySelector('[data-one=qr]').onclick = () => done(a);
      item.querySelector('[data-one=open]').onclick = () => window.open(hostUrl(a), '_blank', 'noopener');
      box.append(item);
    }
  }
  async function done(a) {
    current = a;
    $('#album-url').textContent = a.url;
    $('#album-summary').textContent = `${a.name} · ${left(a)}`;
    const qrBox = $('#album-qr');
    qrBox.innerHTML = '';
    show('done');
    try {
      await window.loadQr();
      const qr = qrcode(0, 'M');
      qr.addData(a.url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {}
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    toast(t('Link copied'));
  }
  let making = false;
  async function make() {
    const name = $('#album-name').value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
    if (!name) { $('#album-name').focus(); return toast(t('Type a name for the album.')); }
    if (making) return;
    making = true;
    try {
      const raw = crypto.getRandomValues(new Uint8Array(16));
      const keyText = b64u(raw);
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const days = Number($('#album-days').value) || 7;
      const meta = await seal(key, { v: 1, name, q: $('#album-q').value === 'orig' ? 'orig' : 'small' });
      const res = await fetch('/api/album', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days, meta }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error === 'too-many' ? t('Too many albums from your network. Try again later.') : t('Could not make the album. Try again.'));
      const a = { id: j.id, token: j.token, key: keyText, url: `${location.origin}/e/${j.id}#${keyText}`, name, expires: j.expires };
      save([...load(), a]);
      $('#album-name').value = '';
      render();
      await done(a);
    } catch (err) {
      toast(err instanceof TypeError ? t('Could not make the album. Try again.') : err.message);
    } finally {
      making = false;
    }
  }
  dlg.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'make') make();
    else if (!current) return;
    else if (act === 'copy') copy(current.url);
    else if (act === 'open') window.open(hostUrl(current), '_blank', 'noopener');
    else if (act === 'poster') window.open(posterUrl(current), '_blank', 'noopener');
    else if (act === 'share') {
      const text = t('Add your photos to our album "{name}". No app needed:', { name: current.name });
      if (navigator.share) navigator.share({ title: current.name, text, url: current.url }).catch(() => {});
      else copy(current.url);
    }
  });
  window.Album = {
    open(config) {
      cfg = config || cfg;
      if (cfg?.itemMb) $('#album-limit').textContent = t('Guests can add photos and videos of up to {size} each.', { size: formatSize(cfg.itemMb * 1048576) });
      current = null;
      show('new');
      render();
      if (!dlg.open) dlg.showModal();
    },
  };
})();
