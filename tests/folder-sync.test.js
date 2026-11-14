// Upgrade of 2026-11-14: Sync a folder between two computers (sync.js). Each computer picks a folder and the other
// computer; new and changed files then copy over by themselves both ways, subfolders included.
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { openDevice, card, menu } = require('./helpers');

let devices = [];
test.afterEach(async () => {
  for (const d of devices) await d.close();
  devices = [];
});
const open = async (...args) => { const d = await openDevice(...args); devices.push(d); return d; };

// A folder in memory in place of the browser's folder picker (which a test can't click). It can be read and changed
// like a real one: window.__tree holds it ({ name: { text, m } | { ...folder } }), window.__edit changes it.
function fakeFolder({ name, tree }) {
  const OLD = 1700000000000;
  const isFile = (v) => v && typeof v.text === 'string';
  const fileOf = (n, v) => new File([v.text], n, { type: 'text/plain', lastModified: v.m });
  const fileHandle = (dir, n) => ({
    kind: 'file', name: n,
    async getFile() { if (!isFile(dir[n])) throw new DOMException('gone', 'NotFoundError'); return fileOf(n, dir[n]); },
    async createWritable() {
      let parts = [];
      return {
        async write(data) { parts.push(data); },
        async close() { dir[n] = { text: await new Blob(parts).text(), m: Date.now() }; },
        async abort() { parts = []; },
      };
    },
  });
  const make = (n, dir) => ({
    kind: 'directory', name: n,
    async *entries() {
      for (const k of Object.keys(dir)) yield [k, isFile(dir[k]) ? fileHandle(dir, k) : make(k, dir[k])];
    },
    async getDirectoryHandle(k, o) {
      if (!dir[k] && o?.create) dir[k] = {};
      if (!dir[k] || isFile(dir[k])) throw new DOMException('no', 'NotFoundError');
      return make(k, dir[k]);
    },
    async getFileHandle(k, o) {
      if (!dir[k] && o?.create) dir[k] = { text: '', m: Date.now() };
      if (!isFile(dir[k])) throw new DOMException('no', 'NotFoundError');
      return fileHandle(dir, k);
    },
    async isSameEntry(other) { return other === this; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  // Every file: path -> text
  const flat = (dir, prefix = '') => Object.entries(dir).flatMap(([k, v]) => (isFile(v) ? [[prefix + k, v.text]] : flat(v, prefix + k + '/')));
  const walk = (tree) => { for (const v of Object.values(tree)) { if (isFile(v)) v.m = v.m || OLD; else walk(v); } };
  walk(tree);
  window.__tree = tree;
  window.__files = () => Object.fromEntries(flat(window.__tree));
  // Change a file as a person would (saved a while ago, so it isn't skipped as "still being written")
  window.__edit = (path, text, age = 10000) => {
    const parts = path.split('/');
    let d = window.__tree;
    for (const p of parts.slice(0, -1)) d = d[p] = d[p] || {};
    if (text === null) delete d[parts[parts.length - 1]];
    else d[parts[parts.length - 1]] = { text, m: Date.now() - age };
  };
  const root = make(name, tree);
  window.showDirectoryPicker = async () => root;
}

async function turnOn(page, other) {
  await menu(page, 'btn-fsync');
  const dlg = page.locator('#dlg-fsync');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.fs-state')).toHaveText('Not syncing.');
  await dlg.locator('#fsync-to').selectOption({ label: other });
  await dlg.locator('[data-act=pick]').click();
  await expect(dlg.locator('.fs-state')).toContainText(`with ${other}.`);
  return dlg;
}
const files = (d) => d.page.evaluate(() => window.__files());

test('sync a folder: two computers keep a folder the same both ways, keep both versions of a clash, never copy back and forth', async ({ browser }) => {
  test.setTimeout(150000);
  const secret = crypto.randomBytes(32).toString('hex');
  const paired = (name) => JSON.stringify([{ secret, name, at: Date.now(), seen: Date.now(), auto: false, trusted: true }]);
  const a = await open(browser, 'Test Laptop', { storage: { 'omnibeam-paired': paired('Test Desktop') } });
  const b = await open(browser, 'Test Desktop', { storage: { 'omnibeam-paired': paired('Test Laptop') } });
  await a.page.evaluate(fakeFolder, { name: 'Work', tree: {
    'notes.txt': { text: 'shopping list' }, '.hidden': { text: 'secret' }, 'report.docx.crdownload': { text: 'half' },
    'same.txt': { text: 'on both' }, 'twin.txt': { text: 'copied by hand', m: 1600000000000 }, 'photos': { 'beach.txt': { text: 'sun and sea '.repeat(500) }, 'deep': { 'boat.txt': { text: 'boat' } } },
  } });
  await b.page.evaluate(fakeFolder, { name: 'Work copy', tree: { 'plan.txt': { text: 'from the desktop' }, 'same.txt': { text: 'on both' }, 'twin.txt': { text: 'copied by hand', m: 1650000000000 } } });
  await card(a.page, 'Test Desktop');
  await card(b.page, 'Test Laptop');
  // The menu item is there on a computer with Chrome or Edge
  await expect(a.page.locator('#btn-fsync')).toBeAttached();

  // Only one computer on: the other is told how to turn it on
  const da = await turnOn(a.page, 'Test Desktop');
  await expect(da.locator('[data-k=status]')).toContainText('isn\'t syncing with this computer yet', { timeout: 30000 });
  await da.locator('[data-act=close]').click();

  // Both on: everything meets in the middle, subfolders too, hidden and unfinished files left out, nothing asked
  const db = await turnOn(b.page, 'Test Laptop');
  // (twin.txt: the same on both, saved at other times: no second copy of it)
  const want = { 'notes.txt': 'shopping list', 'same.txt': 'on both', 'twin.txt': 'copied by hand', 'plan.txt': 'from the desktop', 'photos/beach.txt': 'sun and sea '.repeat(500), 'photos/deep/boat.txt': 'boat' };
  await expect.poll(() => files(b), { timeout: 60000 }).toEqual(want);
  await expect.poll(() => files(a), { timeout: 60000 }).toEqual({ ...want, '.hidden': 'secret', 'report.docx.crdownload': 'half' });
  await expect(db.locator('[data-k=status]')).toContainText('files copied since this page opened', { timeout: 30000 });
  for (const d of [a, b]) {
    await expect(d.page.locator('#dlg-request')).toBeHidden();
    await expect(d.page.locator('#dlg-received')).toBeHidden();
  }

  // Changed on one computer: the other gets the new version
  await a.page.evaluate(() => window.__edit('notes.txt', 'shopping list, milk'));
  await db.locator('[data-act=now]').click();
  await expect.poll(async () => (await files(b))['notes.txt'], { timeout: 40000 }).toBe('shopping list, milk');

  // Changed on both: the newer keeps the name, the older is kept beside it, on both computers
  await b.page.evaluate(() => window.__edit('same.txt', 'desktop edit', 60000));
  await a.page.evaluate(() => window.__edit('same.txt', 'laptop edit, newer', 20000));
  await db.locator('[data-act=now]').click();
  const clash = (f) => Object.keys(f).filter((k) => /^same \(Test Desktop \d{4}-\d\d-\d\d \d{4}\)\.txt$/.test(k));
  await expect.poll(async () => { const f = await files(b); return [f['same.txt'], ...clash(f).map((k) => f[k])]; }, { timeout: 40000 })
    .toEqual(['laptop edit, newer', 'desktop edit']);
  await expect.poll(async () => { const f = await files(a); return [f['same.txt'], ...clash(f).map((k) => f[k])]; }, { timeout: 60000 })
    .toEqual(['laptop edit, newer', 'desktop edit']);

  // Settled: asking again copies nothing (a copied file isn't sent back), and a file deleted on one computer stays
  // on the other and doesn't come back
  await b.page.evaluate(() => window.__edit('plan.txt', null));
  const sends = async (d) => d.page.evaluate(() => {
    window.__sends = 0;
    for (const p of peers.values()) { const real = p.sendFiles.bind(p); p.sendFiles = (...x) => { window.__sends++; return real(...x); }; }
  });
  await sends(a);
  await sends(b);
  for (let i = 0; i < 2; i++) {
    await b.page.evaluate(() => window.Sync && document.querySelector('#dlg-fsync [data-act=now]').click());
    await a.page.evaluate(() => document.querySelector('#dlg-fsync [data-act=now]')?.click());
    await b.page.waitForTimeout(3000);
  }
  expect(await a.page.evaluate(() => window.__sends)).toBe(0);
  expect(await b.page.evaluate(() => window.__sends)).toBe(0);
  expect((await files(b))['plan.txt']).toBeUndefined();
  expect((await files(a))['plan.txt']).toBe('from the desktop');
  await expect(db.locator('[data-k=status]')).toContainText('Up to date');

  // Nothing outside the folder and nothing hidden, even when asked for directly
  const answer = await b.page.evaluate(async () => {
    const p = [...peers.values()].find((x) => x.info.name === 'Test Laptop');
    const seen = [];
    const real = window.Sync.onMsg;
    window.Sync.onMsg = (peer, msg) => { seen.push(msg); };
    p.sendJson({ t: 'sy-get', paths: ['../../etc/passwd', '.hidden', 'photos/../.hidden', 'report.docx.crdownload'], want: 'ab'.repeat(16) });
    await new Promise((r) => setTimeout(r, 1500));
    window.Sync.onMsg = real;
    return seen;
  });
  expect(answer).toEqual([{ t: 'sy-busy', want: 'ab'.repeat(16), gone: 1 }]);
  // The Sent list and History stay as they were
  expect(await a.page.evaluate(() => JSON.parse(localStorage.getItem('omnibeam-sent') || '[]').length)).toBe(0);

  // Stopped on the laptop: the desktop is told
  await menu(a.page, 'btn-fsync');
  await da.locator('[data-act=off]').click();
  await expect(da.locator('.fs-state')).toHaveText('Not syncing.');
  await db.locator('[data-act=now]').click();
  await expect(db.locator('[data-k=status]')).toContainText('isn\'t syncing with this computer yet', { timeout: 30000 });
  for (const d of [a, b]) expect(d.errors).toEqual([]);
});
