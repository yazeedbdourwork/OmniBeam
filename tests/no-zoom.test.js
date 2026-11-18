// Phones: the app page doesn't zoom, stretch or bounce under the fingers. Pinch-zoom and double-tap zoom are left
// out of the page's touch-action, overscroll bounce is off, and iPhone Safari's own pinch gesture is stopped.
// The viewport tag keeps zoom allowed (axe checks it), so browsers' accessibility zoom settings still work.
const { test, expect, devices } = require('@playwright/test');

test('phone page: no pinch or double-tap zoom, no bounce, iPhone pinch gesture stopped', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.addInitScript(() => { localStorage.setItem('omnibeam-tour', 'done'); localStorage.setItem('omnibeam-lang', 'en'); });
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  const css = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { touch: s.touchAction, over: s.overscrollBehaviorY }; });
  expect(css.touch).toBe('pan-x pan-y');
  expect(css.over).toBe('none');
  const stopped = await page.evaluate(() => {
    const e = new Event('gesturestart', { cancelable: true, bubbles: true });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(stopped).toBe(true);
  await context.close();
});
