// OmniBeam: share files by link (in the ⋯ menu at the top).
// The files are encrypted here with a new random AES-GCM key, uploaded to the server in parts, and the link is
// omnibeam.site/d/<id>#<key>. Browsers never send the part after # to a server, so the server only ever has
// data it can't read. The download page (drop.html + get.js) decrypts it in the receiver's browser.
// Format: part n of the files (one after the other, 4 MB each) is encrypted with IV [0,0,0,0,0,0,0,0,n (4 bytes)];
// the list of names and sizes is encrypted with IV [1,0,…,0].
// Options: how long the link works (up to the server's limit), how many downloads it allows, a PIN or password (any
// 4 to 32 characters, see pinProof), whether chat apps may show the file name and a small picture (linkPreview),
// and an email address or phone number to send it to: an email is sent by the server when it has a Resend key
// (see emailByServer), otherwise the mail or messages app opens with the link written in. "Your links" shows how many times each link was downloaded.
// A whole folder can be shared too (its files keep their places in it: the download page saves them as one ZIP with
// the same folders). "Notify me when someone downloads my links": a notification from the server (web push, also
// while OmniBeam is closed) and, while this page is open, a message here.
'use strict';
(function () {
  const btn = $('#btn-link');
  const btnTo = $('#btn-sendto');
  const dlg = $('#dlg-link');
  const input = $('#link-input');
  const folderInput = $('#link-folder-input');
  // iPhones and iPads can't choose a folder in a browser
  if (isIOS || !('webkitdirectory' in folderInput)) $('#link-folder-btn').remove();
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
  const PIN_RE = /^[^\n]{4,32}$/;
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
    const text = message(l).body;
    $('#link-wa').href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    $('#link-tg').href = `https://t.me/share/url?url=${encodeURIComponent(l.url)}&text=${encodeURIComponent(text.replace(l.url, '').replace(/\n\n+/g, '\n').trim())}`;
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
    $('#link-notify').checked = notifyOn();
    const box = $('#link-list');
    box.innerHTML = '';
    for (const l of list.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="meta"><div class="fname"></div><div class="fsize"></div></div>
        <button class="btn small ghost" data-act="copy-one">${escapeHtml(t('Copy link'))}</button>
        <button class="btn small ghost" data-act="delete-one">${escapeHtml(t('Delete'))}</button>`;
      $('.fname', item).textContent = l.names;
      $('.fsize', item).textContent = `${formatSize(l.size)} · ${timeLeft(l.expires - Date.now())} · ${downloadsText(l)} · ${t('Views: {n}', { n: l.views || 0 })}${l.pin ? ' · ' + t('PIN') : ''}`;
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
      return i ? { ...l, downloads: i.downloads, views: i.views, max: i.max, locked: i.locked } : l;
    }));
    renderLinks();
  }
  let pruneTimer = 0;

  // ---- Notify me when someone downloads my links ----
  const NOTIFY_KEY = 'omnibeam-link-notify';
  const notifyOn = () => { try { return localStorage.getItem(NOTIFY_KEY) !== '0'; } catch { return true; } };
  // For app.js (sendPushSub): the links the server may send a notification about
  window.shareLinksForPush = () => (notifyOn() ? loadLinks().filter((l) => !l.note).slice(-20).map((l) => ({ id: l.id, token: l.token })) : []);
  $('#link-notify').addEventListener('change', (e) => {
    try { localStorage.setItem(NOTIFY_KEY, e.target.checked ? '1' : '0'); } catch {}
    // Notifications while OmniBeam is closed need them turned on (asked now, while the tap counts)
    if (e.target.checked && typeof pushOn === 'function' && !pushOn() && typeof enablePush === 'function') enablePush();
    else window.sendPushSub?.();
    toast(e.target.checked ? t('You get a notification when someone downloads one of your links') : t('No notifications about downloads'));
  });
  // While this page is open: a message when a link was downloaded since the last look (every minute)
  async function watchDownloads() {
    if (document.hidden || !notifyOn() || !loadLinks().length || dlg.open) return;
    const before = new Map(loadLinks().map((l) => [l.id, l.downloads || 0]));
    await pruneLinks();
    for (const l of loadLinks()) {
      const was = before.get(l.id);
      if (was != null && (l.downloads || 0) > was) toast(t('Someone downloaded {name}', { name: l.names }), 6000);
    }
  }
  setInterval(watchDownloads, 60000);
  // A notification about a download was tapped: show the links
  if (/[?&]links=1/.test(location.search)) setTimeout(() => { if (cfg) open(false); }, 1500);

  // "I have the legal right to share this": in this window until it is ticked once on this device (see confirmRights
  // in app.js); unticking it again before the link is made takes it back
  const rights = $('#link-rights');
  $('input', rights).addEventListener('change', (e) => { window.setRights(e.target.checked); rights.classList.remove('need'); });
  function open(focusTo) {
    if (!job) show('new');
    rights.hidden = window.rightsOk();
    if (!rights.hidden) $('input', rights).checked = false;
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
    e.target.value = e.target.value.slice(0, 32);
    $('#link-pin-note').hidden = !e.target.value;
    // A link with a PIN shows nothing in chat previews
    $('#link-pub-box').hidden = !!e.target.value;
  });
  // "Show the name in chat previews": remembered on this device
  try { $('#link-pub').checked = localStorage.getItem('omnibeam-link-pub') === '1'; } catch {}
  $('#link-pub').addEventListener('change', (e) => { try { localStorage.setItem('omnibeam-link-pub', e.target.checked ? '1' : '0'); } catch {} });
  $('#link-to').addEventListener('input', (e) => { e.target.removeAttribute('aria-invalid'); });
  for (const id of ['#link-email', '#link-sms', '#link-send-to', '#link-wa', '#link-tg']) $(id)?.addEventListener('click', sentStat);
  dlg.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'pick' || act === 'pick-folder') {
      // Check the options before the file picker opens
      const to = recipient($('#link-to').value);
      if (to === false) {
        $('#link-to').setAttribute('aria-invalid', 'true');
        $('#link-to').focus();
        return toast(PHONE_DEVICE ? t('Type an email address or a phone number, or leave it empty.') : t('Type an email address, or leave it empty.'));
      }
      const pin = $('#link-pin').value;
      if (pin && !PIN_RE.test(pin)) { $('#link-pin').focus(); return toast(t('The PIN or password needs 4 to 32 characters.')); }
      if (!window.rightsOk()) return window.needRights(rights);
      (act === 'pick-folder' ? folderInput : input).click();
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
      if (pin && !PIN_RE.test(pin)) { $('#link-pin').focus(); return toast(t('The PIN or password needs 4 to 32 characters.')); }
      const text = $('#link-note-text').value;
      if (!text.trim()) return $('#link-note-text').focus();
      if (!window.rightsOk()) return window.needRights(rights);
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
  folderInput.onchange = () => {
    const files = [...folderInput.files].filter((f) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(f.webkitRelativePath || f.name));
    folderInput.value = '';
    if (!files.length) return toast(t('This folder is empty.'));
    if (files.length > 1000) return toast(t('Too many files in this folder (up to {n}).', { n: 1000 }));
    upload(files, { folder: (files[0].webkitRelativePath || '').split('/')[0] || t('Folder') });
  };
  // Scan to PDF (scan.js) and the chat view hand their files to a new link with the options set in this window
  window.OmniLink = { available: () => !btn.hidden && !!window.crypto?.subtle, share(files) { open(false); upload(files); } };

  // One part by PUT, with how many bytes went so far (onSent). XMLHttpRequest, not fetch: only it tells upload progress,
  // so the bar moves smoothly on a slow line instead of jumping once per part
  const STALL_MS = window.omnibeamStallMs || 20000;
  function sendPart(url, token, body, onSent) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      x.setRequestHeader('X-Drop-Token', token);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      // A part that stops moving (a lost connection the browser doesn't notice, a hiccup on the way to the server)
      // is given up after STALL_MS without progress and sent again, instead of freezing the bar for minutes
      let timer = 0;
      const watch = (ms) => { clearTimeout(timer); timer = setTimeout(() => x.abort(), ms); };
      x.upload.onprogress = (e) => { watch(STALL_MS); onSent(e.loaded); };
      x.upload.onload = () => watch(STALL_MS * 2); // all sent: the server writes it and answers
      x.onload = () => {
        clearTimeout(timer);
        let j = {};
        try { j = JSON.parse(x.responseText); } catch {}
        resolve({ status: x.status, json: j });
      };
      x.onerror = x.ontimeout = x.onabort = () => { clearTimeout(timer); reject(new TypeError('network')); };
      watch(STALL_MS);
      x.send(body);
    });
  }
  async function put(url, token, body, onSent = () => {}) {
    // A few tries per part: phones switch networks, and shared hosting has hiccups. 409: that part is still
    // arriving from a try that seemed lost; asking again later answers OK once it's there
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await sendPart(url, token, body, onSent);
        if (r.status >= 200 && r.status < 300) return r.json;
        if (r.status < 500 && r.status !== 409) throw Object.assign(new Error('rejected'), { fatal: true });
      } catch (err) {
        if (err.fatal || attempt >= 6) throw err;
      }
      onSent(0);
      await sleep(1000 * Math.min(attempt + 1, 5));
    }
  }
  // Encrypt and upload all parts, UP_PARALLEL at a time. One at a time left the line idle while each part went
  // through Cloudflare to the server and back (about half the time); a few at once keeps it busy.
  // onProgress(bytes sent, all bytes); stop() true: give up (Cancel)
  const UP_PARALLEL = 4;
  async function uploadParts(all, size, part, key, base, token, onProgress, stop) {
    const parts = Math.max(1, Math.ceil(size / part));
    const total = size + parts * 16;
    const sent = new Array(parts).fill(0);
    let sum = 0;
    let next = 0;
    let failed = false;
    const worker = async () => {
      while (next < parts && !failed) {
        if (stop()) throw new Error('cancelled');
        const n = next++;
        const plain = await all.slice(n * part, Math.min(size, (n + 1) * part)).arrayBuffer();
        const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, plain);
        const mark = (b) => {
          sum += b - sent[n];
          sent[n] = b;
          onProgress(Math.min(sum, total), total);
        };
        await put(`${base}/${n}`, token, sealed, mark);
        mark(sealed.byteLength);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UP_PARALLEL, parts) }, () => worker().catch((err) => { failed = true; throw err; })));
  }

  // What chat apps show when the link is pasted, if the sender ticked it: the name and size, and a small JPEG of the
  // first photo. Only these are readable by the server (the files stay encrypted).
  async function linkPreview(files, size, folder) {
    const title = folder ? `📁 ${folder} (${t('{n} files', { n: files.length })}, ${formatSize(size)})`.slice(0, 120) : `${files.length > 1 ? t('{name} and {n} more', { name: files[0].name, n: files.length - 1 }) : files[0].name} (${formatSize(size)})`.slice(0, 120);
    let thumb = '';
    const photo = files.find((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type) && f.size < 40 * 1048576);
    if (photo) {
      try {
        const url = URL.createObjectURL(photo);
        const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
        URL.revokeObjectURL(url);
        for (const [side, q] of [[600, 0.75], [400, 0.6]]) {
          const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) });
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', q).split(',')[1] || '';
          if (data.length <= 130000) { thumb = data; break; }
        }
      } catch {}
    }
    return { title, ...(thumb ? { thumb } : {}) };
  }

  // opts.note: a secret note (one file with the text): the link opens once, whatever "Downloads allowed" says.
  // opts.folder: the name of a folder chosen whole (the files' names then keep their place in it: "Trip/day 1/a.jpg")
  async function upload(files, opts = {}) {
    if (!cfg || job) return;
    const size = files.reduce((s, f) => s + f.size, 0);
    if (!size) return toast(t('These files are empty.'));
    if (size > cfg.maxMb * 1048576) return toast(t('Too large: a link can hold up to {size}. Send it directly to a device instead.', { size: formatSize(cfg.maxMb * 1048576) }));
    // (Scan to PDF and the chat view come here without the window's box: they ask in their own small window)
    if (!(await window.confirmRights()) || job) return;
    const current = job = { cancelled: false };
    window.keepAwake?.('link', true); // a phone that locks its screen would stop the upload
    show('progress');
    setBar(0, t('Encrypting and uploading…'));
    try {
      const raw = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
      const nameOf = (f) => (opts.folder && f.webkitRelativePath ? f.webkitRelativePath : f.name).slice(0, 200);
      const meta = { v: 1, files: files.map((f) => ({ name: nameOf(f), size: f.size, type: f.type || '' })), ...(opts.note ? { note: 1 } : {}), ...(opts.folder ? { folder: String(opts.folder).slice(0, 120) } : {}) };
      const encMeta = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(0, true) }, key, new TextEncoder().encode(JSON.stringify(meta)));
      if (b64u(encMeta).length > 300000) throw new Error(t('Too many files in this folder (up to {n}).', { n: 1000 }));
      const hours = Number($('#link-hours').value) || 24;
      const max = opts.note ? 1 : Number($('#link-max').value) || 0;
      const once = max === 1;
      const pinText = $('#link-pin').value;
      const pin = PIN_RE.test(pinText) ? await pinProof(pinText, b64u(raw)) : '';
      const to = recipient($('#link-to').value) || null;
      const pub = !opts.note && !pin && $('#link-pub').checked ? await linkPreview(files, size, opts.folder) : undefined;
      const r = await fetch('/api/drop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, hours, max, once, pin, meta: b64u(encMeta), note: !!opts.note, pub }),
      });
      const created = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(created.error === 'too-many' ? t('Too many links from your network today. Try again later.')
          : created.error === 'full' ? t('Link storage is full right now. Try again later, or send directly to a device.')
          : created.error === 'too-large' ? t('Too large: a link can hold up to {size}. Send it directly to a device instead.', { size: formatSize(cfg.maxMb * 1048576) })
          : t('Could not create the link. Try again.'));
      }
      Object.assign(current, { id: created.id, token: created.token });
      let shown = 0;
      await uploadParts(new Blob(files), size, created.part, key, `/api/drop/${created.id}`, created.token, (done, total) => {
        const now = Date.now();
        if (now - shown < 200 && done < total) return; // at most 5 updates a second
        shown = now;
        const frac = done / total;
        setBar(frac, `${t('Encrypting and uploading…')} ${Math.floor(frac * 100)}% · ${formatSize(Math.min(done, size))} / ${formatSize(size)}`);
      }, () => current.cancelled);
      const url = `${location.origin}/d/${created.id}#${b64u(raw)}`;
      const names = opts.note ? `🔒 ${t('Secret note')}` : opts.folder ? `📁 ${opts.folder} (${t('{n} files', { n: files.length })})` : files.length > 1 ? t('{name} and {n} more', { name: files[0].name, n: files.length - 1 }) : files[0].name;
      const link = { id: created.id, token: created.token, url, names, size, expires: created.expires, once, max, downloads: 0, pin: !!pin, note: !!opts.note };
      saveLinks([...loadLinks(), link]);
      if (notifyOn()) window.sendPushSub?.(); // the server learns this link may send download notifications
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
      $('#link-pub-box').hidden = false;
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
