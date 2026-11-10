// Clipboard sync between paired devices, the speed test, and the command-line sender (which the Windows tray
// app and the Mac and Linux right-click menus use)
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});

// Two devices that are already paired with each other (as after entering a pairing code)
async function pairedDevices(browser, opts = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const a = await openDevice(browser, 'Test Laptop', { clipboard: true, storage: { 'omnibeam-paired': paired('Test Phone'), ...opts.storage } });
  const b = await openDevice(browser, 'Test Phone', { clipboard: true, storage: { 'omnibeam-paired': paired('Test Laptop'), ...opts.storage } });
  devices.push(a, b);
  await expect((await card(a.page, 'Test Phone')).locator('.tag')).toHaveText('Trusted');
  await expect((await card(b.page, 'Test Laptop')).locator('.tag')).toHaveText('Trusted');
  return { a, b, secret };
}

for (const how of ['one creates the code', 'both type the same code']) {
  test(`pairing works when ${how}`, async ({ browser }) => {
    const a = await openDevice(browser, 'Test Laptop');
    const b = await openDevice(browser, 'Test Phone');
    devices.push(a, b);
    await card(a.page, 'Test Phone');
    let code = '123456';
    await a.page.locator('#btn-pair').click();
    await a.page.locator('#pair-tab-code').click();
    if (how === 'one creates the code') {
      await a.page.locator('[data-act=create]').click();
      await expect(a.page.locator('#pair-show')).toHaveText(/\d{3} \d{3}/);
      code = (await a.page.locator('#pair-show').textContent()).replace(/\D/g, '');
    } else {
      await a.page.locator('#pair-code').fill(code);
    }
    await b.page.locator('#btn-pair').click();
    await b.page.locator('#pair-tab-code').click();
    await b.page.locator('#pair-code').fill(code);
    await expect((await card(a.page, 'Test Phone')).locator('.tag')).toHaveText(/Paired|Trusted/, { timeout: 10000 });
    await expect((await card(b.page, 'Test Laptop')).locator('.tag')).toHaveText(/Paired|Trusted/, { timeout: 10000 });
    await expect(a.page.locator('#me-scope')).not.toContainText('Pairing with code');
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}

test('clipboard sync: text copied on one device lands on the other', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser);
  // Turn it on in Settings on both
  for (const d of [a, b]) {
    await menu(d.page, 'btn-settings');
    await settingsTab(d.page, 'clipboard');
    await d.page.locator('#clip-sync').check();
    await d.page.locator('#dlg-settings [data-close]').click();
  }
  await a.page.bringToFront();
  await a.page.evaluate(() => navigator.clipboard.writeText('copied on the laptop 123'));
  await b.page.bringToFront();
  await expect.poll(() => b.page.evaluate(() => navigator.clipboard.readText().catch(() => '')), { timeout: 15000 })
    .toBe('copied on the laptop 123');
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('Test speed on a device card (More…) and in Settings opens the check and runs the test', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop');
  const b = await openDevice(browser, 'Test Phone');
  devices.push(a, b);
  const c = await card(a.page, 'Test Phone');
  await c.hover();
  await c.locator('[data-act=more]').click();
  await a.page.locator('#dlg-actions [data-act=speed]').click();
  const result = a.page.locator('#dlg-check .speed-result');
  await expect(result).toContainText('1 GB takes about', { timeout: 40000 });
  await a.page.locator('#dlg-check [data-act=close]').first().click();
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'transfers');
  await a.page.locator('#speed-open').click();
  await expect(a.page.locator('#dlg-check')).toBeVisible();
  await expect(result).toContainText('Testing speed', { timeout: 10000 });
  await expect(result).toContainText('1 GB takes about', { timeout: 40000 });
  await a.page.locator('#dlg-check [data-act=close]').first().click();
  // And Test speed in the ⋯ menu
  await menu(a.page, 'menu-speed');
  await expect(result).toContainText('Testing speed', { timeout: 10000 });
  expect(a.errors).toEqual([]);
});

test('clipboard settings say who gets it, and Send my clipboard now sends it', async ({ browser }) => {
  const { a, b } = await pairedDevices(browser);
  for (const d of [a, b]) {
    await menu(d.page, 'btn-settings');
    await settingsTab(d.page, 'clipboard');
    await d.page.locator('#clip-sync').check();
  }
  await expect(a.page.locator('#clip-status')).toContainText('Paired and online: Test Phone');
  await expect(a.page.locator('#clip-status')).toContainText('Clipboard access: allowed.');
  await b.page.locator('#dlg-settings [data-close]').click();
  // Same text as when sync started: the button still sends it
  await a.page.evaluate(() => navigator.clipboard.writeText('sent with the button'));
  await a.page.locator('#clip-now').click();
  await expect(a.page.locator('#toast')).toContainText('Clipboard sent to Test Phone');
  await b.page.bringToFront();
  await expect.poll(() => b.page.evaluate(() => navigator.clipboard.readText().catch(() => '')), { timeout: 15000 })
    .toBe('sent with the button');
});

test('copying with no paired device says why nothing was sent', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop', { clipboard: true });
  devices.push(a);
  await menu(a.page, 'btn-settings');
  await settingsTab(a.page, 'clipboard');
  await a.page.locator('#clip-sync').check();
  await expect(a.page.locator('#clip-status')).toContainText('No paired device is online right now.');
  await a.page.locator('#dlg-settings [data-close]').click();
  await a.page.evaluate(() => navigator.clipboard.writeText('nobody to send to'));
  await expect(a.page.locator('#toast')).toContainText('Not sent: pair your devices first', { timeout: 10000 });
});

