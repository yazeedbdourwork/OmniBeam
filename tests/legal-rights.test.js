// "I confirm I have the legal right to share this file…": asked once per device, before the first send to a device,
// the first share link and the first shared folder; remembered after it is ticked. The Terms page explains it.
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, menu } = require('./helpers');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});

const pickFiles = async (from, toName, files) => {
  const target = await card(from.page, toName);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
};

test('the first send asks once; Cancel sends nothing, the ticked box is remembered', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { storage: { 'omnibeam-rights': null } });
  b = await openDevice(browser, 'Test Phone');
  await pickFiles(a, 'Test Phone', [makeFile('a.bin', 2048)]);
  const dlg = a.page.locator('#dlg-rights');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('I confirm I have the legal right to share this file and it does not violate copyright laws.');
  await expect(dlg.locator('a', { hasText: 'Terms apply' })).toHaveAttribute('href', '/terms');
  // Cancel: nothing is sent and nothing is remembered
  await dlg.locator('[data-act=no]').click();
  await expect(dlg).toBeHidden();
  await a.page.waitForTimeout(800);
  await expect(b.page.locator('#dlg-request')).toBeHidden();
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-rights'))).toBeNull();

  // Continue without the tick: the box is pointed out and the window stays
  await pickFiles(a, 'Test Phone', [makeFile('b.bin', 2048)]);
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-act=go]').click();
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.rights-check')).toHaveClass(/need/);
  await expect(dlg.locator('input[type=checkbox]')).toBeFocused();
  // Ticked: the file goes, and the choice is kept
  await dlg.locator('input[type=checkbox]').check();
  await dlg.locator('[data-act=go]').click();
  await expect(dlg).toBeHidden();
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await b.page.locator('#dlg-request [data-act=decline]').click().catch(() => {});
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-rights'))).toBe('1');

  // Not asked again (the test's set-up clears the stored choice on every page load, so this checks without a reload)
  await expect(b.page.locator('#dlg-request')).toBeHidden();
  await pickFiles(a, 'Test Phone', [makeFile('c.bin', 2048)]);
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await expect(dlg).toBeHidden();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('the share-link window shows the box until it is ticked once', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { storage: { 'omnibeam-rights': null } });
  await menu(a.page, 'btn-link');
  const dlg = a.page.locator('#dlg-link');
  const box = dlg.locator('#link-rights');
  await expect(box).toBeVisible();
  // Choose files without the tick: no file picker, the box is pointed out
  let picked = false;
  a.page.once('filechooser', () => { picked = true; });
  await dlg.locator('[data-act=pick]').click();
  await expect(box).toHaveClass(/need/);
  await a.page.waitForTimeout(500);
  expect(picked).toBe(false);
  // Ticked: the picker opens and the link is made
  await box.locator('input').check();
  const chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([makeFile('link.bin', 4096)]);
  await expect(dlg.locator('#link-done')).toBeVisible({ timeout: 30000 });
  await dlg.locator('[data-act=close]').last().click();
  // Next time the box isn't there, and a send to a device doesn't ask either
  await menu(a.page, 'btn-link');
  await expect(box).toBeHidden();
  expect(await a.page.evaluate(() => rightsOk())).toBe(true);
  expect(a.errors).toEqual([]);
});

test('the box and the Terms page are translated', async ({ browser }) => {
  a = await openDevice(browser, 'Test Laptop', { path: '/ar/', storage: { 'omnibeam-lang': 'ar', 'omnibeam-rights': null } });
  const box = a.page.locator('#rights-box');
  await expect(box).toContainText('أؤكد أن لدي الحق القانوني');
  await expect(box.locator('a')).toHaveText('تطبق الشروط');
  await expect(box.locator('a')).toHaveAttribute('href', '/ar/terms');
  for (const [path, text] of [['/terms', 'Copyright and the files you share'], ['/ar/terms', 'حقوق النشر والملفات التي تشاركها'], ['/ja/terms', '著作権と共有するファイル']]) {
    await a.page.goto(path);
    await expect(a.page.locator('h2', { hasText: text })).toBeVisible();
  }
});
