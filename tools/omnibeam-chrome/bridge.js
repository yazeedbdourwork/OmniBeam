// Runs on OmniBeam's own page. Passes what the extension sends (a page, link, text or image) to the page, and the
// page's list of devices back to the extension for its menu. The page only listens to messages from itself.
'use strict';
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.omnibeamPage !== 'peers') return;
  chrome.runtime.sendMessage({ cmd: 'peers', peers: e.data.peers }).catch(() => {});
});
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.cmd === 'ping') reply({ ok: true });
  if (msg.cmd === 'send') {
    window.postMessage({ omnibeamExt: 'send', item: msg.item, to: msg.to || null }, location.origin);
    reply({ ok: true });
  }
});
// Tells the page an extension is here, so it starts sending its device list
window.postMessage({ omnibeamExt: 'hello' }, location.origin);
