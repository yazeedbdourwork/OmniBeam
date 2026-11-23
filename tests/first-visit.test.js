// First visit and the "Ready to beam" card (2026-11-22): no tour on top of the app, the pairing QR right in the card
// on computers, "Not showing up?" after 20 s with nobody here, the Pair dialog's words on phones, the trust row, and
// "Files" beside the Received files icon on phones.
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close().catch(() => {});
  devices = [];
});

test('computer: the pairing QR is in the card, the same code as the Pair dialog, and nobody is around yet', async ({ browser }) => {
  const a = await openDevice(browser, 'QR Card Laptop', { storage: { 'omnibeam-tour': null } });
  devices.push(a);
  const page = a.page;
  await expect(page.locator('#empty-qr svg')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#empty .hints')).toBeHidden();
  await expect(page.locator('#dlg-tour')).toBeHidden();
  const cardSvg = await page.locator('#empty-qr').innerHTML();
  await page.locator('#btn-pair').click();
  await expect(page.locator('#pair-qr svg')).toBeVisible();
  expect(await page.locator('#pair-qr').innerHTML()).toBe(cardSvg);
  await expect(page.locator('#pair-qr-section b.qr-for-pc')).toBeVisible();
  await expect(page.locator('#pair-qr-section .qr-for-phone').first()).toBeHidden();
  await page.keyboard.press('Escape');
  // Trust row with the link to the source code
  await expect(page.locator('#empty .trust-row a')).toHaveText('Open source');
  await expect(page.locator('#empty .trust-row a')).toHaveAttribute('href', /github\.com\/yazeedbdourwork\/omnibeam$/);
  // Plain text Cloudflare line (no Cloudflare logo: their brand rules need permission)
  await expect(page.locator('#empty .trust-row')).toContainText('Secured by Cloudflare');
  expect(await page.locator('img[src*="cloudflare" i], svg[class*="cloudflare" i]').count()).toBe(0);
  // GitHub star badge in the footer: GitHub mark, text and the live star count (shields.io SVG, sized, lazy)
  const gh = page.locator('.featured-badges a.github-badge');
  await expect(gh).toHaveAttribute('href', /github\.com\/yazeedbdourwork\/omnibeam$/);
  await expect(gh).toContainText('Star us on GitHub');
  await expect(gh.locator('svg.gh-mark')).toHaveCount(1);
  const stars = gh.locator('img.gh-stars');
  await expect(stars).toHaveAttribute('src', /^https:\/\/img\.shields\.io\/github\/stars\/yazeedbdourwork\/omnibeam\.svg\?/);
  await expect(stars).toHaveAttribute('loading', 'lazy');
  await expect(stars).toHaveAttribute('width', /\d+/);
  await expect(stars).toHaveAttribute('height', /\d+/);
  // When another device shows up, the card (and its QR) goes away
  const b = await openDevice(browser, 'QR Card Phone');
  devices.push(b);
  await expect(page.locator('#empty')).toBeHidden({ timeout: 15000 });
  expect(a.errors).toEqual([]);
});

test('"Not showing up?" takes the place of the hints after 20 s with nobody here', async ({ browser }) => {
  const a = await openDevice(browser, 'Help Phone', { userAgent: ANDROID });
  devices.push(a);
  const page = a.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#empty .hints')).toBeVisible();
  await expect(page.locator('#empty-help')).toBeHidden();
  // (no 20 s wait in the test: the card counts from when it was first seen)
  await page.evaluate(() => { EmptyCard.since = Date.now() - 21000; });
  await expect(page.locator('#empty-help')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#empty-help')).toContainText('Not showing up?');
  await expect(page.locator('#empty .hints')).toBeHidden();
  await expect(page.locator('#btn-pair-empty')).toBeInViewport();
  // Phones: no QR in the card
  await expect(page.locator('#empty-qr-box')).toBeHidden();
  expect(a.errors).toEqual([]);
});

test('phone: the Pair dialog says to scan with the other device, and how to pair with a computer', async ({ browser }) => {
  const a = await openDevice(browser, 'Words Phone', { userAgent: ANDROID });
  devices.push(a);
  const page = a.page;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#btn-pair').click();
  await expect(page.locator('#pair-qr svg')).toBeVisible();
  await expect(page.locator('#pair-qr-section b.qr-for-phone')).toHaveText("Scan with the other device's camera");
  await expect(page.locator('#pair-qr-section p.qr-for-phone')).toContainText('On a computer?');
  await expect(page.locator('#pair-qr-section b.qr-for-pc')).toBeHidden();
  expect(await page.locator('#dlg-pair').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await page.keyboard.press('Escape');
  // Top bar: "Files" beside the Received files icon, Light/Dark in the ⋯ menu
  await expect(page.locator('#btn-history .bar-label')).toHaveText('Files');
  await expect(page.locator('#btn-history .bar-label')).toBeVisible();
  await expect(page.locator('#bar-theme')).toBeHidden();
  expect(a.errors).toEqual([]);
});

test('the new words are translated (German page)', async ({ browser }) => {
  const a = await openDevice(browser, 'Lang Laptop', { path: '/de/', storage: { 'omnibeam-lang': 'de' } });
  devices.push(a);
  const page = a.page;
  await expect(page.locator('#empty-qr-box b')).toHaveText('Mit dem Handy scannen und verbinden');
  await expect(page.locator('#empty .trust-row')).toContainText('Kein Konto');
  await expect(page.locator('#empty .trust-row')).toContainText('Geschützt durch Cloudflare');
  await expect(page.locator('.featured-badges a.github-badge')).toContainText('Gib uns einen Stern auf GitHub');
  await expect(page.locator('.featured-badges a.github-badge')).toHaveAttribute('title', 'Gib uns einen Stern auf GitHub');
  expect(a.errors).toEqual([]);
});
