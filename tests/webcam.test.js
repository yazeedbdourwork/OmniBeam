// A phone as a webcam or microphone for a computer (webcam.js): started on the phone or asked for from the computer,
// the computer sees the camera live (Mirror, Pop out window for OBS), the phone can switch camera and mute, and
// either side can stop. Mic only shows a sound level. The browsers use Chromium's fake camera and microphone.
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// Open "More…" on the card of `name` and choose an action
async function more(page, name, act) {
  const c = await card(page, name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  const dlg = page.locator('#dlg-actions');
  await expect(dlg).toBeVisible();
  const btn = dlg.locator(`[data-act=${act}]`);
  await expect(btn).toBeVisible();
  const label = await btn.textContent();
  await btn.click();
  return label;
}
const videoWidth = (page, sel) => page.evaluate((s) => document.querySelector(s)?.videoWidth || 0, sel);

test('started on the phone: the computer accepts, sees it live, pops it out, and it ends when the phone stops', async ({ browser }) => {
  const pc = await open(browser, 'Test Laptop');
  const phone = await open(browser, 'Test Phone', { userAgent: ANDROID });
  expect(await more(phone.page, 'Test Laptop', 'webcam')).toBe('Be its webcam or mic');
  const dlg = phone.page.locator('#dlg-webcam');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('h3')).toHaveText('Webcam and mic for Test Laptop');
  await expect.poll(() => videoWidth(phone.page, '#dlg-webcam video')).toBeGreaterThan(0);
  await dlg.locator('[data-act=start]').click();
  await expect(dlg.locator('.webcam-status')).toContainText('Waiting for Test Laptop');

  const ask = pc.page.locator('#dlg-webcam-ask');
  await expect(ask).toContainText('Test Phone wants to be your webcam');
  await ask.locator('[data-act=yes]').click();
  const view = pc.page.locator('#dlg-webcam-view');
  await expect(view).toBeVisible();
  await expect(view.locator('.screen-title')).toHaveText('Test Phone\'s camera');
  await expect.poll(() => videoWidth(pc.page, '#dlg-webcam-view video'), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(dlg.locator('.webcam-live-badge')).toBeVisible();
  await expect(dlg.locator('.webcam-status')).toContainText('Live on Test Laptop');
  // Mode and quality can't change while live; Mute works on the microphone track
  await expect(dlg.locator('[data-mode=v]')).toBeDisabled();
  await dlg.locator('[data-act=mute]').click();
  await expect(dlg.locator('[data-act=mute]')).toHaveText('Unmute mic');
  expect(await phone.page.evaluate(() => document.querySelector('#dlg-webcam video').srcObject.getAudioTracks()[0].enabled)).toBe(false);
  // Switching camera keeps the stream going on the computer
  await dlg.locator('[data-act=flip]').click();
  await phone.page.waitForTimeout(1500);
  await expect.poll(() => videoWidth(pc.page, '#dlg-webcam-view video')).toBeGreaterThan(0);

  // Mirror, and the clean window for OBS
  await view.locator('[data-act=mirror]').click();
  await expect(view.locator('video')).toHaveClass(/mirror/);
  const popupP = pc.page.waitForEvent('popup');
  await view.locator('[data-act=popout]').click();
  const popup = await popupP;
  await expect.poll(() => popup.title()).toBe('OmniBeam camera');
  await expect.poll(() => popup.evaluate(() => document.querySelector('video')?.videoWidth || 0), { timeout: 15000 }).toBeGreaterThan(0);
  expect(await popup.evaluate(() => document.querySelector('video').style.transform)).toBe('scaleX(-1)');
  // How to use it in Zoom / OBS
  await view.locator('.webcam-help summary').click();
  await expect(view.locator('.webcam-help')).toContainText('OBS Virtual Camera');

  // The phone stops: the computer's window and the pop-out close
  await dlg.locator('[data-act=close]').click();
  await expect(dlg).toBeHidden();
  await expect(view).toBeHidden();
  await expect(pc.page.locator('.toast').last()).toContainText('Test Phone stopped the camera');
  await expect.poll(() => popup.isClosed()).toBe(true);
  // The phone let go of the camera
  expect(await phone.page.evaluate(() => window.Webcam.state().cam)).toBe(null);
  expect([...pc.errors, ...phone.errors]).toEqual([]);
});

test('asked for from the computer: the phone opens the window, Start connects at once, the computer can stop', async ({ browser }) => {
  const pc = await open(browser, 'Test Laptop');
  const phone = await open(browser, 'Test Phone', { userAgent: ANDROID });
  // Another computer's card has no webcam button
  const other = await open(browser, 'Test Desktop');
  await (await card(other.page, 'Test Laptop')).hover();
  await (await card(other.page, 'Test Laptop')).locator('[data-act=more]').click();
  await expect(other.page.locator('#dlg-actions [data-act=webcam]')).toBeHidden();
  await other.page.locator('#dlg-actions [data-close]').click();

  expect(await more(pc.page, 'Test Phone', 'webcam')).toBe('Use as webcam or mic');
  await expect(pc.page.locator('.toast').last()).toContainText('Asked Test Phone. Tap Start on the phone.');
  const dlg = phone.page.locator('#dlg-webcam');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.webcam-asked')).toHaveText('Test Laptop asked to use this phone as its webcam or mic.');
  await expect.poll(() => videoWidth(phone.page, '#dlg-webcam video')).toBeGreaterThan(0);
  await dlg.locator('[data-act=start]').click();
  // No second question on the computer: it asked for it
  const view = pc.page.locator('#dlg-webcam-view');
  await expect(view).toBeVisible();
  await expect(pc.page.locator('#dlg-webcam-ask')).toHaveCount(0);
  await expect.poll(() => videoWidth(pc.page, '#dlg-webcam-view video'), { timeout: 20000 }).toBeGreaterThan(0);
  await expect(dlg.locator('.webcam-status')).toContainText('Live on Test Laptop');

  // The computer stops: the phone's window stays open, ready to start again
  await view.locator('[data-act=stop]').click();
  await expect(view).toBeHidden();
  await expect(phone.page.locator('.toast').last()).toContainText('Test Laptop stopped watching');
  await expect(dlg.locator('[data-act=start]')).toBeVisible();
  await expect(dlg.locator('.webcam-live-badge')).toBeHidden();

  // Cancelling on the phone after the computer asked tells the computer
  await dlg.locator('[data-act=close]').click();
  await more(pc.page, 'Test Phone', 'webcam');
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-act=close]').click();
  await expect(pc.page.locator('.toast').last()).toContainText('Test Phone said no thanks');
  expect([...pc.errors, ...phone.errors, ...other.errors]).toEqual([]);
});

