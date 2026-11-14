// Move to a new phone and reply from the notification (2026-11-12):
// - Settings -> Device -> Save backup file: one encrypted file (App lock PIN asked first when the lock is on) with the
//   paired devices, settings, pinned notes and chats. Open backup file on another device puts them there (merged
//   with what it has), the pairing works right away, the App lock PIN comes along.
// - Notifications have buttons: Reply (typed right in the notification where the browser allows it) and Open chat on
//   a message, Open link and Reply on a link, Save and Open chat on received files, Stop on Ring my device. sw.js
//   passes them to the open page, which sends the reply, saves the files or stops the ringing.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu, settingsTab } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

function pairStorage(names) {
  const out = Object.fromEntries(names.map((n) => [n, []]));
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const secret = crypto.randomBytes(32).toString('hex');
    out[names[i]].push({ secret, name: names[j], at: Date.now(), seen: Date.now(), auto: false, trusted: true });
    out[names[j]].push({ secret, name: names[i], at: Date.now(), seen: Date.now(), auto: false, trusted: true });
  }
  return out;
}

test('Move to a new phone: save an encrypted backup file and open it on another device', async ({ browser }) => {
  const pairs = pairStorage(['Move Old', 'Move Friend']);
  const secret = pairs['Move Old'][0].secret;
  const pinKey = 'p:' + secret.slice(0, 16);
  const old = await open(browser, 'Move Old', { storage: {
    'omnibeam-paired': JSON.stringify(pairs['Move Old']),
    'omnibeam-pins': JSON.stringify({ [pinKey]: { text: 'wifi password: hunter2', at: Date.now() } }),
    'omnibeam-theme': 'dark',
    'omnibeam-messages': JSON.stringify([{ text: 'see you at 8', from: 'Move Friend', at: Date.now(), pair: secret.slice(0, 16) }]),
  } });
  // App lock on, so saving asks for its PIN first
  await old.page.evaluate(() => AppLock.setPin('2468'));
  await menu(old.page, 'btn-settings');
  await settingsTab(old.page, 'device');
  await expect(old.page.locator('#backup-section')).toContainText('Move to a new phone');
  await old.page.locator('#backup-save').click();
  const lock = old.page.locator('#dlg-lock');
  await expect(lock).toBeVisible();
  await expect(lock.locator('#lock-sub')).toHaveText('To save a backup file, type your PIN first.');
  await lock.locator('#lock-pin').fill('2468');
  await lock.locator('#lock-go').click();
  const dlg = old.page.locator('#dlg-backup');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#backup-title')).toHaveText('Save a backup file');
  await dlg.locator('#backup-a').fill('abc');
  await dlg.locator('#backup-go').click();
  await expect(dlg.locator('#backup-msg')).toHaveText('Use at least 4 characters.');
  await dlg.locator('#backup-a').fill('moving-day');
  await dlg.locator('#backup-b').fill('moving-dax');
  await dlg.locator('#backup-go').click();
  await expect(dlg.locator('#backup-msg')).toHaveText('The two are not the same.');
  await dlg.locator('#backup-b').fill('moving-day');
  const download = old.page.waitForEvent('download');
  await dlg.locator('#backup-go').click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^omnibeam-backup-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(dlg).toBeHidden();
  await expect(old.page.locator('#toast')).toContainText('Backup file saved, with 1 paired device(s).');
  const filePath = await d.path();
  const text = fs.readFileSync(filePath, 'utf8');
  // Encrypted: nothing private can be read from the file without its password
  const file = JSON.parse(text);
  expect(file.kind).toBe('omnibeam-backup');
  for (const s of [secret, 'hunter2', 'Move Friend', 'see you at 8', 'dark']) expect(text).not.toContain(s);

  // A file that isn't a backup
  const fresh = await open(browser, 'Move New');
  await menu(fresh.page, 'btn-settings');
  await settingsTab(fresh.page, 'device');
  let chooser = fresh.page.waitForEvent('filechooser');
  await fresh.page.locator('#backup-open').click();
  await (await chooser).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(fresh.page.locator('#toast')).toHaveText('This isn\'t an OmniBeam backup file.');
  // The backup: a wrong password first
  chooser = fresh.page.waitForEvent('filechooser');
  await fresh.page.locator('#backup-open').click();
  await (await chooser).setFiles(filePath);
  const odlg = fresh.page.locator('#dlg-backup');
  await expect(odlg.locator('#backup-title')).toHaveText('Open a backup file');
  await expect(odlg.locator('#backup-b')).toBeHidden();
  await odlg.locator('#backup-a').fill('wrong-one');
  await odlg.locator('#backup-go').click();
  await expect(odlg.locator('#backup-msg')).toHaveText('Wrong PIN or password, or the file is damaged.');
  await odlg.locator('#backup-a').fill('moving-day');
  const reloaded = fresh.page.waitForEvent('load');
  await odlg.locator('#backup-go').click();
  await expect(odlg.locator('#backup-msg')).toHaveText('Everything is back: 1 paired device(s). OmniBeam restarts now.');
  await reloaded;
  // The App lock PIN came along: the new device asks for it
  const flock = fresh.page.locator('#dlg-lock');
  await expect(flock).toBeVisible();
  await flock.locator('#lock-pin').fill('2468');
  await flock.locator('#lock-go').click();
  await expect(flock).toBeHidden();
  const got = await fresh.page.evaluate(() => ({
    paired: JSON.parse(localStorage.getItem('omnibeam-paired')),
    pins: JSON.parse(localStorage.getItem('omnibeam-pins')),
    theme: localStorage.getItem('omnibeam-theme'),
    messages: JSON.parse(localStorage.getItem('omnibeam-messages')),
    lock: JSON.parse(localStorage.getItem('omnibeam-lock')),
  }));
  expect(got.paired.map((p) => p.secret)).toEqual([secret]);
  expect(got.pins[pinKey].text).toBe('wifi password: hunter2');
  expect(got.theme).toBe('dark');
  expect(got.messages[0].text).toBe('see you at 8');
  expect(got.lock.bio).toBeUndefined();
  // The pairing works on the new device right away: the friend shows up as a paired (trusted) device
  await old.close();
  const friend = await open(browser, 'Move Friend', { storage: { 'omnibeam-paired': JSON.stringify(pairs['Move Friend']) } });
  await expect((await card(fresh.page, 'Move Friend')).locator('.tag')).toHaveText('Trusted');
  expect(fresh.errors.concat(friend.errors)).toEqual([]);
});

