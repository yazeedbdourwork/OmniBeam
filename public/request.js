// OmniBeam: request files by link (in the ⋯ menu at the top). The other way round from share by link (drop.js):
// this device makes a link (omnibeam.site/r/<id>#<key>) and sends it to someone. They open it on any device, with no
// pairing or app, pick files (request.html + put.js), and the files arrive here, in Received files.
// The key after # never reaches the server. It seals what this device asks for ({ v, name, ask }), and the upload
// page uses it to seal each upload's own key and file names ({ v, k, from, files }); the file data is encrypted with
// that upload key exactly like a shared link (4 MB parts, IV [0…0, part number]). Both boxes are [12-byte random IV]
// + AES-GCM ciphertext, base64url.
// Files wait on the server until this device picks them up (then they're deleted there): right away when OmniBeam
// is open here (the server says so over the WebSocket), otherwise when it opens next, or after a notification.
// Every new link also gets an ECDH (P-256) key pair; the private key never leaves this device. The "Send me files" box
// for a website (/embed/r/<id>#<key>.<public key>) and the Telegram bot seal each upload's key to the public key
// ("x1.<sender's public key>.<box>", see put.js), because the code on a website, and so the link's key, is public.
'use strict';
(function () {
  const btn = $('#btn-request');
  const dlg = $('#dlg-asklink');
  if (!btn || !dlg) return;
  const KEY = 'omnibeam-requests';
  const ASK_MAX = 300;
  let cfg = null;
  const busy = new Set(); // uploads being downloaded now
  let checking = null;

  const b64u = (buf) => {
    let s = '';
    for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const ivFor = (n) => {
    const v = new Uint8Array(12);
    new DataView(v.buffer).setUint32(8, n);
    return v;
  };
  const importKey = (raw) => crypto.subtle.importKey('raw', typeof raw === 'string' ? fromB64u(raw) : raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return b64u(out);
  }
  async function open(key, text) {
    const all = fromB64u(text);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  // Boxes sealed to this device's public key (see the top)
  const X1_LABEL = new TextEncoder().encode('omnibeam-x1:');
  async function x1Key(privJwk, theirRaw) {
    const priv = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const pub = await crypto.subtle.importKey('raw', fromB64u(theirRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256));
    const both = new Uint8Array(X1_LABEL.length + shared.length);
    both.set(X1_LABEL);
    both.set(shared, X1_LABEL.length);
    return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', both), 'AES-GCM', false, ['decrypt']);
  }
  async function openMeta(r, text) {
    if (!text.startsWith('x1.')) return open(await importKey(r.key), text);
    if (!r.priv) throw new Error('no private key');
    const [, theirs, box] = text.split('.');
    return open(await x1Key(r.priv, theirs), box);
  }
  async function newKeyPair() {
    try {
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
      return { pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), priv: await crypto.subtle.exportKey('jwk', kp.privateKey) };
    } catch { return {}; } // a browser without ECDH: the link works, just not on a website
  }
  // The code for someone's website: the box in an <iframe>, and a visible link back to OmniBeam
  function embedCode(r) {
    const lang = (window.I18N && I18N.lang) || 'en';
    const src = `${location.origin}/embed/r/${r.id}${lang !== 'en' ? `?lang=${lang}` : ''}#${r.key}.${r.pub}`;
    const home = `${location.origin}${lang !== 'en' ? `/${lang}/` : '/'}`;
    const attr = (s) => escapeHtml(s).replace(/"/g, '&quot;');
    return `<iframe src="${src}" title="${attr(t('Send me files'))}" style="width:100%;max-width:520px;height:470px;border:0;border-radius:18px" loading="lazy"></iframe>\n`
      + `<p style="margin:6px 0;font:13px/1.4 system-ui,sans-serif"><a href="${home}">${escapeHtml(t('Powered by OmniBeam'))}</a> · ${escapeHtml(t('free, end-to-end encrypted file sharing'))}</p>`;
  }
  function showEmbed(r) {
    const box = $('#req-embed');
    if (!r?.pub) {
      box.hidden = false;
      $('#req-embed-code').hidden = true;
      $('#req-embed-copy').hidden = true;
      $('#req-embed-old').hidden = false;
      return;
    }
    $('#req-embed-code').value = embedCode(r);
    $('#req-embed-code').hidden = false;
    $('#req-embed-copy').hidden = false;
    $('#req-embed-old').hidden = true;
    $('#req-embed-short').hidden = r.expires - Date.now() > 31 * 86400000;
    box.hidden = false;
  }
  const PIN_RE = /^\d{4,8}$/;
  const pinProof = async (pin, keyB64) => b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`omnibeam-pin:${pin}:${keyB64}`)));

  // The request links this device made: { id, token, key, url, ask, expires, keep, max, pin, got, uploads }.
  // Kept after a link ends for as long as files sent to it can still be waiting on the server (keep).
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]').filter((r) => (r.keep || r.expires) > Date.now()); } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  }
  function update(id, fn) {
    save(load().map((r) => (r.id === id ? { ...r, ...fn(r) } : r)));
  }
  // Tell the server which links this tab is waiting on, so it can say the moment files arrive
  function watch() {
    if (!cfg?.requests) return;
    wsSend?.({ type: 'watch-requests', items: load().map((r) => ({ id: r.id, token: r.token })) });
  }
  window.requestLinksForPush = () => load().map((r) => ({ id: r.id, token: r.token })); // app.js: sendPushSub

  window.addEventListener('omnibeam-config', (e) => {
    cfg = e.detail.drop || null;
    btn.hidden = !cfg?.requests || !window.crypto?.subtle;
    if (btn.hidden) return;
    $('#req-limit').textContent = t('People can send up to {size} at a time.', { size: formatSize(cfg.maxMb * 1048576) });
    for (const o of $('#req-hours').options) o.disabled = o.hidden = Number(o.value) > (cfg.requestMaxHours || cfg.maxHours);
    if ($('#req-hours').selectedOptions[0]?.disabled) $('#req-hours').value = '24';
    watch();
    check();
  });
  window.addEventListener('omnibeam-ws-open', watch);
  window.addEventListener('omnibeam-request-files', () => check());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  // In case a message from the server was missed (a phone asleep, a dropped connection)
  setInterval(() => { if (document.visibilityState === 'visible' && load().length) check(); }, 60000);

  // ---- The dialog ----
  const PHONE_DEVICE = isIOS || /Android/i.test(navigator.userAgent);
  if (!PHONE_DEVICE) $('#req-sms').remove();
  function show(view) {
    $('#req-new').hidden = view !== 'new';
    $('#req-done').hidden = view !== 'done';
    $('#req-embed').hidden = true;
  }
  function timeLeft(ms) {
    const h = Math.round(ms / 3600000);
    if (h >= 48) return t('{n} days left', { n: Math.round(h / 24) });
    return h >= 1 ? t('{n} h left', { n: h }) : t('{n} min left', { n: Math.max(1, Math.round(ms / 60000)) });
  }
  function message(r) {
    const lines = [t('{name} asks you to send files with OmniBeam. Open this link and pick them, no app needed:', { name: me?.name || t('Someone') }), r.url];
    if (r.ask) lines.splice(1, 0, `“${r.ask}”`);
    if (r.pin) lines.push(t('You also need a PIN to open it. I will tell you the PIN separately.'));
    return { subject: t('Please send me files'), body: lines.join('\n') };
  }
  function setButtons(r) {
    const m = message(r);
    $('#req-email').href = `mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
    if ($('#req-sms')) $('#req-sms').href = `sms:${isIOS ? '&' : '?'}body=${encodeURIComponent(m.body)}`;
  }
  function statusText(r) {
    const got = r.got || 0;
    const parts = [got === 1 ? t('1 upload received') : t('{n} uploads received', { n: got })];
    if (r.expires > Date.now()) parts.push(timeLeft(r.expires - Date.now()));
    else parts.push(t('Ended'));
    if (r.max) parts.push(t('{n} of {max} uploads', { n: r.uploads ?? got, max: r.max }));
    if (r.pin) parts.push(t('PIN'));
    return parts.join(' · ');
  }
  function render() {
    const list = load();
    $('#req-mine').hidden = !list.length;
    const box = $('#req-list');
    box.innerHTML = '';
    for (const r of list.slice().reverse()) {
      const item = document.createElement('div');
      item.className = 'item';
      item.innerHTML = `<div class="meta"><div class="fname"></div><div class="fsize"></div></div>
        <button class="btn small ghost" data-act="copy-one">${escapeHtml(t('Copy link'))}</button>
        <button class="btn small ghost" data-act="embed-one">${escapeHtml(t('Website code'))}</button>
        <button class="btn small ghost" data-act="delete-one">${escapeHtml(t('Delete'))}</button>`;
      $('.fname', item).textContent = r.ask || t('Request link');
      $('.fsize', item).textContent = statusText(r);
      if (r.locked) $('.fsize', item).insertAdjacentHTML('beforeend', ` · <span class="locked">${escapeHtml(t('Locked: too many wrong PINs'))}</span>`);
      const copyBtn = item.querySelector('[data-act="copy-one"]');
      const embedBtn = item.querySelector('[data-act="embed-one"]');
      if (r.expires > Date.now()) copyBtn.onclick = () => copy(r.url);
      else copyBtn.remove();
      if (r.expires > Date.now() && r.pub && !r.tg) embedBtn.onclick = () => copy(embedCode(r), t('Code copied'));
      else embedBtn.remove();
      if (r.tg) $('.fname', item).textContent = t('Telegram bot');
      item.querySelector('[data-act="delete-one"]').onclick = () => remove(r);
      box.appendChild(item);
    }
  }
  async function copy(url, done = t('Link copied')) {
    try { await navigator.clipboard.writeText(url); } catch {
      const el = Object.assign(document.createElement('textarea'), { value: url });
      document.body.append(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    toast(done);
  }
  async function remove(r) {
    try {
      const res = await fetch(`/api/request/${r.id}`, { method: 'DELETE', headers: { 'X-Request-Token': r.token } });
      if (!res.ok && res.status !== 404) throw new Error();
      save(load().filter((x) => x.id !== r.id));
      toast(t('Link deleted'));
      if (!$('#req-done').hidden && $('#req-url').textContent === r.url) show('new');
      render();
      watch();
    } catch {
      toast(t('Could not delete the link. Try again.'));
    }
  }
  btn.onclick = () => {
    show('new');
    render();
    dlg.showModal();
    check();
  };
  $('#req-pin').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8);
    $('#req-pin-note').hidden = !e.target.value;
  });
  dlg.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') dlg.close();
    else if (act === 'make') create();
    else if (act === 'copy') copy($('#req-url').textContent);
    else if (act === 'embed') showEmbed(load().find((x) => x.url === $('#req-url').textContent));
    else if (act === 'copy-embed') copy($('#req-embed-code').value, t('Code copied'));
    else if (act === 'share') {
      const url = $('#req-url').textContent;
      const r = load().find((x) => x.url === url);
      const text = r ? message(r).body.replace(url, '').trim() : '';
      if (navigator.share) navigator.share({ title: 'OmniBeam', text, url }).catch(() => {});
      else copy(url);
    }
  });

  // A new request link on the server: { hours, max, pinText, ask, tg } -> the saved record (see load)
  async function makeLink({ hours, max = 0, pinText = '', ask = '', tg = false }) {
    const raw = crypto.getRandomValues(new Uint8Array(16));
    const keyText = b64u(raw);
    const key = await importKey(raw);
    const meta = await seal(key, { v: 1, name: me?.name || deviceName(), ask });
    const pin = PIN_RE.test(pinText) ? await pinProof(pinText, keyText) : '';
    const pair = await newKeyPair();
    const res = await fetch('/api/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours, max, pin, meta }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error === 'too-many' ? t('Too many links from your network today. Try again later.') : t('Could not create the link. Try again.'));
    const url = `${location.origin}/r/${j.id}#${keyText}`;
    const r = { id: j.id, token: j.token, key: keyText, url, ask, expires: j.expires, keep: j.expires + cfg.maxHours * 3600000, max, pin: !!pin, got: 0, uploads: 0, ...pair, ...(tg ? { tg: true } : {}) };
    save([...load(), r]);
    watch();
    return r;
  }
  // For the Telegram bot in Settings (telegram part below)
  window.omniRequests = { makeLink, load, remove: (id) => { save(load().filter((x) => x.id !== id)); watch(); }, ready: () => !!cfg?.requests };

  let making = false;
  async function create() {
    if (!cfg?.requests || making) return;
    const pinText = $('#req-pin').value;
    if (pinText && !PIN_RE.test(pinText)) { $('#req-pin').focus(); return toast(t('The PIN needs 4 to 8 digits.')); }
    making = true;
    try {
      const ask = $('#req-ask').value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, ASK_MAX);
      const hours = Number($('#req-hours').value) || 24;
      const max = Number($('#req-max').value) || 0;
      const r = await makeLink({ hours, max, pinText, ask });
      const { url } = r;
      const j = { expires: r.expires };
      const pin = r.pin;
      $('#req-url').textContent = url;
      $('#req-summary').textContent = `${ask ? `“${ask}” · ` : ''}${timeLeft(j.expires - Date.now())}${max ? ' · ' + t('{max} uploads', { max }) : ''}${pin ? ' · ' + t('PIN') + ' ' + pinText : ''}`;
      setButtons(r);
      $('#req-ask').value = '';
      $('#req-pin').value = '';
      $('#req-pin-note').hidden = true;
      const qrBox = $('#req-qr');
      qrBox.innerHTML = '';
      try {
        await window.loadQr();
        const qr = qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch {}
      show('done');
      render();
      watch();
      sendPushSub?.(); // so a notification can come when files arrive while OmniBeam is closed
    } catch (err) {
      toast(err instanceof TypeError ? t('Could not create the link. Try again.') : err.message);
    } finally {
      making = false;
    }
  }

  // ---- Picking up files ----
  // Ask the server what's waiting on each link, and download what is
  function check() {
    if (!cfg?.requests) return Promise.resolve();
    if (checking) return checking;
    checking = (async () => {
      for (const r of load()) {
        let res;
        try { res = await fetch(`/api/request/${r.id}`, { cache: 'no-store', headers: { 'X-Request-Token': r.token } }); } catch { continue; }
        if (res.status === 404 || res.status === 403) {
          // Gone from the server (deleted on another tab, or ended with nothing waiting)
          if (r.expires < Date.now() || res.status === 403) save(load().filter((x) => x.id !== r.id));
          continue;
        }
        if (!res.ok) continue;
        const info = await res.json().catch(() => null);
        if (!info) continue;
        update(r.id, () => ({ uploads: info.uploads, locked: info.locked, expires: info.expires }));
        for (const item of info.files || []) await fetchUpload(r, item);
      }
      if (dlg.open) render();
    })().finally(() => { checking = null; });
    return checking;
  }

  async function fetchUpload(r, item) {
    if (busy.has(item.id)) return;
    busy.add(item.id);
    try {
      const meta = await openMeta(r, item.meta);
      const fileKey = await importKey(meta.k);
      const list = (Array.isArray(meta.files) ? meta.files : []).map((f) => ({ name: safePath(String(f.name || 'file')), size: Math.max(0, Number(f.size) || 0), type: String(f.type || '') }));
      const total = list.reduce((s, f) => s + f.size, 0);
      if (total !== item.size) throw new Error('size');
      const res = await fetch(`/api/drop/${item.id}/data`, { cache: 'no-store', headers: { 'X-Request-Token': r.token } });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      // Decrypt part by part as it arrives, and write each file to Received files storage
      const part = item.part || 4 * 1024 * 1024;
      const files = [];
      let fi = 0, inFile = 0, sink = null, mem = [], started = false;
      const endFile = async () => {
        const f = list[fi];
        let blob = sink ? await sink.finish() : new Blob(mem, { type: f.type });
        if (!blob) blob = new Blob(mem, { type: f.type });
        files.push({ id: sink?.id, name: f.name, size: f.size, mime: f.type || blob.type || '', blob });
        sink = null;
        mem = [];
        started = false;
        inFile = 0;
        fi++;
      };
      const write = async (bytes) => {
        let off = 0;
        while (fi < list.length && (off < bytes.length || list[fi].size === 0)) {
          if (!started) { sink = await Store.create(); started = true; }
          const take = Math.min(list[fi].size - inFile, bytes.length - off);
          if (take > 0) {
            const piece = bytes.slice(off, off + take);
            if (sink) await sink.write(piece); else mem.push(piece);
            off += take;
            inFile += take;
          }
          if (inFile === list[fi].size) await endFile();
        }
      };
      const reader = res.body.getReader();
      let pending = new Uint8Array(0);
      let n = 0, done = 0;
      const partLen = (k) => Math.min(part, item.size - k * part) + 16;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (value) {
          const merged = new Uint8Array(pending.length + value.length);
          merged.set(pending);
          merged.set(value, pending.length);
          pending = merged;
          while (n * part < item.size && pending.length >= partLen(n)) {
            const len = partLen(n);
            const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(n) }, fileKey, pending.subarray(0, len)));
            pending = pending.slice(len);
            await write(plain);
            done += plain.length;
            n++;
          }
        }
        if (end) break;
      }
      if (done !== item.size || fi !== list.length) {
        for (const f of files) if (f.id) Store.remove(f.id);
        throw new Error('incomplete');
      }
      const from = String(meta.from || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
      const label = r.tg ? t('{name} (Telegram)', { name: from || 'Telegram' }) : from ? t('{name} (request link)', { name: from }) : t('Request link');
      update(r.id, (x) => ({ got: (x.got || 0) + 1 }));
      // A text message sent to the Telegram bot arrives as a message, not as a file
      if (typeof meta.text === 'string' && !files.length) {
        showText({ info: { name: label } }, meta.text.slice(0, 64 * 1024));
        chime();
        notify(t('Message from {name}', { name: label }), meta.text.slice(0, 120));
        return;
      }
      showReceived({ info: { name: label } }, files);
      files.forEach((f) => History.add(f, label));
      chime();
      notify(t('Received files from {name}', { name: label }), files.map((f) => f.name).join(', '));
    } catch (err) {
      report('transfer', 'Request link file could not be downloaded', { d: String(err.message || err) });
      busy.delete(item.id); // tried again on the next check
      return;
    }
  }

  // ---- Telegram (the OmniBeam bot, when the server has one: TG_BOT_TOKEN) ----
  // Linking makes a request link of its own (1 year, tg: true) and sends the server only its public key and a device
  // name; the server gives a one-time code in a t.me link. What is sent to the bot then arrives like an upload to that
  // link (check above), sealed to this device's key on the server. Sending to Telegram goes through the server to the
  // chat. Neither is end-to-end: Telegram sees the files.
  let tgCfg = null;
  let tgPoll = null;
  let tgPicked = [];
  const tgLink = () => load().find((r) => r.tg);
  const tgHeaders = (r) => ({ 'X-Request-Token': r.token });
  window.addEventListener('omnibeam-config', (e) => {
    tgCfg = (e.detail.telegram && cfg?.requests && window.crypto?.subtle) ? e.detail.telegram : null;
    tgRefresh();
  });
  async function tgRefresh() {
    const section = $('#tg-section');
    if (!section) return false;
    section.hidden = !tgCfg;
    $('#btn-tg').hidden = true;
    if (!tgCfg) return false;
    const r = tgLink();
    let linked = false, name = '';
    if (r) {
      try {
        const res = await fetch(`/api/tg/link?id=${encodeURIComponent(r.id)}`, { cache: 'no-store', headers: tgHeaders(r) });
        if (res.ok) ({ linked, name } = await res.json());
      } catch {}
    }
    const waiting = !$('#tg-wait').hidden && !linked;
    $('#tg-off').hidden = linked || waiting;
    $('#tg-on').hidden = !linked;
    $('#btn-tg').hidden = !linked;
    if (linked) { $('#tg-wait').hidden = true; clearInterval(tgPoll); tgPoll = null; }
    $('#tg-state').textContent = linked ? (name ? t('Linked to Telegram ({name}).', { name }) : t('Linked to Telegram.')) : waiting ? '' : t('Not linked yet.');
    return linked;
  }
  $('#tg-link').onclick = async () => {
    const btnLink = $('#tg-link');
    btnLink.disabled = true;
    try {
      let r = tgLink();
      // A fresh link when there is none, it is from an older version (no key pair) or it ends within a month
      if (!r || !r.pub || r.expires - Date.now() < 30 * 86400000) {
        if (r) await fetch(`/api/request/${r.id}`, { method: 'DELETE', headers: tgHeaders(r) }).catch(() => {});
        if (r) window.omniRequests.remove(r.id);
        r = await makeLink({ hours: Math.min(8760, cfg.requestMaxHours || cfg.maxHours), tg: true });
        if (!r.pub) throw new Error('no key pair');
        sendPushSub?.();
      }
      const res = await fetch(`/api/tg/pair?id=${encodeURIComponent(r.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...tgHeaders(r) },
        body: JSON.stringify({ pub: r.pub, device: me?.name || deviceName(), lang: (window.I18N && I18N.lang) || 'en' }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.url) throw new Error(j.error || 'pair');
      $('#tg-open').href = j.url;
      $('#tg-wait').hidden = false;
      $('#tg-off').hidden = true;
      $('#tg-state').textContent = '';
      // Linked when the person tapped Start in Telegram: look every 3 seconds for 15 minutes
      clearInterval(tgPoll);
      const until = Date.now() + 15 * 60 * 1000;
      tgPoll = setInterval(async () => {
        if (Date.now() > until) { clearInterval(tgPoll); tgPoll = null; $('#tg-wait').hidden = true; tgRefresh(); return; }
        if (await tgRefresh()) toast(t('Linked to Telegram.'));
      }, 3000);
    } catch {
      toast(t('Could not link Telegram. Try again.'));
    } finally {
      btnLink.disabled = false;
    }
  };
  $('#tg-cancel').onclick = () => { clearInterval(tgPoll); tgPoll = null; $('#tg-wait').hidden = true; tgRefresh(); };
  $('#tg-unlink').onclick = async () => {
    const r = tgLink();
    if (!r) return tgRefresh();
    try {
      await fetch(`/api/tg/link?id=${encodeURIComponent(r.id)}`, { method: 'DELETE', headers: tgHeaders(r) });
      await fetch(`/api/request/${r.id}`, { method: 'DELETE', headers: tgHeaders(r) }).catch(() => {});
      window.omniRequests.remove(r.id);
      toast(t('Unlinked from Telegram'));
    } catch {
      toast(t('Could not send to Telegram. Try again.'));
    }
    tgRefresh();
  };

  // Sending files or a message to the Telegram chat
  const tgDlg = $('#dlg-tg');
  function tgRender() {
    const list = $('#tg-files');
    list.innerHTML = '';
    for (const f of tgPicked) {
      const li = document.createElement('li');
      li.textContent = `${f.name} · ${formatSize(f.size)}`;
      if (f.size > tgCfg.upMb * 1048576) li.classList.add('too-big');
      list.appendChild(li);
    }
  }
  function tgOpen() {
    if (!tgCfg) return;
    tgPicked = [];
    tgRender();
    $('#tg-text').value = '';
    $('#tg-progress').textContent = '';
    tgDlg.showModal();
  }
  $('#btn-tg').onclick = tgOpen;
  $('#tg-send-open').onclick = () => { $('#dlg-settings')?.close(); tgOpen(); };
  $('#tg-pick').onclick = () => $('#tg-input').click();
  $('#tg-input').onchange = (e) => {
    tgPicked.push(...e.target.files);
    e.target.value = '';
    tgRender();
    if (tgPicked.some((f) => f.size > tgCfg.upMb * 1048576)) $('#tg-progress').textContent = t('Too large for Telegram: up to {size} per file.', { size: formatSize(tgCfg.upMb * 1048576) });
  };
  let tgSending = false;
  $('#tg-send').onclick = async () => {
    const r = tgLink();
    const text = $('#tg-text').value.trim();
    const files = tgPicked.filter((f) => f.size <= tgCfg.upMb * 1048576);
    if (!r || tgSending || (!files.length && !text)) return;
    tgSending = true;
    const total = files.length + (text ? 1 : 0);
    let n = 0;
    try {
      const post = async (body, headers) => {
        n++;
        $('#tg-progress').textContent = t('Sending {n} of {total}…', { n, total });
        const res = await fetch(`/api/tg/send?id=${encodeURIComponent(r.id)}`, { method: 'POST', headers: { ...tgHeaders(r), ...headers }, body });
        if (res.status === 409) throw new Error(t('Telegram is not linked any more. Link it again in Settings.'));
        if (res.status === 429) throw new Error(t('Too many sends to Telegram. Try again later.'));
        if (res.status === 413) throw new Error(t('Too large for Telegram: up to {size} per file.', { size: formatSize(tgCfg.upMb * 1048576) }));
        if (!res.ok) throw new Error(t('Could not send to Telegram. Try again.'));
      };
      if (text) await post(text, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Kind': 'text' });
      for (const f of files) await post(f, { 'Content-Type': f.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(f.name) });
      toast(t('Sent to Telegram'));
      tgDlg.close();
    } catch (err) {
      $('#tg-progress').textContent = err instanceof TypeError ? t('Could not send to Telegram. Try again.') : err.message;
      if (/not linked/i.test(err.message) || err.message === t('Telegram is not linked any more. Link it again in Settings.')) tgRefresh();
    } finally {
      tgSending = false;
    }
  };

})();
