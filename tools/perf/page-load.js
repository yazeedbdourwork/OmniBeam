// Measures how fast the home page loads on a phone with a slow connection (Lighthouse's "slow 4G": 150 ms round trip,
// 1.6 Mbit/s down, 750 kbit/s up, and the processor 4x slower), cold cache, and how many bytes it downloads.
//   node tools/perf/page-load.js http://localhost:4100/ [runs]
// Prints the median of the runs as JSON.
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:4100/';
const runs = Number(process.argv[3]) || 5;

async function once(browser, warm) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => { try { localStorage.setItem('omnibeam-tour', 'done'); } catch {} });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (warm) { await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1500); }
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const bytes = {};
  const types = {};
  cdp.on('Network.responseReceived', (e) => { types[e.requestId] = `${e.type}${e.response.fromDiskCache ? ' (cache)' : ''}`; });
  cdp.on('Network.loadingFinished', (e) => { const k = types[e.requestId] || 'Other'; bytes[k] = (bytes[k] || 0) + e.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const loadWall = Date.now() - t0;
  // Ready to use: the app script ran and the server gave this device its name
  await page.waitForFunction(() => document.querySelector('#me-name')?.textContent.trim().length > 0, null, { timeout: 120000 });
  const ready = Date.now() - t0;
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { ttfb: Math.round(nav.responseStart), fcp: Math.round(fcp?.startTime || 0), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) };
  });
  await page.waitForTimeout(2000); // late requests (analytics, parts loaded after the page)
  const total = Object.values(bytes).reduce((s, n) => s + n, 0);
  await ctx.close();
  return { ...m, ready, loadWall, totalKB: Math.round(total / 1024), byType: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)])) };
}

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const warm of [false, true]) {
    const list = [];
    for (let i = 0; i < runs; i++) list.push(await once(browser, warm));
    const med = (k) => list.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(list.length / 2)];
    out[warm ? 'repeatVisit' : 'firstVisit'] = { ttfb: med('ttfb'), fcp: med('fcp'), dcl: med('dcl'), load: med('load'), ready: med('ready'), totalKB: med('totalKB'), byType: list[0].byType };
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
