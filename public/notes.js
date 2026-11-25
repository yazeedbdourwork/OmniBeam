// OmniBeam: notes and to-do lists that stay the same on all of a person's paired devices (⋯ → Notes and to-dos).
// Kept on each device (localStorage omnibeam-notes); nothing is kept on the server. Sync, only with paired devices,
// over their encrypted connection:
//   - a change goes at once to every paired device that is online ({t:'nt-put', items});
//   - when two paired devices meet, the one with notes says what it has ({t:'nt-hi', have: [[id, changed at]…]}); the
//     other sends what is newer on its side (nt-put) and asks for what is newer there ({t:'nt-want', ids}).
// The newest change of a note wins. A deleted note leaves a small mark for 60 days, so it isn't brought back.
// It uses app.js's helpers ($, t, toast, peers, randomHex, escapeHtml…) directly.
'use strict';
(function () {
  const KEY = 'omnibeam-notes';
  const MAX = 300;
  const TEXT_MAX = 10000;
  const TASK_MAX = 150;
  const GONE_DAYS = 60;
  const esc = (s) => escapeHtml(String(s));
  const STYLE = `
.notes-dialog { width: min(560px, 100vw); max-width: 100vw; height: min(780px, 100dvh); max-height: 100dvh; padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.notes-dialog:not([open]) { display: none; }
@media (max-width: 600px) { .notes-dialog { width: 100vw; height: 100dvh; margin: 0; border-radius: 0; } }
.nt-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid rgba(127,127,127,.25); }
.nt-head h3 { flex: 1; margin: 0; font-size: 18px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nt-head .icon-btn[hidden] { display: none; }
.nt-body { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.nt-new { display: flex; gap: 8px; flex-wrap: wrap; }
.nt-new .btn { flex: 1; min-width: 140px; }
.nt-search { width: 100%; padding: 9px 12px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; box-sizing: border-box; }
.nt-card { display: block; width: 100%; text-align: start; border: 0; border-radius: 16px; padding: 12px 14px; background: rgba(127,127,127,.1); color: inherit; font: inherit; cursor: pointer; }
.nt-card:hover, .nt-card:focus-visible { background: rgba(127,127,127,.18); }
.nt-card b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
.nt-card .nt-prev { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; opacity: .8; font-size: 14px; margin-top: 2px; white-space: pre-wrap; unicode-bidi: plaintext; }
.nt-card small { display: block; opacity: .65; margin-top: 4px; font-size: 12px; }
.nt-empty { text-align: center; opacity: .75; margin: 30px auto; max-width: 32ch; }
.nt-title { width: 100%; border: 0; border-bottom: 1px solid rgba(127,127,127,.3); background: transparent; color: inherit; font: inherit; font-size: 20px; font-weight: 700; padding: 6px 2px; box-sizing: border-box; unicode-bidi: plaintext; }
.nt-text { width: 100%; flex: 1; min-height: 240px; border: 0; background: transparent; color: inherit; font: inherit; line-height: 1.5; resize: none; padding: 4px 2px; box-sizing: border-box; unicode-bidi: plaintext; }
.nt-title:focus, .nt-text:focus { outline: none; }
.nt-tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nt-task { display: flex; align-items: center; gap: 10px; padding: 4px 2px; }
.nt-task input[type=checkbox] { width: 22px; height: 22px; flex: none; accent-color: var(--accent, #5248e8); }
.nt-task input[type=text] { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; padding: 6px 2px; unicode-bidi: plaintext; }
.nt-task input[type=text]:focus { outline: none; border-bottom: 1px solid var(--accent, #5248e8); }
.nt-task.done input[type=text] { text-decoration: line-through; opacity: .55; }
.nt-task .nt-x { flex: none; border: 0; background: none; color: inherit; opacity: .5; font-size: 18px; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.nt-task .nt-x:hover { opacity: 1; background: rgba(127,127,127,.15); }
.nt-add { display: flex; gap: 8px; }
.nt-add input { flex: 1; min-width: 0; padding: 9px 12px; border-radius: 12px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; }
.nt-foot { padding: 8px 14px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid rgba(127,127,127,.25); font-size: 13px; opacity: .8; }
.nt-done-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; opacity: .8; }
`;
  let styled = false;
  let view = null; // null: the list; else the id of the note open
  let query = '';
  let saveTimer = 0;
  const dirty = new Set(); // ids changed here and not yet sent

  // ---------- Kept on this device ----------
  function all() {
    try { return (JSON.parse(localStorage.getItem(KEY)) || []).filter((n) => n && typeof n.id === 'string' && typeof n.at === 'number'); } catch { return []; }
  }
  function save(list) {
    const gone = Date.now() - GONE_DAYS * 864e5;
    list = list.filter((n) => !n.del || n.at > gone).sort((a, b) => b.at - a.at).slice(0, MAX);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { toast(t('Could not save: this device is out of space')); }
    return list;
  }
  const get = (id) => all().find((n) => n.id === id);
  // A note as it may be kept (from this device or another one)
  function clean(n) {
    if (!n || typeof n !== 'object' || typeof n.id !== 'string' || !/^[0-9a-f]{8,24}$/.test(n.id)) return null;
    const at = Number(n.at);
    if (!(at > 0) || at > Date.now() + 864e5) return null;
    if (n.del) return { id: n.id, at, del: 1 };
    return {
      id: n.id,
      at,
      kind: n.kind === 'todo' ? 'todo' : 'note',
      title: String(n.title || '').slice(0, 200),
      text: String(n.text || '').slice(0, TEXT_MAX),
      tasks: (Array.isArray(n.tasks) ? n.tasks : []).slice(0, TASK_MAX)
        .filter((x) => x && typeof x.id === 'string')
        .map((x) => ({ id: x.id.slice(0, 16), text: String(x.text || '').slice(0, 300), done: !!x.done })),
    };
  }
  function change(id, fn) {
    const list = all();
    let n = list.find((x) => x.id === id);
    if (!n) return null;
    fn(n);
    n.at = Math.max(Date.now(), n.at + 1);
    save(list);
    dirty.add(id);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(push, 700);
    return n;
  }
  function create(kind) {
    const n = { id: randomHex(8), at: Date.now(), kind, title: '', text: '', tasks: [] };
    save([n, ...all()]);
    dirty.add(n.id);
    push();
    wsSend({ type: 'stat', kind: 'notes' });
    return n;
  }
  function remove(id) {
    const list = all().map((n) => (n.id === id ? { id, at: Math.max(Date.now(), n.at + 1), del: 1 } : n));
    save(list);
    dirty.add(id);
    push();
  }
  // What came from another device: the newer of the two wins
  function merge(items) {
    const list = all();
    const byId = new Map(list.map((n) => [n.id, n]));
    let changed = false;
    for (const raw of [].concat(items || []).slice(0, MAX)) {
      const n = clean(raw);
      if (!n) continue;
      const mine = byId.get(n.id);
      if (mine && mine.at >= n.at) continue;
      byId.set(n.id, n);
      changed = true;
    }
    if (changed) {
      save([...byId.values()]);
      paint();
    }
    return changed;
  }

  // ---------- Sync with paired devices ----------
  const paired = () => [...peers.values()].filter((p) => p.pairSecret);
  async function send(p, msg) {
    try {
      await p.connect();
      if (peers.get(p.info.id) === p) p.sendJson(msg);
      return true;
    } catch { return false; }
  }
  // Notes in batches small enough for one message each
  async function sendItems(p, items) {
    let batch = [];
    let size = 0;
    for (const n of items) {
      const len = JSON.stringify(n).length;
      if (batch.length && size + len > 40000) { await send(p, { t: 'nt-put', items: batch }); batch = []; size = 0; }
      batch.push(n);
      size += len;
    }
    if (batch.length) await send(p, { t: 'nt-put', items: batch });
  }
  function push() {
    const ids = new Set(dirty);
    dirty.clear();
    const items = all().filter((n) => ids.has(n.id));
    if (!items.length) return;
    for (const p of paired()) sendItems(p, items);
    paintFoot();
  }
  function hello(p) {
    if (!p.pairSecret) return;
    send(p, { t: 'nt-hi', have: all().map((n) => [n.id, n.at]) });
  }
  function onMsg(p, msg) {
    if (!p.pairSecret) return;
    if (msg.t === 'nt-put') merge(msg.items);
    else if (msg.t === 'nt-hi') {
      const theirs = new Map([].concat(msg.have || []).slice(0, MAX * 2).filter((x) => Array.isArray(x) && typeof x[0] === 'string').map((x) => [x[0], Number(x[1]) || 0]));
      const list = all();
      // Newer here (or not there at all): send it; newer there: ask for it
      sendItems(p, list.filter((n) => !theirs.has(n.id) || theirs.get(n.id) < n.at));
      const mine = new Map(list.map((n) => [n.id, n.at]));
      const want = [...theirs].filter(([id, at]) => !mine.has(id) || mine.get(id) < at).map(([id]) => id);
      if (want.length) send(p, { t: 'nt-want', ids: want.slice(0, MAX) });
    } else if (msg.t === 'nt-want') {
      const ids = new Set([].concat(msg.ids || []).slice(0, MAX));
      sendItems(p, all().filter((n) => ids.has(n.id)));
    }
  }

  // ---------- The window ----------
  function dialog() {
    let dlg = document.getElementById('dlg-notes');
    if (dlg) return dlg;
    if (!styled) {
      styled = true;
      const s = document.createElement('style');
      s.textContent = STYLE;
      document.head.appendChild(s);
    }
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-notes';
    dlg.className = 'notes-dialog';
    dlg.setAttribute('aria-labelledby', 'notes-title');
    dlg.innerHTML = `
      <div class="nt-head">
        <button type="button" class="icon-btn" data-act="back" hidden title="${esc(t('Back'))}" aria-label="${esc(t('Back'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
        <h3 id="notes-title"></h3>
        <button type="button" class="icon-btn" data-act="delete" hidden title="${esc(t('Delete'))}" aria-label="${esc(t('Delete'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
        <button type="button" class="icon-btn" data-act="close" title="${esc(t('Close'))}" aria-label="${esc(t('Close'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="nt-body"></div>
      <p class="nt-foot" role="status"></p>`;
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('close', () => { if (dirty.size) push(); view = null; });
    document.body.appendChild(dlg);
    return dlg;
  }
  const when = (at) => {
    const d = new Date(at);
    return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
  };
  function paintFoot() {
    const dlg = document.getElementById('dlg-notes');
    if (!dlg) return;
    const on = paired().map((p) => p.info.name);
    $('.nt-foot', dlg).textContent = !loadPaired().length ? t('Pair your devices (link button at the top) to keep notes the same on all of them.')
      : on.length ? t('In sync with {names}', { names: on.join(', ') })
        : t('Your paired devices get the changes when OmniBeam is open on them.');
  }
  function paintList(body) {
    body.dataset.view = '';
    const list = all().filter((n) => !n.del);
    body.innerHTML = `<div class="nt-new"><button type="button" class="btn" data-act="new-note">＋ ${esc(t('Note'))}</button><button type="button" class="btn" data-act="new-todo">＋ ${esc(t('To-do list'))}</button></div>`;
    if (list.length > 4) {
      const s = document.createElement('input');
      s.type = 'search';
      s.className = 'nt-search';
      s.placeholder = t('Search');
      s.setAttribute('aria-label', t('Search'));
      s.value = query;
      s.oninput = () => { query = s.value; paintCards(body); };
      body.appendChild(s);
    }
    const box = document.createElement('div');
    box.className = 'nt-cards';
    box.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    body.appendChild(box);
    paintCards(body);
  }
  function paintCards(body) {
    const box = $('.nt-cards', body);
    const q = query.trim().toLowerCase();
    const list = all().filter((n) => !n.del && (!q || [n.title, n.text, ...n.tasks.map((x) => x.text)].join('\n').toLowerCase().includes(q)));
    box.innerHTML = '';
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'nt-empty';
      p.textContent = q ? t('No results') : t('Write a note or a to-do list here, and it shows up on your paired devices too.');
      box.appendChild(p);
      return;
    }
    for (const n of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nt-card';
      b.dataset.open = n.id;
      b.innerHTML = '<b></b><span class="nt-prev"></span><small></small>';
      const done = n.tasks.filter((x) => x.done).length;
      $('b', b).textContent = (n.kind === 'todo' ? '☑ ' : '') + (n.title || (n.kind === 'todo' ? t('To-do list') : t('Note')));
      $('.nt-prev', b).textContent = n.kind === 'todo' ? n.tasks.filter((x) => !x.done).slice(0, 3).map((x) => '○ ' + x.text).join('\n') : n.text;
      $('small', b).textContent = (n.kind === 'todo' ? t('{done} of {n} done', { done, n: n.tasks.length }) + ' · ' : '') + when(n.at);
      box.appendChild(b);
    }
  }
  function paintEditor(body, n) {
    body.innerHTML = '';
    body.dataset.view = n.id;
    const title = document.createElement('input');
    title.className = 'nt-title';
    title.maxLength = 200;
    title.placeholder = t('Title');
    title.setAttribute('aria-label', t('Title'));
    title.value = n.title;
    title.oninput = () => change(n.id, (x) => { x.title = title.value; });
    body.appendChild(title);
    if (n.kind === 'note') {
      const ta = document.createElement('textarea');
      ta.className = 'nt-text';
      ta.maxLength = TEXT_MAX;
      ta.placeholder = t('Note');
      ta.setAttribute('aria-label', t('Note'));
      ta.value = n.text;
      ta.oninput = () => change(n.id, (x) => { x.text = ta.value; });
      body.appendChild(ta);
      return ta;
    }
    const ul = document.createElement('ul');
    ul.className = 'nt-tasks';
    body.appendChild(ul);
    const paintTasks = () => {
      const cur = get(n.id);
      if (!cur) return;
      ul.innerHTML = '';
      // Open tasks first, done ones after
      for (const task of [...cur.tasks.filter((x) => !x.done), ...cur.tasks.filter((x) => x.done)]) {
        const li = document.createElement('li');
        li.className = 'nt-task' + (task.done ? ' done' : '');
        li.innerHTML = `<input type="checkbox"><input type="text" maxlength="300"><button type="button" class="nt-x" title="${esc(t('Delete'))}" aria-label="${esc(t('Delete'))}">×</button>`;
        const [box, text] = li.querySelectorAll('input');
        box.checked = task.done;
        box.setAttribute('aria-label', task.text);
        text.value = task.text;
        text.setAttribute('aria-label', t('Task'));
        box.onchange = () => { change(n.id, (x) => { const k = x.tasks.find((y) => y.id === task.id); if (k) k.done = box.checked; }); paintTasks(); };
        text.oninput = () => change(n.id, (x) => { const k = x.tasks.find((y) => y.id === task.id); if (k) k.text = text.value; });
        $('.nt-x', li).onclick = () => { change(n.id, (x) => { x.tasks = x.tasks.filter((y) => y.id !== task.id); }); paintTasks(); };
        ul.appendChild(li);
      }
      const done = cur.tasks.filter((x) => x.done).length;
      row.hidden = !done;
      $('span', row).textContent = t('{done} of {n} done', { done, n: cur.tasks.length });
    };
    const add = document.createElement('form');
    add.className = 'nt-add';
    add.innerHTML = `<input type="text" maxlength="300" placeholder="${esc(t('Add a task'))}" aria-label="${esc(t('Add a task'))}"><button type="submit" class="btn small">${esc(t('Add'))}</button>`;
    add.onsubmit = (e) => {
      e.preventDefault();
      const input = $('input', add);
      const text = input.value.trim();
      if (!text) return input.focus();
      if (get(n.id).tasks.length >= TASK_MAX) return toast(t('A list can have up to {n} tasks', { n: TASK_MAX }));
      change(n.id, (x) => { x.tasks.push({ id: randomHex(6), text, done: false }); });
      input.value = '';
      paintTasks();
      input.focus();
    };
    body.appendChild(add);
    const row = document.createElement('div');
    row.className = 'nt-done-row';
    row.innerHTML = `<span></span><button type="button" class="btn ghost small" data-act="clear-done">${esc(t('Remove done tasks'))}</button>`;
    body.appendChild(row);
    paintTasks();
    return $('input', add);
  }
  // Draws what is showing again (after a change from another device), keeping the cursor where it is
  function paint() {
    const dlg = document.getElementById('dlg-notes');
    if (!dlg || !dlg.open) return;
    const body = $('.nt-body', dlg);
    // (only when the note on screen is this one, being typed in)
    const editing = view && body.dataset.view === view && document.activeElement && body.contains(document.activeElement);
    $('#notes-title').textContent = view ? '' : t('Notes and to-dos');
    $('[data-act=back]', dlg).hidden = !view;
    $('[data-act=delete]', dlg).hidden = !view;
    paintFoot();
    if (!view) return paintList(body);
    const n = get(view);
    if (!n || n.del) { view = null; return paint(); }
    $('#notes-title').textContent = n.kind === 'todo' ? t('To-do list') : t('Note');
    // Someone is typing here: don't redraw under their fingers (their own change is newest anyway)
    if (editing) return;
    paintEditor(body, n);
  }
  function show(id, focus) {
    view = id;
    paint();
    const dlg = document.getElementById('dlg-notes');
    if (focus) (id ? $('.nt-title', dlg) : null)?.focus();
  }
  function onClick(e) {
    const dlg = document.getElementById('dlg-notes');
    const card = e.target.closest('[data-open]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    // What was tapped is drawn again: the page's own handlers must not see a tap outside the window
    if (card || act) e.stopPropagation();
    if (card) return show(card.dataset.open);
    if (act === 'close') dlg.close();
    else if (act === 'back') { if (dirty.size) push(); show(null); }
    else if (act === 'new-note' || act === 'new-todo') show(create(act === 'new-todo' ? 'todo' : 'note').id, true);
    else if (act === 'delete' && view) {
      if (!confirm(t('Delete this on all your paired devices?'))) return;
      remove(view);
      toast(t('Deleted'));
      show(null);
    } else if (act === 'clear-done' && view) {
      change(view, (x) => { x.tasks = x.tasks.filter((y) => !y.done); });
      paint();
    }
  }
  function open() {
    const dlg = dialog();
    view = null;
    query = '';
    paint();
    if (!dlg.open) dlg.showModal();
    paint();
    // Catch up with the paired devices here now
    for (const p of paired()) hello(p);
  }
  window.addEventListener('storage', (e) => { if (e.key === KEY) paint(); });
  window.Notes = { open, hello, onMsg, all, merge };
})();
