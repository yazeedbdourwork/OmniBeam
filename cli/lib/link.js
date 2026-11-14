// omnibeam link: share files by link (like ⋯ > Share files by link on the site), and omnibeam get: download one.
// The files are encrypted here with a new random AES-GCM key that only exists in the part of the link after #;
// the server stores encrypted bytes it can't read. Same format as public/drop.js and public/get.js:
//   part n of the files (one after the other, 4 MB each) is encrypted with IV [0,0,0,0,0,0,0,0,n (4 bytes)],
//   the list of names and sizes with IV [1,0,…,0].
'use strict';
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { fail, log, subtle, formatSize, plural, progressLine, progressDone, collectInputs, readInput, safePath, freeName,
  ask, closeAsk, showQr, b64u, isTTY } = require('./util');

const TAG = 16;
const ivFor = (n, meta = false) => {
  const v = Buffer.alloc(12);
  v[0] = meta ? 1 : 0;
  v.writeUInt32BE(n, 8);
  return v;
};
const pinProof = (pin, keyB64) => nodeCrypto.createHash('sha256').update(`omnibeam-pin:${pin}:${keyB64}`).digest('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (server) => server.replace(/\/$/, '');

async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    fail(`Could not reach ${new URL(url).origin} (${(err.cause && err.cause.code) || err.message})`);
  }
}

function parseHours(v) {
  if (v == null) return 24;
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*(h|d|w)?$/i);
  if (!m) fail('--expires takes hours or days, like 24h, 3d or 1w');
  const n = Number(m[1]) * ({ h: 1, d: 24, w: 168 }[(m[2] || 'h').toLowerCase()]);
  return Math.max(1, Math.round(n));
}

// Upload parts in order, with a few tries each (shared hosting has hiccups)
async function putPart(url, token, body) {
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, { method: 'PUT', headers: { 'X-Drop-Token': token, 'Content-Type': 'application/octet-stream' }, body });
    } catch (err) {
      if (attempt >= 4) fail(`Upload failed (${(err.cause && err.cause.code) || err.message})`);
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (r.ok) return r.json();
    const info = await r.json().catch(() => ({}));
    if (r.status === 409 && info.got > Number(url.split('/').pop())) return info; // it arrived after all
    if ((r.status < 500 && r.status !== 409) || attempt >= 4) fail(`Upload failed (${r.status} ${info.error || ''})`.trim());
    await sleep(1000 * (attempt + 1));
  }
}

// The files, one after the other, cut into parts of `part` bytes
async function* parts(files, part) {
  let buf = [];
  let len = 0;
  for (const f of files) {
    for await (const block of readInput(f, 1024 * 1024)) {
      let b = block;
      while (b.length) {
        const take = Math.min(part - len, b.length);
        buf.push(b.subarray(0, take));
        len += take;
        b = b.subarray(take);
        if (len === part) { yield Buffer.concat(buf); buf = []; len = 0; }
      }
    }
  }
  if (len) yield Buffer.concat(buf);
}

