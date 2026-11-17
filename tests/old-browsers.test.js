// Older browsers can read every script the site ships (2026-11-17 admin alert: "Uncaught SyntaxError: Unexpected
// token '='" in Chrome 78 on Windows, /app.js:1, when opening /tv). One ?. or ||= that an old browser can't parse
// stops the whole file, so the page does nothing. Smart-TV browsers often run Chromium 70-79 too.
// tools/minify.js rewrites newer syntax (Babel) before minifying; these tests check what goes into the upload zip.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { shipped, wanted, newSyntax, TARGETS } = require('../tools/minify');

const ROOT = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

test('the targets still include Chrome 78 and TV Chromium', () => {
  expect(Number(TARGETS.chrome)).toBeLessThanOrEqual(78);
});

test('the checker finds the syntax old browsers stop on', () => {
  const bad = 'a ||= 1; b ??= 2; c &&= 3; x?.y; f?.(); const z = p ?? q; class K { static s = 1; #p = 2; }';
  const found = newSyntax(bad).map((s) => s.split(' at ')[0]);
  for (const what of ['||=', '??=', '&&=', '?.', '?.()', '??', 'class field', '#private field']) expect(found).toContain(what);
  expect(newSyntax('const a = (b && b.c) || 10n; async function f() { try { await g(); } catch { } }')).toEqual([]);
});

test('every shipped script parses in old browsers', async () => {
  test.setTimeout(5 * 60 * 1000);
  const problems = [];
  const files = walk(path.join(ROOT, 'public')).map(rel).filter((r) => wanted(r) && r.endsWith('.js'));
  expect(files).toContain('public/app.js');
  expect(files).toContain('public/tv.js');
  for (const r of files) {
    try {
      const out = (await shipped(r, fs.readFileSync(path.join(ROOT, r)))).toString('utf8');
      const left = newSyntax(out);
      if (left.length) problems.push(`${r}: ${left.slice(0, 3).join(', ')}`);
    } catch (err) {
      problems.push(`${r}: ${err.message}`);
    }
  }
  // Shipped exactly as written (next to server.js / not minified): must be old-browser safe in the source itself
  for (const r of ['service-worker.js', 'public/heic2any.js']) {
    const left = newSyntax(fs.readFileSync(path.join(ROOT, r), 'utf8'));
    if (left.length) problems.push(`${r}: ${left.slice(0, 3).join(', ')}`);
  }
  expect(problems).toEqual([]);
});
