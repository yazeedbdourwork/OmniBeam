#!/usr/bin/env node
// Checks the Google Play listing texts in store/google-play/listing/<lang>.txt against Play's limits:
// title 30, short description 80, full description 4000 characters.   node tools/play-listing-check.js
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'store', 'google-play', 'listing');
const LIMITS = { title: 30, short: 80, full: 4000 };
// Play counts characters (code points), not bytes
const len = (s) => [...s].length;
function parse(text) {
  const out = {};
  let key = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(/^\[(title|short|full)\]\s*$/);
    if (m) { key = m[1]; out[key] = []; continue; }
    if (key) out[key].push(line);
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  return out;
}
let bad = 0;
const rows = [];
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.txt')).sort()) {
  const l = parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const row = [f.replace('.txt', '')];
  for (const [k, max] of Object.entries(LIMITS)) {
    const n = l[k] ? len(l[k]) : 0;
    if (!n || n > max) { bad++; row.push(`${k} ${n}/${max} ✗`); } else row.push(`${k} ${n}/${max}`);
  }
  rows.push(row.join('  '));
}
console.log(rows.join('\n'));
if (bad) { console.log(`${bad} problem(s)`); process.exitCode = 1; } else console.log('All within the limits.');
module.exports = { parse, LIMITS, len };