async function link(opts) {
  if (!opts.args.length) fail('Nothing to share. Try: omnibeam link report.pdf');
  if (!subtle) fail('This needs Node.js 22 or newer (https://nodejs.org)');
  const files = await collectInputs(opts.args, { stdinName: opts.as });
  const size = files.reduce((s, f) => s + f.size, 0);
  if (!size) fail('These files are empty');
  const server = base(opts.server);
  const cfg = await (await request(`${server}/config.json`)).json().catch(() => ({}));
  if (!cfg.drop) fail(`${server} does not offer share links`);
  if (size > cfg.drop.maxMb * 1048576) fail(`Too large: a link can hold up to ${formatSize(cfg.drop.maxMb * 1048576)} (this is ${formatSize(size)}). Use "omnibeam send" instead.`);
  const hours = Math.min(cfg.drop.maxHours, parseHours(opts.expires));
  const max = opts.downloads == null ? 0 : Math.floor(Number(opts.downloads));
  if (!(max >= 0 && max <= 100)) fail('--downloads takes a number from 1 to 100 (0 = no limit)');
  if (opts.pin != null && !/^\d{4,8}$/.test(String(opts.pin))) fail('A PIN is 4 to 8 digits');

  const raw = nodeCrypto.randomBytes(16);
  const keyB64 = b64u(raw);
  const key = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const meta = { v: 1, files: files.map((f) => ({ name: f.name, size: f.size, type: f.mime || '' })) };
  const encMeta = await subtle.encrypt({ name: 'AES-GCM', iv: ivFor(0, true) }, key, Buffer.from(JSON.stringify(meta)));
  const pin = opts.pin != null ? pinProof(String(opts.pin), keyB64) : '';
  const r = await request(`${server}/api/drop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size, hours, max, once: max === 1, pin, meta: b64u(encMeta) }),
  });
  const created = await r.json().catch(() => ({}));
  if (!r.ok) {
    fail({ 'too-many': 'Too many links from your network today. Try again later.', full: 'Link storage is full right now. Try again later.',
      'too-large': 'Too large for a link' }[created.error] || `Could not create the link (${r.status})`);
  }
  const deleteLink = () => fetch(`${server}/api/drop/${created.id}`, { method: 'DELETE', headers: { 'X-Drop-Token': created.token } }).catch(() => {});
  const started = Date.now();
  let n = 0;
  let sent = 0;
  try {
    for await (const plain of parts(files, created.part)) {
      const sealed = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, plain));
      await putPart(`${server}/api/drop/${created.id}/${n}`, created.token, sealed);
      n++;
      sent += plain.length;
      progressLine('uploading', sent, size, started);
    }
  } catch (err) {
    await deleteLink();
    throw err;
  }
  progressDone();
  const url = `${server}/d/${created.id}#${keyB64}`;
  if (opts.json) {
    console.log(JSON.stringify({ url, id: created.id, token: created.token, expires: new Date(created.expires).toISOString(), size, files: files.length, downloads: max || null, pin: !!pin }));
    return;
  }
  const limits = [`expires ${new Date(created.expires).toLocaleString()}`];
  if (max) limits.push(max === 1 ? 'one download' : `${max} downloads`);
  if (pin) limits.push(`PIN ${opts.pin}`);
  log(`${files.length > 1 ? plural(files.length, 'file') : files[0].name} · ${formatSize(size)} · ${limits.join(' · ')}`);
  log('End-to-end encrypted: the key is only in the link (after #), never on the server.');
  showQr(url, opts);
  console.log(url);
  if (isTTY) log(`To delete it early: omnibeam unlink ${created.id} --token ${created.token}`);
}

async function unlink(opts) {
  const [id] = opts.args;
  if (!id || !opts.token) fail('Usage: omnibeam unlink <id> --token <token> (both are shown when the link is made)');
  const m = String(id).match(/(?:\/d\/)?([A-Za-z0-9_-]{8,40})(?:#.*)?$/);
  const r = await request(`${base(opts.server)}/api/drop/${m ? m[1] : id}`, { method: 'DELETE', headers: { 'X-Drop-Token': opts.token } });
  if (r.status === 404) fail('That link is already gone');
  if (!r.ok) fail(r.status === 403 ? 'Wrong token' : `Could not delete it (${r.status})`);
  log('Link deleted.');
}

// ---------- Download ----------
function parseLink(text, server) {
  let u;
  try { u = new URL(text, base(server) + '/'); } catch { fail(`Not a link: ${text}`); }
  const m = u.pathname.match(/\/d\/([A-Za-z0-9_-]{8,40})\/?$/);
  const key = u.hash.replace(/^#/, '');
  if (!m || !/^[A-Za-z0-9_-]{22}$/.test(key)) {
    if (/\/(r|e)\//.test(u.pathname)) fail('That is a request or album link: open it in a browser');
    fail('Not an OmniBeam share link (it looks like https://omnibeam.site/d/<id>#<key>, with the part after # too)');
  }
  return { origin: u.origin, id: m[1], keyB64: key };
}

async function get(opts) {
  const [text] = opts.args;
  if (!text) fail('Usage: omnibeam get <link>');
  if (!subtle) fail('This needs Node.js 22 or newer (https://nodejs.org)');
  const { origin, id, keyB64 } = parseLink(text, opts.server);
  const key = await subtle.importKey('raw', Buffer.from(keyB64, 'base64url'), 'AES-GCM', false, ['decrypt']);
  const api = `${origin}/api/drop/${id}`;
  let pin = opts.pin != null ? String(opts.pin) : '';
  let info;
  for (;;) {
    const headers = pin ? { 'X-Drop-Pin': pinProof(pin, keyB64) } : {};
    const r = await request(api, { headers });
    const body = await r.json().catch(() => ({}));
    if (r.ok) { info = { ...body, headers }; break; }
    if (r.status === 404 || r.status === 410) fail(body.error === 'uploading' ? 'This link is still being uploaded, or it is gone' : 'This link has expired, was deleted, or has no downloads left');
    if (r.status === 423) fail('This link is locked after too many wrong PINs');
    if (r.status === 401 || r.status === 403) {
      if (r.status === 403) log(`Wrong PIN (${body.left} ${body.left === 1 ? 'try' : 'tries'} left)`);
      if (!process.stdin.isTTY) fail('This link needs a PIN: add --pin <digits>');
      pin = await ask('PIN: ');
      if (!pin) fail('No PIN given');
      continue;
    }
    fail(`Could not open the link (${r.status})`);
  }
  closeAsk();
  let meta;
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: ivFor(0, true) }, key, Buffer.from(info.meta, 'base64url'));
    meta = JSON.parse(Buffer.from(plain).toString('utf8'));
  } catch {
    fail('Could not decrypt the link: the part after # is wrong or cut off');
  }
  const files = (meta.files || []).map((f) => ({ name: safePath(f.name), size: Math.max(0, Number(f.size) || 0) }));
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total !== info.size) fail('The link does not match its file list');
  const toStdout = opts.out === '-';
  if (toStdout && files.length !== 1) fail('-o - writes one file to standard output; this link has several');
  if (meta.note) log('A secret note (it opens only once):');
  else log(`${files.length > 1 ? plural(files.length, 'file') : files[0].name} · ${formatSize(total)}${info.max === 1 ? ' · one download: the link is deleted after this' : ''}`);
  if (opts.list) {
    for (const f of files) console.log(`${f.name}\t${f.size}`);
    return;
  }

  const dir = path.resolve(toStdout ? '.' : opts.out || '.');
  if (!toStdout) fs.mkdirSync(dir, { recursive: true });
  const r = await request(`${api}/data`, { headers: info.headers });
  if (!r.ok) fail(r.status === 410 ? 'This link has no downloads left' : `Download failed (${r.status})`);

  // Decrypt part by part, and cut the plain bytes back into the files
  const sealedPart = info.part + TAG;
  let fi = -1;
  let cur = null; // { f, out, final, temp, left }
  const saved = [];
  const openNext = async () => {
    for (;;) {
      if (cur) await closeCur();
      fi++;
      if (fi >= files.length) return;
      const f = files[fi];
      if (toStdout || meta.note) cur = { f, out: null, left: f.size };
      else {
        const final = freeName(dir, f.name);
        const temp = `${final}.omnibeam-part`;
        cur = { f, final, temp, out: fs.createWriteStream(temp), left: f.size };
      }
      if (cur.left > 0) return;
    }
  };
  const closeCur = async () => {
    const c = cur;
    cur = null;
    if (!c.out) return;
    await new Promise((resolve, reject) => c.out.end((err) => (err ? reject(err) : resolve())));
    fs.renameSync(c.temp, c.final);
    saved.push(c.final);
  };
  const write = (buf) => new Promise((resolve, reject) => {
    if (meta.note || toStdout) return process.stdout.write(buf, (err) => (err ? reject(err) : resolve()));
    cur.out.write(buf, (err) => (err ? reject(err) : resolve()));
  });
  await openNext();
  let n = 0;
  let got = 0;
  const started = Date.now();
  const onPlain = async (plain) => {
    let b = plain;
    while (b.length && cur) {
      const take = Math.min(cur.left, b.length);
      await write(b.subarray(0, take));
      cur.left -= take;
      b = b.subarray(take);
      if (cur.left === 0) await openNext();
    }
  };
  const decryptPart = async (sealed) => {
    let plain;
    try {
      plain = Buffer.from(await subtle.decrypt({ name: 'AES-GCM', iv: ivFor(n) }, key, sealed));
    } catch {
      fail('The download did not pass its check (damaged on the way, or the key is wrong). Try again.');
    }
    n++;
    got += plain.length;
    if (!toStdout && !meta.note) progressLine('downloading', got, total, started);
    await onPlain(plain);
  };
  try {
    let pending = [];
    let len = 0;
    for await (const chunk of r.body) {
      let c = Buffer.from(chunk);
      while (c.length) {
        const take = Math.min(sealedPart - len, c.length);
        pending.push(c.subarray(0, take));
        len += take;
        c = c.subarray(take);
        if (len === sealedPart) { await decryptPart(Buffer.concat(pending)); pending = []; len = 0; }
      }
    }
    if (len) await decryptPart(Buffer.concat(pending));
    if (got !== total) fail('The download stopped before the end. Try again.');
    if (cur) await openNext();
  } catch (err) {
    if (cur && cur.temp) { cur.out.destroy(); fs.rm(cur.temp, { force: true }, () => {}); }
    throw err;
  }
  if (meta.note) { process.stdout.write('\n'); return; }
  if (toStdout) return;
  progressDone();
  for (const f of saved) console.log(path.relative(process.cwd(), f) || f);
  log(`Saved ${plural(saved.length, 'file')} (${formatSize(total)}) to ${dir}`);
}

module.exports = { link, unlink, get, parseLink };
