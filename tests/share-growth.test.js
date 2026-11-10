// Share links with a PIN, a download limit, a longer expiry and "send to" an email or phone; the rest of a
// dropped send going to another paired device; the rating / share ask after sends
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function pick(from, to, files) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}

test('send to an email address: a link with a PIN, 7 days and 3 downloads', async ({ browser }) => {
  const a = await open(browser, 'Test Laptop');
  await menu(a.page, 'btn-sendto');
  const dlg = a.page.locator('#dlg-link');
  await expect(dlg).toBeVisible();
  await expect(a.page.locator('#link-to')).toBeFocused();
  // Not an email or phone number: stopped before the file picker
  await a.page.fill('#link-to', 'not an address');
  await dlg.locator('[data-act=pick]').click();
  await expect(a.page.locator('#toast')).toContainText('Type an email address, or leave it empty');
  // A computer has no text messages: email only
  await expect(a.page.locator('#link-sms')).toHaveCount(0);
  await a.page.fill('#link-to', 'friend@example.com');
  await a.page.selectOption('#link-hours', '168');
  await a.page.selectOption('#link-max', '3');
  await a.page.fill('#link-pin', '43a21');
  await expect(a.page.locator('#link-pin')).toHaveValue('4321'); // digits only
  await expect(a.page.locator('#link-pin-note')).toBeVisible();
  const file = makeFile('report.pdf', 300 * 1024 + 7, 'application/pdf');
  const chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([file]);
  await expect(a.page.locator('#link-done')).toBeVisible();
  const url = await a.page.locator('#link-url').textContent();
  await expect(a.page.locator('#link-summary')).toContainText('3 downloads');
  await expect(a.page.locator('#link-summary')).toContainText('PIN 4321');
  await expect(a.page.locator('#link-summary')).toContainText(/16[78] h left/);
  // The server emails the link to that address (Resend; here written to a file), but never the PIN
  await expect(a.page.locator('#link-email-status')).toContainText('Email sent to friend@example.com');
  await expect(a.page.locator('#link-send-to')).toBeHidden();
  const mails = fs.readFileSync(require('path').join(__dirname, '.data', 'emails.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const mail = mails.filter((m) => m.to[0] === 'friend@example.com').pop();
  expect(mail.from).toBe('OmniBeam <no-reply@omnibeam.site>');
  expect(mail.subject).toBe('Files for you: report.pdf');
  expect(mail.text).toContain(url.replace(/^http:\/\/localhost:\d+/, 'https://omnibeam.site'));
  expect(mail.text).toContain('Test Laptop sent you files with OmniBeam');
  expect(mail.text).toContain('You also need a PIN');
  expect(mail.text).not.toContain('4321');
  expect(mail.html).toContain('Download the files');
  // The mail-app button is still there under the link
  const href = decodeURIComponent(await a.page.locator('#link-email').getAttribute('href'));
  expect(href.startsWith('mailto:?subject=')).toBe(true);
  expect(href).toContain(url);
  expect(href).not.toContain('4321');

  // The receiver opens the link: asked for the PIN first
  const ctx = await browser.newContext({ acceptDownloads: true });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('#drop-pin')).toBeVisible();
  await expect(page.locator('#drop-get')).toBeHidden();
  await page.fill('#drop-pin-input', '1111');
  await page.locator('#drop-pin button').click();
  await expect(page.locator('#drop-status')).toHaveText('Wrong PIN. 9 tries left.');
  await page.fill('#drop-pin-input', '4321');
  await page.locator('#drop-pin button').click();
  await expect(page.locator('#drop-pin')).toBeHidden();
  await expect(page.locator('#drop-status')).toContainText('Downloads left: 3 of 3.');
  await expect(page.locator('#drop-files')).toContainText('report.pdf');
  const download = page.waitForEvent('download');
  await page.locator('#drop-get').click();
  const d = await download;
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(file.buffer));

  // The sender sees the download count under "Your links"
  await dlg.locator('[data-act=close]').click();
  await menu(a.page, 'btn-link');
  await expect(a.page.locator('#link-list .fsize')).toContainText('1 of 3 downloads');
  await expect(a.page.locator('#link-list .fsize')).toContainText('PIN');
  expect(a.errors).toEqual([]);
});

