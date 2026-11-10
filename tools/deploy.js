#!/usr/bin/env node
// OmniBeam deploy helper: checks the files, builds the zip to upload to cPanel, and afterwards checks that the
// live site runs the new version. Double-click deploy.cmd (Windows) or run:  npm run deploy
//
//   node tools/deploy.js            check, rebuild the tool downloads, make deploy/omnibeam-update.zip (only what
//                                   changed since the last deploy) and deploy/omnibeam-upload.zip (everything)
//   node tools/deploy.js --check    after uploading and clicking Restart: is the live site on this version?
//   node tools/deploy.js --done     remember the current files as deployed without checking the live site
//   node tools/deploy.js --bump     fix forgotten ?v= numbers without asking
//   node tools/deploy.js --sitemap  only write public/sitemap.xml from server.js (every build does this first)
//   node tools/deploy.js --store    only make the extension zips for the stores: deploy/omnibeam-chrome-store.zip
//                                   (Chrome Web Store, Edge Add-ons) and deploy/omnibeam-firefox.zip (Firefox Add-ons)
//
// Options: --site <url> (default https://omnibeam.site). Nothing here logs in to cPanel or stores a password:
// the zip is uploaded by hand (steps printed at the end). The last deploy is remembered in deploy/last-deploy.json.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { shipped } = require('./minify');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'deploy');
const LAST = path.join(OUT, 'last-deploy.json');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const SITE = (args.includes('--site') ? args[args.indexOf('--site') + 1] || '' : 'https://omnibeam.site').replace(/\/$/, '');
const interactive = process.stdin.isTTY && !flag('--yes');

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}
function ask(q) {
  if (!interactive) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, (a) => { rl.close(); resolve(a.trim()); }));
}
let problems = 0;
const bad = (msg) => { problems++; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---------- ZIP writer (deflate, with Unix file modes so .sh/.command stay executable) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// entries: [{ name, data: Buffer, mode? }]
function makeZip(entries) {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const packed = zlib.deflateRawSync(e.data, { level: 9 });
    const store = packed.length >= e.data.length;
    const body = store ? e.data : packed;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, so the file mode below counts
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((0o100000 | (e.mode || 0o644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const entry = (name, file, mode) => ({ name, data: fs.readFileSync(file), mode });

// ---------- The tool downloads in public/tools, rebuilt from tools/ ----------
function buildToolZips() {
  const T = (f) => path.join(ROOT, 'tools', f);
  const zips = {
    'omnibeam-windows.zip': ['omnibeam-tray.ps1', 'install-tray.cmd', 'omnibeam-send.js', 'install-send-to.cmd', 'omnibeam.ico', 'README.txt']
      .map((f) => entry(f, T(f))),
    'omnibeam-mac-linux.zip': [
      entry('omnibeam-send.js', T('omnibeam-send.js'), 0o755),
      entry('install-mac.command', T('install-mac.command'), 0o755),
      entry('install-linux.sh', T('install-linux.sh'), 0o755),
      entry('README.txt', T('README-mac-linux.txt')),
      // The WebSocket library, for Node.js older than 22
      ...walk(path.join(ROOT, 'vendor', 'ws')).map((f) => entry('ws/' + path.relative(path.join(ROOT, 'vendor', 'ws'), f).split(path.sep).join('/'), f)),
    ],

    // The Chrome and Edge extension, in its own folder inside the zip (Load unpacked wants a folder)
    'omnibeam-chrome.zip': walk(path.join(ROOT, 'tools', 'omnibeam-chrome'))
      .map((f) => entry('omnibeam-chrome/' + path.relative(path.join(ROOT, 'tools', 'omnibeam-chrome'), f).split(path.sep).join('/'), f)),

    // The WordPress plugin for the "Send me files" box (/embed), in the folder WordPress expects: Plugins -> Add New
    // -> Upload Plugin takes this zip as it is
    'omnibeam-wordpress.zip': walk(path.join(ROOT, 'tools', 'omnibeam-wordpress'))
      .map((f) => entry('omnibeam-box/' + path.relative(path.join(ROOT, 'tools', 'omnibeam-wordpress'), f).split(path.sep).join('/'), f)),
  };
  fs.mkdirSync(path.join(ROOT, 'public', 'tools'), { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, entries] of Object.entries(zips)) {
    const file = path.join(ROOT, 'public', 'tools', name);
    // Same contents as before: keep the old file, so it doesn't count as changed
    const sig = hash(Buffer.concat(entries.flatMap((e) => [Buffer.from(e.name), e.data])));
    const sigFile = path.join(OUT, name + '.sig');
    if (fs.existsSync(file) && fs.existsSync(sigFile) && fs.readFileSync(sigFile, 'utf8') === sig) continue;
    fs.writeFileSync(file, makeZip(entries));
    fs.writeFileSync(sigFile, sig);
    ok(`Rebuilt public/tools/${name}`);
  }
  fs.copyFileSync(path.join(ROOT, 'tools', 'omnibeam-send.js'), path.join(ROOT, 'public', 'tools', 'omnibeam-send.js'));
}

// The extension as the Chrome Web Store wants it: manifest.json at the top of the zip, no README, and only the
// real site (localhost is for testing with Load unpacked)
function buildChromeStoreZip() {
  const dir = path.join(ROOT, 'tools', 'omnibeam-chrome');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const live = (list) => list.filter((m) => !m.includes('localhost'));
  manifest.host_permissions = live(manifest.host_permissions);
  for (const cs of manifest.content_scripts) cs.matches = live(cs.matches);
  const entries = walk(dir)
    .map((f) => path.relative(dir, f).split(path.sep).join('/'))
    .filter((name) => name !== 'README.txt' && name !== 'manifest.json')
    .map((name) => entry(name, path.join(dir, name)));
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'omnibeam-chrome-store.zip'), makeZip(entries));
  ok(`deploy/omnibeam-chrome-store.zip: the extension for the Chrome Web Store, version ${manifest.version}`);
  buildFirefoxZip();
}
// The same extension for Firefox Add-ons (addons.mozilla.org). Firefox runs the background script as an event
// page instead of a service worker and needs an add-on id; the code itself is the same (Firefox understands the
// chrome.* names).
function buildFirefoxZip() {
  const dir = path.join(ROOT, 'tools', 'omnibeam-chrome');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const live = (list) => list.filter((m) => !m.includes('localhost'));
  manifest.host_permissions = live(manifest.host_permissions);
  for (const cs of manifest.content_scripts) cs.matches = live(cs.matches);
  manifest.background = { scripts: ['background.js'] };
  manifest.browser_specific_settings = {
    gecko: {
      id: 'omnibeam@omnibeam.site',
      strict_min_version: '140.0', // the first version that reads data_collection_permissions
      // Asked on every new Firefox add-on: this one collects nothing
      data_collection_permissions: { required: ['none'] },
    },
  };
  const entries = walk(dir)
    .map((f) => path.relative(dir, f).split(path.sep).join('/'))
    .filter((name) => name !== 'README.txt' && name !== 'manifest.json')
    .map((name) => entry(name, path.join(dir, name)));
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  fs.writeFileSync(path.join(OUT, 'omnibeam-firefox.zip'), makeZip(entries));
  ok(`deploy/omnibeam-firefox.zip: the extension for Firefox Add-ons, version ${manifest.version}`);
}

// ---------- What goes to the server ----------
function deployFiles() {
  const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'service-worker.js'), path.join(ROOT, 'package.json'), ...walk(path.join(ROOT, 'public')), ...walk(path.join(ROOT, 'vendor'))];
  // Not for the server: stray zips in public/ (only the tool downloads are meant to be there) and helper files
  return files.filter((f) => {
    const r = rel(f);
    if (r.startsWith('public/') && r.endsWith('.zip') && !r.startsWith('public/tools/')) return false;
    return true;
  });
}
// package.json for the server: without the test tools (cPanel's "Run NPM Install" would download them)
function serverPackageJson() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return Buffer.from(JSON.stringify({ name: pkg.name, version: pkg.version, description: pkg.description, main: pkg.main, scripts: { start: 'node server.js' }, dependencies: {} }, null, 2) + '\n');
}

