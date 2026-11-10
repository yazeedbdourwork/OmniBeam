// Messages only in the chat view (2026-11-07): every "Send message" opens the chat with that device; a message that
// arrives opens its chat by itself (with the message sound), or shows a small banner ("Name: first words · Open chat")
// when the person is busy; notifications open the chat; the history's message rows open the chat; Send again of a
// message puts it in the chat's box; Clear chat (with Undo); the message sound and its switches; the one-time offer to
// turn notifications on.
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const sendFrom = (page, to, text) => page.evaluate(([n, s]) => [...peers.values()].find((p) => p.info.name === n).sendText(s), [to, text]);
const busyInSettings = (page) => page.evaluate(() => document.getElementById('dlg-settings').showModal());
const closeSettings = (page) => page.evaluate(() => document.getElementById('dlg-settings').close());
// Counts the chimes: a fake AudioContext whose oscillators are counted (the real one makes no sound in tests anyway)
const countChimes = (page) => page.evaluate(() => {
  window.__tones = 0;
  const node = () => ({ connect: (x) => x || node(), gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: {}, start() {}, stop() {} });
  window.AudioContext = function () { this.state = 'running'; this.currentTime = 0; this.destination = {}; };
  window.AudioContext.prototype.createOscillator = () => { window.__tones++; return node(); };
  window.AudioContext.prototype.createGain = node;
  window.AudioContext.prototype.resume = () => Promise.resolve();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); // the tap that allows sound
});

