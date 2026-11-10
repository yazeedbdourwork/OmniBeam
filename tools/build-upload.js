#!/usr/bin/env node
// Builds one upload zip with everything the server needs: server.js and public/ (its scripts and styles minified,
// see tools/minify.js), in the layout of the app folder, so it can be extracted over it in cPanel.
//   node tools/build-upload.js upgrades-1105      -> deploy/omnibeam-upgrades-1105-upload.zip
// Prints the fingerprint the live site will report after the upload (the "build" the deploy check compares).
// Never uploads anything itself.
'use strict';
const fs = require('fs');
const path = require('path');
const { makeZip, localBuild, writeSitemap, buildToolZips } = require('./deploy');
const { shipped } = require('./minify');

const ROOT = path.join(__dirname, '..');
const name = (process.argv[2] || 'update').replace(/[^a-z0-9-]/gi, '');
const out = path.join(ROOT, 'deploy', `omnibeam-${name}-upload.zip`);

function walk(dir, list = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, list);
    else if (e.isFile()) list.push(p);
  }
  return list;
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

(async () => {
  // The downloads in public/tools (the Windows, Mac/Linux, Chrome and WordPress zips), when their files changed
  buildToolZips();
  await writeSitemap();
  const files = [path.join(ROOT, 'server.js'), ...walk(path.join(ROOT, 'public'))]
    // Stray zips in public/ (only the tool downloads belong there)
    .filter((f) => !(rel(f).endsWith('.zip') && !rel(f).startsWith('public/tools/')));
  const entries = [];
  let before = 0, after = 0;
  for (const f of files) {
    const raw = fs.readFileSync(f);
    const data = await shipped(rel(f), raw);
    if (data !== raw) { before += raw.length; after += data.length; }
    entries.push({ name: rel(f), data });
  }
  // The service worker sits next to server.js (served as /sw.js with its version written in): shipped as it is
  entries.push({ name: 'service-worker.js', data: fs.readFileSync(path.join(ROOT, 'service-worker.js')) });
  fs.writeFileSync(out, makeZip(entries));
  console.log(`${rel(out)}: ${entries.length} files, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  console.log(`Scripts and styles: ${Math.round(before / 1024)} KB -> ${Math.round(after / 1024)} KB minified`);
  console.log(`The live site reports build ${await localBuild()} after this upload and a Restart`);
})().catch((err) => { console.error(err); process.exitCode = 1; });