// ---------- The sitemap ----------
// On the host, public/sitemap.xml is served before server.js is asked, so a stale copy hides new pages from search
// engines. Write it from what server.js builds (all pages in all languages): start it on a spare port, ask for it.
async function writeSitemap() {
  const os = require('os');
  const { spawn } = require('child_process');
  const port = 40000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-sitemap-'));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: 'test', GA_ID: ' ', SITE_URL: 'https://omnibeam.site' },
  });
  try {
    let xml = null;
    for (let i = 0; i < 60 && xml === null; i++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        const res = await fetch(`http://localhost:${port}/sitemap.xml`);
        if (res.ok) xml = await res.text();
      } catch {}
    }
    if (!xml || !xml.includes('<urlset')) return bad('Could not build sitemap.xml (server.js did not start)');
    const file = path.join(ROOT, 'public', 'sitemap.xml');
    const n = (xml.match(/<loc>/g) || []).length;
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === xml) return ok(`public/sitemap.xml is up to date (${n} pages)`);
    fs.writeFileSync(file, xml);
    ok(`public/sitemap.xml written from server.js (${n} pages)`);
  } finally {
    server.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
}

// ---------- Checks ----------
function checkSyntax() {
  const js = [path.join(ROOT, 'server.js'), path.join(ROOT, 'service-worker.js'), path.join(ROOT, 'tools', 'omnibeam-send.js'), ...walk(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')),
    ...walk(path.join(ROOT, 'tools', 'omnibeam-chrome')).filter((f) => f.endsWith('.js'))];
  let n = 0;
  for (const f of js) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad(`${rel(f)} has a syntax error:\n${r.stderr.split('\n').slice(0, 5).join('\n')}`);
    else n++;
  }
  for (const f of [...walk(path.join(ROOT, 'public')), ...walk(path.join(ROOT, 'tools', 'omnibeam-chrome'))].filter((x) => x.endsWith('.json') || x.endsWith('.webmanifest'))) {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (err) { bad(`${rel(f)} is not valid JSON: ${err.message}`); }
  }
  if (n === js.length) ok(`${n} script files have no syntax errors`);
}
// Every translation must keep the {placeholders} of its English text
function checkTranslations() {
  let n = 0;
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'lang'))) {
    let lang;
    try { lang = require(path.join(ROOT, 'public', 'lang', f)); } catch (err) { bad(`public/lang/${f} doesn't load: ${err.message}`); continue; }
    for (const [en, tr] of Object.entries(lang.strings || {})) {
      const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
      if (vars(en) !== vars(tr)) bad(`public/lang/${f}: "${en.slice(0, 50)}" has ${vars(en) || 'no {…}'} but the translation has ${vars(tr) || 'none'}`);
      n++;
    }
  }
  ok(`${n} translations checked`);
}
// Files linked as /file.js?v=12 are kept by browsers for a year: a changed file needs a new number, or visitors
// keep the old one. Compares with the last deploy; returns [{ file, ref, files }] for forgotten numbers.
function referencesOf() {
  const sources = [path.join(ROOT, 'server.js'), path.join(ROOT, 'service-worker.js'), ...walk(path.join(ROOT, 'public')).filter((f) => /\.(html|js|webmanifest)$/.test(f))];
  const refs = new Map(); // public path -> { versions: Set, in: Set(source files) }
  for (const src of sources) {
    const text = fs.readFileSync(src, 'utf8');
    for (const m of text.matchAll(/["'(]\/([\w./-]+\.\w+)\?v=(\d+)/g)) {
      const r = refs.get(m[1]) || { versions: new Set(), in: new Set() };
      r.versions.add(m[2]);
      r.in.add(src);
      refs.set(m[1], r);
    }
  }
  return refs;
}
function checkVersions(last) {
  const refs = referencesOf();
  const stale = [];
  for (const [file, r] of refs) {
    const full = path.join(ROOT, 'public', file);
    if (!fs.existsSync(full)) { bad(`${file}?v= is linked but public/${file} doesn't exist`); continue; }
    if (r.versions.size > 1) console.log(`  ! ${file} is linked with different numbers: ${[...r.versions].map((v) => '?v=' + v).join(', ')}`);
    const before = last && last.files[`public/${file}`];
    const lastVersion = last && last.versions && last.versions[file];
    const now = hash(fs.readFileSync(full));
    if (before && before !== now && lastVersion && r.versions.has(lastVersion)) stale.push({ file, version: lastVersion, in: [...r.in] });
  }
  if (!stale.length) ok(last ? 'Every changed file linked with ?v= has a new number' : `${refs.size} versioned links found (nothing to compare with yet: this is the first deploy with this tool)`);
  return stale;
}
function bumpVersions(stale) {
  for (const s of stale) {
    const next = String(Number(s.version) + 1);
    for (const src of s.in) {
      const text = fs.readFileSync(src, 'utf8');
      const esc = s.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      fs.writeFileSync(src, text.replace(new RegExp(`(/${esc}\\?v=)${s.version}\\b`, 'g'), `$1${next}`));
    }
    ok(`${s.file}: ?v=${s.version} → ?v=${next} (in ${s.in.map(rel).join(', ')})`);
  }
}

// Same fingerprint as BUILD in server.js: the live site sends it to every browser. The zip holds a minified app.js
// (tools/minify.js), so the fingerprint is made from that, as the server will see it.
async function localBuild() {
  const files = [];
  for (const f of ['index.html', 'app.js', 'style.css']) files.push(await shipped(`public/${f}`, fs.readFileSync(path.join(ROOT, 'public', f))));
  return crypto.createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
}
async function liveBuild() {
  let WS = globalThis.WebSocket;
  if (typeof WS !== 'function') WS = require(path.join(ROOT, 'vendor', 'ws'));
  const url = SITE.replace(/^http/, 'ws') + '/ws';
  return new Promise((resolve, reject) => {
    const ws = new WS(url);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('no answer')); }, 15000);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'hello') { clearTimeout(timer); ws.close(); resolve(msg.build); }
      } catch {}
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`could not connect to ${url}`)); };
  });
}
async function snapshot() {
  const files = {};
  for (const f of deployFiles()) files[rel(f)] = hash(fs.readFileSync(f));
  const versions = {};
  for (const [file, r] of referencesOf()) versions[file] = [...r.versions].sort((a, b) => b - a)[0];
  return { at: new Date().toISOString(), build: await localBuild(), files, versions };
}
async function markDeployed() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(LAST, JSON.stringify(await snapshot(), null, 2));
  ok('Remembered these files as deployed (deploy/last-deploy.json)');
}
async function checkLive() {
  const want = await localBuild();
  try {
    const live = await liveBuild();
    if (live === want) {
      ok(`${SITE} runs this version (${want})`);
      return true;
    }
    bad(`${SITE} runs another version (${live || 'unknown'}, this folder is ${want}). Did the upload finish, and did you click Restart?`);
  } catch (err) {
    bad(`Could not ask ${SITE} for its version: ${err.message}`);
  }
  return false;
}

