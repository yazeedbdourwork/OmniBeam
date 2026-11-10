// Bytes of the home page and its scripts as the server sends them: raw (minified), gzip and brotli.
//   node tools/perf/sizes.js http://localhost:4100
const http = require('http');
const zlib = require('zlib');
const base = process.argv[2] || 'http://localhost:4100';
const get = (p, enc) => new Promise((res, rej) => http.get(base + p, { headers: enc ? { 'Accept-Encoding': enc } : {} }, (r) => {
  const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => res({ body: Buffer.concat(parts), enc: r.headers['content-encoding'] || '', cc: r.headers['cache-control'] }));
}).on('error', rej));
(async () => {
  const html = (await get('/')).body.toString();
  const assets = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s.startsWith('/'));
  const rows = [];
  for (const p of ['/', ...assets]) {
    const raw = (await get(p)).body;
    const served = await get(p, 'br, gzip');
    rows.push({ path: p, raw: raw.length, gzip: zlib.gzipSync(raw, { level: 9 }).length, brotli: zlib.brotliCompressSync(raw).length, served: `${served.body.length} ${served.enc}`, cache: served.cc });
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  console.table(rows);
  console.log({ totalRaw: sum('raw'), totalGzip: sum('gzip'), totalBrotli: sum('brotli') });
})();