test('share link server: download limit, PIN lock, and up to 7 days', async ({ request }) => {
  const meta = 'A'.repeat(40);
  const body = Buffer.alloc(100 + 16, 1); // 100 bytes plus the encryption tag
  const make = async (opts) => {
    const r = await request.post('/api/drop', { data: { size: 100, meta, ...opts } });
    expect(r.ok()).toBe(true);
    const c = await r.json();
    expect((await request.put(`/api/drop/${c.id}/0`, { headers: { 'X-Drop-Token': c.token, 'Content-Type': 'application/octet-stream' }, data: body })).ok()).toBe(true);
    return c;
  };
  // 7 days is allowed; more is cut to 7 days
  const long = await make({ hours: 1000 });
  expect(Math.round((long.expires - Date.now()) / 3600000)).toBe(168);
  // Two downloads allowed: the third is refused, and the link is gone
  const two = await make({ hours: 1, max: 2 });
  expect((await request.get(`/api/drop/${two.id}/data`)).status()).toBe(200);
  const owner = await (await request.get(`/api/drop/${two.id}`, { headers: { 'X-Drop-Token': two.token } })).json();
  expect(owner).toMatchObject({ downloads: 1, max: 2, left: 1 });
  expect((await request.get(`/api/drop/${two.id}`)).ok()).toBe(true);
  expect((await request.get(`/api/drop/${two.id}/data`)).status()).toBe(200);
  expect((await request.get(`/api/drop/${two.id}/data`)).status()).toBe(404);
  // A PIN: nothing without the proof, the data too; 10 wrong ones lock it for good
  const proof = 'p'.repeat(43);
  const pin = await make({ hours: 1, pin: proof });
  expect((await request.get(`/api/drop/${pin.id}`)).status()).toBe(401);
  expect((await request.get(`/api/drop/${pin.id}/data`)).status()).toBe(401);
  expect((await request.get(`/api/drop/${pin.id}`, { headers: { 'X-Drop-Pin': proof } })).ok()).toBe(true);
  expect((await request.get(`/api/drop/${pin.id}/data`, { headers: { 'X-Drop-Pin': proof } })).status()).toBe(200);
  for (let i = 0; i < 9; i++) expect((await request.get(`/api/drop/${pin.id}`, { headers: { 'X-Drop-Pin': 'q'.repeat(43) } })).status()).toBe(403);
  expect((await request.get(`/api/drop/${pin.id}`, { headers: { 'X-Drop-Pin': 'q'.repeat(43) } })).status()).toBe(423);
  expect((await request.get(`/api/drop/${pin.id}`, { headers: { 'X-Drop-Pin': proof } })).status()).toBe(423);
  const locked = await (await request.get(`/api/drop/${pin.id}`, { headers: { 'X-Drop-Token': pin.token } })).json();
  expect(locked).toMatchObject({ pin: true, locked: true });
  // A bad PIN proof is refused when making the link
  expect((await request.post('/api/drop', { data: { size: 100, meta, pin: '1234' } })).status()).toBe(400);
});

test('a send whose receiver goes offline can finish on another paired device', async ({ browser }) => {
  const secret = 'ab'.repeat(32);
  const pairing = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now() }]);
  const a = await open(browser, 'Test Laptop', { relayOnly: true, storage: { 'omnibeam-paired': pairing('Test Tablet') } });
  const b = await open(browser, 'Test Phone', { relayOnly: true });
  const c = await open(browser, 'Test Tablet', { relayOnly: true, storage: { 'omnibeam-paired': pairing('Test Laptop') } });
  await expect.poll(() => a.page.evaluate(() => [...peers.values()].some((p) => p.pairSecret && p.info.name === 'Test Tablet'))).toBe(true);
  // Slow the relay down so the phone can leave in the middle
  await a.page.evaluate(() => {
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(20); return wait.call(this); };
  });
  const small = makeFile('first.txt', 2000, 'text/plain');
  const big = makeFile('second.mov', 20 * 1024 * 1024 + 99, 'video/quicktime');
  await pick(a, b, [small, big]);
  await b.page.locator('#dlg-request [data-act=accept]').click();
  await expect.poll(() => b.page.evaluate(() => [...peers.values()][0]?.prog?.done || 0), { timeout: 60000 }).toBeGreaterThan(3 * 1024 * 1024);
  await b.close(); // the phone is gone (closed, battery…)
  devices = devices.filter((d) => d !== b);
  const nudge = a.page.locator('#nudge');
  await expect(nudge).toBeVisible({ timeout: 20000 });
  await expect(nudge).toContainText('Test Phone went offline before the transfer finished');
  await expect(nudge).toContainText('1 file(s)'); // first.txt had arrived
  await nudge.getByRole('button', { name: 'Send to Test Tablet' }).click();
  await expect(nudge).toBeHidden();
  await expect(c.page.locator('#dlg-request')).toBeVisible();
  await expect(c.page.locator('#dlg-request')).toContainText('second.mov');
  await expect(c.page.locator('#dlg-request')).not.toContainText('first.txt');
  await c.page.locator('#dlg-request [data-act=accept]').click();
  const got = c.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 90000 });
  const download = c.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(big.buffer));
  await expect.poll(() => a.page.evaluate(() => AutoResume.size)).toBe(0);
  expect(a.errors).toEqual([]);
  expect(c.errors).toEqual([]);
});

