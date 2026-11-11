// OmniBeam: the parts of the app most visits never use, loaded by app.js the first time one is needed
// (see loadMore in app.js): the connection check and speed test, shrinking photos and videos, HEIC to JPG,
// "Save all as ZIP". They use app.js's helpers and state ($, t, peers, ws…)
// directly; app.js calls them through window.More.
'use strict';
(function () {
  // ---------- HEIC photos (see convertHeic in app.js) ----------
  async function heicToJpeg(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) return null;
      return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
    } catch {
      return null; // this browser can't read HEIC
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function convertHeic(files, receiverDevice) {
    if (/iOS|macOS/.test(receiverDevice) || !files.some(isHeic)) return files;
    let converted = 0;
    const out = [];
    for (const f of files) {
      const jpg = isHeic(f) ? await heicToJpeg(f) : null;
      if (jpg) converted++;
      if (jpg && pathOf(f) !== f.name) jpg.relPath = pathOf(f).replace(/\.(heic|heif)$/i, '.jpg');
      out.push(jpg || f);
    }
    if (converted) toast(t('Converted {n} HEIC photo(s) to JPG', { n: converted }));
    return out;
  }

  // ---------- Shrink photos and videos before sending (see shrinkFiles in app.js) ----------
  const PHOTO_MAX = 2048; // longest side
  const PHOTO_QUALITY = 0.82;
  const PHOTO_MIN_BYTES = 500 * 1024; // smaller photos are sent as they are
  // Videos: 720p (Smaller photos and videos) or 480p (Smallest), as MP4 (H.264 + AAC, plays everywhere)
  const VIDEO_SIZES = { all: { side: 720, bitrate: 2500000 }, small: { side: 480, bitrate: 1200000 } };
  const videoSize = () => VIDEO_SIZES[shrinkMode] || VIDEO_SIZES.all;
  const VIDEO_MAX_SECONDS = 15 * 60; // the slow way (played and recorded): longer videos are sent as they are
  const FAST_MAX_SECONDS = 2 * 3600;
  const VIDEO_MIN_BYTES = testNumber('omnibeam-video-min') || 10 * 1024 * 1024; // smaller videos are sent as they are
  const renamed = (f, ext) => {
    const name = f.name.replace(/\.[^./]+$/, '') + ext;
    const out = { name, path: pathOf(f) !== f.name ? pathOf(f).replace(/[^/]+$/, name) : null };
    return out;
  };
  // A PNG with see-through parts would get a black background as a JPG: it is sent as it is
  function hasTransparency(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor((w * h) / 400000)) * 4; // at most ~400k pixels looked at
    for (let i = 3; i < data.length; i += step) if (data[i] < 250) return true;
    return false;
  }
  async function shrinkPhoto(file) {
    if (file.size < PHOTO_MIN_BYTES || /^image\/gif$/.test(file.type) || /\.gif$/i.test(file.name)) return file;
    const png = /^image\/png$/.test(file.type) || /\.png$/i.test(file.name);
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode(); // turned the right way up from the photo's EXIF orientation (HEIC: only where the browser can read it)
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return file;
      const scale = Math.min(1, PHOTO_MAX / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: png });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (png && hasTransparency(ctx, canvas.width, canvas.height)) { canvas.width = canvas.height = 0; return file; }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
      canvas.width = canvas.height = 0;
      if (!blob || blob.size > file.size * 0.9) return file;
      const { name, path } = renamed(file, '.jpg');
      const out = new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
      if (path) out.relPath = path;
      return out;
    } catch {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  // The fast way (Chrome, Edge, Safari 26, Firefox 130+ with WebCodecs): the video is read straight from the file,
  // decoded, made smaller and encoded again by the browser's own video encoder (on the graphics chip where there is
  // one), much faster than it plays and with the page in the background too. Mediabunny (public/mediabunny.js,
  // loaded only now) reads and writes the MP4/MOV/WebM files. Returns null when this video or browser can't do it
  // (the slow way below is tried next), the file itself when it's already small enough.
  const loadMediabunny = () => loadScript('/mediabunny.js?v=1.63.0');
  async function shrinkVideoFast(file, job) {
    if (!FAST_VIDEO) return null;
    let input = null, conv = null;
    try {
      await loadMediabunny();
      const M = window.Mediabunny;
      input = new M.Input({ source: new M.BlobSource(file), formats: [M.MP4, M.QTFF, M.WEBM, M.MATROSKA] });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return null;
      const dur = await input.computeDuration();
      if (!isFinite(dur) || dur <= 0 || dur > FAST_MAX_SECONDS) return null;
      const { side, bitrate } = videoSize();
      if ((file.size * 8) / dur < bitrate * 1.6) return file; // already about as small as it would get
      // The size the video is shown at (turned the right way up); its shorter side becomes 720 or 480
      const sw = await track.getSquarePixelWidth(), sh = await track.getSquarePixelHeight();
      const [w, h] = (await track.getRotation()) % 180 ? [sh, sw] : [sw, sh];
      const size = Math.min(w, h) <= side ? {} : w < h ? { width: side } : { height: side };
      const outW = size.width || (size.height ? Math.round((w * side) / h) : w), outH = size.height || (size.width ? Math.round((h * side) / w) : h);
      if (!(await M.canEncodeVideo('avc', { width: outW + (outW % 2), height: outH + (outH % 2), bitrate }))) return null;
      const fps = (await track.computePacketStats(120).catch(() => null))?.averagePacketRate || 0;
      const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
      conv = await M.Conversion.init({
        input, output, showWarnings: false, tracks: 'primary',
        // 60 fps phone videos become 30 fps (half the frames to send); slower ones keep their frame rate
        video: { ...size, codec: 'avc', bitrate, ...(fps > 31 ? { frameRate: 30 } : {}) },
        // The sound is copied as it is (phone videos: AAC), only re-encoded if MP4 can't hold it
      });
      // Never lose the sound or the picture: anything this browser can't encode means the slow way instead
      if (!conv.isValid || conv.discardedTracks.some((d) => d.track.type === 'video' || d.track.type === 'audio')) return null;
      conv.onProgress = (p) => {
        job.progress(p);
        if (job.cancelled()) conv.cancel();
      };
      await conv.execute();
      const buf = output.target.buffer;
      if (!buf || !buf.byteLength || buf.byteLength > file.size * 0.8) return file;
      const { name, path } = renamed(file, '.mp4');
      const out = new File([buf], name, { type: 'video/mp4', lastModified: file.lastModified });
      if (path) out.relPath = path;
      return out;
    } catch (err) {
      if (conv && conv.state === 'canceled') return file;
      report('shrink', 'Could not shrink a video quickly: ' + (err.name || '') + ' ' + (err.message || ''), { size: file.size });
      return null;
    } finally {
      try { input && input.dispose(); } catch {}
    }
  }
  async function shrinkVideo(file, job) {
    if (file.size < VIDEO_MIN_BYTES) return file;
    const fast = await shrinkVideoFast(file, job);
    if (fast) return fast;
    if (job.cancelled()) return file;
    return shrinkVideoSlow(file, job);
  }
  // The slow way: plays the video (silently: its sound goes into the recording, not the speakers), draws each frame
  // smaller on a canvas and records that. Gives up, sending the original, if the page is hidden (browsers pause
  // drawing then) or every send waiting for it was cancelled.
  async function shrinkVideoSlow(file, job) {
    if (!VIDEO_TYPE) return file;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none';
    document.body.appendChild(video);
    let ctx = null;
    let rec = null;
    try {
      video.src = url;
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error('This browser can\'t read the video'));
        setTimeout(() => reject(new Error('Reading the video took too long')), 15000);
      });
      const dur = video.duration, w = video.videoWidth, h = video.videoHeight;
      const { side, bitrate: VIDEO_BITRATE } = videoSize();
      if (!w || !h || !isFinite(dur) || dur <= 0 || dur > VIDEO_MAX_SECONDS) return file;
      if ((file.size * 8) / dur < VIDEO_BITRATE * 1.6) return file; // already about as small as it would get
      const scale = Math.min(1, side / Math.min(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round((w * scale) / 2) * 2;
      canvas.height = Math.round((h * scale) / 2) * 2;
      const g = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        ctx = new AC();
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaElementSource(video).connect(dest);
        for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
        await ctx.resume();
      } else {
        video.muted = true;
      }
      rec = new MediaRecorder(stream, { mimeType: VIDEO_TYPE, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      const stopped = new Promise((resolve) => { rec.onstop = resolve; });
      await video.play();
      let running = true;
      const draw = () => {
        if (!running) return;
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        job.progress(video.currentTime / dur);
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(draw);
        else requestAnimationFrame(draw);
      };
      draw();
      rec.start(1000);
      let timer;
      const result = await new Promise((resolve) => {
        video.onended = () => resolve('done');
        video.onerror = () => resolve('error');
        timer = setInterval(() => {
          if (document.hidden) resolve('hidden');
          else if (job.cancelled()) resolve('cancelled');
        }, 300);
      });
      clearInterval(timer);
      running = false;
      video.pause();
      rec.stop();
      await stopped;
      if (result === 'hidden') toast(t('Shrinking stopped because the page was hidden. Sending the original video.'));
      if (result !== 'done') {
        if (result === 'error') report('shrink', 'Video playback failed while shrinking', { size: file.size });
        return file;
      }
      const blob = new Blob(parts, { type: VIDEO_TYPE.split(';')[0] });
      if (!blob.size || blob.size > file.size * 0.8) return file;
      const { name, path } = renamed(file, VIDEO_TYPE.startsWith('video/webm') ? '.webm' : '.mp4');
      const out = new File([blob], name, { type: blob.type, lastModified: file.lastModified });
      if (path) out.relPath = path;
      return out;
    } catch (err) {
      report('shrink', 'Could not shrink a video: ' + (err.name || '') + ' ' + (err.message || ''), { size: file.size });
      return file;
    } finally {
      if (rec && rec.state !== 'inactive') try { rec.stop(); } catch {}
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      URL.revokeObjectURL(url);
      if (ctx) ctx.close().catch(() => {});
    }
  }
  // One shrink per file, shared by all the devices it's sent to; it stops early only if every one of them cancelled
  const shrinkJobs = new WeakMap();
  function shrinkJob(file) {
    let job = shrinkJobs.get(file);
    if (job) return job;
    job = {
      users: new Set(),
      progress: (p) => { for (const u of job.users) u.progress(p); },
      cancelled: () => [...job.users].every((u) => u.gone()),
    };
    job.promise = (isVideo(file) ? shrinkVideo(file, job) : shrinkPhoto(file)).then((out) => {
      if (out === file) shrinkJobs.delete(file); // not shrunk (or stopped): try again next time
      return out;
    });
    shrinkJobs.set(file, job);
    return job;
  }
  async function shrinkFiles(files, peer, gone) {
    if (shrinkMode === 'off') return files;
    const wanted = wantShrink;
    if (!files.some(wanted)) return files;
    const out = [];
    let before = 0, after = 0;
    for (const [i, f] of files.entries()) {
      if (gone()) return files;
      if (!wanted(f)) { out.push(f); continue; }
      const video = isVideo(f);
      peer.setStatus(video ? t('Shrinking video…') : t('Shrinking photos {i} of {n}…', { i: i + 1, n: files.length }));
      const job = shrinkJob(f);
      const user = { gone, progress: (p) => peer.setStatus(t('Shrinking video… {pct}%', { pct: Math.min(99, Math.floor(p * 100)) })) };
      job.users.add(user);
      const small = await job.promise.finally(() => job.users.delete(user));
      if (small !== f) {
        before += f.size; after += small.size;
        if (video) wsSend({ type: 'stat', kind: 'video', saved: f.size - small.size });
      }
      out.push(small);
    }
    if (before) toast(t('Smaller: {size} instead of {was} (saved {saved})', { size: formatSize(after), was: formatSize(before), saved: formatSize(before - after) }), 4000);
    return out;
  }

  // ---------- ZIP (several received files in one download) ----------
  // Eight tables, so eight bytes are worked in one step ("slicing-by-8"): about 4x faster than one byte at a time,
  // which matters on phones, where the sender works this out while sending
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256 * 8);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    for (let n = 0; n < 256; n++) for (let k = 1; k < 8; k++) table[k * 256 + n] = (table[(k - 1) * 256 + n] >>> 8) ^ table[table[(k - 1) * 256 + n] & 0xff];
    return table;
  })();
  // Running CRC-32: start with 0xffffffff, feed the bytes in order, finish with crc32Final
  function crc32Update(crc, bytes) {
    const T = CRC_TABLE;
    const n = bytes.length;
    let i = 0;
    for (; i + 8 <= n; i += 8) {
      const a = crc ^ (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24));
      crc = T[1792 + (a & 0xff)] ^ T[1536 + ((a >>> 8) & 0xff)] ^ T[1280 + ((a >>> 16) & 0xff)] ^ T[1024 + (a >>> 24)]
        ^ T[768 + bytes[i + 4]] ^ T[512 + bytes[i + 5]] ^ T[256 + bytes[i + 6]] ^ T[bytes[i + 7]];
    }
    for (; i < n; i++) crc = T[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return crc >>> 0;
  }
  const crc32Final = (crc) => (crc ^ 0xffffffff) >>> 0;
  async function crc32(blob) {
    let crc = 0xffffffff;
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      crc = crc32Update(crc, value);
    }
    return crc32Final(crc);
  }
  function zipName(files) {
    // Files sent as a folder: name the ZIP after it
    const tops = new Set((files || []).map((f) => (f.name.includes('/') ? f.name.split('/')[0] : '')));
    if (tops.size === 1 && !tops.has('')) return `${[...tops][0]}.zip`;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `OmniBeam ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.zip`;
  }
  // ZIP without compression (photos and videos are compressed already). Files or a ZIP over 4 GB use ZIP64 fields,
  // which Windows, macOS, Android and iOS all open.
  const ZIP64_AT = 0xffffffff; // "look in the ZIP64 field"
  const ZIP64_MIN = ZIP64_AT;   // sizes and offsets from here on need ZIP64
  async function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    const used = new Set();
    let offset = 0;
    let any64 = false;
    for (const f of files) {
      // Same name twice in one ZIP: "photo.jpg", "photo (2).jpg"
      let name = f.name || 'file';
      for (let n = 2; used.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
      used.add(name.toLowerCase());
      const nameBytes = enc.encode(name);
      const size = f.blob.size;
      const crc = await crc32(f.blob);
      const big = size >= ZIP64_MIN;
      const farOff = offset >= ZIP64_MIN;
      if (big || farOff) any64 = true;
      const local = new DataView(new ArrayBuffer(30 + (big ? 20 : 0)));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, big ? 45 : 20, true);
      local.setUint16(6, 0x0800, true); // file names are UTF-8
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, big ? ZIP64_AT : size, true);
      local.setUint32(22, big ? ZIP64_AT : size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, big ? 20 : 0, true);
      const localExtra = big ? new DataView(local.buffer, 30) : null;
      if (localExtra) {
        localExtra.setUint16(0, 0x0001, true);
        localExtra.setUint16(2, 16, true);
        localExtra.setBigUint64(4, BigInt(size), true);
        localExtra.setBigUint64(12, BigInt(size), true);
      }
      const localHead = new Uint8Array(30 + nameBytes.length + (big ? 20 : 0));
      localHead.set(new Uint8Array(local.buffer, 0, 30), 0);
      localHead.set(nameBytes, 30);
      if (big) localHead.set(new Uint8Array(local.buffer, 30, 20), 30 + nameBytes.length);
      parts.push(localHead, f.blob);
      // Central directory entry: the ZIP64 extra holds only the values that didn't fit
      const extraLen = big || farOff ? 4 + (big ? 16 : 0) + (farOff ? 8 : 0) : 0;
      const entry = new DataView(new ArrayBuffer(46 + nameBytes.length + extraLen));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, extraLen ? 45 : 20, true);
      entry.setUint16(6, extraLen ? 45 : 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(12, time, true);
      entry.setUint16(14, date, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, big ? ZIP64_AT : size, true);
      entry.setUint32(24, big ? ZIP64_AT : size, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint16(30, extraLen, true);
      entry.setUint32(42, farOff ? ZIP64_AT : offset, true);
      new Uint8Array(entry.buffer).set(nameBytes, 46);
      if (extraLen) {
        let x = 46 + nameBytes.length;
        entry.setUint16(x, 0x0001, true);
        entry.setUint16(x + 2, extraLen - 4, true);
        x += 4;
        if (big) { entry.setBigUint64(x, BigInt(size), true); entry.setBigUint64(x + 8, BigInt(size), true); x += 16; }
        if (farOff) entry.setBigUint64(x, BigInt(offset), true);
      }
      central.push(entry.buffer);
      offset += localHead.length + size;
    }
    const centralSize = central.reduce((s, p) => s + p.byteLength, 0);
    const tail = [];
    const need64 = any64 || offset >= ZIP64_MIN || files.length >= 0xffff;
    if (need64) {
      // ZIP64 end of central directory record + locator
      const rec = new DataView(new ArrayBuffer(56 + 20));
      rec.setUint32(0, 0x06064b50, true);
      rec.setBigUint64(4, 44n, true);
      rec.setUint16(12, 45, true);
      rec.setUint16(14, 45, true);
      rec.setBigUint64(24, BigInt(files.length), true);
      rec.setBigUint64(32, BigInt(files.length), true);
      rec.setBigUint64(40, BigInt(centralSize), true);
      rec.setBigUint64(48, BigInt(offset), true);
      rec.setUint32(56, 0x07064b50, true);
      rec.setBigUint64(64, BigInt(offset + centralSize), true);
      rec.setUint32(72, 1, true);
      tail.push(rec.buffer);
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Math.min(files.length, 0xffff), true);
    end.setUint16(10, Math.min(files.length, 0xffff), true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, need64 ? ZIP64_AT : offset, true);
    return new Blob([...parts, ...central, ...tail, end.buffer], { type: 'application/zip' });
  }

  // ---------- Connection check ----------
  // Opened from the network ID next to this device's name. Looks at what this browser offers for direct connections
  // (its WebRTC addresses), compares its public address with what the server sees (a difference means a VPN or
  // proxy), lists how the last transfers went, and suggests fixes. Everything runs in the browser.
  async function gatherCandidates() {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const found = [];
    pc.onicecandidate = (e) => { if (e.candidate && e.candidate.candidate) found.push(e.candidate.candidate); };
    pc.createDataChannel('check');
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 6000);
      pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } };
    });
    pc.close();
    // "candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host ..." -> { address, type }
    return found.map((c) => {
      const parts = c.split(' ');
      return { address: parts[4] || '', type: parts[parts.indexOf('typ') + 1] || '' };
    });
  }
  const isPrivateV4 = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(a);
  const isV4 = (a) => /^\d+\.\d+\.\d+\.\d+$/.test(a);

  async function runConnectionCheck() {
    const dlg = $('#dlg-check');
    const list = $('.check-list', dlg);
    const tips = $('.check-tips', dlg);
    list.innerHTML = `<li class="check-run">${escapeHtml(t('Checking…'))}</li>`;
    tips.innerHTML = '';
    if (!dlg.open) dlg.showModal();
    const rows = [];
    const tipSet = new Set();
    const row = (state, title, detail, peer) => rows.push({ state, title, detail, peer });

    // Server connection
    if (!ws || ws.readyState !== WebSocket.OPEN) row('bad', t('Not connected to the OmniBeam server'), t('Check the internet connection.'));
    else if (usePolling) {
      row('warn', t('Connected through a fallback'), t('WebSockets are blocked (often by antivirus web protection or a proxy), so this device uses slower requests.'));
      tipSet.add('antivirus');
    } else row('ok', t('Connected to the OmniBeam server'), myNetworkId ? t('Network ID {id}: devices with the same ID find each other automatically.', { id: myNetworkId }) : '');

    let cands = [];
    try { cands = await gatherCandidates(); } catch {}
    const hosts = cands.filter((c) => c.type === 'host');
    const localV4 = hosts.map((c) => c.address).filter(isPrivateV4);
    const mdns = hosts.some((c) => c.address.endsWith('.local'));
    const srflx = [...new Set(cands.filter((c) => c.type === 'srflx').map((c) => c.address))];
    const relay = cands.some((c) => c.type === 'relay');

    // Local address: needed for a direct connection on the same Wi-Fi
    if (localV4.length) row('ok', t('This device shares its local address'), localV4[0]);
    else if (mdns) {
      row('warn', t('This device hides its local address'),
        t('The other device must then find it by name (mDNS), which Windows "Public" networks, some antivirus and many routers block. Allowing local connections fixes this.'));
      tipSet.add('fast');
    } else if (cands.length) {
      row('warn', t('No local address'), t('This browser offers no address on your Wi-Fi. A VPN may be routing everything, or WebRTC is limited in this browser.'));
      tipSet.add('vpn');
    } else {
      row('bad', t('WebRTC is not working in this browser'), t('Direct connections are not possible; transfers will go through the server.'));
    }

    // Public address and VPN check
    if (srflx.length) {
      const v4 = srflx.find(isV4);
      if (myPublicIp && isV4(myPublicIp) && v4 && v4 !== myPublicIp) {
        row('warn', t('A VPN or proxy is active'), t('The website sees {a}, but direct connections leave from {b}. Turn off VPNs, iCloud Private Relay and antivirus "secure connection" on both devices.', { a: myPublicIp, b: v4 }));
        tipSet.add('vpn');
      } else row('ok', t('Internet connections work (UDP)'), srflx.join(', '));
    } else if (cands.length) {
      row('warn', t('UDP to the internet is blocked'), t('Devices on other networks will connect through the server. On the same Wi-Fi a direct connection can still work.'));
    }
    if (relay) row('ok', t('TURN server available'), '');

    // Other devices and how the last transfers went
    for (const p of peers.values()) {
      const how = p.lastRoute === 'lan' ? t('direct on the same Wi-Fi')
        : p.lastRoute === 'turn' ? t('through the TURN server')
        : p.lastRoute === 'relay' ? t('through the OmniBeam server')
        : p.lastRoute === 'internet' ? t(p.info.sameNet ? 'through the router (not direct)' : 'direct over the internet')
        : t('no transfer yet');
      const state = !p.lastRoute || p.lastRoute === 'lan' || (!p.info.sameNet && p.lastRoute !== 'relay') ? 'ok' : 'warn';
      if (p.info.sameNet && p.lastRoute && p.lastRoute !== 'lan') { tipSet.add('fast'); tipSet.add('windows'); tipSet.add('router'); }
      row(state, `${p.info.name}${p.info.sameNet ? ` · ${t('same Wi-Fi')}` : ''}`, `${t('Last transfer')}: ${how}` + (p.directFailInfo ? ` · ${p.directFailInfo}` : ''), p.info.id);
    }
    if (!peers.size) row('info', t('No other devices visible'), t('Open OmniBeam on another device on this Wi-Fi to test a transfer.'));

    list.innerHTML = rows.map((r) => `<li class="check-${r.state}"><b>${escapeHtml(r.title)}</b>${r.detail ? `<span>${escapeHtml(r.detail)}</span>` : ''}`
      + (r.peer ? `<span class="speed-result" data-peer="${escapeHtml(r.peer)}">${escapeHtml(speedResults.get(r.peer) || '')}</span>`
        + `<button type="button" class="btn ghost small" data-act="speed" data-peer="${escapeHtml(r.peer)}">${escapeHtml(t('Test speed'))}</button>` : '')
      + '</li>').join('');
    const TIPS = {
      fast: 'Tap ⚡ Faster Wi-Fi transfers on one or both devices and allow the microphone once (nothing is recorded).',
      vpn: 'Turn off VPN apps, iCloud Private Relay and "Limit IP Address Tracking" (iPhone Wi-Fi settings) while sending.',
      windows: 'On Windows, set the Wi-Fi to a Private network: Settings → Network & internet → Wi-Fi → your network → Private network.',
      router: 'Use the main Wi-Fi, not a guest network, and turn off "AP isolation" or "client isolation" in the router.',
      antivirus: 'Antivirus web protection that scans encrypted connections can slow OmniBeam down; try turning it off for omnibeam.site.',
    };
    const guide = `${location.pathname.match(/^\/(ar|fr|es|tr)\//) ? location.pathname.slice(0, 4) : '/'}fix-slow-transfers-same-wifi`;
    tips.innerHTML = (tipSet.size ? `<h4>${escapeHtml(t('What to try'))}</h4><ul>${[...tipSet].map((k) => `<li>${escapeHtml(t(TIPS[k]))}</li>`).join('')}</ul>` : '')
      + `<p><a href="${guide}" target="_blank" rel="noopener">${escapeHtml(t('Guide: fix slow transfers on the same Wi-Fi'))}</a></p>`;
    $('[data-act="fast"]', dlg).hidden = fastWifi || !navigator.mediaDevices?.getUserMedia || !tipSet.has('fast');
  }
  // Test speed from a device card or Settings: open the connection check and start the test right away
  async function checkSpeedWith(id) {
    await runConnectionCheck();
    const btn = id && $(`[data-act=speed][data-peer="${CSS.escape(id)}"]`, $('#dlg-check'));
    if (btn) runSpeedTest(id, btn);
  }

  // Speed test from the Connection check, e.g. "11.8 MB/s · direct on the same Wi-Fi · 9 ms. 1 GB takes about 1 min 25 s"
  const speedResults = new Map(); // peer id -> last result text
  async function runSpeedTest(id, btn) {
    const peer = peers.get(id);
    const out = $(`.speed-result[data-peer="${CSS.escape(id)}"]`, $('#dlg-check'));
    if (!peer || !out) return;
    btn.disabled = true;
    out.textContent = t('Testing speed…');
    try {
      const r = await peer.speedTest();
      const how = { lan: 'direct on the same Wi-Fi', internet: peer.info.sameNet ? 'through the router (not direct)' : 'direct over the internet', turn: 'through the TURN server', relay: 'through the OmniBeam server' }[r.route];
      const gb = r.rate > 0 ? formatDuration(1024 ** 3 / r.rate) : '';
      const text = `${formatSize(r.rate)}/s · ${t(how)} · ${r.ping} ms` + (gb ? `. ${t('1 GB takes about {time}', { time: gb })}` : '');
      speedResults.set(id, text);
      out.textContent = text;
      wsSend({ type: 'stat', route: r.route, kind: 'speed', rate: Math.round(r.rate), bytes: 0, files: 0 });
    } catch (err) {
      out.textContent = t(err.message);
    }
    btn.disabled = false;
  }
  $('#dlg-check').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') $('#dlg-check').close();
    if (act === 'again') runConnectionCheck();
    if (act === 'speed') runSpeedTest(e.target.closest('[data-peer]').dataset.peer, e.target.closest('button'));
    if (act === 'fast') {
      await askFastWifi();
      runConnectionCheck();
    }
  });

  window.More = { convertHeic, shrinkFiles, zipName, makeZip, crc32, crc32Update, crc32Final, runConnectionCheck, checkSpeedWith };
})();
