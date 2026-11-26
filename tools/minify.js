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
let babel = null;

// The oldest browsers the shipped scripts must still parse in. Chrome 78 on Windows (an admin alert,
// 2026-11-17: "Unexpected token '='" on /tv) and smart-TV browsers on Chromium 70-79 failed on ?. ?? ||= …,
// and one SyntaxError stops the whole file. Their APIs are fine (Object.fromEntries and matchAll need 73).
const TARGETS = { chrome: '70', safari: '12', firefox: '68' };

// Newer syntax into older syntax (Babel preset-env for TARGETS). Strings keep their quotes (Babel prints them as
// they were written), so server.js still finds "/more.js?v=6" in app.js.
function downlevel(code) {
  babel ||= require(path.join(ROOT, 'vendor', 'babel'));
  return babel.transform(code, {
    sourceType: 'script', babelrc: false, configFile: false, comments: true,
    presets: [['env', { targets: TARGETS, bugfixes: true, modules: false }]],
  }).code;
}

// The newer syntax the oldest browsers in TARGETS can't parse, found in `code`: a list of "what at line:col",
// empty = fine. BigInt (10n) is allowed: Chrome 67 has it. Used before shipping and by the tests.
const LOGIC_ASSIGN = new Set(['||=', '&&=', '??=']);
function newSyntax(code) {
  babel ||= require(path.join(ROOT, 'vendor', 'babel'));
  const found = [];
  const at = (what, node) => found.push(`${what} at ${node.loc ? `${node.loc.start.line}:${node.loc.start.column + 1}` : '?'}`);
  const check = () => ({
    visitor: {
      OptionalMemberExpression(p) { at('?.', p.node); },
      OptionalCallExpression(p) { at('?.()', p.node); },
      LogicalExpression(p) { if (p.node.operator === '??') at('??', p.node); },
      AssignmentExpression(p) { if (LOGIC_ASSIGN.has(p.node.operator)) at(p.node.operator, p.node); },
      ClassProperty(p) { at('class field', p.node); },
      ClassPrivateProperty(p) { at('#private field', p.node); },
      ClassPrivateMethod(p) { at('#private method', p.node); },
      StaticBlock(p) { at('static { }', p.node); },
      NumericLiteral(p) { if (((p.node.extra && p.node.extra.raw) || '').includes('_')) at('1_000', p.node); },
      RegExpLiteral(p) { if (/[dv]/.test(p.node.flags)) at(`regex /${p.node.flags}`, p.node); },
      ImportExpression(p) { at('import()', p.node); },
    },
  });
  babel.transform(code, { sourceType: 'script', babelrc: false, configFile: false, code: false, ast: false, plugins: [check] });
  return found;
}

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
// Terser keeps the syntax it finds (and adds no newer syntax at its default ecma 5), so the code is made
// old-browser safe first (downlevel)
async function minifyJs(code) {
  terser ||= require(path.join(ROOT, 'vendor', 'terser'));
  const r = await terser.minify(downlevel(code), { compress: { passes: 2 }, mangle: true, format: { comments: false, quote_style: 3 } });
  if (!r.code) throw new Error('terser returned nothing');
  return r.code;
}

// Which files get minified: scripts and styles of the website, not the downloads in public/tools/ (people run those
// themselves and may read them) and not the page sources
// mediabunny.js (MPL-2.0) and heic2any.js (MIT, with LGPL-3.0 libheif) are already minified and keep their licence notices: shipped as they are
// pdfjs/ (PDF.js 3.11 legacy build, Apache-2.0, for showing slides: remote.js) too
const wanted = (rel) => /^public\/(?!tools\/|pages\/|media\/|store\/|pdfjs\/).+\.(js|css)$/.test(rel) && !/^public\/(mediabunny|heic2any|pdf-lib)\.js$/.test(rel);

async function shipped(rel, buf) {
  rel = rel.split(path.sep).join('/');
  if (!wanted(rel)) return buf;
  // js2: since 2026-11-17 scripts are also rewritten for older browsers (downlevel)
  const key = crypto.createHash('sha1').update(rel.endsWith('.css') ? 'css1' : 'js2').update(buf).digest('hex');
  const saved = path.join(CACHE, key);
  if (fs.existsSync(saved)) return fs.readFileSync(saved);
  let out;
  if (rel.endsWith('.css')) {
    out = Buffer.from(minifyCss(buf.toString('utf8')));
    if (out.length >= buf.length) return buf; // never ship something bigger
  } else {
    // A script is never shipped exactly as written (it may hold ?. that old browsers can't read): minified, or
    // only rewritten if minifying wouldn't make it smaller
    const src = buf.toString('utf8');
    out = Buffer.from(await minifyJs(src));
    if (out.length >= buf.length) out = Buffer.from(downlevel(src));
    const code = out.toString('utf8').replace(/^#!.*/, '');
    new Function(code); // throws on a syntax error
    const left = newSyntax(code);
    if (left.length) throw new Error(`${rel} still has syntax older browsers can't read: ${left.slice(0, 5).join(', ')}`);
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(saved, out);
  return out;
}

module.exports = { shipped, minifyCss, minifyJs, wanted, downlevel, newSyntax, TARGETS };