function openFolder(dir) {
  const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawnSync(cmd, [dir], { stdio: 'ignore', timeout: 5000 }); } catch {}
}

async function main() {
  const last = fs.existsSync(LAST) ? JSON.parse(fs.readFileSync(LAST, 'utf8')) : null;
  if (flag('--done')) return markDeployed();
  if (flag('--store')) return buildChromeStoreZip();
  if (flag('--sitemap')) return writeSitemap();
  if (flag('--check')) {
    console.log(`Checking ${SITE}…`);
    if (await checkLive()) await markDeployed();
    else process.exitCode = 1;
    return;
  }

  console.log('1. Checking the files');
  await writeSitemap();
  checkSyntax();
  checkTranslations();
  const stale = checkVersions(last);
  if (stale.length) {
    for (const s of stale) console.log(`  ! public/${s.file} changed but is still linked as ?v=${s.version}: visitors would keep the old one`);
    const fix = flag('--bump') || /^y/i.test(await ask('    Raise those numbers now? (y/n) '));
    if (fix) bumpVersions(stale);
    else bad('Forgotten ?v= numbers (run again with --bump to fix them)');
  }
  if (problems) {
    console.log(`\n${problems} problem${problems > 1 ? 's' : ''} found: fix ${problems > 1 ? 'them' : 'it'} first. Nothing was built.`);
    process.exitCode = 1;
    return;
  }

  console.log('\n2. Building the downloads and the upload zips');
  buildToolZips();
  buildChromeStoreZip();
  const files = deployFiles();
  const entries = [];
  // Scripts and styles of the website go minified (tools/minify.js: LiteSpeed sends public/ files as they are)
  for (const f of files) entries.push(rel(f) === 'package.json' ? { name: 'package.json', data: serverPackageJson() } : { name: rel(f), data: await shipped(rel(f), fs.readFileSync(f)) });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'omnibeam-upload.zip'), makeZip(entries));
  const changed = last ? entries.filter((e) => last.files[e.name] !== hash(fs.readFileSync(path.join(ROOT, e.name)))) : entries;
  if (entries.some((e) => e.name.startsWith('public/') && /\.(js|css)$/.test(e.name))) ok('Website scripts and styles are minified in the zip (the files here stay readable)');
  const update = path.join(OUT, 'omnibeam-update.zip');
  if (last && changed.length) fs.writeFileSync(update, makeZip(changed));
  else if (fs.existsSync(update)) fs.unlinkSync(update);
  ok(`deploy/omnibeam-upload.zip: all ${entries.length} files`);
  if (!last) console.log('  (First run with this tool: upload the full zip this time. Later runs also make a small zip of just the changes.)');
  else if (!changed.length) console.log('  Nothing changed since the last deploy.');
  else {
    ok(`deploy/omnibeam-update.zip: the ${changed.length} file${changed.length > 1 ? 's' : ''} changed since ${last.at.slice(0, 16).replace('T', ' ')}:`);
    for (const e of changed.slice(0, 40)) console.log(`      ${e.name}`);
    if (changed.length > 40) console.log(`      … and ${changed.length - 40} more`);
  }

  const zip = last && changed.length ? 'omnibeam-update.zip' : 'omnibeam-upload.zip';
  console.log(`
3. Upload it (about two minutes)
  a. cPanel > File Manager > open the omnibeam folder (where server.js is).
  b. Upload > choose deploy\\${zip} from this folder.
  c. Back in File Manager: right-click ${zip} > Extract > extract to the omnibeam folder itself
     (the path ends in /omnibeam, not /omnibeam/public). Say yes to replacing files. Then delete the zip.
  d. cPanel > Setup Node.js App > Restart.
  e. Check: node tools/deploy.js --check   (it also remembers this deploy for the next small zip)
`);
  openFolder(OUT);
  if (interactive) {
    const a = await ask('Press Enter when you have clicked Restart to check the live site (or type s to skip): ');
    if (!/^s/i.test(a)) {
      if (await checkLive()) await markDeployed();
      else console.log('  Run node tools/deploy.js --check again once it is uploaded.');
    }
  }
}

// tools/build-upload.js uses the zip writer and the file list
module.exports = { makeZip, deployFiles, serverPackageJson, localBuild, writeSitemap, buildToolZips };
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
