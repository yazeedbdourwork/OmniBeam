// 2026-11-28: five more languages (Persian, right to left; Bengali, Vietnamese, Thai, Polish), 20 in all. Each has
// every app text, its own home page address, the guide pages, the share link / request / album page texts, the
// Telegram bot texts and hreflang links.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const NEW = { fa: 'فارسی', bn: 'বাংলা', vi: 'Tiếng Việt', th: 'ไทย', pl: 'Polski' };
const pub = (...p) => path.join(__dirname, '..', 'public', ...p);

test('every app text and guide page exists in the five new languages', async () => {
  const en = Object.keys(require('../public/lang/de.js').strings);
  const LANGS = require('../public/i18n.js');
  expect(Object.keys(LANGS)).toHaveLength(20);
  const pages = fs.readdirSync(pub('pages', 'en'));
  const ui = JSON.parse(fs.readFileSync(pub('pages', 'ui.json'), 'utf8'));
  for (const [code, name] of Object.entries(NEW)) {
    const pack = require(`../public/lang/${code}.js`);
    expect(pack).toMatchObject({ code, name, dir: code === 'fa' ? 'rtl' : 'ltr' });
    for (const k of en) {
      expect(pack.strings[k], `${code}: ${k}`).toBeTruthy();
      expect((pack.strings[k].match(/\{\w+\}/g) || []).sort(), `${code}: ${k}`).toEqual((k.match(/\{\w+\}/g) || []).sort());
    }
    for (const p of pages) expect(fs.existsSync(pub('pages', code, p)), `${code}/${p}`).toBe(true);
    expect(Object.keys(ui[code]).sort()).toEqual(Object.keys(ui.en).sort());
    for (const f of ['get.js', 'put.js', 'event.js']) expect(fs.readFileSync(pub(f), 'utf8'), `${f} ${code}`).toMatch(new RegExp(`\\n    "?${code}"?: \\{`));
  }
});

test('the new home pages: translated, Persian right to left, in the language menu and hreflang', async ({ page, request }) => {
  await page.goto('/fa/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  const fa = require('../public/lang/fa.js').strings;
  await expect(page.locator('#me-name')).toBeVisible();
  expect(await page.locator('body').innerText()).toContain(fa['How to Use']);
  await page.goto('/pl/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await page.locator('#btn-lang option').evaluateAll((o) => o.map((x) => x.value))).toEqual(expect.arrayContaining(Object.keys(NEW)));
  const html = await (await request.get('/vi/')).text();
  for (const code of Object.keys(NEW)) expect(html).toContain(`hreflang="${code}" href="https://omnibeam.site/${code}/"`);
  const guide = await (await request.get('/th/how-to-use')).text();
  expect(guide).toContain('<html lang="th"');
  expect(guide).toContain('<details id="watch">');
  const map = await (await request.get('/sitemap.xml')).text();
  for (const code of Object.keys(NEW)) expect(map).toContain(`https://omnibeam.site/${code}/how-to-use`);
});
