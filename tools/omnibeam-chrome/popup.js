// The toolbar button: send this page (or the selected text) to one of the devices the OmniBeam tab sees
'use strict';
const $ = (s) => document.querySelector(s);
const msg = (key) => chrome.i18n.getMessage(key) || key;
for (const el of document.querySelectorAll('[data-msg]')) el.textContent = msg(el.dataset.msg);
document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';

let item = null;
async function whatToSend() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let selection = '';
  try {
    // Allowed by activeTab: the user just clicked the button on this tab
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection() || '') });
    selection = (r && r.result || '').trim();
  } catch {}
  $('#what').textContent = msg(selection ? 'popupSelection' : 'popupPage');
  item = { text: selection || (tab.title && tab.title !== tab.url ? `${tab.title}\n${tab.url}` : tab.url) };
}
async function showDevices() {
  const { peers = [] } = await chrome.storage.session.get('peers');
  const box = $('#devices');
  box.textContent = '';
  for (const p of peers) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    const d = document.createElement('span');
    d.textContent = p.device;
    b.appendChild(d);
    b.onclick = () => send(p.id);
    box.appendChild(b);
  }
  $('#none').hidden = peers.length > 0;
}
async function send(to) {
  if (!item) return;
  $('#status').textContent = '…';
  const r = await chrome.runtime.sendMessage({ cmd: 'send', item, to });
  $('#status').textContent = r && r.ok ? msg(to ? 'popupSent' : 'popupChoose') : (r && r.error) || 'Error';
  if (r && r.ok && to) setTimeout(() => window.close(), 900);
}
$('#open').onclick = () => send(null);

// Images from any website: Chrome only lets the extension read images from other sites with this permission
const ALL = { origins: ['<all_urls>'] };
chrome.permissions.contains(ALL).then((on) => { $('#images').checked = on; });
$('#images').onchange = async (e) => {
  e.target.checked = e.target.checked ? await chrome.permissions.request(ALL) : !(await chrome.permissions.remove(ALL));
};
chrome.storage.session.onChanged.addListener(showDevices);
whatToSend();
showDevices();
