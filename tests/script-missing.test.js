// A script that doesn't load (2026-11-25: an iPhone reported "Can't find variable: $" in drop.js:1 because app.js
// never arrived): report.js reports the missing file instead of the errors that follow, and loads the page again once
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

test('app.js fails to load once: one report names it, no "$" errors, and the page loads again and works', async ({ browser }) => {
  const reports = [];
  let blocked = 0;
  const d = await openDevice(browser, 'Test Phone', {
    path: '/?reports=on', // (report.js stays off for headless browsers unless asked)
    setup: async (context) => {
      await context.route(/\/api\/report/, (route) => { reports.push(JSON.parse(route.request().postData() || '{}')); route.fulfill({ status: 204, body: '' }); });
      await context.route(/\/app\.js\?v=/, (route) => (blocked++ === 0 ? route.abort() : route.fallback()));
    },
  });
  // openDevice waited for the name: the page came back by itself and app.js runs
  expect(blocked).toBe(2);
  expect(await d.page.evaluate(() => typeof $ === 'function' && typeof peers === 'object')).toBe(true);
  await expect.poll(() => reports.filter((r) => r.m === 'Script did not load: /app.js').length).toBe(1);
  expect(reports.filter((r) => /\$|find variable|not defined/.test(r.m))).toEqual([]);
  await d.close();
});