test('every Send message opens the chat: card button, right-click, More… window', async ({ browser }) => {
  const a = await open(browser, 'Only A');
  const b = await open(browser, 'Only B');
  const target = await card(a.page, b.name);
  const chat = a.page.locator('#dlg-chat');
  await expect(a.page.locator('#dlg-send-text')).toHaveCount(0);
  await target.hover();
  await target.locator('[data-act=message]').click();
  await expect(chat).toBeVisible();
  await expect(chat.locator('#chat-title')).toHaveText(b.name);
  await chat.locator('[data-act=close]').click();
  await target.click({ button: 'right' });
  await expect(chat).toBeVisible();
  await chat.locator('[data-act=close]').click();
  await target.hover();
  await target.locator('[data-act=more]').click();
  await a.page.locator('#dlg-actions [data-act=message]').click();
  await expect(chat).toBeVisible();
  await expect(a.page.locator('#dlg-actions')).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('a message opens its chat by itself, with the message sound; none for what this device sends', async ({ browser }) => {
  const a = await open(browser, 'Pop A');
  const b = await open(browser, 'Pop B');
  await card(a.page, b.name);
  const cardA = await card(b.page, a.name);
  await countChimes(a.page);
  await countChimes(b.page);
  await sendFrom(a.page, b.name, 'dinner at 8');
  const chat = b.page.locator('#dlg-chat');
  await expect(chat.locator('#chat-title')).toHaveText(a.name);
  await expect(chat.locator('.bubble.in .msg-text')).toHaveText('dinner at 8');
  await expect(b.page.locator('#msg-banner.show')).toHaveCount(0);
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  expect(await b.page.evaluate(() => window.__tones)).toBe(2); // the two notes of one chime
  expect(await a.page.evaluate(() => window.__tones)).toBe(0); // the sender hears nothing
  // Another message while the chat is open: a bubble and the sound again
  await sendFrom(a.page, b.name, 'bring the charger');
  await expect(chat.locator('.bubble.in')).toHaveCount(2);
  expect(await b.page.evaluate(() => window.__tones)).toBe(4);
  // Muted from the speaker in the chat's head: no sound, and Settings shows it off too
  await chat.locator('[data-act=sound]').click();
  await expect(chat.locator('[data-act=sound]')).toHaveAttribute('aria-pressed', 'false');
  await sendFrom(a.page, b.name, 'quiet please');
  await expect(chat.locator('.bubble.in')).toHaveCount(3);
  expect(await b.page.evaluate(() => window.__tones)).toBe(4);
  expect(await b.page.evaluate(() => [msgSound, localStorage.getItem('omnibeam-msg-sound'), document.getElementById('msg-sound').checked])).toEqual([false, 'off', false]);
  // On again from Settings (it plays the chime once to show it)
  await chat.locator('[data-act=close]').click();
  await b.page.evaluate(() => { const box = document.getElementById('msg-sound'); box.checked = true; box.dispatchEvent(new Event('change')); });
  expect(await b.page.evaluate(() => [msgSound, window.__tones])).toEqual([true, 6]);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('busy: another window, typing, or another chat open -> banner instead; tapping it opens the chat', async ({ browser }) => {
  const a = await open(browser, 'Busy A');
  const b = await open(browser, 'Busy B');
  const c = await open(browser, 'Busy C');
  await card(a.page, b.name);
  await card(c.page, b.name);
  const cardA = await card(b.page, a.name);
  await card(b.page, c.name);
  const banner = b.page.locator('#msg-banner.show');
  const chat = b.page.locator('#dlg-chat');
  // Settings is open: a banner over it (name, first words shortened, Open chat), the card counts it
  await busyInSettings(b.page);
  const long = 'This is a rather long message that goes well past sixty characters, so the banner shortens it';
  await sendFrom(a.page, b.name, long);
  await expect(banner.locator('b')).toHaveText('Busy A:');
  const shown = await banner.locator('.msg-banner-text').textContent();
  expect(shown.endsWith('…')).toBe(true);
  expect(shown.length).toBeLessThanOrEqual(61);
  await expect(banner.locator('.msg-banner-act')).toHaveText('· Open chat');
  await expect(chat).toBeHidden();
  await expect(b.page.locator('#dlg-text')).toBeHidden();
  await expect(cardA.locator('.chat-badge')).toHaveText('1');
  expect((await banner.boundingBox()).y).toBeLessThan(60);
  await banner.locator('.msg-banner-open').click();
  await expect(chat.locator('#chat-title')).toHaveText(a.name);
  await expect(chat.locator('.bubble.in .msg-text')).toHaveText(long);
  await expect(b.page.locator('#msg-banner.show')).toHaveCount(0);
  await expect(cardA.locator('.chat-badge')).toHaveCount(0);
  // The chat with A stays open when C writes: a banner for C, A's chat is kept
  await sendFrom(c.page, b.name, 'hello from C');
  await expect(banner).toContainText('Busy C:');
  await expect(chat.locator('#chat-title')).toHaveText(a.name);
  await banner.locator('.msg-banner-open').click();
  await expect(chat.locator('#chat-title')).toHaveText(c.name);
  await expect(chat.locator('.bubble.in')).toContainText('hello from C');
  await chat.locator('[data-act=close]').click();
  await closeSettings(b.page);
  // Typing somewhere on the page (a text box with text in it): a banner, the typing is not interrupted
  await b.page.evaluate(() => { const i = document.createElement('input'); i.id = 'typing-test'; document.body.appendChild(i); i.focus(); i.value = 'half a sentence'; });
  await sendFrom(a.page, b.name, 'while typing');
  await expect(banner).toContainText('while typing');
  await expect(chat).toBeHidden();
  expect(await b.page.evaluate(() => document.activeElement.id)).toBe('typing-test');
  // The x closes the banner without opening anything
  await banner.locator('.msg-banner-x').click();
  await expect(b.page.locator('#msg-banner.show')).toHaveCount(0);
  await expect(chat).toBeHidden();
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('notifications: while hidden, or busy on screen; clicking one opens the chat; ?chat= opens it in a new tab', async ({ browser }) => {
  const a = await open(browser, 'Note A');
  const b = await open(browser, 'Note B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await b.page.evaluate(() => {
    window.__notes = [];
    window.Notification = function (title, opts) { window.__notes.push({ title, opts }); this.close = () => {}; window.__last = this; };
    window.Notification.permission = 'granted';
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
  });
  // On screen and not busy: the chat opens, no notification needed
  await sendFrom(a.page, b.name, 'first');
  await expect(b.page.locator('#dlg-chat .bubble.in')).toContainText('first');
  expect(await b.page.evaluate(() => window.__notes.length)).toBe(0);
  await b.page.locator('#dlg-chat [data-act=close]').click();
  // On screen but busy (banner): a notification too, since the chat can't be seen
  await busyInSettings(b.page);
  await sendFrom(a.page, b.name, 'second');
  await expect.poll(() => b.page.evaluate(() => window.__notes.length)).toBe(1);
  await closeSettings(b.page);
  // In the background: a notification; clicking it brings the page back with that chat
  await b.page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await busyInSettings(b.page);
  await sendFrom(a.page, b.name, 'are you there?');
  await expect.poll(() => b.page.evaluate(() => window.__notes.length)).toBe(2);
  const note = await b.page.evaluate(() => window.__notes[1]);
  expect(note.title).toBe('Message from Note A');
  expect(note.opts.body).toBe('are you there?');
  await closeSettings(b.page);
  await b.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); window.__last.onclick(); });
  await expect(b.page.locator('#dlg-chat #chat-title')).toHaveText(a.name);
  await expect(b.page.locator('#dlg-chat .bubble.in').last()).toContainText('are you there?');
  // A new tab opened from a notification (/?chat=n:<name>) shows the chat too, and the address is cleaned up
  const c = await open(browser, 'Note C', { path: '/?chat=' + encodeURIComponent('n:Note A') });
  await expect(c.page.locator('#dlg-chat #chat-title')).toHaveText('Note A', { timeout: 10000 });
  expect(new URL(c.page.url()).search).toBe('');
});

test('the chat offers notifications once when they were never allowed or refused', async ({ browser }) => {
  const a = await open(browser, 'Offer A');
  const b = await open(browser, 'Offer B');
  await card(a.page, b.name);
  await b.page.evaluate(() => {
    window.__asked = 0;
    window.Notification = function () {};
    window.Notification.permission = 'default';
    window.Notification.requestPermission = () => { window.__asked++; window.Notification.permission = 'granted'; return Promise.resolve('granted'); };
  });
  // Not on page load: only in the chat
  expect(await b.page.evaluate(() => window.__asked)).toBe(0);
  await b.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), a.name);
  const offer = b.page.locator('#dlg-chat .chat-notif');
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Turn on notifications' }).click();
  await expect(offer).toBeHidden();
  expect(await b.page.evaluate(() => [window.__asked, Notification.permission])).toEqual([1, 'granted']);
  await expect(b.page.locator('#toast')).toContainText('Notifications are on');
  // Never again (answered), even if permission went back to "ask"
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await b.page.evaluate(() => { window.Notification.permission = 'default'; });
  await b.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), a.name);
  await expect(b.page.locator('#dlg-chat')).toBeVisible();
  await expect(offer).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('Clear chat: asks first, removes only that device\'s messages and files here, Undo brings them back', async ({ browser }) => {
  const a = await open(browser, 'Clear A');
  const b = await open(browser, 'Clear B');
  const c = await open(browser, 'Clear C');
  await card(a.page, b.name);
  await card(c.page, b.name);
  await card(b.page, a.name);
  await card(b.page, c.name);
  await sendFrom(a.page, b.name, 'from A one');
  const chat = b.page.locator('#dlg-chat');
  await expect(chat.locator('.bubble.in')).toHaveCount(1);
  await chat.locator('textarea').fill('reply to A');
  await chat.locator('[data-act=send]').click();
  await expect(chat.locator('.bubble.out')).toHaveCount(1);
  await chat.locator('[data-act=close]').click();
  await sendFrom(c.page, b.name, 'from C stays');
  await expect(chat.locator('#chat-title')).toHaveText(c.name);
  await chat.locator('[data-act=close]').click();
  // Clear the chat with A: the question names A; "Cancel" keeps everything
  await b.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), a.name);
  let question = '';
  let answer = false;
  b.page.on('dialog', async (d) => { question = d.message(); await (answer ? d.accept() : d.dismiss()); });
  await chat.locator('[data-act=clear]').click();
  await expect.poll(() => question).not.toBe('');
  expect(question).toBe('Clear this chat? Messages and file entries with Clear A are removed from this device only.');
  await expect(chat.locator('.bubble')).toHaveCount(2);
  answer = true;
  question = '';
  await chat.locator('[data-act=clear]').click();
  await expect.poll(() => question).not.toBe('');
  await expect(chat.locator('.bubble')).toHaveCount(0);
  await expect(chat.locator('.chat-empty')).toBeVisible();
  await expect(chat.locator('[data-act=clear]')).toBeDisabled();
  const undo = b.page.locator('#undo-toast.show');
  await expect(undo).toContainText('Chat with Clear A cleared');
  // C's chat and the other device are untouched
  expect(await b.page.evaluate(() => Messages.items.map((m) => m.text))).toEqual(['from C stays']);
  expect(await a.page.evaluate(() => Sent.items.map((e) => e.text))).toEqual(['from A one']);
  // Undo: everything is back, in order
  await undo.getByRole('button', { name: 'Undo' }).click();
  await expect(chat.locator('.bubble')).toHaveCount(2);
  await expect(chat.locator('.bubble').nth(0)).toContainText('from A one');
  await expect(chat.locator('.bubble').nth(1)).toContainText('reply to A');
  // Cleared again and left: after the Undo time it stays cleared, also after a reload
  answer = true;
  await chat.locator('[data-act=clear]').click();
  await expect(chat.locator('.bubble')).toHaveCount(0);
  await b.page.waitForTimeout(6800);
  await expect(b.page.locator('#undo-toast.show')).toHaveCount(0);
  await b.page.reload();
  expect(await b.page.evaluate(() => [Messages.items.map((m) => m.text), Sent.items.length])).toEqual([['from C stays'], 0]);
  expect(a.errors.concat(b.errors, c.errors)).toEqual([]);
});

