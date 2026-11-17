// The TV slideshow works in older browsers too (2026-11-17: after the script fix, the slideshow still showed
// nothing in Chrome 78). Chrome before 87 has no `inset` and before 79 no clamp()/min()/max(), before 88 no
// aspect-ratio and before 86 no :focus-visible: it skips those rules, so `.tv-show { position: fixed; inset: 0 }`
// was a box of no size. These tests give the TV page style.css as Chrome 78 reads it (oldView) and check the
// slideshow, the photo wall and the QR code still have their size.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { openDevice, card } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==', 'base64');

// style.css as Chrome 78 reads it: declarations it doesn't know are dropped, rules with selectors it doesn't know
// are dropped whole, and @supports not (aspect-ratio …) applies
function oldView(css) {
  const NEW_SELECTOR = /:focus-visible|:is\(|:where\(|:has\(/;
  const newValue = (prop, value) => /^inset/.test(prop) || prop === 'aspect-ratio' || /(^|[^a-z-])(clamp|min|max)\(/.test(value);
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@supports\s+not\s*\(\s*aspect-ratio[^)]*\)/g, '@media all')
    .replace(/([^{}]*)\{([^{}]*)\}/g, (m, sel, body) => {
      if (/^\s*@/.test(sel)) return m;
      if (NEW_SELECTOR.test(sel)) return '';
      const kept = body.split(';').filter((d) => {
        const i = d.indexOf(':');
        if (i < 0) return d.trim() === '';
        return !newValue(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1));
      });
      return `${sel}{${kept.join(';')}}`;
    });
}
const OLD_CSS = oldView(fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8'));
const asChrome78 = async (context) => {
  await context.route(/\/style\.css(\?|$)/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: OLD_CSS }));
};

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

test('no inset shorthand in the site\'s styles (Chrome before 87 skips it)', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((n) => n.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.match(/(^|[{;\s])inset\s*:[^;}]*/g) || [], f).toEqual([]);
  }
});

test('the Chrome 78 view of the styles drops what Chrome 78 drops', () => {
  expect(oldView('.a{top:0;width:min(1vw,2vh);font-size:clamp(1px,2vw,3px);color:red}')).toBe('.a{top:0;color:red}');
  expect(oldView('.a:focus-visible,.b{color:red}')).toBe('');
  expect(oldView('@supports not (aspect-ratio: 1 / 1) { .t { height: 0 } }')).toContain('@media all');
});

test('TV in Chrome 78: the slideshow fills the screen, the photo wall and QR code have their size', async ({ browser }) => {
  const tv = await open(browser, 'Old TV 1', { path: '/tv', setup: asChrome78 });
  const p = tv.page;
  const size = (sel) => p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  await expect(p.locator('#tv-qr svg')).toBeVisible();
  const qr = await size('#tv-qr');
  expect(qr.w).toBeGreaterThan(100);
  expect(qr.h).toBeGreaterThan(100);
  const link = await p.locator('#tv-qr').getAttribute('data-link');
  const phone = await open(browser, 'Phone', { path: link.replace(/^http:\/\/localhost:\d+/, '') });
  await expect(phone.page.locator('#toast')).toContainText('Paired with Old TV 1', { timeout: 15000 });
  const target = await card(phone.page, 'Old TV 1');
  const chooser = phone.page.waitForEvent('filechooser');
  await target.hover();
  await target.locator('[data-act=files]').click();
  await (await chooser).setFiles([{ name: 'a.png', mimeType: 'image/png', buffer: PNG }, { name: 'b.png', mimeType: 'image/png', buffer: PNG }]);

  await expect(p.locator('#tv-show')).toBeVisible({ timeout: 30000 });
  const view = p.viewportSize();
  const show = await size('#tv-show');
  expect(show.w).toBe(view.width);
  expect(show.h).toBe(view.height);
  const stage = await size('#tv-stage');
  expect(stage.w).toBe(view.width);
  expect(stage.h).toBe(view.height);
  await expect(p.locator('#tv-stage img')).toBeVisible();

  // Back: the photo wall, its tiles have a height
  await p.keyboard.press('Escape');
  await expect(p.locator('#tv-wall')).toBeVisible();
  await expect(p.locator('#tv-grid .tv-tile')).toHaveCount(2);
  const tile = await size('#tv-grid .tv-tile');
  expect(tile.w).toBeGreaterThan(100);
  expect(tile.h).toBeGreaterThan(50);
});
