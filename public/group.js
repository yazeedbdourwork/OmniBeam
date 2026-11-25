// OmniBeam: the group chat of a room, loaded by app.js when it is first opened (the "Group chat" button above the
// devices, shown once three devices or more are in the same public room or team room). What is written goes to
// every device of the room that is here now, each over its own encrypted connection; voice messages too (voice.js).
// It looks like the chat with one device (chat.js gives its styles), with the sender's name over each message.
// Who is in the room and the messages kept on this device: Groups in app.js.
'use strict';
(function () {
  const STYLE = `
.group-dialog .chat-who small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-dialog .g-from { display: block; font-size: 12px; font-weight: 700; margin-bottom: 1px; }
.group-dialog .avatar.g { background: linear-gradient(145deg, #8f84ff, #5248e8); font-size: 20px; }
`;
  let styled = false;
  let current = null; // { gid, dlg }
  const timeOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Each sender's name in its own colour
  const nameColor = (name) => {
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 70% ${document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 72 : 38}%)`;
  };
  function dialog() {
    let dlg = document.getElementById('dlg-group');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-group';
    dlg.className = 'chat-dialog group-dialog';
    dlg.setAttribute('aria-labelledby', 'group-title');
    dlg.innerHTML = `
      <div class="chat-head">
        <div class="avatar g" aria-hidden="true">👥</div>
        <div class="chat-who"><b id="group-title"></b><small class="g-members"></small></div>
        <button type="button" class="icon-btn" data-act="close" title="${escapeHtml(t('Close'))}" aria-label="${escapeHtml(t('Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="chat-thread" role="log" aria-live="polite" tabindex="0"></div>
      <p class="chat-note"></p>
      <div class="chat-compose">
        <textarea rows="1" maxlength="5000" aria-label="${escapeHtml(t('Message'))}" placeholder="${escapeHtml(t('Message'))}"></textarea>
        <button type="button" class="icon-btn" data-act="voice" title="${escapeHtml(t('Record a voice message'))}" aria-label="${escapeHtml(t('Record a voice message'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg></button>
        <button type="button" class="icon-btn round" data-act="send" title="${escapeHtml(t('Send'))}" aria-label="${escapeHtml(t('Send'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg></button>
      </div>`;
    document.body.appendChild(dlg);
    return dlg;
  }
  function render(keepScroll) {
    if (!current) return;
    const { gid, dlg } = current;
    const g = Groups.mine.get(gid);
    const members = Groups.members(gid);
    $('#group-title').textContent = g ? g.name : t('Group chat');
    $('.g-members', dlg).textContent = [t('You'), ...members.map((p) => p.info.name)].join(', ');
    const thread = $('.chat-thread', dlg);
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 60;
    thread.innerHTML = '';
    const items = Groups.items(gid);
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'chat-empty';
      empty.textContent = t('Write to everyone in this room at once. Only the devices here now get it.');
      thread.appendChild(empty);
    }
    items.forEach((m, i) => {
      const prev = items[i - 1];
      const next = items[i + 1];
      const same = (x) => x && !!x.mine === !!m.mine && x.from === m.from && Math.abs(x.at - m.at) < 120000;
      const b = document.createElement('div');
      b.className = `bubble text ${m.mine ? 'out' : 'in'}`;
      if (same(prev)) b.classList.add('grp');
      if (same(next)) b.classList.add('more-next'); else b.classList.add('tail');
      if (!m.mine && !same(prev)) {
        const from = document.createElement('span');
        from.className = 'g-from';
        from.textContent = m.from;
        from.style.color = nameColor(m.from);
        b.appendChild(from);
      }
      if (m.voice && window.Voice) {
        b.classList.add('voice');
        b.appendChild(window.Voice.player({ id: m.id, ms: m.voice.ms, load: () => VoiceStore.get(m.id, m.voice.mime) }));
      } else {
        const p = document.createElement('div');
        p.className = 'msg-text';
        p.innerHTML = linkify(m.text);
        b.appendChild(p);
      }
      const foot = document.createElement('div');
      foot.className = 'chat-foot';
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = timeOf(m.at) + (m.mine && m.to ? ' · ' + t('{n} devices', { n: m.to }) : '');
      foot.appendChild(meta);
      b.appendChild(foot);
      thread.appendChild(b);
    });
    const note = $('.chat-note', dlg);
    note.hidden = members.length > 0;
    note.textContent = t('Nobody else in this room is here right now.');
    for (const el of dlg.querySelectorAll('.chat-compose textarea, .chat-compose button')) el.disabled = !members.length;
    paintSend();
    if (!keepScroll || atEnd) thread.scrollTop = thread.scrollHeight;
    Groups.read(gid);
  }
  function paintSend() {
    const dlg = current.dlg;
    const has = !!$('textarea', dlg).value.trim();
    $('[data-act=send]', dlg).hidden = !has && !!window.Voice?.can();
    $('[data-act=voice]', dlg).hidden = has || !window.Voice?.can();
  }
  // To each device of the room here now, over its own connection
  async function sendText() {
    const ta = $('.chat-compose textarea', current.dlg);
    const text = ta.value.trim();
    if (!text) return ta.focus();
    const { gid } = current;
    const members = Groups.members(gid);
    if (!members.length) return toast(t('Nobody else in this room is here right now.'));
    ta.value = '';
    ta.style.height = '';
    paintSend();
    const id = randomHex(8);
    Groups.add(gid, { id, text, mine: 1, from: me.name, at: Date.now(), to: members.length });
    const results = await Promise.all(members.map(async (p) => {
      try {
        await p.connect();
        p.sendJson({ t: 'gtext', g: gid, id, text });
        return true;
      } catch { return false; }
    }));
    const failed = members.filter((p, i) => !results[i]).map((p) => p.info.name);
    if (failed.length) toast(t('Not delivered to {names}', { names: failed.join(', ') }), 5000);
    ta.focus();
  }
  async function sendVoice(blob, ms) {
    if (!current) return;
    const { gid } = current;
    const members = Groups.members(gid);
    if (!members.length) return;
    const id = randomHex(8);
    await VoiceStore.put(id, blob);
    Groups.add(gid, { id, text: voiceLabel(ms), voice: { ms: Math.round(ms), mime: blob.type }, mine: 1, from: me.name, at: Date.now(), to: members.length });
    const results = await Promise.all(members.map((p) => p.sendVoice(blob, ms, { id, g: gid })));
    const failed = members.filter((p, i) => !results[i]).map((p) => p.info.name);
    if (failed.length) toast(t('Not delivered to {names}', { names: failed.join(', ') }), 5000);
    wsSend({ type: 'stat', kind: 'voice' });
  }
  function open(gid) {
    window.Chat?.style?.();
    if (!styled) {
      styled = true;
      const s = document.createElement('style');
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    const dlg = dialog();
    current = { gid, dlg };
    const ta = $('textarea', dlg);
    ta.value = '';
    ta.oninput = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight + 2) + 'px';
      paintSend();
    };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !isPhone && !e.isComposing) { e.preventDefault(); sendText(); }
    };
    const mic = $('[data-act=voice]', dlg);
    if (window.Voice && !mic.wired) {
      mic.wired = true;
      window.Voice.wire(mic, $('.chat-compose', dlg), {
        allowed: () => !!current && Groups.members(current.gid).length > 0,
        send: (blob, ms) => sendVoice(blob, ms),
      });
    }
    dlg.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'send') sendText();
    };
    dlg.onclose = () => { if (current && !dlg.open) current = null; };
    render();
    if (!dlg.open) dlg.showModal();
    if (!isPhone) ta.focus();
  }
  window.Group = {
    open,
    refresh: () => render(true),
    showing: (gid) => !!current && current.gid === gid && current.dlg.open && document.visibilityState === 'visible',
  };
})();