test('mic only: no picture, the computer shows the sound level', async ({ browser }) => {
  const pc = await open(browser, 'Test Laptop');
  const phone = await open(browser, 'Test Phone', { userAgent: ANDROID });
  await more(phone.page, 'Test Laptop', 'webcam');
  const dlg = phone.page.locator('#dlg-webcam');
  await dlg.locator('[data-mode=a]').click();
  await expect(dlg.locator('.camera-msg')).toContainText('Microphone only');
  await expect(dlg.locator('[data-act=flip]')).toBeHidden();
  await expect(dlg.locator('[data-act=start]')).toBeEnabled();
  await dlg.locator('[data-act=start]').click();
  const ask = pc.page.locator('#dlg-webcam-ask');
  await expect(ask).toContainText('Test Phone wants to be your microphone');
  await ask.locator('[data-act=yes]').click();
  const view = pc.page.locator('#dlg-webcam-view');
  await expect(view.locator('.screen-title')).toHaveText('Test Phone\'s microphone');
  await expect(view.locator('.webcam-meter')).toBeVisible();
  await expect(view.locator('[data-act=popout]')).toBeHidden();
  await expect.poll(() => pc.page.evaluate(() => document.querySelector('#dlg-webcam-view video').srcObject?.getAudioTracks().length || 0), { timeout: 20000 }).toBe(1);
  // The choice is remembered for next time
  expect(await phone.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-webcam')).mode)).toBe('a');
  await view.locator('[data-act=stop]').click();
  await expect(phone.page.locator('.toast').last()).toContainText('Test Laptop stopped watching');
  expect([...pc.errors, ...phone.errors]).toEqual([]);
});
