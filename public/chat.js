// OmniBeam: the chat view of one device, loaded by app.js when it is first opened (More… on a device -> Chat, the
// Chat button of a paired device, or the small number on a card). It shows what was sent to and received from that
// device, messages and files, in time order, like a messenger: what came in on one side, what this device sent on
// the other (the sides follow the page's direction, so they swap in Arabic and Urdu). Received photos show a small
// picture and every received file can be saved or previewed; sent files show their name and how the send went.
// It is the only place to write and read messages (every "Send message" opens it; a message that arrives while it is
// closed opens it by itself, or shows a small banner that opens it when the person is busy with something else).
// The head has Ring (to find that device), Pin a note, the message sound (on/off) and Clear chat. A pinned note (a
// Wi-Fi password, an address) stays at the top of the chat, on this device only, until it is unpinned: also after
// the messages are cleared or too old. A message that is only a link has an Open link button. The box at the bottom sends a message or files to that
// device; a paired device that is offline gets them as soon as it opens OmniBeam (like its greyed card). Everything comes from the history kept on this device (see Chat view in
// app.js): nothing new is stored, and nothing goes to the server.
'use strict';
(function () {
  const STYLE = `
.chat-dialog { width: min(640px, 100vw); max-width: 100vw; height: min(820px, 100dvh); max-height: 100dvh; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.chat-dialog:not([open]) { display: none; }
@media (max-width: 640px) { .chat-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; } }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border, rgba(127,127,127,.25)); }
.chat-head .avatar { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; color: #fff; }
.chat-head .avatar svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.chat-head .avatar .emoji { font-size: 22px; }
.chat-head .chat-who { flex: 1; min-width: 0; }
.chat-head .chat-who b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-head .chat-who small { opacity: .75; }
.chat-thread { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 6px; overscroll-behavior: contain; }
.chat-day { align-self: center; font-size: 12px; opacity: .7; padding: 2px 10px; border-radius: 999px; background: rgba(127,127,127,.15); margin: 8px 0 2px; }
.chat-empty { margin: auto; text-align: center; opacity: .75; max-width: 30ch; }
.bubble { max-width: min(75%, 440px); padding: 8px 10px 6px; border-radius: 14px; background: var(--card, rgba(127,127,127,.14)); border: 1px solid var(--border, rgba(127,127,127,.2)); overflow-wrap: anywhere; unicode-bidi: plaintext; }
.bubble.in { align-self: flex-start; border-end-start-radius: 4px; }
.bubble.out { align-self: flex-end; border-end-end-radius: 4px; background: var(--accent-soft, rgba(124,92,255,.16)); }
.bubble .msg-text { white-space: pre-wrap; unicode-bidi: plaintext; text-align: start; }
.bubble .chat-meta { font-size: 11px; opacity: .7; white-space: nowrap; }
.bubble .chat-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 3px; }
.bubble .chat-foot .chat-acts { margin: 0; margin-inline-end: auto; }
.bubble .chat-file { display: flex; align-items: center; gap: 8px; }
.bubble .chat-file .chat-icon { font-size: 22px; flex: none; }
.bubble .chat-file .chat-name { font-weight: 600; overflow-wrap: anywhere; unicode-bidi: plaintext; }
.bubble .chat-file small { opacity: .75; display: block; }
.bubble .chat-thumb { display: block; max-width: 100%; max-height: 240px; border-radius: 10px; margin-bottom: 6px; background: rgba(127,127,127,.15); cursor: zoom-in; }
.bubble .chat-acts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.bubble .chat-acts .link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.bubble.failed .chat-meta, .bubble.declined .chat-meta, .bubble.cancelled .chat-meta { color: var(--danger, #c0392b); opacity: 1; }
.chat-compose { border-top: 1px solid var(--border, rgba(127,127,127,.25)); padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); display: flex; gap: 8px; align-items: flex-end; }
.chat-compose textarea { flex: 1; resize: none; min-height: 40px; max-height: 140px; padding: 9px 12px; border-radius: 20px; border: 1px solid var(--border, rgba(127,127,127,.35)); background: transparent; color: inherit; font: inherit; unicode-bidi: plaintext; }
.chat-compose .icon-btn { flex: none; }
.chat-note { font-size: 12px; opacity: .8; padding: 0 12px 6px; }
.chat-dialog .shrink-toggle { margin: 0; padding: 2px 12px 2px; justify-content: flex-end; gap: 2px; font-size: 11.5px; opacity: .85; }
.chat-dialog .shrink-toggle button { padding: 2px 8px; box-shadow: none; background: transparent; font-weight: 600; }
.chat-dialog .shrink-toggle button[aria-pressed="true"] { box-shadow: none; text-decoration: underline; text-underline-offset: 3px; }
.bubble.chat-ask .chat-acts .btn { min-width: 6em; }
.chat-head .icon-btn[data-act=sound][aria-pressed="false"] { opacity: .6; }
.chat-notif { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 12px 6px; padding: 8px 10px; border-radius: 12px; font-size: 13px; background: var(--accent-soft, rgba(124,92,255,.14)); }
.chat-notif span { flex: 1; min-width: 12em; }
.chat-pin { display: flex; align-items: flex-start; gap: 8px; margin: 8px 12px 0; padding: 8px 10px; border-radius: 12px; background: var(--accent-soft, rgba(124,92,255,.14)); border: 1px solid var(--border, rgba(127,127,127,.2)); }
.chat-pin:not([hidden]) + .chat-thread { padding-top: 8px; }
.chat-pin .pin-ico { flex: none; font-size: 15px; line-height: 1.4; }
.chat-pin .pin-text { flex: 1; min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: plaintext; text-align: start; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; cursor: pointer; font-size: 14px; }
.chat-pin.open .pin-text { -webkit-line-clamp: unset; display: block; max-height: 40vh; overflow-y: auto; }
.chat-pin .pin-acts { display: flex; gap: 10px; flex: none; }
.chat-pin .link-btn, .bubble .chat-acts .link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.bubble .chat-link-open { margin-top: 6px; }
`;
  let styled = false;
  const addStyle = () => {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
  };
  const ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', text: '📝', '': '📎' };
  const dayOf = (at) => new Date(at).toDateString();
  const dayLabel = (at) => {
    const d = new Date(at), now = new Date();
    if (d.toDateString() === now.toDateString()) return t('Today');
    if (d.toDateString() === new Date(now - 864e5).toDateString()) return t('Yesterday');
    return d.toLocaleDateString(document.documentElement.lang || [], { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const timeOf = (at) => new Date(at).toLocaleTimeString(document.documentElement.lang || [], { hour: '2-digit', minute: '2-digit' });
  const results = () => ({ ok: '✓', declined: t('Declined'), failed: t('Not finished'), cancelled: t('Cancelled') });

  let current = null; // { who, dlg, urls, observer }
  const NOTIF_OFFER_KEY = 'omnibeam-chat-notif-offer';
  const offerAnswered = () => { try { localStorage.setItem(NOTIF_OFFER_KEY, '1'); } catch {} $('.chat-notif', current.dlg).hidden = true; };
  // Clear chat: asks first; then the messages and file entries with this device go from this device (Undo for 6 s)
  function clear() {
    const name = $('#chat-title').textContent || current.who.name;
    if (!confirm(t('Clear this chat? Messages and file entries with {name} are removed from this device only.', { name }))) return;
    clearChat(current.who);
  }
  // Pinned notes: { thread key: { text, at } } on this device
  const PINS_KEY = 'omnibeam-pins';
  const pins = () => { try { return JSON.parse(localStorage.getItem(PINS_KEY)) || {}; } catch { return {}; } };
  const pinOf = (who) => pins()[chatKey(who)] || null;
  function setPin(who, text) {
    const all = pins();
    const key = chatKey(who);
    text = String(text || '').trim().slice(0, 2000);
    if (text) all[key] = { text, at: Date.now() };
    else delete all[key];
    try { localStorage.setItem(PINS_KEY, JSON.stringify(all)); } catch { toast(t('Could not save')); }
    if (text) wsSend({ type: 'stat', kind: 'pin' });
  }
  function pinNow(text) {
    const had = pinOf(current.who);
    setPin(current.who, text);
    toast(had ? t('Pinned note replaced') : t('Pinned at the top of this chat'));
    render(true);
  }
  function editPin() {
    const had = pinOf(current.who);
    const text = prompt(t('A note pinned at the top of this chat, on this device only (a Wi-Fi password, an address…):'), had ? had.text : '');
    if (text === null) return;
    if (!text.trim()) { if (had) { setPin(current.who, ''); toast(t('Note unpinned')); render(true); } return; }
    setPin(current.who, text);
    toast(t('Pinned at the top of this chat'));
    render(true);
  }
  function paintPin() {
    const box = $('.chat-pin', current.dlg);
    const pin = pinOf(current.who);
    box.hidden = !pin;
    if (!pin) return;
    $('.pin-text', box).textContent = pin.text;
  }
  function dialog() {
    let dlg = document.getElementById('dlg-chat');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-chat';
    dlg.className = 'chat-dialog';
    dlg.setAttribute('aria-labelledby', 'chat-title');
    dlg.innerHTML = `
      <div class="chat-head">
        <div class="avatar" aria-hidden="true"></div>
        <div class="chat-who"><b id="chat-title"></b><small class="chat-state"></small></div>
        <button type="button" class="icon-btn" data-act="ring" title="${escapeHtml(t('Ring this device'))}" aria-label="${escapeHtml(t('Ring this device'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>
        <button type="button" class="icon-btn" data-act="pin" title="${escapeHtml(t('Pin a note'))}" aria-label="${escapeHtml(t('Pin a note'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/></svg></button>
        <button type="button" class="icon-btn" data-act="sound" aria-pressed="true"></button>
        <button type="button" class="icon-btn" data-act="clear" title="${escapeHtml(t('Clear chat'))}" aria-label="${escapeHtml(t('Clear chat'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button>
        <button type="button" class="icon-btn" data-act="close" title="${escapeHtml(t('Close'))}" aria-label="${escapeHtml(t('Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="chat-pin" hidden><span class="pin-ico" aria-hidden="true">📌</span><div class="pin-text" title="${escapeHtml(t('Pinned note'))}"></div><div class="pin-acts"><button type="button" class="link-btn" data-act="pin-copy">${escapeHtml(t('Copy'))}</button><button type="button" class="link-btn" data-act="pin-edit">${escapeHtml(t('Edit'))}</button><button type="button" class="link-btn" data-act="unpin">${escapeHtml(t('Unpin'))}</button></div></div>
      <div class="chat-thread" role="log" aria-live="polite" tabindex="0"></div>
      <p class="chat-note" hidden></p>
      <div class="chat-notif" hidden><span>${escapeHtml(t('Get a notification when a message arrives and this chat is not on screen?'))}</span><button type="button" class="btn ghost small" data-act="notif-no">${escapeHtml(t('Not now'))}</button><button type="button" class="btn small" data-act="notif-yes">${escapeHtml(t('Turn on notifications'))}</button></div>
      <div class="shrink-toggle" role="group" aria-label="${escapeHtml(t('Photos'))}">
        <span>${escapeHtml(t('Photos'))}</span>
        <button type="button" data-shrink="off" aria-pressed="true">${escapeHtml(t('Original'))}</button>
        <button type="button" data-shrink="photos" aria-pressed="false">${escapeHtml(t('Smaller'))}</button>
      </div>
      <div class="chat-compose">
        <button type="button" class="icon-btn" data-act="attach" title="${escapeHtml(t('Send files'))}" aria-label="${escapeHtml(t('Send files'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
        <textarea rows="1" maxlength="20000" aria-label="${escapeHtml(t('Message'))}" placeholder="${escapeHtml(t('Message'))}"></textarea>
        <button type="button" class="icon-btn" data-act="send" title="${escapeHtml(t('Send'))}" aria-label="${escapeHtml(t('Send'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>
      </div>`;
    document.body.appendChild(dlg);
    return dlg;
  }
  // The device of this thread if it's here now (a paired one is recognised by its pairing, others by name)
  function peerOf(who) {
    const here = [...peers.values()];
    return here.find((p) => who.pair && p.pairSecret?.startsWith(who.pair))
      || (who.peer && peers.get(who.peer.info.id) === who.peer ? who.peer : null)
      || (!who.pair ? here.find((p) => p.info.name === who.name) : null) || null;
  }
  const pairingOf = (who) => (who.pair ? loadPaired().find((p) => p.secret.startsWith(who.pair)) : null);

  // A picture of a received photo, read from storage when it scrolls into view
  function lazyThumb(img, load) {
    const show = async () => {
      const blob = await load();
      if (!blob || !current) return;
      const url = URL.createObjectURL(blob);
      current.urls.push(url);
      img.src = url;
    };
    if (!current.observer) {
      current.observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          current.observer.unobserve(e.target);
          e.target.loadThumb?.();
        }
      }, { root: $('.chat-thread', current.dlg), rootMargin: '200px' });
    }
    img.loadThumb = show;
    current.observer.observe(img);
  }
  function fileBubble(entry) {
    const el = document.createElement('div');
    if (entry.dir === 'in') {
      const f = entry.item;
      const load = () => History.blobOf(f).then((blob) => {
        if (blob) return blob;
        toast(t('This file is no longer available'));
        History.remove(f);
        return null;
      });
      const kind = previewKind(f);
      if (kind === 'image') {
        const img = document.createElement('img');
        img.className = 'chat-thumb';
        img.alt = f.name;
        img.loading = 'lazy';
        img.onclick = () => media('preview')(f, load).catch(() => {});
        el.appendChild(img);
        lazyThumb(img, () => History.blobOf(f));
      }
      const row = document.createElement('div');
      row.className = 'chat-file';
      row.innerHTML = `<span class="chat-icon" aria-hidden="true">${ICON[kind] || ICON['']}</span><span><span class="chat-name"></span><small></small></span>`;
      $('.chat-name', row).textContent = f.name.split('/').pop();
      $('small', row).textContent = formatSize(f.size);
      el.appendChild(row);
      const acts = document.createElement('div');
      acts.className = 'chat-acts';
      if (kind) acts.appendChild(previewButton(f, load));
      acts.appendChild(saveButton(f, load));
      el.appendChild(acts);
    } else {
      const e = entry.item;
      const files = e.files || [];
      const kept = sentFiles.get(e.id); // the files themselves, while this page stays open
      const first = kept && kept.length === 1 && previewKind(kept[0]) === 'image' ? kept[0] : null;
      if (first) {
        const img = document.createElement('img');
        img.className = 'chat-thumb';
        img.alt = first.name;
        const url = URL.createObjectURL(first);
        current.urls.push(url);
        img.src = url;
        el.appendChild(img);
      }
      const row = document.createElement('div');
      row.className = 'chat-file';
      const name = files.length === 1 && e.n === 1 ? files[0].name.split('/').pop()
        : t('{n} files', { n: e.n || files.length }) + ': ' + files.slice(0, 3).map((x) => x.name.split('/').pop()).join(', ') + ((e.n || 0) > 3 ? '…' : '');
      row.innerHTML = `<span class="chat-icon" aria-hidden="true">${ICON[files.length === 1 ? previewKind(files[0]) : ''] || ICON['']}</span><span><span class="chat-name"></span><small></small></span>`;
      $('.chat-name', row).textContent = name;
      $('small', row).textContent = formatSize(e.bytes || 0);
      el.appendChild(row);
      if (e.result && e.result !== 'ok') {
        const acts = document.createElement('div');
        acts.className = 'chat-acts';
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn small';
        again.textContent = t('Send again');
        again.onclick = () => resend(e);
        acts.appendChild(again);
        el.appendChild(acts);
      }
    }
    return el;
  }
  function textBubble(entry) {
    const el = document.createElement('div');
    const text = entry.item.text;
    const p = document.createElement('div');
    p.className = 'msg-text';
    p.innerHTML = linkify(text);
    el.appendChild(p);
    const acts = document.createElement('div');
    acts.className = 'chat-acts';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'link-btn small';
    copy.textContent = t('Copy');
    copy.onclick = () => navigator.clipboard.writeText(text).then(() => toast(t('Copied to clipboard')), () => toast(t('Could not copy')));
    acts.appendChild(copy);
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'link-btn small';
    pin.textContent = t('Pin');
    pin.onclick = () => pinNow(text);
    acts.appendChild(pin);
    el.appendChild(acts);
    const link = entry.dir === 'in' && linkOnly(text);
    if (link) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn small chat-link-open';
      open.textContent = t('Open link');
      open.onclick = () => { if (!openLink(link)) toast(t('Your browser blocked the new tab. Tap the link itself instead.')); };
      el.appendChild(open);
    }
    return el;
  }
  function render(keepScroll) {
    if (!current) return;
    const { who, dlg } = current;
    const thread = $('.chat-thread', dlg);
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    const before = thread.scrollTop;
    History.sync();
    for (const u of current.urls) URL.revokeObjectURL(u);
    current.urls = [];
    current.observer?.disconnect();
    current.observer = null;
    thread.innerHTML = '';
    const items = chatItems(who);
    const peer = peerOf(who);
    const pairing = pairingOf(who);
    // Header: name and picture, online or when it was last seen
    const name = peer ? peer.info.name : pairing?.name || who.name;
    $('#chat-title').textContent = name;
    const av = $('.chat-head .avatar', dlg);
    av.style.background = colorFor(name);
    av.innerHTML = avatarHtml(peer ? peer.info.avatar : pairing?.avatar, peer ? peer.info.device : pairing?.device || '');
    $('.chat-state', dlg).textContent = peer ? t('Online now') : pairing?.seen ? t('Last seen {time}', { time: timeAgo(pairing.seen) }) : t('Offline');
    // What the box at the bottom can do now
    const canSend = !!peer || !!pairing;
    const note = $('.chat-note', dlg);
    note.hidden = !!peer;
    note.textContent = pairing ? t('{name} is offline. What you send now goes as soon as it opens OmniBeam (keep this page open).', { name })
      : t('{name} is not here right now. Open OmniBeam on it to send.', { name });
    for (const el of dlg.querySelectorAll('.chat-compose textarea, .chat-compose button')) el.disabled = !canSend;
    // The speaker: message sound on or off (the same as Settings -> Message sound)
    const sound = $('[data-act=sound]', dlg);
    const soundLabel = msgSound ? t('Mute message sound') : t('Turn message sound on');
    sound.setAttribute('aria-pressed', String(msgSound));
    sound.title = soundLabel;
    sound.setAttribute('aria-label', soundLabel);
    sound.innerHTML = msgSound
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4zM23 9l-6 6M17 9l6 6"/></svg>';
    $('[data-act=clear]', dlg).disabled = !items.length;
    // Ring: the device here now, or a paired one that is offline (it rings when it opens OmniBeam)
    $('[data-act=ring]', dlg).hidden = !peer && !pairing;
    paintPin();
    // Notifications were never allowed or refused: offer them here once (not when the page opens)
    let offered = true;
    try { offered = !!localStorage.getItem(NOTIF_OFFER_KEY); } catch {}
    $('.chat-notif', dlg).hidden = offered || !('Notification' in window) || Notification.permission !== 'default';
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = t('Nothing sent or received with {name} in the last {n} days yet. Messages and files appear here.', { name, n: HISTORY_DAYS });
      thread.appendChild(empty);
    }
    let day = '';
    const res = results();
    for (const entry of items) {
      if (dayOf(entry.at) !== day) {
        day = dayOf(entry.at);
        const sep = document.createElement('div');
        sep.className = 'chat-day';
        sep.textContent = dayLabel(entry.at);
        thread.appendChild(sep);
      }
      const b = entry.kind === 'text' ? textBubble(entry) : fileBubble(entry);
      b.classList.add('bubble', entry.dir, entry.kind);
      if (entry.dir === 'out' && entry.item.result) b.classList.add(entry.item.result);
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = timeOf(entry.at) + (entry.dir === 'out' && entry.item.result ? ' · ' + (res[entry.item.result] || '') : '');
      const foot = document.createElement('div');
      foot.className = 'chat-foot';
      const acts = entry.kind === 'text' ? b.querySelector(':scope > .chat-acts') : null;
      if (acts) foot.appendChild(acts);
      foot.appendChild(meta);
      b.appendChild(foot);
      thread.appendChild(b);
    }
    // A transfer from this device waiting for an answer stays at the end of the thread
    if (current.ask) thread.appendChild(current.ask.el);
    if (!keepScroll || atEnd) thread.scrollTop = thread.scrollHeight;
    else thread.scrollTop = before;
    markChatRead(who);
    updateShrinkUi();
  }
  function resend(entry) {
    const peer = peerOf(current.who);
    if (!peer) return toast(t('{name} is not here right now. Open OmniBeam on it to send.', { name: current.who.name }));
    const files = sentFiles.get(entry.id);
    if (files) return peer.sendFiles(files);
    toast(t('Choose the same files again: they are only kept while this page is open'), 5000);
    pickFiles();
  }
  function sendFilesNow(files) {
    if (!files.length || !current) return;
    const peer = peerOf(current.who);
    if (peer) return peer.sendFiles(files);
    const pairing = pairingOf(current.who);
    if (pairing) {
      sendWhenOnline(pairing, files);
      toast(t('{n} file(s) waiting to send', { n: files.length }));
    }
  }
  function pickFiles() {
    fileInput.onchange = () => {
      const files = [...fileInput.files];
      fileInput.value = '';
      sendFilesNow(files);
    };
    fileInput.click();
  }
  function sendText() {
    const ta = $('.chat-compose textarea', current.dlg);
    const text = ta.value.trim();
    if (!text) return ta.focus();
    const peer = peerOf(current.who);
    if (peer) peer.sendText(text);
    else {
      const pairing = pairingOf(current.who);
      if (!pairing) return;
      // A message for an offline paired device waits with any files already waiting (see sendWhenOnline)
      const w = waiting.get(pairing.secret);
      sendWhenOnline(pairing, w ? w.files : [], w?.text ? w.text + '\n\n' + text : text);
      toast(t('The message goes as soon as {name} opens OmniBeam.', { name: pairing.name }));
    }
    ta.value = '';
    ta.style.height = '';
    ta.focus();
  }
  // draft: text put in the box, ready to send (Send again of a message)
  function open(who, draft) {
    addStyle();
    const dlg = dialog();
    current = { who, dlg, urls: [], observer: null };
    const ta = $('.chat-compose textarea', dlg);
    ta.value = typeof draft === 'string' ? draft : '';
    ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px'; };
    ta.onkeydown = (e) => {
      // Enter sends on computers; Shift+Enter (and Enter on phones) is a new line
      if (e.key === 'Enter' && !e.shiftKey && !isPhone && !e.isComposing) { e.preventDefault(); sendText(); }
    };
    dlg.onclick = (e) => {
      if (e.target.closest('.pin-text')) return $('.chat-pin', dlg).classList.toggle('open');
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'clear') clear();
      else if (act === 'ring') { const p = peerOf(current.who); ringDevice(p || pairingOf(current.who)); }
      else if (act === 'pin' || act === 'pin-edit') editPin();
      else if (act === 'unpin') { setPin(current.who, ''); toast(t('Note unpinned')); render(true); }
      else if (act === 'pin-copy') { const pin = pinOf(current.who); if (pin) navigator.clipboard.writeText(pin.text).then(() => toast(t('Copied to clipboard')), () => toast(t('Could not copy'))); }
      else if (act === 'sound') {
        setMsgSound(!msgSound);
        toast(msgSound ? t('Message sound on') : t('Message sound off'));
        if (msgSound) { unlockAudio(); chime(); }
      } else if (act === 'notif-no') offerAnswered();
      else if (act === 'notif-yes') {
        offerAnswered();
        Promise.resolve(Notification.requestPermission()).then((p) => { if (p === 'granted') toast(t('Notifications are on')); }).catch(() => {});
      } else if (act === 'attach') pickFiles();
      else if (act === 'send') sendText();
    };
    // Files dropped on the chat go to that device
    dlg.ondragover = (e) => { e.preventDefault(); };
    dlg.ondrop = async (e) => {
      e.preventDefault();
      const files = await filesFromDrop(e.dataTransfer);
      if (files.length) sendFilesNow(files);
    };
    dlg.onclose = () => {
      // The close event comes a moment after closing: if a chat was opened again meanwhile (a message arrived just
      // then), it belongs to that one and must not be undone
      if (!current || dlg.open) return;
      // Closed while a transfer was waiting for an answer: ask in the usual window instead
      const pending = current.ask;
      if (pending) {
        current.ask = null;
        pending.peer.asking = null;
        Promise.resolve().then(() => askAccept(pending.peer, pending.files)).then(pending.resolve);
      }
      for (const u of current.urls) URL.revokeObjectURL(u);
      current.observer?.disconnect();
      current = null;
    };
    render();
    if (!dlg.open) dlg.showModal();
    if (ta.value) ta.oninput();
    if (!isPhone || ta.value) ta.focus();
  }
  // A device wants to send files while its chat is open: ask in the thread, not in a window over it
  function ask(peer, files) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'bubble in file chat-ask';
      el.innerHTML = '<div class="chat-file"><span class="chat-icon" aria-hidden="true">📥</span><span><span class="chat-name"></span><small></small></span></div>'
        + '<div class="chat-acts"><button type="button" class="btn ghost small" data-ask="decline"></button><button type="button" class="btn small" data-ask="accept"></button></div>';
      $('.chat-name', el).textContent = files.length === 1 ? files[0].name.split('/').pop() : t('{n} files', { n: files.length });
      $('small', el).textContent = formatSize(files.reduce((s, f) => s + f.size, 0));
      $('[data-ask=accept]', el).textContent = t('Accept');
      $('[data-ask=decline]', el).textContent = t('Decline');
      const pending = { peer, files, resolve, el };
      const finish = (ok) => {
        peer.asking = null;
        if (current && current.ask === pending) current.ask = null;
        el.remove();
        resolve(ok);
      };
      peer.asking = finish;
      el.onclick = (e) => {
        const a = e.target.closest('[data-ask]')?.dataset.ask;
        if (a) finish(a === 'accept');
      };
      current.ask = pending;
      const thread = $('.chat-thread', current.dlg);
      thread.appendChild(el);
      thread.scrollTop = thread.scrollHeight;
      $('[data-ask=accept]', el).focus({ preventScroll: true });
    });
  }
  window.Chat = {
    open,
    ask,
    // The chat with this device is open now
    showing: (peer) => !!current && !!current.dlg.open && peerOf(current.who) === peer,
    refresh: () => render(true),
    get open_() { return !!current; },
  };
})();
