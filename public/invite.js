// OmniBeam: Invite a friend (menu -> Invite a friend, or Invite card under "Share OmniBeam"), loaded by app.js on
// first use together with qrcode.js. It draws a picture in the page's language: the logo, what OmniBeam does, "Free ·
// No app · No sign-up" and a QR code of the site's address (?utm_source=invite, so the stats page counts the visits).
// Square for posts and chats, tall for stories (WhatsApp status, Instagram, Snapchat). Share sends the picture with
// the link through the phone's share menu; Save picture downloads it; Copy link copies the address. Everything is
// drawn here on the device; nothing is uploaded.
'use strict';
(function () {
  const STYLE = `
.invite-dialog { width: min(520px, calc(100vw - 24px)); }
.invite-dialog .invite-preview { display: block; margin: 10px auto; max-width: 100%; max-height: min(52vh, 520px); border-radius: 14px; box-shadow: 0 6px 24px rgba(0,0,0,.18); background: rgba(127,127,127,.12); }
.invite-dialog .invite-formats { display: flex; justify-content: center; gap: 6px; margin: 4px 0 2px; }
.invite-dialog .invite-formats button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
.invite-dialog .row { flex-wrap: wrap; justify-content: center; }
`;
  const SIZES = { square: [1080, 1080], story: [1080, 1920] };
  const FONT = '"Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
  let current = null; // { url, format, blob, objectUrl }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  // Lines that fit maxWidth (words; languages without spaces, like Japanese and Chinese, by character)
  function wrap(ctx, text, maxWidth) {
    const spaced = /\s/.test(text.trim());
    const parts = spaced ? text.split(/\s+/) : [...text];
    const lines = [];
    let line = '';
    for (const p of parts) {
      const next = line ? line + (spaced ? ' ' : '') + p : p;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = p; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function qrModules(url) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr;
  }

  async function draw(url, format) {
    const [W, H] = SIZES[format];
    const tall = format === 'story';
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    const rtl = document.documentElement.dir === 'rtl';
    try { await document.fonts?.load(`800 64px ${FONT}`); } catch {}
    const logo = await loadImage('/icon.svg');

    // Background: the OmniBeam purple, with two soft circles of light
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#3d34d6');
    g.addColorStop(0.55, '#5248e8');
    g.addColorStop(1, '#8f7cff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (const [cx, cy, r, a] of [[W * 0.9, H * 0.08, W * 0.45, 0.16], [W * 0.05, H * 0.95, W * 0.55, 0.12]]) {
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, `rgba(255,255,255,${a})`);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    const pad = 84;
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.textBaseline = 'alphabetic';
    const startX = rtl ? W - pad : pad;
    let y = tall ? 150 : pad;

    // Logo on a white tile, and the name
    const tile = tall ? 150 : 120;
    const tileX = rtl ? W - pad - tile : pad;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, tileX, y, tile, tile, tile * 0.24);
    ctx.fill();
    if (logo) ctx.drawImage(logo, tileX + tile * 0.08, y + tile * 0.08, tile * 0.84, tile * 0.84);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${tall ? 76 : 64}px ${FONT}`;
    const nameX = rtl ? tileX - 32 : tileX + tile + 32;
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    ctx.fillText('OmniBeam', nameX, y + tile / 2 + (tall ? 27 : 23));
    ctx.restore();
    y += tile + (tall ? 150 : 84);

    // What it does
    const headSize = tall ? 92 : 74;
    ctx.font = `800 ${headSize}px ${FONT}`;
    const head = wrap(ctx, t('Send files between your phone and computer'), W - pad * 2).slice(0, 4);
    for (const line of head) { y += headSize * 1.08; ctx.fillText(line, startX, y); }
    y += tall ? 100 : 72;
    const subSize = tall ? 46 : 38;
    ctx.font = `600 ${subSize}px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (const line of wrap(ctx, t('Free · No app · No sign-up'), W - pad * 2).slice(0, 2)) { ctx.fillText(line, startX, y); y += subSize * 1.3; }
    if (tall) {
      // As many lines as fit above "Scan to try it" (long languages get fewer)
      y += 30;
      ctx.font = `500 40px ${FONT}`;
      const room = H - pad - 560 - 170;
      for (const line of wrap(ctx, t('iPhone, Android, Windows, Mac and more. Files go straight between your devices, encrypted.'), W - pad * 2).slice(0, 4)) {
        if (y + 54 > room) break;
        y += 54;
        ctx.fillText(line, startX, y);
      }
    }

    // The QR code on a white card at the bottom, with "Scan to try it" and the address
    const qr = qrModules(url);
    const n = qr.getModuleCount();
    const cardH = tall ? 560 : 330;
    const cardY = H - pad - cardH;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, pad, cardY, W - pad * 2, cardH, 40);
    ctx.fill();
    const qrSize = cardH - 70;
    const cell = Math.floor(qrSize / n);
    const qrPx = cell * n;
    const qrX = tall ? (W - qrPx) / 2 : rtl ? W - pad - 35 - qrPx : pad + 35;
    const qrY = tall ? cardY + 36 : cardY + (cardH - qrPx) / 2;
    ctx.fillStyle = '#1b1d2a';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect(qrX + col * cell, qrY + r * cell, cell, cell);
    ctx.fillStyle = '#1b1d2a';
    const host = new URL(url).host;
    if (tall) {
      // Below the code isn't room on the card: above it, in white
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 54px ${FONT}`;
      ctx.fillText(t('Scan to try it'), W / 2, cardY - 104);
      ctx.font = `600 42px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.save(); ctx.direction = 'ltr'; ctx.fillText(host, W / 2, cardY - 44); ctx.restore();
    } else {
      const textW = W - pad * 2 - qrPx - 35 * 3;
      const tx = rtl ? qrX - 35 : qrX + qrPx + 35;
      ctx.textAlign = rtl ? 'right' : 'left';
      ctx.font = `800 48px ${FONT}`;
      let ty = cardY + 120;
      for (const line of wrap(ctx, t('Scan to try it'), textW).slice(0, 2)) { ctx.fillText(line, tx, ty); ty += 58; }
      ctx.font = `600 36px ${FONT}`;
      ctx.fillStyle = '#5248e8';
      ctx.save(); ctx.direction = 'ltr'; ctx.fillText(host, tx, ty + 14); ctx.restore();
    }
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  function dialog() {
    let dlg = document.getElementById('dlg-invite');
    if (dlg) return dlg;
    const st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);
    dlg = document.createElement('dialog');
    dlg.id = 'dlg-invite';
    dlg.className = 'info-dialog invite-dialog';
    dlg.setAttribute('aria-labelledby', 'invite-title');
    dlg.innerHTML = `
      <h3 id="invite-title">${escapeHtml(t('Invite a friend'))}</h3>
      <p class="muted small">${escapeHtml(t('A picture with a QR code that opens OmniBeam. Share it in a chat or a story.'))}</p>
      <div class="invite-formats" role="group" aria-label="${escapeHtml(t('Size'))}">
        <button type="button" class="btn ghost small" data-format="square" aria-pressed="true">${escapeHtml(t('Square'))}</button>
        <button type="button" class="btn ghost small" data-format="story" aria-pressed="false">${escapeHtml(t('Story'))}</button>
      </div>
      <img class="invite-preview" alt="${escapeHtml(t('Invite card'))}">
      <div class="row">
        <button type="button" class="btn ghost" data-act="close">${escapeHtml(t('Close'))}</button>
        <button type="button" class="btn ghost" data-act="copy">${escapeHtml(t('Copy link'))}</button>
        <button type="button" class="btn ghost" data-act="save">${escapeHtml(t('Save picture'))}</button>
        <button type="button" class="btn" data-act="share" hidden>${escapeHtml(t('Share'))}</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.onclick = (e) => {
      const fmt = e.target.closest('[data-format]')?.dataset.format;
      if (fmt) return show(fmt);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') dlg.close();
      else if (act === 'copy') navigator.clipboard.writeText(current.url).then(() => toast(t('Link copied')), () => toast(current.url));
      else if (act === 'save') save();
      else if (act === 'share') share();
    };
    dlg.onclose = () => { if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl); if (current) current.objectUrl = null; };
    return dlg;
  }
  const fileOf = () => new File([current.blob], `omnibeam-invite-${current.format}.png`, { type: 'image/png' });
  function canShareFile() {
    try { return !!current?.blob && !!navigator.canShare && navigator.canShare({ files: [fileOf()] }); } catch { return false; }
  }
  async function show(format) {
    const dlg = dialog();
    current.format = format;
    for (const b of dlg.querySelectorAll('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === format));
    current.blob = await draw(current.url, format);
    if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
    current.objectUrl = URL.createObjectURL(current.blob);
    $('.invite-preview', dlg).src = current.objectUrl;
    $('[data-act=share]', dlg).hidden = !canShareFile();
  }
  function save() {
    const a = document.createElement('a');
    a.href = current.objectUrl;
    a.download = fileOf().name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(t('Picture saved'));
  }
  async function share() {
    const text = t('I send files between my phone and computer with OmniBeam. Free, nothing to install:') + ' ' + current.url;
    try {
      await navigator.share({ files: [fileOf()], text, title: 'OmniBeam' });
    } catch (err) {
      if (err?.name !== 'AbortError') save();
    }
  }
  window.Invite = {
    async open(url) {
      current = { url, format: 'square', blob: null, objectUrl: null };
      const dlg = dialog();
      if (!dlg.open) dlg.showModal();
      await show(current.format);
    },
    draw, // for the tests
  };
})();
