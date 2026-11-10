// Gallery of received photos and videos with Save all; team rooms (a fixed link); device name, picture and
// theme; the history's Sent tab with Send again, and the export
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon-192.png'));

async function pick(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}

test('gallery: received photos as thumbnails, full size one by one, Save all as one ZIP', async ({ browser }) => {
  const a = await open(browser, 'Gallery Sender');
  const b = await open(browser, 'Gallery Phone');
  const photos = ['beach.png', 'dog.png', 'cake.png'].map((name) => ({ name, mimeType: 'image/png', buffer: png }));
  await pick(a, b, [...photos, makeFile('notes.txt', 2000, 'text/plain')]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  const got = b.page.locator('#dlg-received');
  await expect(got).toBeVisible();
  // Several photos: a Gallery button opens them full size
  await expect(got.locator('[data-act=gallery]')).toBeVisible();
  await got.locator('[data-act=gallery]').click();
  const viewer = b.page.locator('#dlg-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.viewer-name')).toContainText('beach.png · 1 / 3');
  await expect(viewer.locator('.viewer-stage img')).toBeVisible();
  await viewer.locator('[data-act=next]').click();
  await expect(viewer.locator('.viewer-name')).toContainText('dog.png · 2 / 3');
  await b.page.keyboard.press('ArrowRight');
  await expect(viewer.locator('.viewer-name')).toContainText('cake.png · 3 / 3');
  await expect(viewer.locator('[data-act=next]')).toBeDisabled();
  const one = b.page.waitForEvent('download');
  await viewer.locator('[data-act=save]').click();
  expect((await one).suggestedFilename()).toBe('cake.png');
  await viewer.locator('[data-act=close]').click();
  await got.locator('[data-act=close]').click();

  // History > Gallery: only the photos, as thumbnails
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  await hist.locator('[data-tab=gallery]').click();
  await expect(hist.locator('.gallery .thumb')).toHaveCount(3);
  await expect(hist.locator('.gallery .thumb img')).toHaveCount(3);
  await expect(hist.locator('[data-act=clear]')).toBeHidden();
  const zip = b.page.waitForEvent('download');
  await hist.locator('[data-act=gallery-save]').click();
  const d = await zip;
  expect(d.suggestedFilename()).toMatch(/\.zip$/);
  const buf = fs.readFileSync(await d.path());
  for (const n of ['beach.png', 'dog.png', 'cake.png']) expect(buf.includes(Buffer.from(n))).toBe(true);
  expect(buf.includes(Buffer.from('notes.txt'))).toBe(false);
  // A thumbnail opens the viewer there too
  await hist.locator('.gallery .thumb').nth(1).click();
  await expect(viewer.locator('.viewer-name')).toContainText('/ 3');
  await viewer.locator('[data-act=close]').click();
  // The tab is remembered
  await hist.locator('[data-act=close]').click();
  await b.page.locator('#btn-history').click();
  await expect(hist.locator('[data-tab=gallery]')).toHaveAttribute('aria-selected', 'true');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('history: Sent tab, Send again (also after a reload) and export as CSV', async ({ browser }) => {
  const a = await open(browser, 'Again Laptop');
  const b = await open(browser, 'Again Phone');
  await pick(a, b, [makeFile('=report.pdf', 40 * 1024, 'application/pdf'), makeFile('photo.jpg', 20 * 1024, 'image/jpeg')]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  await b.page.locator('#dlg-received [data-act=close]').click();
  await expect(a.page.locator('#toast')).toContainText('Sent 2 files to Again Phone');
  // A message too
  const target = await card(a.page, b.name);
  await target.hover();
  await target.locator('[data-act=message]').click();
  await a.page.fill('#dlg-chat textarea', 'see you at 8');
  await a.page.locator('#dlg-chat [data-act=send]').click();
  await expect(b.page.locator('#dlg-chat .bubble.in').last()).toContainText('see you at 8');
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await a.page.locator('#dlg-chat [data-act=close]').click();

  await a.page.locator('#btn-history').click();
  const hist = a.page.locator('#dlg-history');
  await hist.locator('[data-tab=sent]').click();
  const items = hist.locator('.sent-list .item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('see you at 8');
  await expect(items.nth(1)).toContainText('2 files: =report.pdf, photo.jpg');
  await expect(items.nth(1)).toContainText('to Again Phone');
  await expect(items.nth(1)).toContainText('✓ Sent');

  // Export: one row per file and message, both directions; = at the start can't become a formula
  const dl = a.page.waitForEvent('download');
  await hist.locator('[data-act=export]').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^omnibeam-history-\d{4}-\d\d-\d\d\.csv$/);
  const csv = fs.readFileSync(await d.path(), 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('Date,Direction,Device,Type,Name or text,Size (bytes),Result');
  expect(csv).toContain("Sent,Again Phone,File,'=report.pdf,40960,Sent");
  expect(csv).toContain('Sent,Again Phone,Message,see you at 8,,Sent');

  // Send again: the files go to the same device right away
  await items.nth(1).locator('[data-again]').click();
  await expect(hist).toBeHidden();
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await expect(b.page.locator('#dlg-request .file-list')).toContainText('=report.pdf');
  await b.page.locator('#dlg-request [data-act=decline]').click();
  await expect(a.page.locator('#toast')).toContainText('declined');
  await a.page.locator('#btn-history').click();
  await expect(hist.locator('.sent-list .item').first()).toContainText('Declined');

  // After a reload the files are chosen again (the list stays)
  await a.page.reload();
  await expect(a.page.locator('#me-name')).toHaveText('Again Laptop');
  await card(a.page, b.name);
  await a.page.locator('#btn-history').click();
  await expect(hist.locator('[data-tab=sent]')).toHaveAttribute('aria-selected', 'true');
  const chooser = a.page.waitForEvent('filechooser');
  await hist.locator('.sent-list .item').nth(2).locator('[data-again]').click();
  await (await chooser).setFiles([makeFile('=report.pdf', 40 * 1024, 'application/pdf')]);
  await expect(b.page.locator('#dlg-request')).toBeVisible();
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('send again when the device is not here: choose another one', async ({ browser }) => {
  const a = await open(browser, 'Choose Laptop');
  const b = await open(browser, 'Choose Tablet');
  await pick(a, b, [makeFile('plan.txt', 3000, 'text/plain')]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  await b.close();
  devices = devices.filter((d) => d !== b);
  const c = await open(browser, 'Choose Phone');
  await card(a.page, c.name);
  await a.page.locator('#btn-history').click();
  await a.page.locator('#dlg-history [data-tab=sent]').click();
  await a.page.locator('#dlg-history [data-again]').first().click();
  const choose = a.page.locator('#dlg-choose');
  await expect(choose).toBeVisible();
  await choose.locator('.choose-item', { hasText: 'Choose Phone' }).click();
  await expect(c.page.locator('#dlg-request .file-list')).toContainText('plan.txt');
  expect([...a.errors, ...c.errors]).toEqual([]);
});

test('team room: a fixed link, the team name on cards, kept after a reload, auto-accept per team', async ({ browser }) => {
  const a = await open(browser, 'Mum Laptop');
  await a.page.locator('#btn-pair').click();
  const dlg = a.page.locator('#dlg-pair');
  await dlg.locator('#pair-tab-rooms').click();
  await dlg.locator('#team-name').fill('Family');
  await a.page.evaluate(() => { navigator.clipboard.writeText = (text) => { window.copied = text; return Promise.resolve(); }; });
  await dlg.locator('[data-act=team-create]').click();
  await expect(dlg.locator('.team-row')).toHaveCount(1);
  await expect(dlg.locator('.team-row .team-name')).toHaveText('Family');
  await expect(dlg.locator('.team-row')).toContainText('nobody else here now');
  const link = await a.page.evaluate(() => window.copied);
  expect(link).toMatch(/\/#team=[0-9a-f]{64}&n=Family$/);
  await dlg.locator('[data-team=qr]').click();
  await expect(dlg.locator('.team-qr svg')).toBeVisible();
  await dlg.locator('[data-act=close]').click();

  // Another device opens the link once
  const b = await open(browser, 'Kid Tablet', { path: link.replace(/^https?:\/\/[^/]+/, '') });
  await expect(b.page.locator('#toast')).toContainText('You joined the team room Family');
  const onA = await card(a.page, b.name);
  await expect(onA.locator('.tag')).toHaveText('Family');
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText('Family');
  // Still in the team after a reload, without the link
  await b.page.goto('/');
  await expect((await card(b.page, a.name)).locator('.tag')).toHaveText('Family');
  // The server never got the secret: only a hash of it
  const stored = await b.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-teams')));
  expect(stored).toHaveLength(1);
  expect(link).toContain(stored[0].secret);
  expect(stored[0].id).not.toBe(stored[0].secret);

  // Auto-accept from the team, turned on on the tablet
  await b.page.locator('#btn-pair').click();
  await b.page.locator('#pair-tab-rooms').click();
  await expect(b.page.locator('#dlg-pair .team-row')).toContainText('1 here now');
  await b.page.locator('#dlg-pair .team-row [data-k=auto]').check();
  await b.page.locator('#dlg-pair [data-act=close]').click();
  await pick(a, b, [makeFile('homework.pdf', 5000, 'application/pdf')]);
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  await expect(b.page.locator('#dlg-request')).toBeHidden();

  // Leaving: the tag goes
  b.page.on('dialog', (d) => d.accept());
  await b.page.locator('#dlg-received [data-act=close]').click();
  await b.page.locator('#btn-pair').click();
  await b.page.locator('#dlg-pair [data-team=leave]').click();
  await expect(b.page.locator('#dlg-pair .team-row')).toHaveCount(0);
  await expect(onA.locator('.tag')).toHaveCount(0);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('device name and picture, and the theme setting', async ({ browser }) => {
  const a = await open(browser, 'Old Name');
  const b = await open(browser, 'Watcher');
  await a.page.locator('#me-rename').click();
  const me = a.page.locator('#dlg-me');
  await expect(me).toBeVisible();
  await expect(a.page.locator('#me-name-input')).toHaveValue('Old Name');
  await a.page.fill('#me-name-input', 'Kitchen PC');
  await me.locator('.avatar-opt[data-avatar="🦊"]').click();
  await expect(me.locator('.avatar-opt[data-avatar="🦊"]')).toHaveAttribute('aria-checked', 'true');
  await me.locator('[data-act=save]').click();
  await expect(a.page.locator('#me-name')).toHaveText('Kitchen PC');
  await expect(a.page.locator('#me-avatar .emoji')).toHaveText('🦊');
  const onB = await card(b.page, 'Kitchen PC');
  await expect(onB.locator('.avatar .emoji')).toHaveText('🦊');
  // The picture is kept after a reload (the test sets the name again on every load), and sent with the first hello
  await a.page.reload();
  await expect(a.page.locator('#me-avatar .emoji')).toHaveText('🦊');
  await expect((await card(b.page, 'Old Name')).locator('.avatar .emoji')).toHaveText('🦊');
  // Back to the device icon and a random name
  await menu(a.page, 'btn-settings');
  await expect(a.page.locator('#set-name')).toHaveText('Old Name');
  await a.page.locator('#set-me').click();
  await me.locator('.avatar-opt[data-avatar=""]').click();
  await me.locator('[data-act=random]').click();
  await me.locator('[data-act=save]').click();
  await expect(a.page.locator('#me-name')).not.toHaveText('Old Name');
  await expect(a.page.locator('#me-avatar svg')).toBeVisible();
  const newName = await a.page.locator('#me-name').textContent();
  await expect((await card(b.page, newName)).locator('.avatar svg')).toBeVisible();

  // Theme: Dark, Light, Automatic in Settings; the ⋯ menu switch updates it
  await menu(a.page, 'btn-settings');
  const settings = a.page.locator('#dlg-settings');
  await expect(settings.locator('#theme-choice input[value=""]')).toBeChecked();
  await settings.locator('#theme-choice label', { hasText: 'Dark' }).click();
  await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(a.page.locator('meta[name=theme-color]').first()).toHaveAttribute('content', '#2b2e38');
  await settings.locator('#theme-choice label', { hasText: 'Light' }).click();
  await expect(a.page.locator('html')).toHaveAttribute('data-theme', 'light');
  await settings.locator('#theme-choice label', { hasText: 'Automatic' }).click();
  await expect(a.page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await a.page.evaluate(() => localStorage.getItem('omnibeam-theme'))).toBe(null);
  await settings.locator('[data-close]').last().click();
  await menu(a.page, 'btn-theme');
  await menu(a.page, 'btn-settings');
  const now = await a.page.locator('html').getAttribute('data-theme');
  await expect(settings.locator(`#theme-choice input[value="${now}"]`)).toBeChecked();
  expect([...a.errors, ...b.errors]).toEqual([]);
});
