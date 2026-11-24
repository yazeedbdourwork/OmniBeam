// Messenger look for the chat (2026-11-24): ticks (✓ sent, ✓✓ arrived, blue ✓✓ read), "typing…", reactions and
// Reply shared with the other device, the message menu (react, Reply, Copy, Pin, Delete for me), the emoji panel, the
// round Send button (the paper clip while the box is empty), bubbles grouped with a tail on the last, big emoji, the
// link card, ↓ New messages when scrolled up, and the new words in all 15 languages.
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };
const chatWith = (page, name) => page.evaluate((n) => openChat([...peers.values()].find((p) => p.info.name === n)), name);

test('ticks, typing, reply with a quote, reactions both ways, menu, delete for me', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Msgr A');
  const b = await open(browser, 'Msgr B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  const chatB = b.page.locator('#dlg-chat');
  // The round button is the paper clip while the box is empty, Send once there is text
  await expect(chatA.locator('[data-act=send]')).toBeHidden();
  await expect(chatA.locator('[data-act=attach]')).toHaveClass(/round/);
  await chatA.locator('textarea').fill('hello there');
  await expect(chatA.locator('[data-act=send]')).toBeVisible();
  await chatA.locator('[data-act=send]').click();
  // B's chat opens by itself (on screen): A sees blue ticks (read)
  await expect(chatB.locator('.bubble.in .msg-text')).toHaveText('hello there');
  await expect(chatA.locator('.bubble.out .tick.r')).toHaveText('✓✓');
  // typing… on A while B types
  await chatB.locator('textarea').pressSequentially('ok');
  await expect(chatA.locator('.chat-state')).toHaveText('typing…');
  await expect(chatA.locator('.chat-typing')).toHaveCount(1);
  // B answers it with Reply from the menu: a quote on both sides
  await chatB.locator('textarea').fill('');
  await chatB.locator('.bubble.in').click({ button: 'right' });
  await chatB.locator('.chat-menu [data-menu=reply]').click();
  await expect(chatB.locator('.chat-replying')).toBeVisible();
  await chatB.locator('textarea').fill('sure!');
  await chatB.locator('[data-act=send]').click();
  await expect(chatB.locator('.chat-replying')).toBeHidden();
  await expect(chatB.locator('.bubble.out .chat-quote')).toContainText('hello there');
  await expect(chatB.locator('.bubble.out .chat-quote b')).toHaveText(a.name);
  await expect(chatA.locator('.bubble.in .chat-quote b')).toHaveText('You');
  await expect(chatA.locator('.bubble.in .chat-quote span')).toHaveText('hello there');
  await expect(chatA.locator('.chat-typing')).toHaveCount(0);
  // A reacts ❤️ to B's message: shown on both
  await chatA.locator('.bubble.in .bubble-more').click();
  await chatA.locator('.chat-menu [data-react="❤️"]').click();
  await expect(chatA.locator('.bubble.in .chat-react')).toContainText('❤️');
  await expect(chatB.locator('.bubble.out .chat-react')).toContainText('❤️');
  // The same again takes it away
  await chatA.locator('.bubble.in .bubble-more').click();
  await chatA.locator('.chat-menu [data-react="❤️"]').click();
  await expect(chatB.locator('.bubble.out .chat-react')).toHaveCount(0);
  // Esc closes the menu, not the chat
  await chatA.locator('.bubble.in .bubble-more').click();
  await expect(chatA.locator('.chat-menu')).toBeVisible();
  await a.page.keyboard.press('Escape');
  await expect(chatA.locator('.chat-menu')).toBeHidden();
  await expect(chatA).toBeVisible();
  // Delete for me: gone here only
  await chatA.locator('.bubble.in').click({ button: 'right' });
  await chatA.locator('.chat-menu [data-menu=delete]').click();
  await expect(chatA.locator('.bubble.in')).toHaveCount(0);
  await expect(chatB.locator('.bubble.out')).toHaveCount(1);
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('emoji panel, big emoji, grouped bubbles with one tail, link card, ↓ new messages', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Look A');
  const b = await open(browser, 'Look B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  await chatA.locator('[data-act=emoji]').click();
  await expect(chatA.locator('.chat-emoji')).toBeVisible();
  await chatA.locator('.chat-emoji [data-emoji="😂"]').click();
  await chatA.locator('.chat-emoji [data-emoji="👍"]').click();
  await expect(chatA.locator('textarea')).toHaveValue('😂👍');
  await chatA.locator('[data-act=send]').click();
  await expect(chatA.locator('.bubble.out.big-emoji')).toHaveCount(1);
  await chatA.locator('textarea').fill('see https://www.example.com/page?x=1 please');
  await chatA.locator('[data-act=send]').click();
  await chatA.locator('textarea').fill('third');
  await chatA.locator('[data-act=send]').click();
  await expect(chatA.locator('.bubble.out')).toHaveCount(3);
  // One group: the tail only on the last
  await expect(chatA.locator('.bubble.out.tail')).toHaveCount(1);
  await expect(chatA.locator('.bubble.out').last()).toHaveClass(/tail/);
  await expect(chatA.locator('.bubble.out .chat-link-card b')).toHaveText('example.com');
  // B gets many messages, scrolls up, one more comes: ↓ 1 new messages
  const chatB = b.page.locator('#dlg-chat');
  for (let i = 0; i < 14; i++) await a.page.evaluate(([n, i]) => [...peers.values()].find((p) => p.info.name === n).sendText('line ' + i + '\n.\n.'), [b.name, i]);
  await expect(chatB.locator('.bubble.in')).toHaveCount(17);
  await chatB.locator('.chat-thread').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await expect(chatB.locator('.chat-jump')).toBeVisible();
  await a.page.evaluate((n) => [...peers.values()].find((p) => p.info.name === n).sendText('newest'), b.name);
  await expect(chatB.locator('.chat-jump')).toHaveText('↓ 1 new messages');
  await chatB.locator('.chat-jump').click();
  await expect(chatB.locator('.chat-jump')).toBeHidden();
  expect(a.errors.concat(b.errors)).toEqual([]);
});

test('the new chat words are translated in all 15 languages', async () => {
  const keys = ['Delete for me', 'Message options', 'Reactions', 'Replying to {name}', 'Cancel reply', 'You', 'typing…', 'Emoji',
    'Delivered', 'Read', 'Sent', 'Reply', '{n} new messages', 'Go to the latest message', 'Deleted from this device',
    'Also delete it on {name} (asks there first)', '{name} deleted the chat too', '{name} kept the chat on that device', 'Asked {name} to delete this chat too',
    '{name} is offline. It is asked as soon as it opens OmniBeam (keep this page open).', '{name} cleared your chat', 'Keep it', 'Delete here'];
  for (const code of ['ar', 'de', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt', 'ru', 'tr', 'ur', 'zh']) {
    const pack = require(`../public/lang/${code}.js`);
    for (const k of keys) expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
  }
});

test('Clear chat on both devices: the other device asks first (Keep it / Delete here), the sender hears back', async ({ browser }) => {
  test.setTimeout(120000);
  const a = await open(browser, 'Both A');
  const b = await open(browser, 'Both B');
  await card(a.page, b.name);
  await card(b.page, a.name);
  await chatWith(a.page, b.name);
  const chatA = a.page.locator('#dlg-chat');
  const chatB = b.page.locator('#dlg-chat');
  await chatA.locator('textarea').fill('secret plans');
  await chatA.locator('[data-act=send]').click();
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  // A clears with "Also delete it on B": B is asked, and keeps it the first time
  const clearBoth = async () => {
    await chatA.locator('[data-act=head-more]').click();
    await chatA.locator('[data-act=clear]').click();
    const ask = a.page.locator('#dlg-chat-clear');
    await expect(ask.locator('.chat-clear-both')).toContainText(`Also delete it on ${b.name}`);
    await ask.locator('.chat-clear-both input').check();
    await ask.locator('[data-act=yes]').click();
  };
  await clearBoth();
  await expect(chatA.locator('.bubble')).toHaveCount(0);
  const askB = b.page.locator('#dlg-clear-ask');
  await expect(askB).toBeVisible();
  await expect(askB.locator('h3')).toHaveText(`${a.name} cleared your chat`);
  await askB.locator('[data-act=keep]').click();
  await expect(chatB.locator('.bubble.in')).toHaveCount(1);
  await expect(a.page.locator('#toast')).toContainText('kept the chat');
  // Undo on A, then again: this time B deletes it
  await a.page.locator('#undo-toast.show button').click();
  await expect(chatA.locator('.bubble')).toHaveCount(1);
  await clearBoth();
  await askB.locator('[data-act=delete]').click();
  await expect(chatB.locator('.bubble')).toHaveCount(0);
  expect(await b.page.evaluate(() => Messages.items.length)).toBe(0);
  await expect(a.page.locator('#toast')).toContainText('deleted the chat too');
  expect(a.errors.concat(b.errors)).toEqual([]);
});