test('clipboard text from an unpaired device only shows as a message', async ({ browser }) => {
  const a = await openDevice(browser, 'Test Laptop', { clipboard: true });
  const b = await openDevice(browser, 'Test Phone', { clipboard: true, storage: { 'omnibeam-clip': 'on' } });
  devices.push(a, b);
  await card(a.page, 'Test Phone');
  // Pretend to be a device sending clipboard text without a pairing
  await a.page.evaluate(() => { const p = [...peers.values()][0]; return p.connect().then(() => p.sendJson({ t: 'clip', text: 'not yours', proofs: ['00'] })); });
  await expect(b.page.locator('#dlg-chat .bubble.in')).toContainText('not yours');
  expect(await b.page.evaluate(() => Messages.items[0].text)).toBe('not yours');
  expect(await b.page.evaluate(() => navigator.clipboard.readText().catch(() => ''))).not.toBe('not yours');
});

for (const relayOnly of [false, true]) {
  test(`speed test ${relayOnly ? 'through the server' : 'direct'}`, async ({ browser }) => {
    const a = await openDevice(browser, 'Test Laptop', { relayOnly });
    const b = await openDevice(browser, 'Test Phone', { relayOnly });
    devices.push(a, b);
    await card(a.page, 'Test Phone');
    await a.page.locator('#me-network').click();
    const dlg = a.page.locator('#dlg-check');
    await dlg.locator('[data-act=speed]').click();
    const result = dlg.locator('.speed-result');
    await expect(result).toContainText('/s ·', { timeout: 40000 });
    await expect(result).toContainText(relayOnly ? 'OmniBeam server' : 'same Wi-Fi');
    await expect(result).toContainText('1 GB takes about');
    // Both devices are free again afterwards
    expect(await a.page.evaluate(() => [...peers.values()][0].busy)).toBe(false);
    expect(await b.page.evaluate(() => [...peers.values()][0].busy)).toBe(false);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}

// Runs tools/omnibeam-send.js against the test server with its own settings folder
function cli(args, { home, input } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'omnibeam-send.js'), '--server', 'http://localhost:3999', '--name', 'Test CLI', ...args],
      { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), APPDATA: path.join(home, 'AppData') } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    if (input != null) p.stdin.end(input);
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('command line: sends a file and puts text on a paired clipboard', async ({ browser }) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-cli-'));
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.join(home, '.config', 'omnibeam'), { recursive: true });
  fs.mkdirSync(path.join(home, 'AppData', 'OmniBeam'), { recursive: true });
  const pairedFile = JSON.stringify([{ secret, name: 'Test Phone', at: Date.now() }]);
  fs.writeFileSync(path.join(home, '.config', 'omnibeam', 'paired.json'), pairedFile);
  fs.writeFileSync(path.join(home, 'AppData', 'OmniBeam', 'paired.json'), pairedFile);
  const phone = await openDevice(browser, 'Test Phone', {
    clipboard: true,
    storage: { 'omnibeam-clip': 'on', 'omnibeam-paired': JSON.stringify([{ secret, name: 'Test CLI', at: Date.now(), auto: true, trusted: true }]) },
  });
  devices.push(phone);

  // A file (auto-accepted: the phone trusts this pairing)
  const file = path.join(home, 'hello.txt');
  fs.writeFileSync(file, 'hello from the command line\n'.repeat(1000));
  const sent = cli(['--to', 'Test Phone', file], { home });
  const got = phone.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 30000 });
  const r = await sent;
  expect(r.out).toContain('Sent 1 file to Test Phone');
  expect(r.code).toBe(0);
  await got.locator('[data-act=close]').click();

  // Clipboard text from standard input
  const clip = await cli(['--clip', '-'], { home, input: 'from the tray app ✓' });
  expect(clip.out).toContain('Clipboard sent to Test Phone');
  await expect.poll(() => phone.page.evaluate(() => navigator.clipboard.readText().catch(() => '')), { timeout: 15000 }).toBe('from the tray app ✓');

  // A message (the Windows app, the Mac/Linux right-click menu and the command line all send it like this): it lands
  // in the chat with the sender, which opens by itself, no message window
  const msg = await cli(['--to', 'Test Phone', '--text', 'hello from the command line ✓'], { home });
  expect(msg.code).toBe(0);
  const chat = phone.page.locator('#dlg-chat');
  await expect(chat).toBeVisible({ timeout: 15000 });
  await expect(phone.page.locator('#dlg-text')).toBeHidden();
  await expect(chat.locator('#chat-title')).toHaveText('Test CLI');
  await expect(chat.locator('.bubble.in .msg-text')).toHaveText('hello from the command line ✓');
});

test('Linux right-click menu installs and uninstalls', async () => {
  test.skip(process.platform !== 'linux', 'Linux only');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-linux-'));
  fs.mkdirSync(path.join(home, '.local', 'share', 'nautilus', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'Thunar'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'Thunar', 'uca.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<actions>\n</actions>\n');
  const r = await cli(['--install-sendto'], { home });
  expect(r.code, r.out).toBe(0);
  const script = path.join(home, '.local', 'share', 'nautilus', 'scripts', 'Send with OmniBeam');
  expect(fs.statSync(script).mode & 0o111).toBeTruthy();
  expect(fs.readFileSync(path.join(home, '.config', 'Thunar', 'uca.xml'), 'utf8')).toContain('omnibeam-send');
  expect(fs.existsSync(path.join(home, '.config', 'omnibeam', 'app', 'omnibeam-send.js'))).toBe(true);
  await cli(['--uninstall'], { home });
  expect(fs.existsSync(script)).toBe(false);
  expect(fs.readFileSync(path.join(home, '.config', 'Thunar', 'uca.xml'), 'utf8')).not.toContain('omnibeam-send');
});
