// Babel 7.26.10 standalone (MIT, see LICENSE), bundled like terser and ws so nothing needs installing.
// tools/minify.js uses it to rewrite newer JavaScript (?. ?? ||= ??= &&=, class fields…) into syntax that older
// browsers read: old Chrome on Windows and the Chromium inside smart-TV browsers stop at the first ?. with a
// SyntaxError and then run nothing at all. Only for building the upload zip; it is not sent to the host.
'use strict';
module.exports = require('./babel.min.js');
