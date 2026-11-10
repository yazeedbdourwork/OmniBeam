// The link window's lists fit any width (2026-11-07): a remembered device's row (dot, name, Trusted, Auto-accept, Chat,
// Forget) wraps instead of pushing Forget off the right edge, also with a long name, on small phones, in Arabic
// (right to left) and in Russian (long words). Team room rows too.
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { openDevice } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const hex = () => crypto.randomBytes(32).toString('hex');
const LONG = 'LAPTOP of the living room upstairs with a very long name indeed';

for (const path of ['/', '/ar/', '/ru/']) {
  for (const width of [360, 420]) {
    test(`remembered devices and team rooms fit the link window: ${path} at ${width}px`, async ({ browser }) => {
      const paired = [
        { secret: hex(), name: 'LAPTOP', at: Date.now(), seen: Date.now() - 3600e3, trusted: true, auto: true },
        { secret: hex(), name: LONG, at: Date.now(), seen: Date.now() - 86400e3, auto: false },
      ];
      const teams = [{ secret: hex(), id: hex(), name: 'Family room with a long name too' }];
      const d = await openDevice(browser, 'Fit Phone', {
        path,
        storage: { 'omnibeam-paired': JSON.stringify(paired), 'omnibeam-teams': JSON.stringify(teams) },
      });
      devices.push(d);
      const page = d.page;
      await page.setViewportSize({ width, height: 800 });
      await page.locator('#btn-pair').click();
      const dlg = page.locator('#dlg-pair');
      await expect(dlg).toBeVisible();
      await dlg.locator('#pair-tab-devices').click();
      await dlg.evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
      const rows = dlg.locator('#paired-list .paired-row');
      await expect(rows).toHaveCount(2);
      await rows.nth(1).scrollIntoViewIfNeeded();
      // Nothing in the window is wider than the window, and nothing sticks out of its row
      const overflow = await page.evaluate(() => {
        const dlg = document.getElementById('dlg-pair');
        const box = dlg.getBoundingClientRect();
        const bad = [];
        if (dlg.scrollWidth > dlg.clientWidth + 1) bad.push(`dialog scrolls sideways: ${dlg.scrollWidth} > ${dlg.clientWidth}`);
        for (const el of dlg.querySelectorAll('#paired-list *, #team-list *')) {
          const r = el.getBoundingClientRect();
          if (!r.width) continue;
          if (r.left < box.left - 1 || r.right > box.right + 1) bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)} outside ${Math.round(box.left)}-${Math.round(box.right)}`);
          const row = el.parentElement.closest('.paired-row');
          if (row) {
            const rr = row.getBoundingClientRect();
            if (r.left < rr.left - 1 || r.right > rr.right + 1) bad.push(`${el.tagName}.${el.className} outside its row`);
          }
        }
        return bad;
      });
      expect(overflow).toEqual([]);
      // The long name ends in … on its own line; Forget is fully inside the window and works
      const name = rows.nth(1).locator('.paired-name');
      expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      for (let i = 0; i < 2; i++) {
        const forget = rows.nth(i).locator('[data-forget]');
        const fb = await forget.boundingBox();
        const db = await dlg.boundingBox();
        expect(fb.x).toBeGreaterThanOrEqual(db.x);
        expect(fb.x + fb.width).toBeLessThanOrEqual(db.x + db.width);
        await expect(rows.nth(i).locator('[data-chat]')).toBeVisible();
      }
      await rows.nth(1).locator('[data-forget]').click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText('LAPTOP');
      expect(d.errors).toEqual([]);
    });
  }
}

test('Chat and Forget stay together on one line; Chat opens that device\'s chat', async ({ browser }) => {
  const paired = [{ secret: hex(), name: 'LAPTOP', at: Date.now(), seen: Date.now(), trusted: true, auto: true }];
  const d = await openDevice(browser, 'Fit Pair', { path: '/ru/', storage: { 'omnibeam-paired': JSON.stringify(paired) } });
  devices.push(d);
  await d.page.setViewportSize({ width: 360, height: 800 });
  await d.page.locator('#btn-pair').click();
  await d.page.locator('#pair-tab-devices').click();
  const row = d.page.locator('#dlg-pair #paired-list .paired-row');
  // Measured once the window has finished growing in (its opening animation scales it)
  await d.page.locator('#dlg-pair').evaluate((el) => Promise.all(el.getAnimations().map((x) => x.finished)));
  const chat = await row.locator('[data-chat]').boundingBox();
  const forget = await row.locator('[data-forget]').boundingBox();
  expect(Math.abs(chat.y - forget.y)).toBeLessThan(2);
  await row.locator('[data-chat]').click();
  await expect(d.page.locator('#dlg-pair')).toBeHidden();
  await expect(d.page.locator('#dlg-chat #chat-title')).toHaveText('LAPTOP');
  expect(d.errors).toEqual([]);
});