// Notifications are captured instead of shown (the test browser has no notification centre)
async function captureNotifications(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 20000 });
  await page.evaluate(() => {
    // Headless Chrome always says denied; as in upgrades.test.js
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    window.__notes = [];
    ServiceWorkerRegistration.prototype.showNotification = function (title, opts) { window.__notes.push({ title, ...opts }); return Promise.resolve(); };
  });
}
const swMessage = (page, data) => page.evaluate((data) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data })), data);

test('notifications have Reply / Open chat / Save / Stop buttons, and a reply from one is sent', async ({ browser }) => {
  const pairs = pairStorage(['Note A', 'Note B']);
  const a = await open(browser, 'Note A', { storage: { 'omnibeam-paired': JSON.stringify(pairs['Note A']) } });
  const b = await open(browser, 'Note B', { storage: { 'omnibeam-paired': JSON.stringify(pairs['Note B']) } });
  await card(a.page, b.name);
  await card(b.page, a.name);
  await captureNotifications(b.page);
  // B is busy (Settings open), so a message notifies instead of opening the chat
  await menu(b.page, 'btn-settings');
  await a.page.evaluate(() => [...peers.values()].find((p) => p.info.name === 'Note B').sendText('lunch at 1?'));
  await b.page.waitForFunction(() => window.__notes.length === 1);
  const note = (await b.page.evaluate(() => window.__notes))[0];
  expect(note.title).toBe('Message from Note A');
  expect(note.body).toBe('lunch at 1?');
  expect(note.actions.map((x) => x.action)).toEqual(['reply', 'open']);
  expect(note.actions[0]).toMatchObject({ type: 'text', title: 'Reply', placeholder: 'Type a reply…' });
  expect(note.data.chat).toBe('p:' + pairs['Note A'][0].secret.slice(0, 16));
  // The reply typed in the notification goes to A, without B opening anything
  await swMessage(b.page, { type: 'notif-reply', chat: note.data.chat, text: 'yes, see you there' });
  await a.page.waitForFunction(() => JSON.parse(localStorage.getItem('omnibeam-messages') || '[]').some((m) => m.text === 'yes, see you there'));
  expect(await b.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-sent') || '[]').some((e) => e.text === 'yes, see you there'))).toBe(true);
  // Reply where nothing can be typed in the notification: the chat opens, ready to type
  await b.page.locator('#dlg-settings').evaluate((d) => d.close());
  await swMessage(b.page, { type: 'open-chat', chat: note.data.chat, focus: true });
  await expect(b.page.locator('#dlg-chat')).toBeVisible();
  await expect(b.page.locator('#dlg-chat .chat-compose textarea')).toBeFocused();
  await b.page.locator('#dlg-chat [data-act=close]').click();
  // A link: Open link and Reply
  await menu(b.page, 'btn-settings');
  await b.page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  await a.page.evaluate(() => [...peers.values()].find((p) => p.info.name === 'Note B').sendText('https://example.com/menu'));
  await b.page.waitForFunction(() => window.__notes.length === 2);
  const link = (await b.page.evaluate(() => window.__notes))[1];
  expect(link.actions.map((x) => x.action)).toEqual(['link', 'reply']);
  expect(link.data.link).toBe('https://example.com/menu');
  await b.page.evaluate(() => { delete document.visibilityState; });
  await b.page.locator('#dlg-settings').evaluate((d) => d.close());
  // Received files (while the page is hidden): Save and Open chat; Save on it downloads them
  await b.page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await a.page.evaluate(() => { [...peers.values()].find((p) => p.info.name === 'Note B').sendFiles([new File(['menu for friday'], 'menu.txt', { type: 'text/plain' })]); });
  const ask = b.page.locator('#dlg-request [data-act=accept]');
  await ask.click();
  await expect(b.page.locator('#dlg-received')).toBeVisible();
  const files = await b.page.waitForFunction(() => window.__notes.find((n) => n.title === 'Received files from Note A'));
  expect((await files.jsonValue()).actions.map((x) => x.action)).toEqual(['save', 'open']);
  await b.page.evaluate(() => { delete document.hidden; });
  const download = b.page.waitForEvent('download');
  await swMessage(b.page, { type: 'save-files', chat: note.data.chat });
  expect((await download).suggestedFilename()).toBe('menu.txt');
  await expect(b.page.locator('#dlg-received')).toBeHidden();
  // Ring my device: Stop on the notification stops it, and A hears it was found
  await a.page.evaluate(() => ringDevice([...peers.values()].find((p) => p.info.name === 'Note B')));
  await expect(b.page.locator('#dlg-ring')).toBeVisible();
  const ring = await b.page.waitForFunction(() => window.__notes.find((n) => /is ringing this device/.test(n.title)));
  expect((await ring.jsonValue()).actions.map((x) => x.action)).toEqual(['stop']);
  await swMessage(b.page, { type: 'ring-stop' });
  await expect(b.page.locator('#dlg-ring')).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('App lock on: notifications offer no Reply or Save, and a reply is not sent', async ({ browser }) => {
  const pairs = pairStorage(['Shut A', 'Shut B']);
  const a = await open(browser, 'Shut A', { storage: { 'omnibeam-paired': JSON.stringify(pairs['Shut A']) } });
  const b = await open(browser, 'Shut B', { storage: { 'omnibeam-paired': JSON.stringify(pairs['Shut B']) } });
  await card(a.page, b.name);
  await card(b.page, a.name);
  await captureNotifications(b.page);
  await b.page.evaluate(async () => { await AppLock.setPin('1357'); AppLock.lock(); });
  await a.page.evaluate(() => [...peers.values()].find((p) => p.info.name === 'Shut B').sendText('private words'));
  await b.page.waitForFunction(() => window.__notes.length === 1);
  const note = (await b.page.evaluate(() => window.__notes))[0];
  expect(note.body).toBe('Open OmniBeam to see it.');
  expect(note.actions.map((x) => x.action)).toEqual(['open']);
  await swMessage(b.page, { type: 'notif-reply', chat: note.data.chat, text: 'should not go' });
  await b.page.waitForTimeout(800);
  expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-messages') || '[]').some((m) => m.text === 'should not go'))).toBe(false);
});

// sw.js itself: what each button on the notification does, with a pretend browser around it
test('sw.js: notification buttons go to the open tab, or open OmniBeam with the reply kept', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
  const run = async (event, { tab = true, answers = true, others = [] } = {}) => {
    const listeners = {};
    const posted = [];
    const opened = [];
    const kept = [];
    let focused = false;
    // The app tab answers a reply on the port sw.js sends with it (a paused tab doesn't)
    const client = { url: 'https://omnibeam.site/', postMessage: (m, ports) => { posted.push(m); if (answers && ports?.[0]) ports[0].postMessage('ok'); }, focus: () => { focused = true; } };
    const other = (u) => ({ url: u, postMessage: (m) => posted.push({ wrongTab: u, ...m }), focus: () => {} });
    const self = {
      location: { origin: 'https://omnibeam.site' },
      registration: { scope: 'https://omnibeam.site/' },
      addEventListener: (type, fn) => { listeners[type] = fn; },
      clients: { matchAll: async () => [...others.map(other), ...(tab ? [client] : [])], openWindow: async (u) => { opened.push(u); } },
    };
    // A small IndexedDB: enough for saveReply
    const indexedDB = { open: () => {
      const r = {};
      const db = { transaction: () => { const tx = { objectStore: () => ({ put: (v, k) => { kept.push([k, v]); setTimeout(() => tx.oncomplete()); } }) }; return tx; }, close() {} };
      setTimeout(() => { r.result = db; r.onsuccess(); });
      return r;
    } };
    vm.runInNewContext(src, { self, caches: {}, fetch: () => {}, indexedDB, URL, Response: function () {}, setTimeout, clearTimeout, MessageChannel, console });
    let done;
    listeners.notificationclick({ ...event, notification: { close() {}, data: event.data }, waitUntil: (p) => { done = p; } });
    await done;
    return { posted, opened, kept, focused };
  };
  const data = { chat: 'p:0123456789abcdef', url: '/?chat=p%3A0123456789abcdef' };
  let r = await run({ action: 'reply', reply: '  on my way  ', data });
  expect(r.posted).toEqual([{ type: 'notif-reply', chat: data.chat, text: 'on my way' }]);
  expect(r.focused).toBe(false);
  // A paused tab (a phone with OmniBeam in the background): no answer, so OmniBeam comes to the front and sends it
  r = await run({ action: 'reply', reply: 'on my way', data }, { answers: false });
  expect(r.posted).toEqual([{ type: 'notif-reply', chat: data.chat, text: 'on my way' }]);
  expect(r.focused).toBe(true);
  // The app's tab, not an open /admin or guide page
  r = await run({ action: 'reply', reply: 'on my way', data }, { others: ['https://omnibeam.site/admin', 'https://omnibeam.site/guide/send-files'] });
  expect(r.posted).toEqual([{ type: 'notif-reply', chat: data.chat, text: 'on my way' }]);
  r = await run({ action: 'reply', reply: 'on my way', data }, { tab: false });
  expect(r.kept[0][0]).toBe('reply');
  expect(r.kept[0][1]).toMatchObject({ chat: data.chat, text: 'on my way' });
  expect(r.opened).toEqual(['https://omnibeam.site/?chat=p%3A0123456789abcdef']);
  // No typing in the notification: the chat, ready to type
  r = await run({ action: 'reply', data });
  expect(r.posted).toEqual([{ type: 'open-chat', chat: data.chat, focus: true }]);
  expect(r.focused).toBe(true);
  r = await run({ action: 'reply', data }, { tab: false });
  expect(r.opened).toEqual(['https://omnibeam.site/?chat=p%3A0123456789abcdef&reply=1']);
  r = await run({ action: 'stop', data });
  expect(r.posted).toEqual([{ type: 'ring-stop' }]);
  expect(r.focused).toBe(false);
  r = await run({ action: 'save', data });
  expect(r.posted).toEqual([{ type: 'save-files', chat: data.chat }]);
  expect(r.focused).toBe(true);
  r = await run({ action: 'link', data: { ...data, link: 'https://example.com/x' } });
  expect(r.opened).toEqual(['https://example.com/x']);
  // Reply on a link's notification is a reply, not the link
  r = await run({ action: 'reply', reply: 'thanks', data: { ...data, link: 'https://example.com/x' } });
  expect(r.posted).toEqual([{ type: 'notif-reply', chat: data.chat, text: 'thanks' }]);
  r = await run({ action: '', data });
  expect(r.posted).toEqual([{ type: 'open-chat', chat: data.chat, focus: false }]);
});
