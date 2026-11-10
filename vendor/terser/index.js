// Terser 5.51.2 (BSD-2-Clause, see LICENSE), the JavaScript minifier, bundled like ws so nothing needs installing.
// server.js uses it to send smaller copies of public/*.js. The bundle asks for a source-map library that is only
// needed for source maps, which aren't made here, so it gets an empty stand-in.
'use strict';
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, 'bundle.min.js'), 'utf8');
const mod = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', code)(mod.exports, (id) => (id === '@jridgewell/source-map' ? {} : require(id)), mod);
module.exports = mod.exports;
