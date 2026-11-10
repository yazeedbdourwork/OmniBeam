// An iPhone's screen locks in the middle of a transfer, the way it really happens: the page is told it is hidden, then
// it is frozen (no code runs at all, like Safari on a locked iPhone), its direct connection is closed and the server
// stops hearing from it, as iOS cuts its connections. 20 seconds later the screen is back. The transfer must then
// continue by itself, without anyone tapping anything, and the file must arrive byte for byte.
// Covers the phone receiving and sending, direct and through the server, and a phone whose page was reloaded
// after waking (Safari often throws away pages that were in the background).
// The seconds from waking to the transfer moving again are written to tests/.results/screen-lock.json.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card, makeFile, sha } = require('./helpers');

const LOCKED_MS = Number(process.env.LOCKED_MS) || 20000;
const SIZE = 40 * 1024 * 1024 + 77;
const RESULTS = path.join(__dirname, '.results', 'screen-lock.json');

let a, b;
test.afterEach(async () => {
  for (const d of [a, b]) if (d) await d.close();
  a = b = null;
});
test.setTimeout(180000);

async function setHidden(page, hidden) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

// A device that counts the file bytes it receives (window.rxBytes)
async function device(browser, name, relayOnly) {
  const d = await openDevice(browser, name, { relayOnly });
  await d.page.evaluate(() => {
    window.rxBytes = 0;
    const onChunk = Peer.prototype.onChunk;
    Peer.prototype.onChunk = function (buf) { if (this.incoming) window.rxBytes += buf.byteLength; return onChunk.call(this, buf); };
    // Here the transfer would be over before the screen can turn off: a little slower, like a phone
    const wait = Peer.prototype.waitForBuffer;
    Peer.prototype.waitForBuffer = async function () { await sleep(this.direct ? 8 : 20); return wait.call(this); };
  });
  return d;
}
// The phone: an iPhone as far as the page knows
async function phone(browser, name, relayOnly) {
  const d = await device(browser, name, relayOnly);
  await d.page.evaluate(() => { isPhone = true; freezesHidden = true; });
  return d;
}

// The receiver has this many file bytes so far
const rx = (d) => d.page.evaluate(() => window.rxBytes);

async function startSend(from, to, file) {
  const target = await card(from.page, to.name);
  const chooser = from.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([file]);
  await to.page.locator('#dlg-request [data-act=accept]').click();
}

// The screen of `ph` turns off for LOCKED_MS. mode: how the server loses it (close: at once; mute: it goes silent
// and the server only notices with its next check). reload: the page is thrown away and opened again on waking.
// freeze: false leaves the page running while hidden (an iPhone that takes a moment to stop it, or an Android phone)
async function lock(ph, other, { mode = 'mute', reload = false, freeze = true } = {}) {
  await setHidden(ph.page, true);
  await ph.page.waitForTimeout(300); // Safari lets the page run for a moment before pausing it
  await ph.page.evaluate(() => { for (const p of peers.values()) p.pc?.close(); });
  const r = await ph.page.request.post(`/__test/socket?mode=${mode}&name=${encodeURIComponent(ph.name)}`);
  expect((await r.json()).n).toBe(1);
  // Frozen: no code runs on the page at all; what arrives meanwhile waits until it runs again. (Chromium won't
  // freeze a page with an open WebSocket through Page.setWebLifecycleState, so the debugger pauses it instead.)
  const cdp = await ph.context.newCDPSession(ph.page);
  await cdp.send('Debugger.enable');
  if (freeze) await cdp.send('Debugger.pause');
  await other.page.waitForTimeout(LOCKED_MS);
  const woke = Date.now();
  if (reload) {
    // Safari threw the page away: on waking it is loaded again (same browser, so the same storage)
    await ph.page.close({ runBeforeUnload: false });
    ph.page = await ph.context.newPage();
    ph.page.on('pageerror', (e) => ph.errors.push(e.message));
    await ph.page.goto('/');
    await expect(ph.page.locator('#me-name')).toHaveText(ph.name);
    await ph.page.evaluate(() => { isPhone = true; freezesHidden = true; });
  } else {
    if (freeze) await cdp.send('Debugger.resume');
    await cdp.detach();
    await setHidden(ph.page, false);
  }
  return woke;
}

// Seconds from waking until the receiver got 2 MB more of the file
async function resumeSeconds(receiver, woke) {
  const before = await rx(receiver);
  const page = receiver.page;
  await expect.poll(async () => (await page.evaluate(() => window.rxBytes)) - before, { timeout: 60000, intervals: [100] }).toBeGreaterThan(2 * 1024 * 1024);
  return (Date.now() - woke) / 1000;
}

