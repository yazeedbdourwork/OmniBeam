// Transfer speed between two Chromium tabs on this computer: a 100 MB file direct (WebRTC) and through the server
// relay. Starts its own server on port 4100 (data in a temp folder) unless BASE is given.
//   node tools/perf/transfer-speed.js [runs]        (ONLY=direct or ONLY=relay for one of them)
// Prints MB/s (from Accept to the file being complete on the receiver) as JSON, the median of the runs.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runs = Number(process.argv[2]) || 3;
const SIZE = 100 * 1024 * 1024;
const PORT = 4100;
const BASE = process.env.BASE || `http://localhost:${PORT}`;

async function device(browser, name, relayOnly) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript((name) => {
    localStorage.setItem('omnibeam-name', name);
    localStorage.setItem('omnibeam-lang', 'en');
    localStorage.setItem('omnibeam-tour', 'done');
  }, name);
  if (relayOnly) {
    await ctx.addInitScript(() => {
      const Real = window.RTCPeerConnection;
      window.RTCPeerConnection = function (cfg) { return new Real({ ...(cfg || {}), iceTransportPolicy: 'relay' }); };
      window.RTCPeerConnection.prototype = Real.prototype;
    });
  }
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.waitForFunction((n) => document.querySelector('#me-name')?.textContent === n, name);
  return { ctx, page, name };
}

async function once(browser, relay, file) {
  const a = await device(browser, 'Speed A', relay);
  const b = await device(browser, 'Speed B', relay);
  const target = a.page.locator('.peer:not(.offline)').filter({ has: a.page.locator('.name', { hasText: 'Speed B' }) });
  await target.waitFor();
  const chooser = a.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(file);
  await b.page.locator('#dlg-request [data-act=accept]').waitFor();
  const t0 = Date.now();
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await b.page.locator('#dlg-received').waitFor({ timeout: 300000 });
  const secs = (Date.now() - t0) / 1000;
  const route = await a.page.evaluate(() => [...peers.values()][0]?.lastRoute);
  await a.ctx.close();
  await b.ctx.close();
  return { mbps: SIZE / 1024 / 1024 / secs, route };
}

(async () => {
  let server;
  if (!process.env.BASE) {
    server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore',
      env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(os.tmpdir(), 'omnibeam-perf-data'), GA_ID: ' ', NODE_ENV: 'test' } });
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/config.json'); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  }
  const browser = await chromium.launch();
  const file = path.join(os.tmpdir(), 'omnibeam-speed.bin');
  fs.writeFileSync(file, crypto.randomBytes(SIZE));
  const out = {};
  try {
    for (const relay of [false, true].filter((r) => !process.env.ONLY || process.env.ONLY === (r ? 'relay' : 'direct'))) {
      const list = [];
      for (let i = 0; i < runs; i++) list.push(await once(browser, relay, file));
      const sorted = list.map((r) => r.mbps).sort((x, y) => x - y);
      out[relay ? 'relay' : 'direct'] = { medianMBps: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, runs: sorted.map((x) => Math.round(x * 10) / 10), route: list[0].route };
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(JSON.stringify(out, null, 2));
})();
