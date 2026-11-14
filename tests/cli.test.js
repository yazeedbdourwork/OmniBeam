// The command-line tool in cli/ (npx omnibeam): sends to a browser, receives from one, and makes and opens share
// links that the browser pages understand, all against the test server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha, menu } = require('./helpers');

const BIN = path.join(__dirname, '..', 'cli', 'bin', 'omnibeam.js');
let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close().catch(() => {});
  devices = [];
});

// Starts the tool with its own settings folder. Returns { done: Promise<{ code, out, err }>, proc }.
function run(args, { home, input, cwd } = {}) {
  const proc = spawn(process.execPath, [BIN, ...args, '--server', 'http://localhost:3999', '--no-qr'], {
    cwd: cwd || home,
    env: { ...process.env, OMNIBEAM_CONFIG_DIR: path.join(home, 'config') },
  });
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { err += d; });
  if (input != null) proc.stdin.end(input);
  else proc.stdin.end();
  const done = new Promise((resolve) => proc.on('close', (code) => resolve({ code, out, err })));
  return { proc, done, get err() { return err; }, get out() { return out; } };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'omnibeam-npx-'));

test('npx omnibeam: help and version', async () => {
  const home = tmp();
  const help = await run(['--help'], { home }).done;
  expect(help.code).toBe(0);
  expect(help.out).toContain('omnibeam send <files or folders...>');
  const v = await run(['--version'], { home }).done;
  expect(v.out.trim()).toBe(require('../cli/package.json').version);
  const bad = await run(['frobnicate'], { home }).done;
  expect(bad.code).toBe(1);
  expect(bad.err).toContain('Unknown command');
});

test('npx omnibeam send: a file and a folder reach a browser, checked intact', async ({ browser }) => {
  const home = tmp();
  const phone = await openDevice(browser, 'Test Phone');
  devices.push(phone);
  const big = makeFile('build.bin', 1500 * 1024 + 3);
  fs.writeFileSync(path.join(home, 'build.bin'), big.buffer);
  fs.mkdirSync(path.join(home, 'notes'));
  fs.writeFileSync(path.join(home, 'notes', 'todo.txt'), 'ship it\n');
  const sent = run(['send', 'build.bin', 'notes', '--to', 'Test Phone', '--name', 'Test Terminal'], { home });
  const ask = phone.page.locator('#dlg-request');
  await expect(ask).toBeVisible({ timeout: 30000 });
  await expect(ask).toContainText('Test Terminal');
  await ask.locator('[data-act=accept]').click();
  const got = phone.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 60000 });
  // Both files show the "intact" badge: the tool sends each file's check
  await expect(got.locator('.info .muted.intact')).toHaveCount(2);
  const r = await sent.done;
  expect(r.err).toContain('Sent 2 files to Test Phone');
  expect(r.code).toBe(0);

  await got.locator('[data-act=close]').click();

  // A message: it lands in the chat with the sender
  const msg = await run(['send', '--text', 'deploy finished ✓', '--to', 'Test Phone', '--name', 'Test Terminal'], { home }).done;
  expect(msg.code).toBe(0);
  await expect(phone.page.locator('.bubble.in .msg-text').last()).toHaveText('deploy finished ✓', { timeout: 15000 });
});

test('npx omnibeam receive: a browser sends files, saved byte for byte', async ({ browser }) => {
  const home = tmp();
  const out = path.join(home, 'inbox');
  const recv = run(['receive', '--yes', '--no-room', '-o', out, '--name', 'Test Terminal'], { home });
  await expect.poll(() => recv.err, { timeout: 15000 }).toContain('Ready to receive');
  const laptop = await openDevice(browser, 'Test Laptop');
  devices.push(laptop);
  const files = [makeFile('photo.jpg', 700 * 1024 + 11, 'image/jpeg'), makeFile('notes.txt', 1234, 'text/plain')];
  const target = await card(laptop.page, 'Test Terminal');
  const chooser = laptop.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
  // The browser tries a direct connection first (the tool has none) and then goes through the server
  const r = await recv.done;
  expect(r.code).toBe(0);
  expect(r.err).toContain('Test Laptop');
  expect(r.err).toContain('Received 2 files from Test Laptop');
  expect(r.out).toContain('photo.jpg  ✓ intact');
  for (const f of files) expect(sha(fs.readFileSync(path.join(out, f.name)))).toBe(sha(f.buffer));
  await expect(laptop.page.locator('#toast')).toContainText('Sent 2 files to Test Terminal', { timeout: 15000 });
});

