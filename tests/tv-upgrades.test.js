// TV mode upgrades (tv.js): photo wall, remote keys everywhere, video controls, slideshow settings, the phone as a
// remote, messages and links on screen, music, iPhone (HEIC) photos, photos kept after a reload, Clear photos, and
// the clock screen saver.
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');
// 14 seconds of blue, 32x24 (VP8)
const WEBM = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAR+EU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggRo7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEDLWAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYiBnTCtiTIPuJyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhB3NZQDgibCBILqBGJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYiBnTCtiTIPuGfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MTQuMDAwMDAwMDAwAB9DtnVBKOeBAKO9gQAAgNACAJ0BKiAAGAAARwiFhYiFhIgCAgJ1qgP4AgghCD0A/v9NEv/8WFfxYV/FhX/xYV/8/M7txfzmAKOVgQH0ALEBAAEQEAAYABhYL/QACHAAo5WBA+gAsQEAARAQABgAGFgv9AAIcACjlYEF3ACxAQABEBAAGAAYWC/0AAhwAKOVgQfQALEBAAEQEAAYABhYL/QACHAAo5WBCcQAsQEAARAQABgAGFgv9AAIcACjlYELuACxAQABEBAAGAAYWC/0AAhwAKOVgQ2sALEBAAEQEBRgAGFgv9AAIcAAo5WBD6AAsQEAARAQABgAGFgv9AAIcACjlYERlACxAQABEBAAGAAYWC/0AAhwAKOVgROIALEBAAEQEAAYABhYL/QACHAAH0O2dUEB54IVfKOVgQAAALEBAAEQEAAYABhYL/QACHAAo5WBAfQAsQEAARAQABgAGFgv9AAIcACjlYED6ACxAQABEBAAGAAYWC/0AAhwAKOVgQXcALEBAAEQEAAYABhYL/QACHAAo5WBB9AAsQEAARAQABgAGFgv9AAIcACjlYEJxACxAQABEBAAGAAYWC/0AAhwAKOVgQu4ALEBAAEQEAAYABhYL/QACHAAo5WBDawAsQEAARAQFGAAYWC/0AAhwACjlYEPoACxAQABEBAAGAAYWC/0AAhwAKOVgRGUALEBAAEQEAAYABhYL/QACHAAo5WBE4gAsQEAARAQABgAGFgv9AAIcAAfQ7Z1QI7ngir4o5WBAAAAsQEAARAQABgAGFgv9AAIcACjlYEB9ACxAQABEBAAGAAYWC/0AAhwAKOVgQPoALEBAAEQEAAYABhYL/QACHAAo5WBBdwAsQEAARAQABgAGFgv9AAIcACjlYEH0ACxAQABEBAAGAAYWC/0AAhwAKOVgQnEALEBAAEQEAAYABhYL/QACHAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==', 'base64');
// A 64x48 iPhone-style photo (HEIC): Chromium can't show it
const HEIC = Buffer.from('AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAX1tZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABoQABAAAAAAAAAB4AAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA/WlwcnAAAADdaXBjbwAAAHZodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQAqQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbq5Ka5uAhoMCAAAAMDIAAAAwAhYgABAAZEAcFzwIkAAAATY29scm5jbHgAAQANAAaAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xhcAAAAEAAAAABAAAAMAAAAAEAAAAAAAAAAv////AAAAACAAAAEHBpeGkAAAAAAwgICAAAABhpcG1hAAAAAAAAAAEAAQWBAgMFhAAAACZtZGF0AAAAGigBrwngOSMkv//6Mb//+EaeQ/a5hrVjqdz8', 'base64');
// 3 seconds of a quiet tone (WAV)
function wav(seconds = 3, rate = 8000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(20 * Math.sin(i / 8));
  return b;
}

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

async function pairedTv(browser, name) {
  const tv = await open(browser, name, { path: '/tv' });
  await expect(tv.page.locator('#tv-qr svg')).toBeVisible();
  const link = await tv.page.locator('#tv-qr').getAttribute('data-link');
  const phone = await open(browser, 'Phone', { path: link.replace(/^http:\/\/localhost:\d+/, '') });
  await expect(phone.page.locator('#toast')).toContainText(`Paired with ${name}`, { timeout: 15000 });
  return { tv, phone, p: tv.page };
}
async function sendFiles(phone, files, name) {
  const target = await card(phone.page, name);
  const chooser = phone.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles(files);
}

