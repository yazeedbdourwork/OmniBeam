// The Pair button shows without scrolling on phones (2026-11-22). On an iPhone the pinned footer (This device card,
// links, copyright, badges) took half the screen and covered "Pair a device". Now phones keep only the This device
// card pinned; the links and badges sit at the end of the scrolling page. Checked on small and big phones, in
// Arabic (right to left) and German (long words), and the links move back into the footer on a wide screen.
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

// Phone screens as the page sees them with the browser's bars showing (iPhone SE, 13 mini, 15, 15 Pro Max, Android)
const phones = [[375, 548], [375, 629], [393, 659], [430, 739], [412, 780]];

for (const path of ['/', '/ar/', '/de/']) {
  for (const [width, height] of phones) {
    test(`Pair button visible without scrolling: ${path} at ${width}x${height}`, async ({ browser }) => {
      const d = await openDevice(browser, 'Small Phone', { path });
      devices.push(d);
      const page = d.page;
      await page.setViewportSize({ width, height });
      const btn = page.locator('#btn-pair-empty');
      await expect(btn).toBeVisible();
      // Links and badges are in the scrolling page, not the pinned footer
      await expect(page.locator('#main .footer-meta')).toHaveCount(1);
      await expect(page.locator('body > footer .footer-meta')).toHaveCount(0);
      const box = await page.evaluate(() => {
        const main = document.querySelector('#main');
        const b = document.querySelector('#btn-pair-empty').getBoundingClientRect();
        return { scroll: main.scrollTop, btnBottom: b.bottom, mainBottom: main.getBoundingClientRect().bottom };
      });
      expect(box.scroll).toBe(0);
      expect(box.btnBottom).toBeLessThanOrEqual(box.mainBottom);
      // The footer links still work from there
      await page.locator('#main .footer-meta [data-open=dlg-privacy]').click();
      await expect(page.locator('#dlg-privacy')).toBeVisible();
    });
  }
}

test('footer links go back into the footer on a wide screen', async ({ browser }) => {
  const d = await openDevice(browser, 'Resize PC');
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('body > footer .footer-meta')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 660 });
  await expect(page.locator('#main .footer-meta')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('body > footer .footer-meta')).toHaveCount(1);
  await expect(page.locator('footer.page-foot')).toHaveCount(0);
});
