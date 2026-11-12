// OmniBeam owner stats page (/stats). Asks for STATS_KEY once, keeps it in this browser, and shows the daily
// totals from /api/stats for the chosen period (today, 7, 30, 90 days or a year, compared with the period before):
// visitors (countries, time spent, pages, sources, devices), transfers per day by route, a table, the problems
// browsers reported (report.js) and whether the TURN server works. Reloads itself every minute while it's open.
// Also: any From/To days, an "At a glance" summary, Save as PDF, Clear… (with Undo) and a JSON backup.
'use strict';
(function () {
  const KEY = 'omnibeam-stats-key';
  const $ = (s) => document.querySelector(s);
  const ROUTES = [
    { id: 'lan', name: 'Direct, same network', color: 'var(--s1)' },
    { id: 'internet', name: 'Direct, over the internet', color: 'var(--s2)' },
    { id: 'turn', name: 'TURN server', color: 'var(--s3)' },
    { id: 'relay', name: 'OmniBeam server relay', color: 'var(--s4)' },
  ];
  const size = (n) => {
    n = n || 0;
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
  };
  const KINDS = {
    transfer: 'Transfer failed', direct: 'Direct connection', js: 'Script error', socket: 'Server connection',
    link: 'Shared link', storage: 'Storage', shrink: 'Shrinking photos/videos', crash: 'Tab crashed', stuck: 'Stuck transfer',
  };
  const ROUTE_NAMES = { lan: 'same network', internet: 'internet', turn: 'TURN', relay: 'server relay', none: 'not connected' };
  const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const num = (n) => (n || 0).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let key = '';
  try { key = localStorage.getItem(KEY) || ''; } catch {}
  let range = 30;
  try { range = Number(localStorage.getItem(KEY + '-range')) || 30; } catch {}
  let last = null; // the latest answer from the server, for the CSV and for switching periods
  let endBack = 0; // the period ends this many days before today (0 = today), set by the From/To boxes
  let printing = false; // Save as PDF is open: no reload every minute
  let allCountries = false;
  // Days as YYYY-MM-DD (UTC): isoDay(0) is today, isoDay(1) yesterday; dayBack('2026-11-01') = days from then to today
  const isoDay = (back) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
  const dayBack = (d) => Math.round((Date.parse(isoDay(0)) - Date.parse(d)) / 86400000);
  const niceDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  // The period shown, as [start, end) in ms, for the problem reports (which have a time, not a day)
  const span = () => {
    const end = Date.parse(isoDay(endBack)) + 86400000;
    return [end - range * 86400000, end];
  };
  // "4 Nov 2026" or "6 Oct 2026 – 4 Nov 2026"
  const shownDays = () => (range === 1 ? niceDay(isoDay(endBack)) : `${niceDay(isoDay(endBack + range - 1))} – ${niceDay(isoDay(endBack))}`);

  async function load() {
    const r = await fetch(`/api/stats?days=${Math.min(400, Math.max(2, endBack + range * 2))}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (r.status === 404) throw new Error('The stats page is off: set STATS_KEY in server.js (or in cPanel) and restart the app.');
    if (r.status === 429) throw new Error('Too many wrong keys. Wait 10 minutes.');
    if (r.status === 403) throw new Error('Wrong key.');
    if (!r.ok) throw new Error('Could not load the stats.');
    return r.json();
  }
  function showLogin(message = '') {
    $('#view').hidden = true;
    $('#login').hidden = false;
    $('#error').textContent = message;
    $('#key').focus();
  }
  async function start() {
    if (!key) return showLogin();
    try {
      last = await load();
      render(last);
      $('#updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      try { localStorage.setItem(KEY, key); } catch {}
    } catch (err) {
      if (/Wrong key/.test(err.message)) { try { localStorage.removeItem(KEY); } catch {} }
      showLogin(err.message);
    }
  }
  $('#login').onsubmit = (e) => {
    e.preventDefault();
    key = $('#key').value.trim();
    start();
  };
  $('#logout').onclick = (e) => {
    e.preventDefault();
    try { localStorage.removeItem(KEY); } catch {}
    key = '';
    showLogin();
  };

  // The days of the chosen period (oldest first, including days with nothing) and of the period before it
  function period(data, n, back = 0) {
    const days = [];
    for (let i = n - 1 + back; i >= back; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      days.push({ date: d, ...(data.days[d] || {}) });
    }
    return days;
  }
  const sumOf = (days, f) => days.reduce((s, d) => s + (d[f] || 0), 0);
  // All fields that start with prefix ("uc_" -> { JO: 12, US: 3 }), added up over the days
  function group(days, prefix) {
    const out = {};
    for (const d of days) for (const k in d) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = (out[k.slice(prefix.length)] || 0) + d[k];
    return out;
  }
  const label = () => {
    if (endBack) return range === 1 ? isoDay(endBack) : `${range} days to ${isoDay(endBack)}`;
    return range === 1 ? 'today' : range === 365 ? '1 year' : `${range} days`;
  };
  // What the period before is called: "yesterday", "the day before", "the 30 days before"
  const beforeName = () => (range === 1 ? (endBack ? 'the day before' : 'yesterday') : `the ${endBack ? range + ' days' : label()} before`);
  const tile = (name, value, sub = '', delta = '') => `<div class="tile"><span>${esc(name)}</span><b>${esc(value)}</b>${delta}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  // "▲ 12% vs the 30 days before"
  function change(now, before) {
    if (!before && !now) return '';
    if (!before) return '<small class="delta up">new</small>';
    const p = Math.round(((now - before) / before) * 100);
    return `<small class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}% vs ${esc(beforeName())}</small>`;
  }
  const duration = (sec) => {
    sec = Math.round(sec || 0);
    if (sec < 60) return `${sec} s`;
    if (sec < 3600) return `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`;
    return `${Math.floor(sec / 3600)} h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')} min`;
  };
  let regionNames = null, langNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch {}
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc) && cc !== 'XX' ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐');
  const country = (cc) => {
    if (cc === 'XX') return 'Unknown';
    if (cc === 'T1') return 'Tor network';
    try { return (regionNames && regionNames.of(cc)) || cc; } catch { return cc; }
  };
  const language = (l) => { try { return (langNames && langNames.of(l)) || l; } catch { return l; } };
  const SOURCES = { direct: 'Direct (typed, bookmark, app)', 'google.com': 'Google', 'bing.com': 'Bing', 'x.com': 'X (Twitter)',
    'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'youtube.com': 'YouTube', 'reddit.com': 'Reddit', 'linkedin.com': 'LinkedIn',
    'tiktok.com': 'TikTok', 'snapchat.com': 'Snapchat', 'duckduckgo.com': 'DuckDuckGo', 'yahoo.com': 'Yahoo', 'yandex.com': 'Yandex', 'baidu.com': 'Baidu' };
  const DEVICES = { phone: 'Phone', tablet: 'Tablet', desktop: 'Computer' };
  const BUCKETS = ['Under 10 s', '10–30 s', '30 s – 1 min', '1–3 min', '3–10 min', '10–30 min', 'Over 30 min'];
  // A list of names with a bar for each (largest first), e.g. browsers
  function barList(el, counts, { name = (k) => k, max = 8, total } = {}) {
    const rows = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    total = total || rows.reduce((s, [, v]) => s + v, 0);
    if (!rows.length) { el.innerHTML = '<p class="empty">Nothing yet.</p>'; return; }
    const shown = rows.slice(0, max);
    const rest = rows.slice(max).reduce((s, [, v]) => s + v, 0);
    if (rest) shown.push(['(others)', rest]);
    const top = Math.max(...shown.map(([, v]) => v));
    el.innerHTML = `<ul class="bars">${shown.map(([k, v]) => `<li><span class="name" title="${esc(name(k))}">${esc(name(k))}</span><span class="val">${num(v)} · ${Math.round((v / total) * 100)}%</span><span class="track"><span class="fill" style="width:${((v / top) * 100).toFixed(1)}%"></span></span></li>`).join('')}</ul>`;
  }
  // Single-series bars, one per item (days or hours), with a tooltip each
  function columns(el, items, { W = 720, H = 200, ariaLabel, every = 5 }) {
    const top = 10, bottom = 24, left = 34;
    const max = Math.max(1, ...items.map((i) => i.v));
    const step = Math.max(1, Math.ceil(max / 4));
    const scaleMax = step * 4;
    const y = (v) => top + (H - top - bottom) * (1 - v / scaleMax);
    const bw = (W - left) / items.length;
    let svg = '';
    for (let g = 0; g <= 4; g++) {
      const v = g * step;
      svg += `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${num(v)}</text>`;
    }
    items.forEach((it, i) => {
      const x = left + i * bw + Math.min(2, bw * 0.15);
      const w = Math.max(1, bw - Math.min(4, bw * 0.3));
      svg += `<g class="bar"><title>${esc(it.tip)}</title><rect class="hit" x="${left + i * bw}" y="${top}" width="${bw}" height="${H - top - bottom}"/>`;
      if (it.v) svg += `<rect class="v" x="${x}" y="${y(it.v)}" width="${w}" height="${Math.max(1, y(0) - y(it.v))}" rx="${Math.min(3, w / 2)}" fill="var(--s1)"/>`;
      svg += '</g>';
      if (it.label && (i % every === every - 1 || i === items.length - 1)) svg += `<text class="axis" x="${i === items.length - 1 ? x + w : x + w / 2}" y="${H - 6}" text-anchor="${i === items.length - 1 ? 'end' : 'middle'}">${esc(it.label)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${svg}</svg>`;
  }

  function renderVisitors(data, days, before) {
    const sum = (f) => sumOf(days, f);
    const prev = (f) => sumOf(before, f);
    const now = data.now || {};
    $('#visits-off').hidden = now.visits !== false;
    $('#visits-off').textContent = 'Visitor counting is off on the server (VISITS=false in cPanel). Remove it and restart the app to turn it on.';
    const views = sum('views'), time = sum('time'), timed = sum('timed');
    $('#visit-tiles').innerHTML = [
      tile('Visitors now', num(now.visitors), `${num(now.online)} devices connected`),
      tile(`Visitors, ${label()}`, num(sum('visitors')), 'unique per day', change(sum('visitors'), prev('visitors'))),
      tile(`Page views, ${label()}`, num(views), sum('visitors') ? `${(views / sum('visitors')).toFixed(1)} per visitor` : '', change(views, prev('views'))),
      tile('Time on a page', views ? duration(time / views) : '–', `average · ${duration(time)} in total`,
        before.length && prev('views') ? change(time / views || 0, prev('time') / prev('views')) : ''),
      tile('Stayed 10 s or more', timed ? `${Math.round((sum('engaged') / timed) * 100)}%` : '–', 'of finished page visits'),
      tile('Countries', num(Object.keys(group(days, 'uc_')).filter((c) => c !== 'XX').length), `${num(sum('app'))} page views in the installed app`),
    ].join('');
    const live = Object.entries(now.countries || {}).sort((a, b) => b[1] - a[1]);
    $('#now').innerHTML = `<span><span class="dot" aria-hidden="true"></span>${num(now.visitors)} on the site right now</span>`
      + live.map(([cc, n]) => `<span class="chip">${flag(cc)} ${esc(country(cc))} ${num(n)}</span>`).join('');

    // Visitors per day (per hour of today when the period is today)
    if (range === 1) {
      $('#visit-chart-title').textContent = `Visits ${endBack ? 'on ' + niceDay(days[0].date) : 'today'} by hour (UTC)`;
      columns($('#visit-chart'), Array.from({ length: 24 }, (_, h) => ({ v: days[0]['vh_' + h] || 0, label: String(h), tip: `${h}:00–${h}:59 UTC: ${num(days[0]['vh_' + h])} page views` })),
        { ariaLabel: 'Page views by hour', every: 3 });
    } else {
      $('#visit-chart-title').textContent = 'Visitors per day';
      columns($('#visit-chart'), days.map((d) => ({ v: d.visitors || 0, label: d.date.slice(5),
        tip: `${d.date}\nVisitors: ${num(d.visitors)}\nPage views: ${num(d.views)}\nTime on a page: ${d.views ? duration((d.time || 0) / d.views) : '–'}` })),
      { ariaLabel: 'Visitors per day; Download CSV has the numbers', every: Math.max(1, Math.round(days.length / 6)) });
    }

    // Countries: visitors, views, share and average time per page view
    const uc = group(days, 'uc_'), vc = group(days, 'vc_'), tc = group(days, 'tc_');
    const totalV = Object.values(uc).reduce((s, v) => s + v, 0);
    const rows = Object.keys({ ...uc, ...vc }).sort((a, b) => (uc[b] || 0) - (uc[a] || 0) || (vc[b] || 0) - (vc[a] || 0));
    const topShare = Math.max(1, ...rows.map((c) => uc[c] || 0));
    const shown = allCountries ? rows : rows.slice(0, 15);
    $('#countries').innerHTML = rows.length ? `<thead><tr><th>Country</th><th>Visitors</th><th class="share">Share</th><th>Page views</th><th>Time on a page</th></tr></thead><tbody>${shown
      .map((c) => `<tr><td>${flag(c)} ${esc(country(c))}</td><td>${num(uc[c])} <small>(${totalV ? Math.round(((uc[c] || 0) / totalV) * 100) : 0}%)</small></td><td class="share"><i style="width:${(((uc[c] || 0) / topShare) * 100).toFixed(1)}%"></i></td><td>${num(vc[c])}</td><td>${vc[c] ? esc(duration((tc[c] || 0) / vc[c])) : '–'}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">No visitors counted in this period yet.</td></tr></tbody>';
    $('#countries-more').hidden = rows.length <= 15;
    $('#countries-more').textContent = allCountries ? 'Show the top 15' : `Show all ${rows.length} countries`;

    // How long pages stayed open
    const tb = BUCKETS.map((b, i) => [b, sum('tb_' + i)]);
    const tbTotal = tb.reduce((s, [, v]) => s + v, 0);
    const tbTop = Math.max(1, ...tb.map(([, v]) => v));
    $('#time-buckets').innerHTML = tbTotal ? `<ul class="bars">${tb.map(([b, v]) => `<li><span class="name">${esc(b)}</span><span class="val">${num(v)} · ${Math.round((v / tbTotal) * 100)}%</span><span class="track"><span class="fill" style="width:${((v / tbTop) * 100).toFixed(1)}%"></span></span></li>`).join('')}</ul>`
      : '<p class="empty">Nothing yet: a page is added here when its visit ends.</p>';

    // Visits by hour in this browser's time zone
    const off = -new Date().getTimezoneOffset() / 60;
    $('#hour-zone').textContent = `(your time, UTC${off >= 0 ? '+' : '−'}${Math.abs(off)})`;
    const byHour = Array(24).fill(0);
    for (let h = 0; h < 24; h++) byHour[(((h + Math.round(off)) % 24) + 24) % 24] += sum('vh_' + h);
    columns($('#hours'), byHour.map((v, h) => ({ v, label: String(h), tip: `${h}:00–${h}:59: ${num(v)} page views` })),
      { W: 300, H: 150, ariaLabel: 'Page views by hour of the day', every: 6 });

    // Pages: views and average time
    const vp = group(days, 'vp_'), tp = group(days, 'tp_');
    const pages = Object.entries(vp).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const topPage = Math.max(1, ...pages.map(([, v]) => v));
    $('#pages').innerHTML = pages.length ? `<thead><tr><th>Page</th><th>Views</th><th class="share">Share</th><th>Time on the page</th></tr></thead><tbody>${pages
      .map(([p, v]) => `<tr><td>${p.startsWith('/') && p !== '/d/' ? `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(p)}</a>` : esc(p === '/d/' ? '/d/… (shared links)' : p)}</td><td>${num(v)}</td><td class="share"><i style="width:${((v / topPage) * 100).toFixed(1)}%"></i></td><td>${esc(duration((tp[p] || 0) / v))}</td></tr>`).join('')}</tbody>`
      : '<tbody><tr><td class="empty">No page views in this period yet.</td></tr></tbody>';

    barList($('#sources'), group(days, 'us_'), { name: (k) => SOURCES[k] || k });
    barList($('#devices'), group(days, 'ud_'), { name: (k) => DEVICES[k] || k });
    barList($('#browsers'), group(days, 'ub_'));
    barList($('#systems'), group(days, 'uo_'));
    barList($('#langs'), group(days, 'ul_'), { name: (l) => `${language(l)} (${l})` });
  }
  $('#countries-more').onclick = () => { allCountries = !allCountries; if (last) render(last); };

  function render(data) {
    $('#login').hidden = true;
    $('#view').hidden = false;
    for (const b of document.querySelectorAll('.range button')) b.setAttribute('aria-pressed', String(!endBack && Number(b.dataset.days) === range));
    const days = period(data, range, endBack);
    const before = period(data, range, endBack + range);
    renderVisitors(data, days, before);
    const sum = (f) => sumOf(days, f);
    const prev = (f) => sumOf(before, f);
    const today = days[days.length - 1];
    const lastDay = endBack ? niceDay(today.date) : 'today'; // the last day of the period
    const transfers = sum('transfers');
    const direct = sum('t_lan') + sum('t_internet') + sum('t_turn');
    $('#tiles').innerHTML = [
      tile('Online now', num(data.now.online), 'connected devices'),
      tile(endBack ? `Transfers on ${lastDay}` : 'Transfers today', num(today.transfers), `${size(today.bytes)} · ${num(today.texts)} messages`),
      tile(`Transfers, ${label()}`, num(transfers), size(sum('bytes')), change(transfers, prev('transfers'))),
      tile(`Direct, ${label()}`, transfers ? `${Math.round((direct / transfers) * 100)}%` : '–', `${num(sum('t_lan'))} on the same network`),
      tile(`Connections, ${label()}`, num(sum('connections')), `${num(sum('networks'))} network-days`, change(sum('connections'), prev('connections'))),
      tile('Visitors who connected', sum('visitors') ? `${Math.min(100, Math.round((sum('networks') / sum('visitors')) * 100))}%` : '–', 'networks that connected ÷ visitors'),
      tile('Shared links', num(data.now.links), `${num(data.now.linkMb)} of ${num(data.now.linkMaxMb)} MB used`),
      tile(`Problems, ${label()}`, num(sum('err')), `${num(sum('e_transfer'))} failed transfers · ${num(today.err)} ${endBack ? 'on ' + lastDay : 'today'}`),
      tile(`Speed tests, ${label()}`, num(sum('speeds')), ROUTES.filter((r) => sum('sp_' + r.id))
        .map((r) => `${r.name} ${size((sum('spk_' + r.id) / sum('sp_' + r.id)) * 1024)}/s`).join(' · ') || 'average speed by route'),
    ].join('');

    $('#legend').innerHTML = ROUTES.map((r) => `<span><i style="background:${r.color}"></i>${esc(r.name)}</span>`).join('');

    // Stacked bars: one per day, segments by route, 2px gaps between segments
    const W = 720, H = 220, top = 10, bottom = 24, left = 34;
    const max = Math.max(1, ...days.map((d) => ROUTES.reduce((s, r) => s + (d['t_' + r.id] || 0), 0)));
    const step = Math.max(1, Math.ceil(max / 4));
    const scaleMax = step * 4;
    const y = (v) => top + (H - top - bottom) * (1 - v / scaleMax);
    const bw = (W - left) / days.length;
    let svg = '';
    for (let g = 0; g <= 4; g++) {
      const v = g * step;
      svg += `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    days.forEach((d, i) => {
      const x = left + i * bw + 2;
      let acc = 0;
      const tip = `${d.date}\n` + ROUTES.map((r) => `${r.name}: ${num(d['t_' + r.id])} (${size(d['b_' + r.id])})`).join('\n');
      svg += `<g class="bar"><title>${esc(tip)}</title><rect class="hit" x="${x - 2}" y="${top}" width="${bw}" height="${H - top - bottom}"/>`;
      for (const r of ROUTES) {
        const v = d['t_' + r.id] || 0;
        if (!v) continue;
        const y1 = y(acc + v), y0 = y(acc);
        const h = Math.max(1, y0 - y1 - (acc ? 2 : 0));
        svg += `<rect x="${x}" y="${y1}" width="${Math.max(2, bw - 4)}" height="${h}" rx="2" fill="${r.color}"/>`;
        acc += v;
      }
      svg += '</g>';
      const every = Math.max(1, Math.round(days.length / 6));
      if (i % every === every - 1 || i === days.length - 1) svg += `<text class="axis" x="${i === days.length - 1 ? x + bw - 4 : x + (bw - 4) / 2}" y="${H - 6}" text-anchor="${i === days.length - 1 ? 'end' : 'middle'}">${d.date.slice(5)}</text>`;
    });
    $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Transfers per day by route; the table below has the numbers">${svg}</svg>`;

    const cols = [
      ['Date', (d) => d.date], ['Visitors', (d) => num(d.visitors)], ['Page views', (d) => num(d.views)],
      ['Time on a page', (d) => (d.views ? duration((d.time || 0) / d.views) : '–')], ['Connections', (d) => num(d.connections)], ['Networks', (d) => num(d.networks)],
      ['Transfers', (d) => num(d.transfers)], ['Same network', (d) => num(d.t_lan)], ['Internet', (d) => num(d.t_internet)],
      ['TURN', (d) => num(d.t_turn)], ['Server relay', (d) => num(d.t_relay)], ['Messages', (d) => num(d.texts)],
      ['Data sent', (d) => size(d.bytes)], ['Through server', (d) => size(d.relayBytes)], ['Links made', (d) => num(d.links)],
      ['Link downloads', (d) => num(d.linkDownloads)], ['Problems', (d) => num(d.err)],
    ];
    $('#table').innerHTML = `<thead><tr>${cols.map(([h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${days.slice().reverse()
      .map((d) => `<tr>${cols.map(([, f]) => `<td>${esc(f(d))}</td>`).join('')}</tr>`).join('')}</tbody>`;

    renderSuccess(days, before);
    renderCrashes(days, before, data.errors || []);
    renderProblems(data.errors || []);
    renderTurn(data.turn || {});
    renderAlerts(data.alerts || {});
    renderWeekly(data.weekly || {});
    if (!supportersLoaded) loadSupporters();
    renderGlance(data);
    syncDates();
  }

  // The From/To boxes show the period on screen (unless someone is typing in them)
  function syncDates() {
    if ($('#dates').contains(document.activeElement)) return;
    for (const el of [$('#from'), $('#to')]) { el.max = isoDay(0); el.min = isoDay(399); }
    $('#from').value = isoDay(endBack + range - 1);
    $('#to').value = isoDay(endBack);
  }
  $('#dates').onsubmit = (e) => {
    e.preventDefault();
    let a = $('#from').value, b = $('#to').value;
    if (!a || !b) return;
    if (a > b) [a, b] = [b, a];
    endBack = Math.min(399, Math.max(0, dayBack(b)));
    range = Math.max(1, Math.min(400 - endBack, dayBack(a) - endBack + 1));
    allCountries = false;
    document.activeElement.blur();
    start();
  };

  // "At a glance": the period in a few lines, at the top (and at the top of the PDF)
  function renderGlance(data) {
    const days = period(data, range, endBack);
    const before = period(data, range, endBack + range);
    const sum = (f) => sumOf(days, f);
    const top = (counts) => Object.entries(counts).filter(([k, v]) => v > 0 && k !== 'XX').sort((a, b) => b[1] - a[1])[0];
    const best = (f) => days.reduce((b, d) => ((d[f] || 0) > (b[f] || 0) ? d : b), days[0]);
    const share = (n, all) => (all ? ` (${Math.round((n / all) * 100)}%)` : '');
    const visitors = sum('visitors'), pv = sumOf(before, 'visitors');
    const vs = pv ? ` · ${visitors >= pv ? '+' : '−'}${Math.abs(Math.round(((visitors - pv) / pv) * 100))}% vs ${beforeName()}` : '';
    const bestV = best('visitors'), bestT = best('transfers');
    const cc = top(group(days, 'uc_')), src = top(group(days, 'us_')), page = top(group(days, 'vp_'));
    const transfers = sum('transfers'), fail = sum('tfail');
    const direct = sum('t_lan') + sum('t_internet') + sum('t_turn');
    const rows = [
      ['Period', `${shownDays()} · ${range === 1 ? '1 day' : num(range) + ' days'} (UTC)`],
      ['Visitors', `${num(visitors)}${vs} · ${(visitors / days.length).toFixed(1)} a day · ${num(sum('views'))} page views`],
      ['Best day', bestV.visitors ? `${niceDay(bestV.date)} (${num(bestV.visitors)} visitors)` : '–'],
      ['Top country', cc ? `${flag(cc[0])} ${country(cc[0])}: ${num(cc[1])} visitors${share(cc[1], visitors)}` : '–'],
      ['Top source', src ? `${SOURCES[src[0]] || src[0]}: ${num(src[1])} visitors${share(src[1], visitors)}` : '–'],
      ['Top page', page ? `${page[0] === '/d/' ? '/d/… (shared links)' : page[0]}: ${num(page[1])} views` : '–'],
      ['Transfers', transfers ? `${num(transfers)} · ${size(sum('bytes'))} · ${Math.round((direct / transfers) * 100)}% direct · busiest day ${niceDay(bestT.date)} (${num(bestT.transfers)})` : '0'],
      ['Finished', transfers + fail ? `${Math.round((transfers / (transfers + fail)) * 100)}% of sends (${num(fail)} failed)` : '–'],
      ['Problems', `${num(sum('err'))} reports · ${num(sum('e_crash'))} tab crashes · ${num(sum('e_stuck'))} stuck transfers`],
      ['Counting since', data.first ? niceDay(data.first) : '–'],
    ];
    $('#glance').innerHTML = `<h2>At a glance</h2><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    $('#print-head').textContent = `OmniBeam stats · ${shownDays()} · made ${new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    renderData(data);
  }

  // Your data: the last clear (which Undo brings back)
  const CLEARED = { all: 'everything', visitors: 'visitors', transfers: 'transfers and feature counts', problems: 'problem reports' };
  function renderData(data) {
    const c = data.cleared;
    $('#undo').hidden = !c;
    $('#undo-info').textContent = c
      ? `Last clear: ${CLEARED[c.what] || c.what}, ${c.from ? `${niceDay(c.from)} – ${niceDay(c.to)}` : 'all days'}, on ${when(c.at)}. Undo adds those numbers back (anything counted since stays).`
      : 'Nothing cleared yet, or the last clear was undone.';
  }

  // How many sends finished, by route and by browser, and why the others stopped. Counted since the
  // version that reports failed sends (tfail/tcancel); cancelled sends don't count against the rate.
  function renderSuccess(days, before) {
    const sum = (f) => sumOf(days, f);
    const counted = days.filter((d) => 'tfail' in d || 'tcancel' in d || Object.keys(d).some((k) => k.startsWith('bo_')));
    const ok = sumOf(counted, 'transfers'), fail = sumOf(counted, 'tfail');
    const rate = (o, f) => (o + f ? `${Math.round((o / (o + f)) * 100)}%` : '–');
    const prevCounted = before.filter((d) => Object.keys(d).some((k) => k.startsWith('bo_')));
    const pOk = sumOf(prevCounted, 'transfers'), pFail = sumOf(prevCounted, 'tfail');
    const delta = pOk + pFail && ok + fail
      ? (() => { const p = Math.round((ok / (ok + fail) - pOk / (pOk + pFail)) * 100); return `<small class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)} points vs ${esc(beforeName())}</small>`; })()
      : '';
    $('#success-lead').textContent = counted.length
      ? `Sends that reached the end, out of those that started sending (cancelled ones left out). Counted on ${counted.length} of the ${days.length} days.`
      : 'Nothing counted yet: failed sends are counted from this version on.';
    $('#success-tiles').innerHTML = [
      tile(`Finished, ${label()}`, rate(ok, fail), `${num(ok)} finished · ${num(fail)} failed`, delta),
      tile('Failed', num(fail), `${num(sum('tw_lost'))} lost connection · ${num(sum('tw_error'))} other`),
      tile('Cancelled', num(sum('tcancel')), 'someone pressed Stop'),
      tile('Finished by itself', num(sum('tresumed')), 'continued after the connection dropped'),
      tile('Sent on to another device', num(sum('thandoff')), 'the rest went to another paired device after the first went offline'),
      tile('Rating / share prompt', num(sum('ask_shown')), `shown after sends · ${num(sum('ask_rate'))} rated · ${num(sum('ask_share'))} shared · ${num(sum('ask_no'))} not now`),
      tile('Link options', num(sum('linkPins')), `links with a PIN · ${num(sum('linkLimited'))} with a download limit · ${num(sum('linkLong'))} longer than 3 days · ${num(sum('linkSendTo'))} sent to an email or phone`),
      tile('Team rooms', num(sum('teamRooms')), `opened · ${num(sum('teamNew'))} new teams created`),
      tile('History', num(sum('sendAgain')), `Send again used · ${num(sum('histExport'))} exports · ${num(sum('galleryOpen'))} gallery views`),
      tile('Emails sent', num(sum('emailsSent')), `links emailed by the server (Resend) · ${num(sum('emailsFailed'))} failed`),
      tile('Clipboard history', num(sum('clipResend')), 'texts sent again from the Clipboard tab'),
      tile('Auto-send folder', num(sum('autoSend')), 'files sent by themselves from a watched folder'),
      tile('Big-file mode', num(sum('bigFiles')), 'sends with a file of 1 GB or more, checked piece by piece'),
      tile('Secret notes', num(sum('secretNotes')), `sent to a device · ${num(sum('noteLinks'))} read-once links made`),
      tile('Camera and voice', num(sum('photosTaken')), `photos taken and sent · ${num(sum('voiceNotes'))} voice notes`),
      tile('Request links', num(sum('requests')), `made · ${num(sum('requestFiles'))} uploads received (${size(sum('requestBytes'))})`),
      tile('Screen sharing', num(sum('screenShares')), `screens shown to a device · ${num(sum('previews'))} file previews opened`),
      tile('Ring my device', num(sum('rings')), 'times a device was rung to find it'),
      tile('Links opened', num(sum('linksOpened')), 'links that opened by themselves on the other device'),
      tile('Send to all my devices', num(sum('sendAll')), 'sends to several of your devices at once'),
      tile('Invite cards', num(sum('inviteCards')), 'invite pictures made to share OmniBeam'),
      tile('Device chats', num(sum('chatOpen')), `chats opened · ${num(sum('pins'))} notes pinned`),
      tile('Scan to PDF', num(sum('scans')), 'PDFs made from photos of pages'),
      tile('Video size', num(sum('videoShrunk')), `videos made smaller before sending · ${size(sum('videoSaved'))} saved`),
      tile('Telegram bot', num(sum('telegramOut')), `sent to Telegram · ${num(sum('telegramIn'))} received from it · ${num(sum('telegramLinks'))} chats linked`),
      tile('Embed box', num(sum('requestEmbedUploads')), 'uploads through the "Send me files" box on other sites'),
      tile('App lock', num(sum('lockOn')), `locks turned on · ${num(sum('cleanOn'))} auto-clean turned on`),
      tile('Move to a new phone', num(sum('backupsSaved')), `backup files saved · ${num(sum('backupsOpened'))} opened on a new device`),
      tile('Notification replies', num(sum('notifReplies')), 'quick replies sent from a notification'),
    ].join('');
    const table = (el, rows) => {
      rows = rows.filter((r) => r.ok + r.fail > 0).sort((a, b) => b.ok + b.fail - (a.ok + a.fail));
      if (!rows.length) { el.innerHTML = '<tbody><tr><td class="empty">Nothing yet.</td></tr></tbody>'; return; }
      el.innerHTML = `<thead><tr><th>Name</th><th>Finished</th><th>Failed</th><th>Rate</th><th class="share"></th></tr></thead><tbody>${rows.map((r) => {
        const pct = r.ok / (r.ok + r.fail);
        const color = pct >= 0.9 ? 'var(--s1)' : pct >= 0.7 ? 'var(--s3)' : '#c7392f';
        return `<tr><td>${esc(r.name)}</td><td>${num(r.ok)}</td><td>${num(r.fail)}</td><td><b>${rate(r.ok, r.fail)}</b></td><td class="share"><i style="width:${(pct * 100).toFixed(0)}%;background:${color}"></i></td></tr>`;
      }).join('')}</tbody>`;
    };
    table($('#success-routes'), [...ROUTES.map((r) => ({ name: r.name, ok: sumOf(counted, 't_' + r.id), fail: sum('tf_' + r.id) })),
      { name: 'Never connected', ok: 0, fail: sum('tf_none') }]);
    const bo = group(days, 'bo_'), bf = group(days, 'bf_');
    table($('#success-browsers'), [...new Set([...Object.keys(bo), ...Object.keys(bf)])].map((b) => ({ name: b, ok: bo[b] || 0, fail: bf[b] || 0 })));
    barList($('#success-why'), { 'Connection lost or other device left': sum('tw_lost'), 'Other error (saving, secure connection…)': sum('tw_error'), 'Cancelled': sum('tcancel') });
  }

  // Alerts by email or Telegram when problem reports spike (set up in server.js / cPanel)
  function renderAlerts(a) {
    const where = [a.email && `email to ${a.email}${a.sendmail ? '' : ' (⚠️ this server has no sendmail)'}`,
      a.telegram && `Telegram${a.chat ? '' : ' (send your bot a message, then press Send a test alert)'}`].filter(Boolean);
    let html = where.length
      ? `<p class="lead">${a.channels && a.channels.length ? '✅' : '⚠️'} Alerts go by ${esc(where.join(' and '))} when there are ${num(a.min)}+ problem reports within ${num(a.windowMin)} minutes (3× the usual number, from 2+ networks), at most once every ${num(a.everyMin)} minutes.</p>`
      : '<p class="lead">No alerts are set up. Set ALERT_EMAIL (your address) or ALERT_TELEGRAM_TOKEN in cPanel and restart the app; see server.js near the top.</p>';
    const i = a.instant || {};
    html += i.channels && i.channels.length
      ? `<p>✅ Crashes, stuck transfers and new script errors also go by ${esc(i.channels.map((c) => (c === 'telegram' ? 'Telegram' : 'email')).join(' and '))} as they happen: gathered for a minute, at most one message every ${num(i.everyMin)} minutes and ${num(i.maxDay)} a day (${num(i.today)} today).${i.last ? ` Last one: ${esc(when(i.last))}.` : ''}</p>`
      : '<p>⚠️ Crash and stuck-transfer alerts are off: they need ALERT_TELEGRAM_TOKEN in cPanel (the @OmniBeam_bot token), or INSTANT_ALERTS=email.</p>';
    if (i.error) html += `<p class="stats-error">Last crash/stuck alert failed: ${esc(i.error)}</p>`;
    if (a.last) html += `<p>Last spike alert: ${esc(when(a.last))}</p>`;
    if (a.error) html += `<p class="stats-error">Last attempt failed: ${esc(a.error)}</p>`;
    $('#alerts').innerHTML = html;
  }
  $('#alert-test').onclick = async () => {
    const out = $('#alert-result');
    out.textContent = 'Sending…';
    try {
      const r = await fetch('/api/stats/alert-test', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      const j = await r.json();
      out.textContent = j.sent && j.sent.length ? `Sent by ${j.sent.join(' and ')}.${j.error ? ' Failed: ' + j.error : ''}` : `Not sent: ${j.error || 'error ' + r.status}`;
      if (j.alerts) renderAlerts(j.alerts);
    } catch {
      out.textContent = 'Could not reach the server.';
    }
  };

  // Supporter codes (server.js: Supporter codes): make one for someone who donated, copy it, take it back
  let supportersLoaded = false;
  function renderSupporters(j) {
    supportersLoaded = true;
    if (!j.on) {
      $('#supporters').innerHTML = '<p class="lead">⚠️ Supporter codes are off: set SUPPORTER_KEY in cPanel (a long random secret of your own, never in a file) and restart the app. Keep the same key afterwards: changing it makes every code made with it stop working.</p>';
      $('#sup-make').disabled = true;
      $('#sup-list').innerHTML = '';
      return;
    }
    $('#sup-make').disabled = false;
    const live = j.codes.filter((c) => !c.revoked).length;
    $('#supporters').innerHTML = `<p class="lead">✅ ${num(live)} working code${live === 1 ? '' : 's'}${j.codes.length > live ? `, ${num(j.codes.length - live)} taken back` : ''}. Send a code to someone who donated: in OmniBeam, ⋯ → Settings → Supporter, they type it and get a ♥ on their card, 4 colour themes and extra pictures. Codes typed in: ${num(sumOf(Object.values(last?.days || {}), 'supporterUnlock'))} (last ${num(Object.keys(last?.days || {}).length)} days).</p>`;
    $('#sup-list').innerHTML = j.codes.length ? '<tr><th>Code</th><th>For</th><th>Made</th><th></th></tr>' + j.codes.map((c) => `<tr class="${c.revoked ? 'muted' : ''}"><td><code>${esc(c.code)}</code>${c.revoked ? ' (taken back)' : ''}</td><td>${esc(c.note || '')}</td><td>${esc(when(c.made))}</td><td><button type="button" class="link-btn" data-sup-copy="${esc(c.code)}">Copy</button> <button type="button" class="link-btn" data-sup-${c.revoked ? 'restore' : 'revoke'}="${esc(c.id)}">${c.revoked ? 'Give back' : 'Take back'}</button></td></tr>`).join('') : '';
  }
  async function supporters(method, query = '') {
    const r = await fetch('/api/stats/supporters' + query, { method, headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    if (!r.ok && r.status !== 409) throw new Error('error ' + r.status);
    return r.json();
  }
  async function loadSupporters() {
    try { renderSupporters(await supporters('GET')); } catch { $('#supporters').textContent = 'Could not load the supporter codes.'; }
  }
  $('#sup-make').onclick = async () => {
    const out = $('#sup-result');
    out.textContent = 'Making…';
    try {
      const j = await supporters('POST', '?note=' + encodeURIComponent($('#sup-note').value.trim()));
      if (j.error === 'no-key') { out.textContent = 'Set SUPPORTER_KEY first.'; return; }
      renderSupporters(j);
      $('#sup-note').value = '';
      out.textContent = `New code: ${j.made}`;
      navigator.clipboard?.writeText(j.made).then(() => { out.textContent += ' (copied)'; }, () => {});
    } catch {
      out.textContent = 'Could not reach the server.';
    }
  };
  $('#sup-list').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.supCopy) return navigator.clipboard?.writeText(b.dataset.supCopy).then(() => { $('#sup-result').textContent = `Copied ${b.dataset.supCopy}`; }, () => {});
    const q = b.dataset.supRevoke ? '?revoke=' + encodeURIComponent(b.dataset.supRevoke) : '?restore=' + encodeURIComponent(b.dataset.supRestore);
    if (b.dataset.supRevoke && !confirm('Take this code back? Devices using it lose the supporter perks.')) return;
    try { renderSupporters(await supporters('POST', q)); } catch { $('#sup-result').textContent = 'Could not reach the server.'; }
  };

  // Weekly summary (server.js: Weekly summary): when it goes out, and where
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function renderWeekly(w) {
    let html;
    if (w.on === false) html = '<p class="lead">The weekly summary is off (WEEKLY=false).</p>';
    else if (!w.channels || !w.channels.length) html = '<p class="lead">⚠️ No channel for the weekly summary: set ALERT_TELEGRAM_TOKEN, or ALERT_EMAIL with RESEND_API_KEY (or sendmail), in cPanel.</p>';
    else html = `<p class="lead">✅ Every ${esc(DAYS[w.day] || '?')} at ${esc(String(w.hour).padStart(2, '0'))}:00 (${esc(w.tz)}), the last 7 days go by ${esc(w.channels.join(' and '))}${w.channels.includes('email') ? (w.resend ? ' (email through Resend)' : ' (email through sendmail)') : ''}.</p>`;
    if (w.last) html += `<p>Last summary sent: ${esc(when(w.last))}</p>`;
    if (w.error) html += `<p class="stats-error">Last attempt failed: ${esc(w.error)}</p>`;
    $('#weekly').innerHTML = html;
  }
  $('#weekly-test').onclick = async () => {
    const out = $('#weekly-result');
    out.textContent = 'Sending…';
    try {
      const r = await fetch('/api/stats/weekly-test', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      const j = await r.json();
      out.textContent = j.sent && j.sent.length ? `Sent by ${j.sent.join(' and ')}.${j.error ? ' Failed: ' + j.error : ''}` : `Not sent: ${j.error || 'error ' + r.status}`;
      if (j.weekly) renderWeekly(j.weekly);
      if (j.preview) $('#weekly-preview').textContent = `${j.preview.subject}\n\n${j.preview.text}`;
    } catch {
      out.textContent = 'Could not reach the server.';
    }
  };

  // Crashes (a tab that stopped while on screen, see report.js) and stuck transfers (no progress for 30 s, app.js),
  // counted per day (e_crash, e_stuck) and listed one by one. Both also go to Telegram (Alerts below).
  function renderCrashes(days, before, list) {
    const sum = (f) => sumOf(days, f);
    const prev = (f) => sumOf(before, f);
    const [since, until] = span();
    const recent = list.filter((e) => (e.k === 'crash' || e.k === 'stuck') && e.t >= since && e.t < until);
    const share = (k, f) => { const n = recent.filter((e) => e.k === k && f(e)).length, all = recent.filter((e) => e.k === k).length; return all ? Math.round((n / all) * 100) + '%' : '–'; };
    const vs = (f) => (before.length ? `${num(prev(f))} in ${beforeName()}` : '');
    $('#crash-lead').textContent = 'A crash is a tab that stopped while on screen (browser crash or out of memory) and was opened again. '
      + 'A stuck transfer showed no progress for 30 seconds while the page was on screen. Both are sent to Telegram as they happen (see Alerts).';
    $('#crash-tiles').innerHTML = [
      tile(`Tab crashes, ${label()}`, num(sum('e_crash')), [vs('e_crash'), `${share('crash', (e) => e.busy)} during a transfer`].filter(Boolean).join(' · ')),
      tile(`Stuck transfers, ${label()}`, num(sum('e_stuck')), [vs('e_stuck'), `${share('stuck', (e) => e.role === 'receive')} on the receiving side`].filter(Boolean).join(' · ')),
      tile('In TV mode', num(recent.filter((e) => e.page === 'tv').length), 'crashes on /tv'),
    ].join('');
    const rows = recent.slice(-30).reverse();
    $('#crash-recent').innerHTML = rows.length ? `<thead><tr><th>Time</th><th>What</th><th>Device</th><th>Details</th></tr></thead><tbody>${rows
      .map((e) => `<tr><td>${esc(when(e.t))}</td><td>${esc(KINDS[e.k])}</td><td>${esc(`${e.os} · ${e.browser}`)}</td><td>${esc((e.k === 'stuck'
        ? [e.role === 'receive' ? 'receiving' : 'sending', e.pct != null ? `at ${e.pct}%` : '', e.secs ? `${e.secs} s without progress` : '',
          e.r ? ROUTE_NAMES[e.r] || e.r : '', e.same ? 'same Wi‑Fi' : '', e.size ? size(e.size) : '']
        : [e.busy ? 'during a transfer' : 'no transfer running', e.up ? `open ${e.up} min` : '', e.page && e.page !== 'app' ? `page: ${e.page}` : ''])
        .concat(e.v ? ['v' + e.v] : []).filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody>` : '';
  }

  // Problems: the same problem grouped (most frequent first), then the latest reports one by one
  function renderProblems(list) {
    const [since, until] = span();
    const recent = list.filter((e) => e.t >= since && e.t < until);
    const inPeriod = endBack ? `in ${label()}` : `from the last ${label()}`;
    const groups = new Map();
    for (const e of recent) {
      const key = e.k + '|' + e.m;
      const g = groups.get(key) || { k: e.k, m: e.m, n: 0, last: 0, where: new Map() };
      g.n++;
      g.last = Math.max(g.last, e.t);
      const w = `${e.os} · ${e.browser}`;
      g.where.set(w, (g.where.get(w) || 0) + 1);
      groups.set(key, g);
    }
    const top = [...groups.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 15);
    $('#problems-lead').textContent = recent.length
      ? `${recent.length} reports ${inPeriod} (the newest ${list.length >= 300 ? 300 : list.length} are stored). Reports never include file names, contents or addresses.`
      : `No problems reported ${endBack ? 'in ' + label() : 'in the last ' + label()}. Reports appear here when a transfer fails, a direct connection doesn’t work, a shared link breaks or the page hits an error.`;
    $('#problems-top').innerHTML = top.length ? `<thead><tr><th>Kind</th><th>Problem</th><th>Times</th><th>Last</th><th>Where</th></tr></thead><tbody>${top
      .map((g) => `<tr><td>${esc(KINDS[g.k] || g.k)}</td><td>${esc(g.m)}</td><td>${num(g.n)}</td><td>${esc(when(g.last))}</td><td>${esc([...g.where]
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${w} (${n})`).join(', '))}</td></tr>`).join('')}</tbody>` : '';
    const latest = list.slice(-40).reverse();
    $('#problems-recent').innerHTML = latest.length ? `<thead><tr><th>Time</th><th>Kind</th><th>Problem</th><th>Device</th><th>Route</th><th>Details</th></tr></thead><tbody>${latest
      .map((e) => `<tr><td>${esc(when(e.t))}</td><td>${esc(KINDS[e.k] || e.k)}</td><td>${esc(e.m)}</td><td>${esc(`${e.os} · ${e.browser}`)}</td><td>${esc([
        e.role === 'receive' ? 'receiving' : e.role === 'send' ? 'sending' : '', e.r ? ROUTE_NAMES[e.r] || e.r : '', e.same ? 'same Wi‑Fi' : '',
        e.size ? size(e.size) : ''].filter(Boolean).join(' · '))}</td><td>${esc([e.d, e.src, e.v ? 'v' + e.v : ''].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody>` : '';
  }

  function renderTurn(turn) {
    let html;
    if (!turn.provider) {
      html = '<p class="lead">No TURN server is set up, so devices that can’t connect directly use the OmniBeam server relay. See the TURN guide in DEPLOY.md.</p>';
    } else if (turn.ok) {
      html = `<p class="lead">✅ <b>${esc(turn.provider)}</b> is set up and gave ${num(turn.servers)} server login${turn.servers === 1 ? '' : 's'} just now.</p>`;
    } else {
      html = `<p class="lead">⚠️ <b>${esc(turn.provider)}</b> is set up, but getting a login failed${turn.error ? `: ${esc(turn.error)}` : ''}. Check the keys in cPanel and restart the app.</p>`;
    }
    $('#turn').innerHTML = html;
  }

  // Ask for a TURN-only connection with the same settings visitors get: if a "relay" candidate appears,
  // the TURN server answered this browser
  $('#turn-test').onclick = async () => {
    const out = $('#turn-result');
    out.textContent = 'Testing…';
    try {
      const cfg = await (await fetch('/config.json', { cache: 'no-store' })).json();
      const servers = (cfg.iceServers || []).filter((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
      if (!servers.length) { out.textContent = 'No TURN server in the settings.'; return; }
      const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'relay' });
      const found = [];
      const started = performance.now();
      pc.onicecandidate = (e) => {
        const c = e.candidate && e.candidate.candidate;
        if (c && / typ relay /.test(c)) found.push(`${(c.match(/ (udp|tcp) /i) || [])[1] || ''} in ${Math.round(performance.now() - started)} ms`);
      };
      pc.createDataChannel('test');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, 5000));
      pc.close();
      out.textContent = found.length ? `✅ TURN works from this browser (${found.slice(0, 3).join(', ')}).` : '❌ No answer from the TURN server within 5 seconds. Check the address, login and firewall.';
    } catch (err) {
      out.textContent = `❌ Test failed: ${err.message}`;
    }
  };

  // Period buttons, refresh, CSV download and a reload every minute while the page is on screen
  for (const b of document.querySelectorAll('.range button')) {
    b.onclick = () => {
      range = Number(b.dataset.days);
      endBack = 0;
      try { localStorage.setItem(KEY + '-range', String(range)); } catch {}
      allCountries = false;
      start();
    };
  }
  $('#refresh').onclick = () => start();
  setInterval(() => { if (key && !printing && document.visibilityState === 'visible' && !$('#view').hidden) start(); }, 60 * 1000);
  $('#csv').onclick = () => {
    if (!last) return;
    const days = period(last, range, endBack);
    const fields = ['visitors', 'views', 'time', 'engaged', 'timed', 'app', 'connections', 'networks', 'transfers', 't_lan', 't_internet', 't_turn',
      't_relay', 'texts', 'files', 'bytes', 'relayBytes', 'links', 'linkDownloads', 'err', 'tfail', 'tcancel', 'tresumed',
      'thandoff', 'ask_shown', 'ask_rate', 'ask_share', 'ask_no', 'linkPins', 'linkLimited', 'linkLong', 'linkSendTo',
      'teamRooms', 'teamNew', 'sendAgain', 'histExport', 'galleryOpen', 'emailsSent', 'emailsFailed', 'clipResend', 'autoSend', 'bigFiles', 'requests', 'requestFiles', 'requestBytes',
      'rings', 'linksOpened', 'sendAll', 'inviteCards', 'chatOpen', 'pins', 'scans', 'videoShrunk', 'videoSaved', 'telegramOut', 'telegramIn',
      'telegramLinks', 'requestEmbedUploads', 'lockOn', 'cleanOn', 'backupsSaved', 'backupsOpened', 'notifReplies'];
    const countries = Object.keys(group(days, 'uc_')).sort();
    const head = ['date', ...fields, ...countries.map((c) => 'visitors_' + c)];
    const rows = days.map((d) => [d.date, ...fields.map((f) => d[f] || 0), ...countries.map((c) => d['uc_' + c] || 0)]);
    const csv = [head, ...rows].map((r) => r.join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `omnibeam-stats-${days[0].date}-to-${days[days.length - 1].date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // Save as PDF: the browser's print dialog (choose "Save as PDF"), with every country listed and a title that
  // becomes the file name; stats.css hides the buttons and prints light colours
  let beforePrint = { title: '', all: false };
  $('#pdf').onclick = () => {
    if (!last) return;
    beforePrint = { title: document.title, all: allCountries };
    allCountries = true;
    render(last);
    document.title = `OmniBeam stats ${isoDay(endBack + range - 1)} to ${isoDay(endBack)}`;
    printing = true;
    setTimeout(() => window.print(), 50);
  };
  window.addEventListener('afterprint', () => {
    if (!printing) return;
    printing = false;
    document.title = beforePrint.title;
    allCountries = beforePrint.all;
    if (last) render(last);
  });

  // Clear…: pick what and which days, type CLEAR. The server keeps what it cleared, so Undo can bring it back.
  const dlg = $('#clear-dlg');
  $('#clear').onclick = () => {
    $('#clear-word').value = '';
    $('#clear-go').disabled = true;
    $('#clear-msg').textContent = '';
    $('#clear-period').textContent = shownDays();
    dlg.showModal();
    $('#clear-word').focus();
  };
  $('#clear-word').oninput = () => { $('#clear-go').disabled = $('#clear-word').value.trim().toUpperCase() !== 'CLEAR'; };
  $('#clear-cancel').onclick = () => dlg.close();
  $('#clear-form').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#clear-word').value.trim().toUpperCase() !== 'CLEAR') return;
    const what = $('input[name="clear-what"]:checked').value;
    const shown = $('input[name="clear-days"]:checked').value === 'shown';
    const q = `what=${what}&confirm=CLEAR` + (shown ? `&from=${isoDay(endBack + range - 1)}&to=${isoDay(endBack)}` : '');
    $('#clear-go').disabled = true;
    try {
      const r = await fetch(`/api/stats/clear?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 403 ? 'Wrong key.' : r.status === 429 ? 'Too many wrong keys. Wait 10 minutes.' : `Could not clear (${j.error || 'error ' + r.status}).`);
      dlg.close();
      $('#data-result').textContent = `Cleared (${num(j.cleared)} numbers, ${num(j.reports)} problem reports). Press Undo below to bring them back.`;
      start();
    } catch (err) {
      $('#clear-msg').textContent = /fetch/i.test(err.message) ? 'Could not reach the server.' : err.message;
      $('#clear-go').disabled = false;
    }
  };
  $('#undo').onclick = async () => {
    if (!confirm('Bring back the numbers from the last clear?')) return;
    const out = $('#data-result');
    out.textContent = 'Undoing…';
    try {
      const r = await fetch('/api/stats/clear?undo=1', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      out.textContent = r.ok ? 'Done: the cleared numbers are back.' : r.status === 404 ? 'Nothing to undo.' : `Could not undo (error ${r.status}).`;
      start();
    } catch {
      out.textContent = 'Could not reach the server.';
    }
  };
  // Download a backup (JSON): every day and problem report the server keeps for this page
  $('#backup').onclick = async () => {
    const out = $('#data-result');
    out.textContent = 'Making the backup…';
    try {
      const r = await fetch('/api/stats/backup', { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      if (!r.ok) throw new Error(`error ${r.status}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = `omnibeam-stats-backup-${isoDay(0)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      out.textContent = 'Backup downloaded.';
    } catch (err) {
      out.textContent = `Could not make the backup (${err.message}).`;
    }
  };

  start();
})();
