// Minified copies of the website's scripts and styles for the upload zip.
// On the host, LiteSpeed sends the files in public/ itself, without asking server.js, so the server's own minifier
// (minifyAll in server.js) never runs for them and visitors got app.js with all its comments (276 KB instead of about
// 150 KB). The zip therefore holds minified copies; the files in this folder stay readable for editing.
// Cloudflare compresses them (brotli) on the way to the visitor, so pre-compressed .br/.gz copies would not help:
// LiteSpeed doesn't send them for a plain .js request and Cloudflare compresses again anyway.
//   const { shipped } = require('./minify');  await shipped('public/app.js', buffer)  -> Buffer (minified or as is)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'deploy', '.min-cache');
let terser = null;

// The same as minifyCss in server.js: comments and spaces out, strings and url(…) left exactly as they are
function minifyCss(css) {
  const keep = [];
  const out = String(css)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\)/g, (m) => `\u0000${keep.push(m) - 1}\u0000`)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[i]);
}

// Original quotes kept (quote_style 3): server.js finds the "/more.js?v=6" style addresses in app.js by their quotes
async function minifyJs(code) {
  terser ||= require(path.join(ROOT, 'vendor', 'terser'));
  const r = await terser.minify(code, { compress: { passes: 2 }, mangle: true, format: { comments: false, quote_style: 3 } });
  if (!r.code) throw new Error('terser returned nothing');
  return r.code;
}

// Which files get minified: scripts and styles of the website, not the downloads in public/tools/ (people run those
// themselves and may read them) and not the page sources
const wanted = (rel) => /^public\/(?!tools\/|pages\/|media\/|store\/).+\.(js|css)$/.test(rel);

async function shipped(rel, buf) {
  rel = rel.split(path.sep).join('/');
  if (!wanted(rel)) return buf;
  const key = crypto.createHash('sha1').update(rel.endsWith('.css') ? 'css1' : 'js1').update(buf).digest('hex');
  const saved = path.join(CACHE, key);
  if (fs.existsSync(saved)) return fs.readFileSync(saved);
  const out = Buffer.from(rel.endsWith('.css') ? minifyCss(buf.toString('utf8')) : await minifyJs(buf.toString('utf8')));
  // Never ship something bigger, or a script that no longer parses
  if (out.length >= buf.length) return buf;
  if (rel.endsWith('.js')) new Function(out.toString('utf8').replace(/^#!.*/, '')); // throws on a syntax error
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(saved, out);
  return out;
}

module.exports = { shipped, minifyCss, minifyJs, wanted };