test('npx omnibeam receive: asks first, and declines without a terminal', async ({ browser }) => {
  const home = tmp();
  const recv = run(['receive', '--no-room', '-o', path.join(home, 'in'), '--name', 'Test Terminal'], { home });
  await expect.poll(() => recv.err, { timeout: 15000 }).toContain('Ready to receive');
  const laptop = await openDevice(browser, 'Test Laptop');
  devices.push(laptop);
  const target = await card(laptop.page, 'Test Terminal');
  const chooser = laptop.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([makeFile('secret.pdf', 4000)]);
  await expect(laptop.page.locator('#toast')).toContainText('Test Terminal declined', { timeout: 30000 });
  expect(recv.err).toContain('add --yes');
  recv.proc.kill('SIGINT');
  await recv.done;
});

test('npx omnibeam receive: a room link brings in a device from anywhere', async ({ browser }) => {
  const home = tmp();
  const recv = run(['receive', '--yes', '-o', path.join(home, 'in'), '--name', 'Test Terminal'], { home });
  await expect.poll(() => recv.err, { timeout: 15000 }).toMatch(/#room=[a-z]{5}/);
  const url = recv.err.match(/https?:\/\/\S+#room=[a-z]{5}/)[0];
  expect(recv.err).toContain('Saving to');
  const phone = await openDevice(browser, 'Test Phone', { path: url.replace('http://localhost:3999', '') });
  devices.push(phone);
  await card(phone.page, 'Test Terminal');
  recv.proc.kill('SIGINT');
  await recv.done;
});

test('npx omnibeam link and get: work with the browser pages both ways', async ({ browser }) => {
  const home = tmp();
  const data = makeFile('dump.sql', 5 * 1024 * 1024 + 5); // two parts
  fs.writeFileSync(path.join(home, 'dump.sql'), data.buffer);
  // The tool makes a link; the browser download page opens it
  const made = await run(['link', 'dump.sql', '--expires', '2h', '--downloads', '2', '--json'], { home }).done;
  expect(made.code).toBe(0);
  const info = JSON.parse(made.out);
  expect(info.url).toMatch(/^http:\/\/localhost:3999\/d\/[A-Za-z0-9_-]+#[A-Za-z0-9_-]{22}$/);
  expect(info.downloads).toBe(2);
  const ctx = await browser.newContext({ acceptDownloads: true });
  devices.push({ close: () => ctx.close() });
  const page = await ctx.newPage();
  await page.goto(info.url);
  const download = page.waitForEvent('download');
  await page.locator('#drop-get').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('dump.sql');
  expect(sha(fs.readFileSync(await d.path()))).toBe(sha(data.buffer));

  // The tool downloads it too (the second and last download)
  const got = await run(['get', info.url, '-o', 'copy'], { home }).done;
  expect(got.code).toBe(0);
  expect(sha(fs.readFileSync(path.join(home, 'copy', 'dump.sql')))).toBe(sha(data.buffer));
  const gone = await run(['get', info.url], { home }).done;
  expect(gone.code).toBe(1);
  expect(gone.err).toContain('no downloads left');

  // A link made in the browser, with a PIN, downloaded by the tool to standard output
  const a = await openDevice(browser, 'Test Laptop');
  devices.push(a);
  await menu(a.page, 'btn-link');
  const dlg = a.page.locator('#dlg-link');
  await expect(dlg).toBeVisible();
  await a.page.fill('#link-pin', '2468');
  const chooser = a.page.waitForEvent('filechooser');
  await dlg.locator('[data-act=pick]').click();
  await (await chooser).setFiles([{ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('hello from the browser') }]);
  await expect(a.page.locator('#link-done')).toBeVisible();
  const url = (await a.page.locator('#link-url').textContent()).replace('https://omnibeam.site', 'http://localhost:3999');
  const noPin = await run(['get', url, '-o', '-'], { home }).done;
  expect(noPin.code).toBe(1);
  expect(noPin.err).toContain('needs a PIN');
  const withPin = await run(['get', url, '-o', '-', '--pin', '2468'], { home }).done;
  expect(withPin.code).toBe(0);
  expect(withPin.out).toBe('hello from the browser');
});

test('npx omnibeam link: standard input, and delete it early', async () => {
  const home = tmp();
  const made = await run(['link', '-', '--as', 'log.txt', '--json'], { home, input: 'line 1\nline 2\n' }).done;
  expect(made.code).toBe(0);
  const info = JSON.parse(made.out);
  const list = await run(['get', info.url, '--list'], { home }).done;
  expect(list.out).toBe('log.txt\t14\n');
  const del = await run(['unlink', info.id, '--token', info.token], { home }).done;
  expect(del.code).toBe(0);
  const gone = await run(['get', info.url], { home }).done;
  expect(gone.code).toBe(1);
});
