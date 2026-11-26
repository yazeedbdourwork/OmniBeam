// More upgrades of 2026-11-26: favorite devices that connect by themselves (app.js Fav), a search box in History,
// Send to… on received files and Send again that still works after a reload (app.js SentStore), and links that open
// on the other device (Send a link, Always open, YouTube). Plus the new words in all 15 languages.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function pairedDevices(browser, names, { trusted = true, ...opts } = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: trusted, trusted }]);
  const a = await open(browser, names[0], { ...opts, storage: { 'omnibeam-paired': paired(names[1]) } });
  const b = await open(browser, names[1], { ...opts, storage: { 'omnibeam-paired': paired(names[0]) } });
  const tag = trusted ? 'Trusted' : 'Paired';
  await expect((await card(a.page, names[1])).locator('.tag')).toHaveText(tag);
  await expect((await card(b.page, names[0])).locator('.tag')).toHaveText(tag);
  return { a, b };
}
async function more(page, name) {
  const c = await card(page, name);
  await c.hover();
  await c.locator('[data-act=more]').click();
  await expect(page.locator('#dlg-actions')).toBeVisible();
  return page.locator('#dlg-actions');
}
async function sendFilesTo(page, name, files) {
  const c = await card(page, name);
  const chooser = page.waitForEvent('filechooser');
  await c.hover();
  await c.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}
const historyNames = (page) => page.evaluate(() => History.items.map((f) => f.name).sort());

test('favorite device: first in the list, connects by itself, and again after the other page reloads', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Fav Laptop', 'Fav Phone']);
  // Not connected until something is sent (no favorite yet)
  await a.page.waitForTimeout(1500);
  expect(await a.page.evaluate(() => [...peers.values()][0].direct)).toBe(false);
  const dlg = await more(a.page, 'Fav Phone');
  await expect(dlg.locator('[data-act=fav]')).toHaveText('Add to favorites');
  await dlg.locator('[data-act=fav]').click();
  const c = await card(a.page, 'Fav Phone');
  await expect(c.locator('.tag')).toHaveText('★ Trusted');
  await expect(c).toHaveClass(/\bfav\b/);
  await expect(c).toHaveClass(/\blinked\b/);
  expect(await a.page.evaluate(() => [...peers.values()][0].direct)).toBe(true);
  expect(await a.page.evaluate(() => loadPaired()[0].fav)).toBe(true);
  // The phone's page reloads: they meet again and connect by themselves, nothing sent
  await b.page.reload();
  await expect(b.page.locator('#me-name')).toHaveText('Fav Phone');
  await expect(a.page.locator('.peer.fav.linked')).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => b.page.evaluate(() => [...peers.values()][0]?.direct)).toBe(true);
  // The pairing list has the star too; tapping it takes the favorite away
  await a.page.evaluate(() => { renderPairedList(); });
  const star = a.page.locator('#paired-list .fav-star');
  await expect(star).toHaveText('★');
  await star.dispatchEvent('click'); // (the list is in the pairing window)
  await expect(a.page.locator('.peer.fav')).toHaveCount(0);
  await expect((await card(a.page, 'Fav Phone')).locator('.tag')).toHaveText('Trusted');
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('favorite device: shown first among the devices, and greyed while offline', async ({ browser }) => {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name, fav) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: false, fav }]);
  const a = await open(browser, 'Order Laptop', { storage: { 'omnibeam-paired': paired('Order Phone', true) } });
  await open(browser, 'Other Tablet');
  await card(a.page, 'Other Tablet');
  const b = await open(browser, 'Order Phone', { storage: { 'omnibeam-paired': paired('Order Laptop', false) } });
  await expect((await card(a.page, 'Order Phone')).locator('.tag')).toHaveText('★ Paired');
  await expect(a.page.locator('#peers .peer').first().locator('.name')).toHaveText('Order Phone');
  await expect(a.page.locator('.peer.fav.linked')).toHaveCount(1, { timeout: 30000 });
  await b.close();
  devices = devices.filter((d) => d !== b);
  const off = a.page.locator('.peer.offline.fav');
  await expect(off).toBeVisible({ timeout: 30000 });
  await expect(off.locator('.tag')).toHaveText('★ Paired');
  expect(a.errors).toEqual([]);
});

