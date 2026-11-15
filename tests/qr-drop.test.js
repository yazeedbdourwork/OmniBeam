// QR pairing on the phone: if the computer drops off while the phone checks its answer, the phone still pairs
// and doesn't crash ("peers.get(...) is undefined", seen on Firefox for Android).
const { test, expect } = require('@playwright/test');
const { openDevice } = require('./helpers');

test('QR pairing keeps going when the other device drops off during the check', async ({ browser }) => {
  const a = await openDevice(browser, 'Drop Laptop');
  await a.page.locator('#btn-pair').click();
  await expect(a.page.locator('#pair-qr svg')).toBeVisible();
  const link = await a.page.evaluate(() => qrPairLink());
  const secret = link.match(/#qr=([0-9a-f]{64})/)[1];

  const b = await openDevice(browser, 'Drop Phone');
  await b.page.evaluate(() => {
    // The laptop's card goes away while the phone is checking the laptop's "ok"
    const real = window.qrProof;
    window.qrProof = async (...args) => {
      const out = await real(...args);
      if (args[3] === 'ok') peers.delete(args[1]);
      return out;
    };
  });
  await b.page.evaluate((s) => scanFromLink(s, 'Drop Laptop', false), secret);
  await expect.poll(() => b.page.evaluate(() => loadPaired().length), { timeout: 10000 }).toBe(1);
  await expect(b.page.locator('#toast')).toContainText('Paired with Drop Laptop');
  expect(b.errors).toEqual([]);
  expect(a.errors).toEqual([]);
  await a.close();
  await b.close();
});
