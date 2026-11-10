// OmniBeam for Chrome and Edge: right-click a page, link, image or selected text (or use the toolbar button) and
// send it to a device in OmniBeam. The sending is done by an open OmniBeam tab (opened if needed), so files go
// straight from this computer to the other device, the same way as from the page.
'use strict';
const DEFAULT_SITE = 'https://omnibeam.site';
const msg = (key, sub) => chrome.i18n.getMessage(key, sub) || key;

async function siteUrl() {
  const { site } = await chrome.storage.sync.get('site');
  return String(site || DEFAULT_SITE).replace(/\/+$/, '');
}
// The devices the open OmniBeam tab sees (kept in session storage: this worker is stopped when idle)
async function getPeers() {
  const { peers = [], peersTab = null } = await chrome.storage.session.get(['peers', 'peersTab']);
  return { peers, peersTab };
}

// ---------- Right-click menu: Send to OmniBeam > each device ----------
const CONTEXTS = ['page', 'selection', 'link', 'image'];
let building = Promise.resolve();
function buildMenus() {
  building = building.then(async () => {
    const { peers } = await getPeers();
    await new Promise((r) => chrome.contextMenus.removeAll(r));
    chrome.contextMenus.create({ id: 'ob', title: msg('menuRoot'), contexts: CONTEXTS });
    for (const p of peers) chrome.contextMenus.create({ id: 'peer:' + p.id, parentId: 'ob', title: p.name, contexts: CONTEXTS });
    if (peers.length) chrome.contextMenus.create({ id: 'sep', parentId: 'ob', type: 'separator', contexts: CONTEXTS });
    chrome.contextMenus.create({ id: 'choose', parentId: 'ob', title: msg(peers.length ? 'menuChoose' : 'menuOpen'), contexts: CONTEXTS });
  }).catch(() => {});
  return building;
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.cmd === 'peers' && sender.tab && Array.isArray(m.peers)) {
    const peers = m.peers.slice(0, 50).map((p) => ({ id: String(p.id), name: String(p.name).slice(0, 60), device: String(p.device || '').slice(0, 60) }));
    chrome.storage.session.set({ peers, peersTab: sender.tab.id }).then(buildMenus);
  }
  if (m.cmd === 'send') {
    send(m.item, m.to).then(() => reply({ ok: true }), (err) => reply({ ok: false, error: String(err.message || err) }));
    return true;
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { peersTab } = await getPeers();
  if (tabId === peersTab) { await chrome.storage.session.set({ peers: [], peersTab: null }); buildMenus(); }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const to = String(info.menuItemId).startsWith('peer:') ? String(info.menuItemId).slice(5) : null;
  let item;
  if (info.mediaType === 'image' && info.srcUrl) item = await imageItem(info.srcUrl, tab);
  else if (info.selectionText) item = { text: info.selectionText };
  else if (info.linkUrl) item = { text: info.linkUrl };
  else item = { text: pageText(tab) };
  send(item, to).catch((err) => console.warn('OmniBeam: could not send', err));
});

const pageText = (tab) => (tab && tab.title && tab.title !== tab.url ? `${tab.title}\n${tab.url}` : (tab && tab.url) || '');

// The image itself, or its address when the site doesn't allow reading it
async function imageItem(src, tab) {
  try {
    const res = await fetch(src, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size > 50 * 1024 * 1024) throw new Error('not an image');
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
    let name = '';
    try { name = decodeURIComponent(new URL(src).pathname.split('/').pop() || ''); } catch {}
    name = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
    if (!/\.\w{2,5}$/.test(name)) name = (name || 'image') + '.' + ext;
    return { file: { name, type: blob.type, base64: await toBase64(blob) } };
  } catch {
    return { text: src.startsWith('data:') ? pageText(tab) : src };
  }
}
async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

// ---------- Hand it to the OmniBeam tab ----------
async function omnibeamTab() {
  const base = await siteUrl();
  const { peersTab } = await getPeers();
  if (peersTab != null) {
    try {
      const t = await chrome.tabs.get(peersTab);
      if (t.url && t.url.startsWith(base + '/')) return { tab: t, opened: false };
    } catch {}
  }
  const tabs = await chrome.tabs.query({ url: base + '/*' });
  const app = tabs.find((t) => !/\/(d|stats|blog)\b/.test(new URL(t.url).pathname));
  if (app) return { tab: app, opened: false };
  return { tab: await chrome.tabs.create({ url: base + '/', active: true }), opened: true };
}
// Waits until the helper script in the tab answers (a new tab takes a moment to load)
async function ready(tabId) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await chrome.tabs.sendMessage(tabId, { cmd: 'ping' }))?.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('OmniBeam did not load');
}
async function send(item, to) {
  if (!item || (!item.text && !item.file)) return;
  const { tab, opened } = await omnibeamTab();
  await ready(tab.id);
  const { peers } = await getPeers();
  const known = !opened && to && peers.some((p) => p.id === to);
  await chrome.tabs.sendMessage(tab.id, { cmd: 'send', item, to: known ? to : null });
  if (known) {
    // Sent straight to the device: a short tick on the toolbar button instead of switching tabs
    chrome.action.setBadgeBackgroundColor({ color: '#6c63ff' });
    chrome.action.setBadgeText({ text: '✓' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } else {
    // The page asks which device: show it
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}
