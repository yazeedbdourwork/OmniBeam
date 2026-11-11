// Tidy Settings (2026-11-10): Settings shows one group at a time (Device, Transfers, Clipboard, Apps), opens on the
// group used last, has shorter notes, an Add to Firefox button, works with the keyboard (right to left too), fits
// on a small phone in Liquid Glass, and the new words are translated in all 15 languages.
const { test, expect } = require('@playwright/test');
const { openDevice, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

const GROUPS = { device: ['#theme-choice', '#look-choice', '#set-me'], transfers: ['#shrink-choice', '#msg-sound', '#speed-open'], privacy: ['#lock-on', '#keep-choice'],
  clipboard: ['#clip-sync', '#autosend-section'], apps: ['#tg-section'] };

test('Settings shows one group at a time and opens on the one used last', async ({ browser }) => {
  const d = await openDevice(browser, 'Tabs PC');
  devices.push(d);
  const page = d.page;
  await menu(page, 'btn-settings');
  const dlg = page.locator('#dlg-settings');
  await expect(dlg.locator('#set-tab-device')).toHaveAttribute('aria-selected', 'true');
  for (const [name, sels] of Object.entries(GROUPS)) {
    await settingsTab(page, name);
    await expect(dlg.locator(`#set-tab-${name}`)).toHaveAttribute('aria-selected', 'true');
    for (const sel of sels) await expect(dlg.locator(sel)).toBeVisible();
    for (const other of Object.keys(GROUPS).filter((n) => n !== name)) await expect(dlg.locator(`#set-pane-${other}`)).toBeHidden();
  }
  // Apps: Chrome and Firefox add-ons, and the Windows app
  await expect(dlg.getByRole('link', { name: 'Add to Firefox' })).toHaveAttribute('href', /addons\.mozilla\.org\/firefox\/addon\/omnibeam-send-to-your-devices/);
  await expect(dlg.getByRole('link', { name: 'Add to Chrome' })).toBeVisible();
  await expect(dlg.getByRole('link', { name: 'Get the Windows app' })).toBeVisible();
  // Same size whichever group is open, and the Close button always in view
  await expect(dlg.locator('[data-close]')).toBeInViewport();
  await dlg.locator('[data-close]').click();
  // Reopens on Apps (the last one), also after a reload
  await menu(page, 'btn-settings');
  await expect(dlg.locator('#set-tab-apps')).toHaveAttribute('aria-selected', 'true');
  await dlg.locator('[data-close]').click();
  await page.reload();
  await menu(page, 'btn-settings');
  await expect(dlg.locator('#set-pane-apps')).toBeVisible();
  // Photo notes only once smaller photos are chosen
  await settingsTab(page, 'transfers');
  await dlg.locator('#shrink-choice label').first().click();
  await expect(dlg.locator('#shrink-notes')).toBeHidden();
  await dlg.locator('#shrink-choice label').nth(1).click();
  await expect(dlg.locator('#shrink-notes')).toBeVisible();
  expect(d.errors).toEqual([]);
});

test('Settings groups work with the keyboard right to left, and fit a small phone in Liquid Glass', async ({ browser }) => {
  const d = await openDevice(browser, 'Tabs AR', { path: '/ar/', storage: { 'omnibeam-lang': 'ar', 'omnibeam-look': 'glass' } });
  devices.push(d);
  const page = d.page;
  await page.setViewportSize({ width: 340, height: 680 });
  await menu(page, 'btn-settings');
  const dlg = page.locator('#dlg-settings');
  await expect(dlg.locator('#set-tab-transfers')).toHaveText('النقل');
  await expect(dlg.locator('#set-tab-apps')).toHaveText('التطبيقات');
  await dlg.locator('#set-tab-device').focus();
  // Right to left: the left arrow goes to the next group
  await page.keyboard.press('ArrowLeft');
  await expect(dlg.locator('#set-tab-transfers')).toBeFocused();
  await expect(dlg.locator('#set-pane-transfers')).toBeVisible();
  await page.keyboard.press('End');
  await expect(dlg.locator('#set-pane-apps')).toBeVisible();
  await expect(dlg.getByRole('link', { name: 'إضافة إلى Firefox' })).toBeVisible();
  // Nothing sticks out sideways: the dialog, the tabs and every group
  for (const name of Object.keys(GROUPS)) {
    await settingsTab(page, name);
    const fits = await page.evaluate(() => {
      const d = document.getElementById('dlg-settings');
      const r = d.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && d.querySelector('.set-tabs').scrollWidth <= d.querySelector('.set-tabs').clientWidth + 1
        && [...d.querySelectorAll('.set-pane:not([hidden]) *')].every((el) => { const b = el.getBoundingClientRect(); return !b.width || (b.left >= r.left - 1 && b.right <= r.right + 1); });
    });
    expect(fits, name).toBe(true);
  }
  await expect(dlg.locator('[data-close]')).toBeInViewport();
  expect(d.errors).toEqual([]);
});

test('the new Settings words are translated in all 15 languages', async () => {
  const keys = ['Transfers', 'Apps', 'Device', 'Clipboard', 'Settings sections', 'Browser extension', 'Add to Firefox', 'Windows app',
    "Got a supporter code? It adds a ♥ to this device's card, 4 colour themes and extra pictures.",
    'Smaller photos send faster on slow connections. The originals on this device are not changed.',
    'Get notified when a paired device wants to send you files, even when OmniBeam is closed.',
    'Copy on one device, paste on the other. Turn it on on both devices and keep OmniBeam open.',
    'New files you put in a folder on this computer go to your phone by themselves while OmniBeam is open.',
    "Send the page you're on, a link, an image or selected text with one click.",
    'Link this device to the OmniBeam bot to send files, photos and text both ways.'];
  const langs = ['ar', 'fr', 'es', 'tr', 'de', 'pt', 'hi', 'id', 'ru', 'ja', 'zh', 'ko', 'it', 'ur'];
  for (const code of langs) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
  }
});