test('history: message rows open the chat, Send again of a message puts it in the chat box', async ({ browser }) => {
  const a = await open(browser, 'Hist A');
  const b = await open(browser, 'Hist B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await sendFrom(a.page, b.name, 'from the history');
  await expect(b.page.locator('#dlg-chat .bubble.in')).toContainText('from the history');
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await b.page.locator('#btn-history').click();
  const hist = b.page.locator('#dlg-history');
  const row = hist.locator('.messages .item').first();
  await expect(row).toContainText('from the history');
  await row.getByRole('button', { name: 'Chat' }).click();
  await expect(hist).toBeHidden();
  await expect(b.page.locator('#dlg-chat #chat-title')).toHaveText(a.name);
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await b.page.locator('#btn-history').click();
  await hist.locator('.messages .item .msg-open').first().click();
  await expect(b.page.locator('#dlg-chat')).toBeVisible();
  await b.page.locator('#dlg-chat [data-act=close]').click();
  await a.page.locator('#btn-history').click();
  const histA = a.page.locator('#dlg-history');
  await histA.locator('[data-tab=sent]').click();
  await histA.locator('.sent-list .item').first().getByRole('button', { name: 'Send again' }).click();
  const chatA = a.page.locator('#dlg-chat');
  await expect(chatA).toBeVisible();
  await expect(chatA.locator('textarea')).toHaveValue('from the history');
  await expect(chatA.locator('.bubble.out')).toHaveCount(1);
  await chatA.locator('[data-act=send]').click();
  await expect(chatA.locator('.bubble.out')).toHaveCount(2);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('a chat opened again right after closing it keeps working (the late close event does not undo it)', async ({ browser }) => {
  const a = await open(browser, 'Race A');
  const b = await open(browser, 'Race B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await b.page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), a.name);
  const chat = b.page.locator('#dlg-chat');
  await expect(chat).toBeVisible();
  // Closed and opened again in the same moment (as when a message arrives just as the chat is closed)
  await b.page.evaluate(async (n) => {
    document.querySelector('#dlg-chat [data-act=close]').click();
    await openChat([...peers.values()].find((p) => p.info.name === n));
  }, a.name);
  await b.page.waitForTimeout(300);
  await expect(chat).toBeVisible();
  expect(await b.page.evaluate(() => window.Chat.open_)).toBe(true);
  await chat.locator('textarea').fill('still works');
  await chat.locator('[data-act=send]').click();
  await expect(chat.locator('.bubble.out')).toContainText('still works');
  await expect(a.page.locator('#dlg-chat .bubble.in')).toContainText('still works');
  expect(a.errors.concat(b.errors)).toEqual([]);
});