test('history search, Send to… on a received file, and Send again after a reload', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser, ['Hist Laptop', 'Hist Phone']);
  const report = { name: 'quarterly-report.pdf', mimeType: 'application/pdf', buffer: crypto.randomBytes(3000) };
  const photo = { name: 'beach-holiday.jpg', mimeType: 'image/jpeg', buffer: crypto.randomBytes(2000) };
  await sendFilesTo(a.page, 'Hist Phone', [report, photo]);
  await expect.poll(() => historyNames(b.page), { timeout: 30000 }).toEqual(['beach-holiday.jpg', 'quarterly-report.pdf']);
  await b.page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  await hist.locator('[data-tab=received]').click();
  const search = hist.locator('.history-search input');
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('placeholder', 'Search files, devices and messages');
  await expect(hist.locator('.received:not(.messages) .item')).toHaveCount(2);
  await search.fill('REPORT');
  await expect(hist.locator('.received:not(.messages) .item')).toHaveCount(1);
  await expect(hist.locator('.received:not(.messages) .item')).toContainText('quarterly-report.pdf');
  await search.fill('hist laptop beach');
  await expect(hist.locator('.received:not(.messages) .item')).toHaveCount(1);
  await expect(hist.locator('.received:not(.messages) .item')).toContainText('beach-holiday.jpg');
  await search.fill('nothing like this');
  await expect(hist.locator('.received:not(.messages) .item')).toHaveCount(0);
  await expect(hist.locator('.history-none')).toHaveText('Nothing matches “nothing like this”');
  // Send to…: the phone sends the report back to the laptop
  await search.fill('report');
  await hist.locator('.received:not(.messages) .item').first().getByRole('button', { name: 'Send to…' }).click();
  await b.page.locator('#dlg-choose .choose-item', { hasText: 'Hist Laptop' }).click();
  await expect(hist).toBeHidden();
  await expect.poll(() => historyNames(a.page), { timeout: 30000 }).toEqual(['quarterly-report.pdf']);
  // Send again after the laptop's page reloads: the copy kept on this device goes, no file chooser
  await a.page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  await expect.poll(() => a.page.evaluate(() => { Sent.load(); return Sent.items.filter((e) => e.kept).length; })).toBe(1);
  await a.page.reload();
  await expect(a.page.locator('#me-name')).toHaveText('Hist Laptop');
  await card(a.page, 'Hist Phone');
  await b.page.evaluate(() => { [...History.items].forEach((f) => History.remove(f)); });
  let chooser = false;
  a.page.on('filechooser', () => { chooser = true; });
  await a.page.locator('#btn-history').click();
  const histA = a.page.locator('#dlg-history');
  await histA.locator('[data-tab=sent]').click();
  await expect(histA.locator('.history-note')).toContainText('up to 50 MB a send');
  await histA.locator('.history-search input').fill('beach');
  await expect(histA.locator('.sent-list .item')).toHaveCount(1);
  await histA.locator('.sent-list .item').first().getByRole('button', { name: 'Send again' }).click();
  await expect.poll(() => historyNames(b.page), { timeout: 30000 }).toEqual(['beach-holiday.jpg', 'quarterly-report.pdf']);
  const got = await b.page.evaluate(async () => {
    const f = History.items.find((x) => x.name === 'quarterly-report.pdf');
    const blob = await History.blobOf(f);
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  expect(Buffer.from(got).equals(report.buffer)).toBe(true);
  expect(chooser).toBe(false);
  // Delete takes the copy away too
  await a.page.evaluate(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  await a.page.evaluate(() => { Sent.load(); Sent.items.forEach((e) => Sent.remove(e.id)); });
  await expect.poll(() => a.page.evaluate(() => SentStore.run('readonly', (st) => st.count()))).toBe(0);
  expect([...a.errors, ...b.errors]).toEqual([]);
});

test('links: Send a link from the phone, the computer shows a YouTube video, Always open, then they open by themselves', async ({ browser }) => {
  // The pages the links open: a blank page here instead of the real sites
  const setup = (ctx) => ctx.route(/^https:\/\/(www\.)?(youtube|example)\.com\//, (r) => r.fulfill({ body: '<title>ok</title>', contentType: 'text/html' }));
  const { a: pc, b: phone } = await pairedDevices(browser, ['Link PC', 'Link Phone'], { trusted: false, setup });
  const dlg = await more(phone.page, 'Link PC');
  await dlg.locator('[data-act=link]').click();
  const send = phone.page.locator('#dlg-send-link');
  await expect(send).toBeVisible();
  await expect(send.locator('#send-link-title')).toHaveText('Open a link on Link PC');
  await send.locator('input').fill('not a link');
  await send.locator('[data-act=send]').click();
  await expect(send.locator('.send-link-err')).toBeVisible();
  await send.locator('input').fill('youtube.com/watch?v=dQw4w9WgXcQ&t=42');
  await send.locator('[data-act=send]').click();
  await expect(send).toBeHidden();
  const banner = pc.page.locator('#msg-banner.show');
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(banner.locator('.msg-banner-text')).toHaveText('▶ YouTube video (42)');
  const always = banner.locator('.msg-banner-always');
  await expect(always).toHaveText('Always open');
  const popup = pc.page.waitForEvent('popup');
  await always.click();
  expect((await popup).url()).toContain('youtube.com/watch?v=dQw4w9WgXcQ');
  expect(await pc.page.evaluate(() => loadPaired()[0].links)).toBe(true);
  // The next link opens by itself on the computer
  const popup2 = pc.page.waitForEvent('popup');
  await phone.page.evaluate(() => [...peers.values()][0].sendText('https://example.com/next-page'));
  expect((await popup2).url()).toContain('example.com/next-page');
  // More… on the phone's card can turn it off again
  const pcDlg = await more(pc.page, 'Link Phone');
  await expect(pcDlg.locator('[data-act=links]')).toHaveText('Stop opening its links');
  await pcDlg.locator('[data-act=links]').click();
  expect(await pc.page.evaluate(() => loadPaired()[0].links)).toBe(false);
  expect(await pc.page.evaluate(() => [
    linkLabel('https://youtu.be/dQw4w9WgXcQ'), linkLabel('https://m.youtube.com/shorts/abcDEF12345'), linkLabel('https://www.youtube.com/feed/library'),
  ])).toEqual(['▶ YouTube video', '▶ YouTube video', 'youtube.com/feed/library']);
  expect([...pc.errors, ...phone.errors]).toEqual([]);
});

test('the new words are translated in all 15 languages, and are the words the app uses', async () => {
  const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'upgrades-1126b.keys.json'), 'utf8'));
  const src = ['app.js', 'index.html', 'parts/info.html']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');
  for (const k of keys) expect(src.includes(k) || src.includes(k.replace(/'/g, "\\'")), `used: ${k}`).toBe(true);
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) {
      const v = pack.strings[k];
      expect(v, `${code}: ${k}`).toBeTruthy();
      for (const part of k.match(/\{\w+\}/g) || []) expect(v, `${code}: ${k}`).toContain(part);
    }
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'pages', code, 'how-to-use.html'), 'utf8');
    for (const id of ['send-link', 'history-search', 'favorites']) expect(page, `${code}: ${id}`).toContain(`<details id="${id}">`);
  }
});