async function received(receiver, file) {
  const got = receiver.page.locator('#dlg-received');
  await expect(got).toBeVisible({ timeout: 120000 });
  // Nobody had to accept it a second time
  await expect(receiver.page.locator('#dlg-request')).toBeHidden();
  await expect(got.locator('.info .muted.intact')).toHaveCount(1);
  const download = receiver.page.waitForEvent('download');
  await got.locator('[data-act=save-all]').click();
  expect(sha(fs.readFileSync(await (await download).path()))).toBe(sha(file.buffer));
}

function note(name, seconds) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(RESULTS, 'utf8')); } catch {}
  all[name] = { seconds: Math.round(seconds * 10) / 10, lockedMs: LOCKED_MS, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify(all, null, 2));
  console.log(`${name}: transfer moving again ${seconds.toFixed(1)} s after the screen came back`);
}

for (const relay of [false, true]) {
  const how = relay ? 'through the server' : 'direct';

  test(`phone receiving ${how}: continues by itself after the screen was off`, async ({ browser }) => {
    a = await device(browser, 'Test Laptop', relay);
    b = await phone(browser, 'Test Phone', relay);
    const file = makeFile('clip.mov', SIZE, 'video/quicktime');
    await startSend(a, b, file);
    await expect.poll(() => rx(b), { timeout: 60000 }).toBeGreaterThan(4 * 1024 * 1024);
    const woke = await lock(b, a, { mode: relay ? 'close' : 'mute' });
    note(`phone receiving, ${how}`, await resumeSeconds(b, woke));
    await received(b, file);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });

  test(`phone sending ${how}: continues by itself after the screen was off`, async ({ browser }) => {
    a = await device(browser, 'Test Laptop', relay);
    b = await phone(browser, 'Test Phone', relay);
    const file = makeFile('clip.mov', SIZE, 'video/quicktime');
    await startSend(b, a, file);
    await expect.poll(() => rx(a), { timeout: 60000 }).toBeGreaterThan(4 * 1024 * 1024);
    const woke = await lock(b, a, { mode: relay ? 'mute' : 'close' });
    note(`phone sending, ${how}`, await resumeSeconds(a, woke));
    await received(a, file);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}

// The server cuts the phone's connection while its page still runs in the background: it reconnects while hidden
for (const sending of [false, true]) {
  test(`phone ${sending ? 'sending direct' : 'receiving through the server'}, connection cut while its page still runs: continues after waking`, async ({ browser }) => {
    a = await device(browser, 'Test Laptop', !sending);
    b = await phone(browser, 'Test Phone', !sending);
    const file = makeFile('clip.mov', SIZE, 'video/quicktime');
    if (sending) await startSend(b, a, file); else await startSend(a, b, file);
    const receiver = sending ? a : b;
    await expect.poll(() => rx(receiver), { timeout: 60000 }).toBeGreaterThan(4 * 1024 * 1024);
    const woke = await lock(b, a, { mode: 'close', freeze: false });
    note(`phone ${sending ? 'sending direct' : 'receiving through the server'}, page not frozen`, await resumeSeconds(receiver, woke));
    await received(receiver, file);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  });
}

test('phone receiving, its page reloaded after waking: continues where it stopped', async ({ browser }) => {
  a = await device(browser, 'Test Laptop', true);
  b = await phone(browser, 'Test Phone', true);
  const file = makeFile('clip.mov', SIZE, 'video/quicktime');
  await startSend(a, b, file);
  await expect.poll(() => rx(b), { timeout: 60000 }).toBeGreaterThan(12 * 1024 * 1024);
  const had = await rx(b);
  const woke = await lock(b, a, { reload: true });
  await b.page.evaluate(() => {
    window.rxBytes = 0;
    const onChunk = Peer.prototype.onChunk;
    Peer.prototype.onChunk = function (buf) { if (this.incoming) window.rxBytes += buf.byteLength; return onChunk.call(this, buf); };
  });
  note('phone receiving, page reloaded', await resumeSeconds(b, woke));
  await received(b, file);
  // It continued from what was saved before the screen turned off, not from the start
  expect(await rx(b)).toBeLessThan(SIZE - had + 2 * 1024 * 1024);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('phone sending, its page reloaded after waking: picking the files again continues where it stopped', async ({ browser }) => {
  a = await device(browser, 'Test Laptop', false);
  b = await phone(browser, 'Test Phone', false);
  const file = makeFile('clip.mov', SIZE, 'video/quicktime');
  await startSend(b, a, file);
  await expect.poll(() => rx(a), { timeout: 60000 }).toBeGreaterThan(12 * 1024 * 1024);
  await lock(b, a, { mode: 'mute', reload: true });
  // The files are gone with the page: it says what happened and how to continue
  const banner = b.page.locator('#resume-banner');
  await expect(banner).toBeVisible({ timeout: 30000 });
  await expect(banner).toContainText('The transfer to Test Laptop stopped when the screen turned off');
  const had = await rx(a);
  await card(b.page, a.name);
  const chooser = b.page.waitForEvent('filechooser');
  await banner.locator('[data-act=repick]').click();
  await (await chooser).setFiles([file]);
  await received(a, file);
  // Only the rest was sent
  expect((await rx(a)) - had).toBeLessThan(SIZE - 10 * 1024 * 1024);
  await expect(banner).toBeHidden();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('a phone without Wake Lock keeps its screen on with a tiny video, only while a transfer runs', async ({ browser }) => {
  a = await device(browser, 'Test Laptop', false);
  b = await openDevice(browser, 'Test Phone', { storage: {} });
  await b.context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => undefined }));
  await b.page.reload();
  await expect(b.page.locator('#me-name')).toHaveText('Test Phone');
  await b.page.evaluate(() => { isPhone = true; window.rxBytes = 0; });
  await b.page.mouse.click(5, 5); // a tap readies the video
  await startSend(a, b, makeFile('clip.mov', SIZE, 'video/quicktime'));
  await expect.poll(() => b.page.evaluate(() => KeepAwakeVideo.playing)).toBe(true);
  await expect.poll(() => b.page.evaluate(() => KeepAwakeVideo.el.currentTime), { timeout: 5000 }).toBeGreaterThan(0);
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 120000 });
  await expect.poll(() => b.page.evaluate(() => KeepAwakeVideo.playing)).toBe(false);
  expect(b.errors).toEqual([]);
});

test('the experimental screen-off sound plays only during transfers, titled on the lock screen', async ({ browser }) => {
  a = await device(browser, 'Test Laptop', false);
  b = await device(browser, 'Test Phone', false);
  await b.page.evaluate(() => { isPhone = true; BgAudio.set(true); });
  await b.page.mouse.click(5, 5);
  await startSend(a, b, makeFile('clip.mov', SIZE, 'video/quicktime'));
  await expect.poll(() => b.page.evaluate(() => BgAudio.playing)).toBe(true);
  expect(await b.page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('OmniBeam · Receiving 1 file(s)');
  // While it plays, the other device is not told to pause when the screen turns off
  await setHidden(b.page, true);
  await a.page.waitForTimeout(1500);
  expect(await a.page.evaluate(() => [...peers.values()][0].busy)).toBe(true);
  await setHidden(b.page, false);
  await expect(b.page.locator('#dlg-received')).toBeVisible({ timeout: 120000 });
  await expect.poll(() => b.page.evaluate(() => BgAudio.playing)).toBe(false);
  // Off by default
  const c = await openDevice(browser, 'Test Tablet');
  expect(await c.page.evaluate(() => BgAudio.on)).toBe(false);
  await c.close();
});

test('the screen-off texts are in every language', async () => {
  const keys = ['Paused: the screen of {name} turned off. It continues by itself when {name} is back.', 'Resuming…',
    'The transfer to {name} stopped when the screen turned off. Pick the same files again to continue where it stopped.',
    'The transfer to {name} stopped before it finished. Pick the same files again to continue where it stopped.',
    'Pick the files again',
    'Keep the screen on until this finishes. If it turns off, it continues when you are back (or try the screen-off option in Settings).',
    'Trying to keep going with the screen off (experimental). If it stops, it continues when you are back.',
    'Sending {n} file(s)', 'Receiving {n} file(s)', 'Screen off (iPhone)',
    'Plays a near-silent sound during transfers, which may keep Safari going while the screen is off. It pauses any music that is playing, and it may not work on every iPhone.',
    'Keep transfers going with the screen off (iPhone, experimental)'];
  const files = fs.readdirSync(path.join(__dirname, '..', 'public', 'lang'));
  expect(files.length).toBe(14);
  for (const f of files) {
    const lang = require(`../public/lang/${f}`);
    for (const k of keys) {
      expect(lang.strings[k], `${f}: ${k}`).toBeTruthy();
      for (const v of ['{name}', '{n}']) expect(lang.strings[k].includes(v), `${f}: ${k}`).toBe(k.includes(v));
    }
  }
});