test('after the third good send it asks for a share (or a rating), and "Not now" is remembered', async ({ browser, request }) => {
  const a = await open(browser, 'Test Laptop', { storage: { 'omnibeam-ask': JSON.stringify({ n: 1 }) } });
  const b = await open(browser, 'Test Phone');
  const sendOne = async (i) => {
    await pick(a, b, [makeFile(`f${i}.txt`, 500, 'text/plain')]);
    await b.page.locator('#dlg-request [data-act=accept]').click();
    await expect(b.page.locator('#dlg-received')).toBeVisible();
    await b.page.locator('#dlg-received [data-act=close]').click();
  };
  await sendOne(1);
  await a.page.waitForTimeout(2500);
  await expect(a.page.locator('#nudge')).toBeHidden(); // only the 2nd send so far
  await sendOne(2);
  const nudge = a.page.locator('#nudge');
  await expect(nudge).toBeVisible();
  await expect(nudge).toContainText('Sent! Glad it worked.');
  // No store to rate on in a plain browser without the extension: share only
  await expect(nudge.getByRole('link', { name: 'Rate OmniBeam' })).toHaveCount(0);
  await expect(nudge.getByRole('button', { name: 'Tell a friend' })).toBeVisible();
  await nudge.getByRole('button', { name: 'Not now' }).click();
  await expect(nudge).toBeHidden();
  const st = await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-ask')));
  expect(st).toMatchObject({ n: 3, no: 1 });
  // Not again right away
  await sendOne(3);
  await a.page.waitForTimeout(2500);
  await expect(nudge).toBeHidden();
  // With the Chrome extension there's a store page: Rate comes first, and links to the reviews
  await a.page.evaluate(() => {
    extensionHere = true;
    localStorage.setItem('omnibeam-ask', JSON.stringify({ n: 5 }));
  });
  await sendOne(4);
  await expect(nudge.getByRole('link', { name: 'Rate OmniBeam' })).toHaveAttribute('href', /chromewebstore\.google\.com\/detail\/.*\/reviews/);
  await expect(nudge.locator('.btn').first()).toHaveText('Rate OmniBeam');
  expect(a.errors).toEqual([]);
});

test('on a phone, Send to also takes a phone number and opens Messages', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', viewport: { width: 400, height: 850 }, hasTouch: true });
  devices.push({ close: () => ctx.close() });
  await ctx.addInitScript(() => { localStorage.setItem('omnibeam-name', 'Test Phone'); localStorage.setItem('omnibeam-lang', 'en'); localStorage.setItem('omnibeam-tour', 'done'); });
  await ctx.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('#btn-sendto')).toHaveText('Send to email or phone');
  await menu(page, 'btn-sendto');
  await page.fill('#link-to', '+962 79 123 4567');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#dlg-link [data-act=pick]').click();
  await (await chooser).setFiles([makeFile('a.txt', 100, 'text/plain')]);
  const big = page.locator('#link-send-to');
  await expect(big).toHaveText('Text it to +962791234567');
  expect(decodeURIComponent(await big.getAttribute('href'))).toMatch(/^sms:\+962791234567\?body=.*\/d\//s);
  await expect(page.locator('#link-sms')).toBeVisible();
});
