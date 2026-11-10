// OmniBeam: share files by link (in the ⋯ menu at the top).
// The files are encrypted here with a new random AES-GCM key, uploaded to the server in parts, and the link is
// omnibeam.site/d/<id>#<key>. Browsers never send the part after # to a server, so the server only ever has
// data it can't read. The download page (drop.html + get.js) decrypts it in the receiver's browser.
// Format: part n of the files (one after the other, 4 MB each) is encrypted with IV [0,0,0,0,0,0,0,0,n (4 bytes)];
// the list of names and sizes is encrypted with IV [1,0,…,0].
// Options: how long the link works (up to the server's limit), how many downloads it allows, a PIN (see pinProof),
// and an email address or phone number to send it to: an email is sent by the server when it has a Resend key
// (see emailByServer), otherwise the mail or messages app opens with the link written in. "Your links" shows how many times each link was downloaded.
'use strict';
(function () {
  const btn = $('#btn-link');
  const btnTo = $('#btn-sendto');
  const dlg = $('#dlg-link');
  const input = $('#link-input');
  const LINKS_KEY = 'omnibeam-links';
  let cfg = null;
  let job = null; // the upload in progress: { cancelled, id, token }

  window.addEventListener('omnibeam-config', (e) => {
    cfg = e.detail.drop || null;
    btn.hidden = btnTo.hidden = !cfg || !window.crypto?.subtle;
    if (!cfg) return;
    $('#link-limit').textContent = t('Up to {size} per link.', { size: formatSize(cfg.maxMb * 1048576) });
    for (const o of $('#link-hours').options) o.disabled = o.hidden = Number(o.value) > cfg.maxHours;
    if ($('#link-hours').selectedOptions[0]?.disabled) $('#link-hours').value = '24';
    $('#link-to-note').hidden = !cfg.email;
  });

  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const ivFor = (n, meta = false) => {
    const v = new Uint8Array(12);
    v[0] = meta ? 1 : 0;
    new DataView(v.buffer).setUint32(8, n);
    return v;
  };

  // What the receiver's page sends instead of the PIN: made from the PIN and the key in the link, so the server
  // (which never sees the key) can't work out the PIN from it
  async function pinProof(pin, keyB64) {
    return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-pin:${pin}:${keyB64}`)));
  }
  const PIN_RE = /^\d{4,8}$/;
  // Text messages only on phones (a computer usually has no messages app): computers get email only
  const PHONE_DEVICE = isIOS || /Android/i.test(navigator.userAgent);
  if (!PHONE_DEVICE) {
    $('#link-sms').remove();
    $('#btn-sendto span').textContent = t('Send by email');
    $('#link-to').placeholder = t('Email address');
    $('#link-to').type = 'email';
  } else {
    $('#link-to').inputMode = 'text';
    $('#link-to').autocomplete = 'off';
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;
  // "Send to": an email address or a phone number (null if empty, false if it's neither)
  function recipient(text) {
    const v = text.trim();
    if (!v) return null;
    if (EMAIL_RE.test(v)) return { kind: 'email', to: v };
    if (PHONE_DEVICE && PHONE_RE.test(v) && v.replace(/\D/g, '').length >= 6) return { kind: 'phone', to: v.replace(/[\s().-]/g, '') };
    return false;
  }
  // The message with the link, for an email or a text message. Never the PIN: that goes another way.
  function message(l) {
    if (l.note) {
      const lines = [t('{name} sent you a secret note with OmniBeam. It opens once:', { name: me?.name || 'Someone' }), l.url];
      if (l.pin) lines.push(t('You also need a PIN to open it. I will tell you the PIN separately.'));
      return { subject: t('A secret note for you'), body: lines.join('\n') };
    }
    const lines = [t('{name} sent you files with OmniBeam:', { name: me?.name || 'Someone' }), l.url, '',
      `${l.names} · ${formatSize(l.size)}`, t('The link works until {date}.', { date: new Date(l.expires).toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }) })];
    if (l.pin) lines.push(t('You also need a PIN to open it. I will tell you the PIN separately.'));
    return { subject: t('Files for you: {names}', { names: l.names }), body: lines.join('\n') };
  }
  function mailtoUrl(l, to = '') {
    const m = message(l);
    return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  }
  function smsUrl(l, to = '') {
    // iPhone uses sms:NUMBER&body=, everything else sms:NUMBER?body=
    return `sms:${to}${isIOS ? '&' : '?'}body=${encodeURIComponent(message(l).body)}`;
  }
  // With email on the server (RESEND_API_KEY set there), an email address in "Send to" gets the link by email from
  // no-reply@omnibeam.site right away. If that fails (daily limit, no connection), the mail-app button is shown.
  async function emailByServer(l, to, key) {
    const status = $('#link-email-status');
    status.hidden = false;
    status.className = 'small link-email-status';
    status.textContent = t('Sending the email to {to}…', { to });
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    try {
      const r = await fetch(`/api/drop/${l.id}/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Drop-Token': l.token },
        body: JSON.stringify({ to, key, lang: document.documentElement.lang || 'en', name: me?.name || '', names: l.names, tz }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error('send'), { limit: j.error === 'limit' });
      status.classList.add('ok');
      status.textContent = '✓ ' + t('Email sent to {to}. If it does not arrive in a few minutes, check the spam folder.', { to });
      $('#link-send-to').hidden = true;
      sentStat();
      return true;
    } catch (err) {
      status.classList.add('bad');
      status.textContent = (err.limit ? t('Daily email limit reached.') : t('The email could not be sent.')) + ' ' + t('Use the button below to send it from your mail app.');
      $('#link-send-to').hidden = false;
      return false;
    }
  }
  // Fill in the email / text buttons on the "link ready" screen
  function setSendButtons(l) {
    $('#link-email-status').hidden = true;
    $('#link-email').href = mailtoUrl(l);
    if ($('#link-sms')) $('#link-sms').href = smsUrl(l);
    const big = $('#link-send-to');
    big.hidden = !l.to;
    if (l.to) {
      big.href = l.to.kind === 'email' ? mailtoUrl(l, l.to.to) : smsUrl(l, l.to.to);
      big.textContent = l.to.kind === 'email' ? t('Email it to {to}', { to: l.to.to }) : t('Text it to {to}', { to: l.to.to });
    }
  }
  const sentStat = () => wsSend?.({ type: 'stat', kind: 'sendto' });

  // Links this device created, so they can be copied again or deleted early
  function loadLinks() {
    try {
      return JSON.parse(localStorage.getItem(LINKS_KEY) || '[]').filter((l) => l.expires > Date.now());
    } catch { return []; }
  }
  function saveLinks(list) {
    try { localStorage.setItem(LINKS_KEY, JSON.stringify(list)); } catch {}
  }
  function timeLeft(ms) {
    const h = Math.round(ms / 3600000);
    return h >= 1 ? t('{n} h left', { n: h }) : t('{n} min left', { n: Math.max(1, Math.round(ms / 60000)) });
  }
  function renderLinks() {
    const list = loadLinks();
    saveLinks(list);
    $('#link-mine').hidden = !list.length;
    const box = $('#link-list');
    box.innerHTML = '';
    for (const l of list.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="meta"><div class="fname"></div><div class="fsize"></div></div>
        <button class="btn small ghost" data-act="copy-one">${escapeHtml(t('Copy link'))}</button>
        <button class="btn small ghost" data-act="delete-one">${escapeHtml(t('Delete'))}</button>`;
      $('.fname', item).textContent = l.names;
      $('.fsize', item).textContent = `${formatSize(l.size)} · ${timeLeft(l.expires - Date.now())} · ${downloadsText(l)}${l.pin ? ' · ' + t('PIN') : ''}`;
      if (l.locked) $('.fsize', item).insertAdjacentHTML('beforeend', ` · <span class="locked">${escapeHtml(t('Locked: too many wrong PINs'))}</span>`);
      item.querySelector('[data-act="copy-one"]').onclick = () => copy(l.url);
      item.querySelector('[data-act="delete-one"]').onclick = () => removeLink(l);
      box.appendChild(item);
    }
  }
  function downloadsText(l) {
    const n = l.downloads || 0;
    const max = l.max || (l.once ? 1 : 0);
    if (max) return t('{n} of {max} downloads', { n, max });
    return n === 1 ? t('1 download') : t('{n} downloads', { n });
  }
  async function removeLink(l) {
    try {
      const r = await fetch(`/api/drop/${l.id}`, { method: 'DELETE', headers: { 'X-Drop-Token': l.token } });
      if (!r.ok && r.status !== 404) throw new Error();
      saveLinks(loadLinks().filter((x) => x.id !== l.id));
      toast(t('Link deleted'));
      if (!$('#link-done').hidden && $('#link-url').textContent === l.url) show('new');
      renderLinks();
    } catch {
      toast(t('Could not delete the link. Try again.'));
    }
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); } catch {
      const el = Object.assign(document.createElement('input'), { value: url });
      document.body.append(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    toast(t('Link copied'));
  }
  function show(view) {
    $('#link-new').hidden = view !== 'new';
    $('#link-progress').hidden = view !== 'progress';
    $('#link-done').hidden = view !== 'done';
  }
  function setBar(frac, text) {
    $('.link-bar span', dlg).style.width = `${(frac * 100).toFixed(1)}%`;
    if (text) $('#link-status').textContent = text;
  }

  // How many times each link was downloaded; drop links that are gone (all downloads used, deleted on another
  // device, or the server was cleaned up)
  async function pruneLinks() {
    const list = loadLinks();
    const gone = [];
    const info = new Map();
    await Promise.all(list.map((l) => fetch(`/api/drop/${l.id}`, { cache: 'no-store', headers: { 'X-Drop-Token': l.token } })
      .then(async (r) => {
        if (r.status === 404) gone.push(l.id);
        else if (r.ok) info.set(l.id, await r.json());
      }, () => {})));
    if (!gone.length && !info.size) return;
    saveLinks(loadLinks().filter((l) => !gone.includes(l.id)).map((l) => {
      const i = info.get(l.id);
      return i ? { ...l, downloads: i.downloads, max: i.max, locked: i.locked } : l;
    }));
    renderLinks();
  }
  let pruneTimer = 0;

  function open(focusTo) {
    if (!job) show('new');
    renderLinks();
    pruneLinks();
    dlg.showModal();
    // Download counts change while the dialog is open
    clearInterval(pruneTimer);
    pruneTimer = setInterval(() => { if (dlg.open) pruneLinks(); else clearInterval(pruneTimer); }, 15000);
    if (focusTo && !job) $('#link-to').focus();
  }
  btn.onclick = () => open(false);
  btnTo.onclick = () => open(true);
  $('#link-pin').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
    $('#link-pin-note').hidden = !e.target.value;
  });
  $('#link-to').addEventListener('input', (e) => { e.target.removeAttribute('aria-invalid'); });
  for (const id of ['#link-email', '#link-sms', '#link-send-to']) $(id)?.addEventListener('click', sentStat);
  dlg.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'pick') {
      // Check the options before the file picker opens
      const to = recipient($('#link-to').value);
      if (to === false) {
        $('#link-to').setAttribute('aria-invalid', 'true');
        $('#link-to').focus();
        return toast(PHONE_DEVICE ? t('Type an email address or a phone number, or leave it empty.') : t('Type an email address, or leave it empty.'));
      }
      const pin = $('#link-pin').value;
      if (pin && !PIN_RE.test(pin)) { $('#link-pin').focus(); return toast(t('The PIN needs 4 to 8 digits.')); }
      input.click();
    }
    else if (act === 'note-open') {
      // A secret note: text instead of files, on a link that opens once (get.js shows it and it's gone)
      const box = $('#link-note');
      box.hidden = !box.hidden;
      e.target.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) $('#link-note-text').focus();
    }
    else if (act === 'note-make') {
      const to = recipient($('#link-to').value);
      if (to === false) {
        $('#link-to').setAttribute('aria-invalid', 'true');
        $('#link-to').focus();
        return toast(PHONE_DEVICE ? t('Type an email address or a phone number, or leave it empty.') : t('Type an email address, or leave it empty.'));
      }
      const pin = $('#link-pin').value;
      if (pin && !PIN_RE.test(pin)) { $('#link-pin').focus(); return toast(t('The PIN needs 4 to 8 digits.')); }
      const text = $('#link-note-text').value;
      if (!text.trim()) return $('#link-note-text').focus();
      upload([new File([text], 'secret-note.txt', { type: 'text/plain' })], { note: true });
    }
    else if (act === 'cancel' && job) job.cancelled = true;
    else if (act === 'copy') copy($('#link-url').textContent);
    else if (act === 'share') {
      const url = $('#link-url').textContent;
      const l = loadLinks().find((x) => x.url === url);
      const text = l ? message(l).body.replace(url, '').replace(/\n\n+/g, '\n').trim() : '';
      if (navigator.share) navigator.share({ title: 'OmniBeam', text, url }).catch(() => {});
      else copy(url);
    }
  });
  input.onchange = () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) upload(files);
  };
  // Scan to PDF (scan.js) and the chat view hand their files to a new link with the options set in this window
  window.OmniLink = { available: () => !btn.hidden && !!window.crypto?.subtle, share(files) { open(false); upload(files); } };

  async function put(url, token, body) {
    // A few tries per part: phones switch networks, and shared hosting has hiccups
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url, { method: 'PUT', headers: { 'X-Drop-Token': token, 'Content-Type': 'application/octet-stream' }, body });
        if (r.ok) return r.json();
        if (r.status < 500 && r.status !== 409) throw Object.assign(new Error('rejected'), { fatal: true });
        if (r.status === 409) {
          const info = await r.json().catch(() => ({}));
          if (info.got > Number(url.split('/').pop())) return info; // it arrived after all
        }
      } catch (err) {
        if (err.fatal || attempt >= 4) throw err;
      }
      await sleep(1000 * (attempt + 1));
    }
  }

  // opts.note: a secret note (one file with the text): the link opens once, whatever "Downloads allowed" says
  async function upload(files, opts = {}) {
    if (!cfg || job) return;
    const size = files.reduce((s, f) => s + f.size, 0);
    if (!size) return toast(t('These files are empty.'));
    if (size > cfg.maxMb * 1048576) return toast(t('Too large: a link can hold up to {size}. Send it directly to a device instead.', { size: formatSize(cfg.maxMb * 1048576) }));
    const current = job = { cancelled: false };
    window.keepAwake?.('link', true); // a phone that locks its screen would stop the upload
    show('progress');
    setBar(0, t('Encrypting and uploading…'));
    try {
      const raw = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const meta = { v: 1, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type || '' })), ...(opts.note ? { note: 1 } : {}) };
      const encMeta = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(0, true) }, key, new TextEncoder().encode(JSON.stringify(meta)));
      const hours = Number($('#link-hours').value) || 24;
      const max = opts.note ? 1 : Number($('#link-max').value) || 0;
      const once = max === 1;
      const pinText = $('#link-pin').value;
      const pin = PIN_RE.test(pinText) ? await pinProof(pinText, b64u(raw)) : '';
      const to = recipient($('#link-to').value) || null;
      const r = await fetch('/api/drop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, hours, max, once, pin, meta: b64u(encMeta), note: !!opts.note }),
      });
      const created = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(created.error === 'too-many' ? t('Too many links from your network today. Try again later.')
          : created.error === 'full' ? t('Link storage is full right now. Try again later, or send directly to a device.')
          : created.error === 'too-large' ? t('Too large: a link can hold up to {size}. Send it directly to a device instead.', { size: formatSize(cfg.maxMb * 1048576) })
          : t('Could not create the link. Try again.'));
      }
      Object.assign(current, { id: created.id, token: created.token });
      const all = new Blob(files);
      const parts = Math.max(1, Math.ceil(size / created.part));
      for (let n = 0; n < parts; n++) {
        if (current.cancelled) throw new Error('cancelled');
        const plain = await all.slice(n * created.part, Math.min(size, (n + 1) * created.part)).arrayBuffer();
        const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, plain);
        await put(`/api/drop/${created.id}/${n}`, created.token, sealed);
        const frac = (n + 1) / parts;
        setBar(frac, `${t('Encrypting and uploading…')} ${Math.floor(frac * 100)}%`);
      }
      const url = `${location.origin}/d/${created.id}#${b64u(raw)}`;
      const names = opts.note ? `🔒 ${t('Secret note')}` : files.length > 1 ? t('{name} and {n} more', { name: files[0].name, n: files.length - 1 }) : files[0].name;
      const link = { id: created.id, token: created.token, url, names, size, expires: created.expires, once, max, downloads: 0, pin: !!pin, note: !!opts.note };
      saveLinks([...loadLinks(), link]);
      $('#link-url').textContent = url;
      $('#link-summary').textContent = `${names} · ${formatSize(size)} · ${timeLeft(created.expires - Date.now())}${max ? ' · ' + (max === 1 ? t('one download') : t('{max} downloads', { max })) : ''}${pin ? ' · ' + t('PIN') + ' ' + pinText : ''}`;
      setSendButtons({ ...link, to });
      if (to?.kind === 'email' && cfg.email) {
        $('#link-send-to').hidden = true;
        emailByServer(link, to.to, b64u(raw));
      }
      // Clear the PIN, recipient and note for the next link
      $('#link-note-text').value = '';
      $('#link-note').hidden = true;
      $('[data-act=note-open]', dlg).setAttribute('aria-expanded', 'false');
      $('#link-pin').value = '';
      $('#link-pin-note').hidden = true;
      $('#link-to').value = '';
      const qrBox = $('#link-qr');
      qrBox.innerHTML = '';
      try {
        await window.loadQr(); // qrcode.js, loaded on first use (app.js)
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch {}
      show('done');
      renderLinks();
    } catch (err) {
      if (current.id) fetch(`/api/drop/${current.id}`, { method: 'DELETE', headers: { 'X-Drop-Token': current.token } }).catch(() => {});
      show('new');
      if (err.message !== 'cancelled') window.omniReport?.('link', 'Upload failed: ' + (err.message || err.name), { size });
      if (err.message !== 'cancelled') toast(err.message === 'rejected' || err instanceof TypeError ? t('Upload failed. Check the connection and try again.') : err.message);
    } finally {
      job = null;
      window.keepAwake?.('link', false);
    }
  }
})();
