// Core Web Vitals in the lab, like Lighthouse's mobile run: slow 4G (150 ms round trip, 1.6 Mbit/s down), the
// processor 4x slower, a 412x823 phone screen, cold cache. Reports the median CLS, LCP, FCP and TBT (long tasks over
// 50 ms between FCP and 5 s after load) of each page, and the largest layout shift with the element that moved.
//   node tools/perf/cls.js http://localhost:4100 [runs] [/ /ar/ ...]
// Outside requests (Google Analytics...) are blocked, so only OmniBeam's own files count.
const { chromium } = require('playwright');

const base = (process.argv[2] || 'http://localhost:4100').replace(/\/$/, '');
const runs = Number(process.argv[3]) || 5;
const paths = process.argv.slice(4).length ? process.argv.slice(4) : ['/', '/ar/'];

async function once(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('omnibeam-tour', 'done'); } catch {}
    window.__cwv = { cls: 0, shifts: [], lcp: 0, long: [] };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cwv.cls += e.value;
        const src = (e.sources || []).map((s) => {
          const n = s.node;
          return n ? (n.id ? '#' + n.id : n.className ? '.' + String(n.className).split(' ')[0] : n.nodeName) : '?';
        }).join(',');
        window.__cwv.shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(4), src });
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cwv.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cwv.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  });
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(5000);
  const r = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0;
    const tbt = window.__cwv.long.filter(([s]) => s >= fcp).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
    const top = window.__cwv.shifts.slice().sort((a, b) => b.value - a.value)[0] || null;
    return { cls: +window.__cwv.cls.toFixed(4), lcp: Math.round(window.__cwv.lcp), fcp: Math.round(fcp), tbt: Math.round(tbt), top };
  });
  await ctx.close();
  return { ...r, kb: Math.round(bytes / 1024) };
}

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const p of paths) {
    const list = [];
    for (let i = 0; i < runs; i++) list.push(await once(browser, base + p));
    const med = (k) => list.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(list.length / 2)];
    out[p] = { cls: med('cls'), lcp: med('lcp'), fcp: med('fcp'), tbt: med('tbt'), kb: med('kb'), clsRuns: list.map((x) => x.cls), worstShift: list.map((x) => x.top).sort((a, b) => (b?.value || 0) - (a?.value || 0))[0] };
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