test('TV: photo wall, remote keys, video controls, music, HEIC card, settings, kept after a reload, Clear photos', async ({ browser }) => {
  const { tv, phone, p } = await pairedTv(browser, 'Den TV 1');
  await sendFiles(phone, [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
    { name: 'clip.webm', mimeType: 'video/webm', buffer: WEBM },
    { name: 'IMG_0001.heic', mimeType: 'image/heic', buffer: HEIC },
    { name: 'Morning song.wav', mimeType: 'audio/wav', buffer: wav() },
  ], 'Den TV 1');
  await expect(p.locator('#tv-show')).toBeVisible({ timeout: 30000 });
  await expect(p.locator('#tv-caption')).toHaveText('1 / 4 · from Phone');
  // Music plays in the background, shown in the slideshow and on the home screen
  await expect(p.locator('#tv-song')).toContainText('Morning song');
  // ▼ next, the video: its bar, ◀ ▶ skip 10 s
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowDown');
  await expect(p.locator('#tv-caption')).toContainText('3 / 4');
  await expect(p.locator('#tv-stage video')).toHaveCount(1);
  await expect(p.locator('#tv-bar')).toBeVisible();
  await expect(p.locator('#tv-hint')).toContainText('skip 10 s');
  await p.keyboard.press('Enter'); // (sound on, if the browser started it muted) or pause
  if (!(await p.locator('#tv-caption').textContent()).includes('Paused')) await p.keyboard.press('Enter');
  await expect(p.locator('#tv-caption')).toContainText('Paused');
  await p.keyboard.press('ArrowRight');
  expect(await p.locator('#tv-stage video').evaluate((v) => v.currentTime)).toBeGreaterThan(9);
  await expect(p.locator('.tv-bar-time')).toContainText('0:1');
  await p.keyboard.press('ArrowLeft');
  expect(await p.locator('#tv-stage video').evaluate((v) => v.currentTime)).toBeLessThan(2);
  // The HEIC photo: this browser can't read it, so the slide says how to send it
  await p.keyboard.press('ArrowDown');
  await expect(p.locator('#tv-stage .tv-heic')).toContainText('HEIC');

  // Back: the photo wall; arrows move between the tiles, OK opens one
  await p.keyboard.press('Escape');
  await expect(p.locator('#tv-wall')).toBeVisible();
  await expect(p.locator('#tv-grid .tv-tile')).toHaveCount(4);
  await expect(p.locator('#tv-grid [data-i="3"]')).toBeFocused();
  await p.keyboard.press('ArrowLeft');
  await expect(p.locator('#tv-grid [data-i="2"]')).toBeFocused();
  await expect(p.locator('#tv-grid [data-i="0"] img')).toHaveCount(1); // a small picture of the photo
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('Enter');
  await expect(p.locator('#tv-caption')).toContainText('2 / 4');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await expect(p.locator('#tv-wall')).toBeHidden();
  await expect(p.locator('#tv-music')).toBeVisible();
  await expect(p.locator('#tv-music b')).toHaveText('Morning song');

  // Home: arrows move between the buttons
  await expect(p.locator('#tv-photos')).toBeVisible();
  await p.locator('#tv-photos').focus();
  await p.keyboard.press('ArrowRight');
  await expect(p.locator('#tv-wall-btn')).toBeFocused();
  // Slideshow settings, with the remote
  await p.locator('#tv-set-btn').click();
  await expect(p.locator('#dlg-tv-set')).toBeVisible();
  await expect(p.locator('#dlg-tv-set [data-k=speed][data-v="8"]')).toBeFocused();
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('Enter');
  await expect(p.locator('#dlg-tv-set [data-k=speed][data-v="15"]')).toHaveAttribute('aria-pressed', 'true');
  await p.locator('#dlg-tv-set [data-k=order][data-v=shuffle]').click();
  await p.locator('#dlg-tv-set [data-k=zoom][data-v="1"]').click();
  await p.locator('#dlg-tv-set [data-act=close]').click();
  expect(JSON.parse(await p.evaluate(() => localStorage.getItem('omnibeam-tv-show')))).toMatchObject({ speed: 15, order: 'shuffle', zoom: true });

  // A reload: the photos and the song are still there
  await p.reload();
  await expect(p.locator('#tv-photos')).toHaveText('Show photos (4)', { timeout: 15000 });
  await expect(p.locator('#tv-music b')).toHaveText('Morning song');
  // Clear photos removes them, for good
  p.once('dialog', (d) => d.accept());
  await p.locator('#tv-clear').click();
  await expect(p.locator('#tv-photos')).toBeHidden();
  await expect(p.locator('#tv-music')).toBeHidden();
  await p.reload();
  await expect(p.locator('#tv-qr svg')).toBeVisible();
  await p.waitForTimeout(1500);
  await expect(p.locator('#tv-photos')).toBeHidden();
  expect(tv.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('TV: the phone is the remote, messages and links show big, the clock screen saver', async ({ browser }) => {
  const { tv, phone, p } = await pairedTv(browser, 'Den TV 2');
  // The TV tells the paired phone it is a TV: its card offers the remote
  const target = await card(phone.page, 'Den TV 2');
  await expect(target.locator('.tv-remote-chip')).toBeVisible({ timeout: 15000 });
  await sendFiles(phone, [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
    { name: 'c.png', mimeType: 'image/png', buffer: PNG },
  ], 'Den TV 2');
  await expect(p.locator('#tv-caption')).toHaveText('1 / 3 · from Phone', { timeout: 30000 });
  await target.locator('.tv-remote-chip').click();
  const remote = phone.page.locator('#dlg-tv-remote');
  await expect(remote).toBeVisible();
  await expect(remote.locator('.tv-remote-now')).toHaveText('Photo 1 / 3');
  await remote.locator('[data-cmd=next]').click();
  await expect(p.locator('#tv-caption')).toHaveText('2 / 3 · from Phone');
  await expect(remote.locator('.tv-remote-now')).toHaveText('Photo 2 / 3');
  await remote.locator('[data-cmd=pause]').click();
  await expect(p.locator('#tv-caption')).toHaveText('2 / 3 · from Phone · Paused');
  await expect(remote.locator('.tv-remote-now')).toHaveText('Photo 2 / 3 · Paused');
  await remote.locator('[data-cmd=wall]').click();
  await expect(p.locator('#tv-wall')).toBeVisible();
  await expect(remote.locator('.tv-remote-now')).toHaveText('Photo wall · 3');
  await remote.locator('[data-cmd=home]').click();
  await expect(p.locator('#tv-wall')).toBeHidden();
  await expect(remote.locator('.tv-remote-now')).toHaveText('The TV shows its QR code. 3 photos are ready.');
  await remote.locator('[data-act=close]').click();

  // A message: big on the TV (not the chat window); OK closes it
  await phone.page.evaluate(() => [...peers.values()].find((x) => x.info.name === 'Den TV 2').sendText('Dinner is ready!'));
  await expect(p.locator('#tv-note')).toBeVisible();
  await expect(p.locator('.tv-note-text')).toHaveText('Dinner is ready!');
  await expect(p.locator('#dlg-chat')).toHaveCount(0);
  await p.keyboard.press('Enter');
  await expect(p.locator('#tv-note')).toBeHidden();
  // A link: a QR code to open it on a phone
  await phone.page.evaluate(() => [...peers.values()].find((x) => x.info.name === 'Den TV 2').sendText('https://example.com/recipe'));
  await expect(p.locator('.tv-note-qr svg')).toBeVisible();
  await expect(p.locator('.tv-note-link')).toHaveText('https://example.com/recipe');
  await p.keyboard.press('Escape');
  await expect(p.locator('#tv-note')).toBeHidden();

  // The screen saver: after the quiet minutes on the home screen; it moves; any key only wakes the screen
  await p.evaluate(() => { Tv.lastActive -= 3 * 60000; });
  await expect(p.locator('#tv-saver')).toBeVisible({ timeout: 5000 });
  await expect(p.locator('.tv-saver-time')).toHaveText(/\d/);
  await expect(p.locator('.tv-saver-qr svg')).toBeVisible();
  const focused = await p.evaluate(() => document.activeElement.id);
  await p.keyboard.press('Enter');
  await expect(p.locator('#tv-saver')).toBeHidden();
  expect(await p.evaluate(() => document.activeElement.id)).toBe(focused);
  await expect(p.locator('#tv-show')).toBeHidden(); // the key didn't also press a button
  expect(tv.errors).toEqual([]);
  expect(phone.errors).toEqual([]);
});

test('TV: phones that are not paired and sent nothing can\'t work the remote', async ({ browser }) => {
  const tv = await open(browser, 'Den TV 3', { path: '/tv' });
  const other = await open(browser, 'Stranger');
  await card(other.page, 'Den TV 3');
  await tv.page.waitForFunction(() => [...peers.values()].some((x) => x.info.name === 'Stranger')); // (no cards on a TV)
  await other.page.evaluate(async () => {
    const peer = [...peers.values()].find((x) => x.info.name === 'Den TV 3');
    await peer.connect();
    peer.sendJson({ t: 'tv-cmd', cmd: 'wall' });
  });
  await tv.page.waitForTimeout(1500);
  expect(await tv.page.evaluate(() => Tv.remotes.size)).toBe(0);
  await expect(other.page.locator('.tv-remote-chip')).toHaveCount(0);
});
