// Small helpers shared by the commands: settings folder, remembered devices, sizes, prompts, CRC-32, QR codes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const nodeCrypto = require('crypto');

const subtle = globalThis.crypto && globalThis.crypto.subtle;

class CliError extends Error {}
const fail = (msg) => { throw new CliError(msg); };

// Progress and questions go to stderr, so stdout only has results (a link, a file list, JSON) for scripts
const log = (...a) => console.error(...a);
const isTTY = !!process.stderr.isTTY;

// ---------- Settings folder ----------
// The same folder as tools/omnibeam-send.js (the Windows "Send to" menu and the tray app), so pairings are shared
const CONFIG_DIR = process.env.OMNIBEAM_CONFIG_DIR || (process.platform === 'win32'
  ? path.join(process.env.APPDATA || os.homedir(), 'OmniBeam')
  : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'omnibeam'));
const PAIRED_FILE = path.join(CONFIG_DIR, 'paired.json');

function loadPaired() {
  try {
    const list = JSON.parse(fs.readFileSync(PAIRED_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((p) => p && /^[0-9a-f]{64}$/.test(p.secret)) : [];
  } catch {
    return [];
  }
}
function savePaired(list) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PAIRED_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}
// Proof that two devices share a pairing, as pairProof() in public/app.js: a device that trusts the other accepts its
// files without asking
function pairProof(secret, from, to) {
  return nodeCrypto.createHmac('sha256', secret).update(`omnibeam-auto:${from}>${to}`).digest().subarray(0, 16).toString('hex');
}

// ---------- Formatting ----------
function formatSize(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
// One progress line on stderr, redrawn in place (only on a terminal)
function progressLine(label, got, total, started) {
  if (!isTTY) return;
  const secs = (Date.now() - started) / 1000;
  const pct = total ? Math.min(100, Math.floor((got / total) * 100)) : 100;
  const width = 24;
  const fill = Math.round((pct / 100) * width);
  const bar = '█'.repeat(fill) + '░'.repeat(width - fill);
  const speed = secs > 1 ? `  ${formatSize(got / secs)}/s` : '';
  process.stderr.write(`\r  ${label} ${bar} ${String(pct).padStart(3)}%  ${formatSize(got)} / ${formatSize(total)}${speed}   `);
}
function progressDone() {
  if (isTTY) process.stderr.write('\n');
}

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.gz': 'application/gzip', '.tar': 'application/x-tar', '.7z': 'application/x-7z-compressed',
};
const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || '';

// ---------- What to send ----------
// Paths (files, or folders: every file in them, with "folder/sub/file" names, as a browser sends a dropped folder),
// or "-" for standard input. Returns [{ name, size, mime, path } | { name, size, mime, data }].
async function collectInputs(args, { stdinName } = {}) {
  const out = [];
  for (const a of args) {
    if (a === '-') {
      const data = await readStdinBuffer();
      const name = stdinName || 'stdin.txt';
      out.push({ name, size: data.length, mime: mimeOf(name), data });
      continue;
    }
    let st;
    try { st = fs.statSync(a); } catch { fail(`File not found: ${a}`); }
    if (st.isFile()) {
      out.push({ name: path.basename(a), size: st.size, mime: mimeOf(a), path: a });
    } else if (st.isDirectory()) {
      const base = path.basename(path.resolve(a));
      const before = out.length;
      walk(a, base, out);
      if (out.length === before) fail(`The folder is empty: ${a}`);
    } else {
      fail(`Not a file: ${a}`);
    }
  }
  return out;
}
function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, `${rel}/${e.name}`, out);
    else if (e.isFile()) out.push({ name: `${rel}/${e.name}`, size: fs.statSync(p).size, mime: mimeOf(e.name), path: p });
  }
}
// The bytes of one input, in blocks
async function* readInput(f, block = 256 * 1024) {
  if (f.data) {
    for (let i = 0; i < f.data.length; i += block) yield f.data.subarray(i, i + block);
    return;
  }
  for await (const chunk of fs.createReadStream(f.path, { highWaterMark: block })) yield chunk;
}
function readStdinBuffer() {
  return new Promise((resolve, reject) => {
    const parts = [];
    process.stdin.on('data', (d) => parts.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(parts)));
    process.stdin.on('error', reject);
  });
}

// ---------- Saving received files ----------
// A name from another device, made safe to save: folders kept, but nothing that climbs out of the target folder
function safePath(name) {
  const parts = String(name || '').split(/[\\/]+/)
    .map((p) => p.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').trim().replace(/[. ]+$/, ''))
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(p) ? `_${p}` : p))
    .slice(-20);
  return parts.join('/').slice(0, 500) || 'file';
}
// A free name in dir for this (safe) relative path: "photo.jpg", else "photo (1).jpg", …
function freeName(dir, rel) {
  const full = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (!fs.existsSync(full)) return full;
  const ext = path.extname(full);
  const stem = full.slice(0, full.length - ext.length);
  for (let i = 1; ; i++) {
    const p = `${stem} (${i})${ext}`;
    if (!fs.existsSync(p)) return p;
  }
}

// ---------- Ctrl+C ----------
// A command can set what happens (receive tells the sender it stopped); otherwise it just ends
let onInterrupt = null;
const setInterrupt = (fn) => { onInterrupt = fn; };
function interrupt() {
  if (onInterrupt) onInterrupt();
  else process.exit(130);
}

// ---------- Questions ----------
let rl = null;
function ask(question) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.on('SIGINT', () => { rl.close(); interrupt(); });
  }
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}
function closeAsk() {
  if (rl) { rl.close(); rl = null; }
}
async function askYes(question, def = true) {
  const a = (await ask(`${question} ${def ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
  return a ? a.startsWith('y') : def;
}

// ---------- CRC-32 (the "file intact" check in public/more.js) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
// crc32(bytes, previous) continues a running check (start with 0). Node 22.2+ has a fast one built in.
const zlib = require('zlib');
function crc32(buf, prev = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev) >>> 0;
  let crc = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------- QR codes in the terminal ----------
// Two rows of the code per line (▀ ▄ █), black on white whatever the terminal's colours
function qrText(text) {
  const qrcode = require('./qrcode.js');
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 2;
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const lines = [];
  for (let r = -m; r < n + m; r += 2) {
    let line = '';
    for (let c = -m; c < n + m; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(`  \x1b[30;47m${line}\x1b[0m`);
  }
  return lines.join('\n');
}
// Shown only on a terminal (and not with --no-qr)
function showQr(text, opts) {
  if (!isTTY || opts.qr === false || process.env.NO_QR) return;
  try { log(qrText(text)); } catch {}
}

// base64url without padding, as the site writes keys
const b64u = (buf) => Buffer.from(buf).toString('base64url');

module.exports = {
  CliError, fail, log, isTTY, subtle, CONFIG_DIR, PAIRED_FILE, loadPaired, savePaired, pairProof, formatSize, plural,
  progressLine, progressDone, mimeOf, collectInputs, readInput, readStdinBuffer, safePath, freeName, ask, askYes, closeAsk,
  crc32, qrText, setInterrupt, interrupt, showQr, b64u,
};
