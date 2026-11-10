// OmniBeam: Scan to PDF, loaded by app.js the first time it is used (More… on a device -> Scan to PDF).
//   1. The camera opens in the page (or the phone's camera app when it can't): take one or more pages.
//   2. Each page's edges are found by themselves (edgesOf: a Sobel edge map, the area those edges close in, and
//      the biggest four-cornered shape around it; when that fails, the brightest area, since paper is usually
//      lighter than the table) and the page is straightened (warp: a perspective transform). The four corners
//      can be dragged by hand when the guess is wrong.
//   3. Colour or black and white (black text on white, from a local threshold), pages moved or deleted.
//   4. A PDF is made here, in the browser (makePdf: one JPEG per page, a few hundred bytes of PDF around them),
//      and sent like any file: to the device, to another one, by link, or saved.
// Nothing is uploaded except the finished PDF, the same way as any other file. It uses app.js's helpers and state
// ($, t, toast, peers, wsSend, chooseDevice, downloadBlob, formatSize…) directly; app.js calls it through window.Scan.
'use strict';
(function () {
  const SOURCE_MAX = 2400; // a photo is kept at most this big (longest side) while scanning
  const PAGE_MAX = 2000; // a straightened page in the PDF, longest side (about A4 at 240 dpi)
  const THUMB_MAX = 360;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  };
  const stopStream = (s) => s && s.getTracks().forEach((tr) => tr.stop());
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
  const toBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));

  // ---------- Finding the page's edges ----------
  // Works on a small copy (about 320 px), so it takes a few milliseconds even on old phones.
  function boxBlur(src, w, h) {
    const out = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        tmp[i] = (src[i - (x > 0 ? 1 : 0)] + src[i] + src[i + (x < w - 1 ? 1 : 0)]) / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        out[i] = (tmp[i - (y > 0 ? w : 0)] + tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) / 3;
      }
    }
    return out;
  }
  // Otsu's threshold: the grey level that best splits the picture into a dark and a light part
  function otsu(values) {
    const hist = new Float64Array(256);
    for (const v of values) hist[Math.max(0, Math.min(255, v | 0))]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, level = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; level = i; }
    }
    return level;
  }
  // The biggest group of touching pixels where mask[i] is 1: its pixel count and the pixels on its border
  function biggestRegion(mask, w, h) {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let bestSize = 0, bestBorder = null;
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      let top = 0, size = 0;
      const border = [];
      stack[top++] = start;
      seen[start] = 1;
      while (top) {
        const i = stack[--top];
        size++;
        const x = i % w, y = (i / w) | 0;
        let edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
          if (j < 0) continue;
          if (!mask[j]) { edge = true; continue; }
          if (!seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
        if (edge) border.push([x, y]);
      }
      if (size > bestSize) { bestSize = size; bestBorder = border; }
    }
    return { size: bestSize, border: bestBorder || [] };
  }
  // Convex hull (monotone chain), then the four of its points that span the biggest area
  function hull(points) {
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  function biggestQuad(h) {
    if (h.length < 4) return null;
    // At most 80 points: plenty for a page's outline, and it keeps this quick
    const pts = h.length > 80 ? Array.from({ length: 80 }, (_, i) => h[Math.floor((i * h.length) / 80)]) : h;
    const n = pts.length;
    let best = 0, quad = null;
    for (let i = 0; i < n; i++) {
      for (let k = i + 2; k < n; k++) {
        let b1 = 0, j1 = -1;
        for (let j = i + 1; j < k; j++) { const a = triArea(pts[i], pts[j], pts[k]); if (a > b1) { b1 = a; j1 = j; } }
        let b2 = 0, l1 = -1;
        for (let l = k + 1; l < n + i; l++) { const a = triArea(pts[k], pts[l % n], pts[i]); if (a > b2) { b2 = a; l1 = l % n; } }
        if (j1 >= 0 && l1 >= 0 && b1 + b2 > best) { best = b1 + b2; quad = [pts[i], pts[j1], pts[k], pts[l1]]; }
      }
    }
    return quad && { quad, area: best };
  }
  // Top-left, top-right, bottom-right, bottom-left
  function ordered(q) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    const byAngle = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    // atan2 goes clockwise on screen (y down) starting from the left: rotate so top-left (smallest x+y) is first
    let first = 0;
    byAngle.forEach((p, i) => { if (p[0] + p[1] < byAngle[first][0] + byAngle[first][1]) first = i; });
    return [0, 1, 2, 3].map((i) => byAngle[(first + i) % 4]);
  }
  function quadOk(q, w, h, minShare) {
    if (!q) return false;
    const area = triArea(q[0], q[1], q[2]) + triArea(q[0], q[2], q[3]);
    if (area < w * h * minShare || area > w * h * 0.985) return false;
    // Each side at least a sixth of the picture, and no corner folded back
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < Math.min(w, h) / 6) return false;
    }
    return true;
  }
  // The page's corners in the source canvas, or null when no page stands out
  function edgesOf(src) {
    const s = Math.min(1, 320 / Math.max(src.width, src.height));
    const w = Math.max(16, Math.round(src.width * s)), h = Math.max(16, Math.round(src.height * s));
    const c = canvasOf(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let grey = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    grey = boxBlur(boxBlur(grey, w, h), w, h);
    // Back to the photo's size. The thickened edges and the blur put each corner about two pixels (of the small
    // copy) outside the page: move it that far towards the middle.
    const back = (q) => {
      const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
      return ordered(q).map(([x, y]) => {
        const len = Math.hypot(cx - x, cy - y) || 1;
        return [(x + ((cx - x) / len) * 2.2) / s, (y + ((cy - y) / len) * 2.2) / s];
      });
    };
    // 1. Edges: Sobel gradient strength, the strongest ~12% count as edges, thickened by one pixel
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = grey[i - w + 1] + 2 * grey[i + 1] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - 1] - grey[i + w - 1];
        const gy = grey[i + w - 1] + 2 * grey[i + w] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - w] - grey[i - w + 1];
        mag[i] = Math.hypot(gx, gy);
      }
    }
    const sorted = Float32Array.from(mag).sort();
    const cut = Math.max(24, sorted[Math.floor(sorted.length * 0.88)]);
    const edge = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (mag[y * w + x] < cut) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) edge[(y + dy) * w + x + dx] = 1;
      }
    }
    // What the edges close in: everything the outside (the picture's border) can't reach without crossing an edge
    const outside = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!edge[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!edge[y * w + x] && !outside[y * w + x]) { outside[y * w + x] = 1; stack.push(y * w + x); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !outside[j] && !edge[j]) { outside[j] = 1; stack.push(j); }
      }
    }
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) inside[i] = outside[i] ? 0 : 1;
    let region = biggestRegion(inside, w, h);
    let found = region.size > w * h * 0.12 ? biggestQuad(hull(region.border)) : null;
    if (found && quadOk(found.quad, w, h, 0.12)) return back(found.quad);
    // 2. The lightest area (white paper on a darker table)
    const level = otsu(grey);
    const light = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) light[i] = grey[i] > level ? 1 : 0;
    region = biggestRegion(light, w, h);
    found = region.size > w * h * 0.12 ? biggestQuad(hull(region.border)) : null;
    if (found && quadOk(found.quad, w, h, 0.15)) return back(found.quad);
    return null;
  }
  const wholeOf = (src) => [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];

  // ---------- Straightening (perspective warp) ----------
  // The 3x3 matrix that takes points of the output rectangle (u, v) to the photo (x, y), from the four corners
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = from[i], [x, y] = to[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    // Gaussian elimination with partial pivoting
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      [b[c], b[p]] = [b[p], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = c + 1; r < 8; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = new Array(8);
    for (let r = 7; r >= 0; r--) {
      let sum = b[r];
      for (let k = r + 1; k < 8; k++) sum -= A[r][k] * h[k];
      h[r] = sum / A[r][r];
    }
    return [...h, 1];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // The page's size once straightened, at most `max` on its longest side (never bigger than the photo had it)
  function pageSize(q, max) {
    let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const s = Math.min(1, max / Math.max(w, h));
    return [Math.max(16, Math.round(w * s)), Math.max(16, Math.round(h * s))];
  }
  // srcData: the photo's pixels (ImageData). Bilinear sampling, row by row.
  function warp(srcData, q, outW, outH) {
    const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], q);
    const out = canvasOf(outW, outH);
    const g = out.getContext('2d');
    const img = g.createImageData(outW, outH);
    const o = img.data, sd = srcData.data, sw = srcData.width, sh = srcData.height;
    if (!H) return out;
    for (let v = 0; v < outH; v++) {
      for (let u = 0; u < outW; u++) {
        const z = H[6] * (u + 0.5) + H[7] * (v + 0.5) + H[8];
        let x = (H[0] * (u + 0.5) + H[1] * (v + 0.5) + H[2]) / z - 0.5;
        let y = (H[3] * (u + 0.5) + H[4] * (v + 0.5) + H[5]) / z - 0.5;
        x = Math.max(0, Math.min(sw - 1.001, x));
        y = Math.max(0, Math.min(sh - 1.001, y));
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const k = (v * outW + u) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * fx;
          const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * fx;
          o[k + ch] = top + (bot - top) * fy;
        }
        o[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return out;
  }
  // Black and white: each pixel against the average brightness around it (so shadows and uneven light don't
  // turn into black blotches), from an integral image
  function blackAndWhite(canvas) {
    const w = canvas.width, h = canvas.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const grey = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const sum = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += grey[y * w + x];
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    const r = Math.max(4, Math.round(Math.min(w, h) / 24));
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const mean = (sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
        const v = grey[y * w + x] < mean * 0.86 ? 0 : 255;
        const k = (y * w + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = v;
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }
  function render(page, max, bw) {
    const [w, h] = pageSize(page.corners, max);
    const out = warp(page.pixels, page.corners, w, h);
    return bw ? blackAndWhite(out) : out;
  }

  // ---------- The PDF ----------
  // One page per JPEG, each page as wide as A4 (595 pt) when upright, its height from the photo (and the other way
  // round for a landscape page). Format: PDF 1.4, objects written one after the other, then the table of where
  // each starts (xref).
  function makePdf(images, title) {
    const enc = new TextEncoder();
    const chunks = [];
    let length = 0;
    const offsets = [];
    const add = (part) => {
      const bytes = typeof part === 'string' ? enc.encode(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };
    const obj = (n, body) => { offsets[n] = length; add(`${n} 0 obj\n`); for (const b of [].concat(body)) add(b); add('\nendobj\n'); };
    const pdfText = (s) => '(' + String(s).replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, '\\$&') + ')';
    const d = new Date();
    const date = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    add('%PDF-1.4\n');
    add(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // "this file has binary data", as raw bytes
    const n = images.length;
    // 1 catalog, 2 pages, 3 info, then for each page: page, contents, image
    const kids = images.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
    obj(3, `<< /Producer (OmniBeam omnibeam.site) /Creator (OmniBeam Scan to PDF) /Title ${pdfText(title)} /CreationDate (${date}) >>`);
    images.forEach((im, i) => {
      const base = 4 + i * 3;
      // The short side is A4's short side (595 pt), the long side follows the page's shape
      const W = im.h >= im.w ? 595.28 : (595.28 * im.w) / im.h;
      const Hh = im.h >= im.w ? (595.28 * im.h) / im.w : 595.28;
      const fmt = (x) => x.toFixed(2);
      const content = `q ${fmt(W)} 0 0 ${fmt(Hh)} 0 0 cm /Im0 Do Q`;
      obj(base, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(W)} ${fmt(Hh)}] /Resources << /XObject << /Im0 ${base + 2} 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ${base + 1} 0 R >>`);
      obj(base + 1, [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
      obj(base + 2, [`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`, im.bytes, '\nendstream']);
    });
    const count = 4 + n * 3;
    const xref = length;
    add(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let i = 1; i < count; i++) add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    add(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  // ---------- The scan window ----------
  const STYLE = `
.scan-dialog { width: min(720px, 96vw); max-width: 96vw; }
.scan-stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; aspect-ratio: 3 / 4; max-height: 60vh; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; }
.scan-stage video { width: 100%; height: 100%; object-fit: contain; }
.scan-stage .scan-count { position: absolute; inset-inline-start: 10px; top: 10px; background: rgba(0,0,0,.6); color: #fff; border-radius: 999px; padding: 3px 10px; font-size: 13px; }
.scan-stage .scan-msg { color: #fff; padding: 20px; text-align: center; }
.scan-pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; margin: 6px 0 10px; max-height: 52vh; overflow: auto; padding: 2px; }
.scan-page { border: 1px solid var(--border, #ccc); border-radius: 10px; padding: 6px; display: flex; flex-direction: column; gap: 6px; align-items: center; background: var(--card, transparent); }
.scan-page img { width: 100%; height: 130px; object-fit: contain; background: #fff; border-radius: 6px; cursor: pointer; }
.scan-page .scan-no { font-size: 12px; opacity: .75; }
.scan-page .scan-tools { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
.scan-page .scan-tools button { min-width: 32px; min-height: 32px; padding: 2px 6px; border-radius: 8px; border: 1px solid var(--border, #ccc); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 14px; }
[dir=rtl] .scan-page .scan-tools .scan-arrow { transform: scaleX(-1); }
.scan-adjust { position: relative; touch-action: none; display: flex; justify-content: center; margin: 0 auto 10px; }
.scan-adjust canvas { max-width: 100%; max-height: 58vh; border-radius: 8px; touch-action: none; }
.scan-mode { display: flex; gap: 6px; justify-content: center; margin: 4px 0 10px; flex-wrap: wrap; }
.scan-mode button[aria-pressed=true] { outline: 2px solid currentColor; }
.scan-info { text-align: center; }
.scan-dialog .row { flex-wrap: wrap; }
`;
  let styled = false;
  function addStyle() {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = STYLE;
    document.head.appendChild(el);
  }
  function dialog() {
    let dlg = document.getElementById('dlg-scan');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'dlg-scan';
      dlg.className = 'scan-dialog';
      dlg.setAttribute('aria-labelledby', 'scan-title');
      document.body.appendChild(dlg);
    }
    return dlg;
  }
  // A picture (from the camera or a photo file) as a canvas of at most SOURCE_MAX, with its pixels and edges
  function addPage(pages, source, sw, sh) {
    const s = Math.min(1, SOURCE_MAX / Math.max(sw, sh));
    const c = canvasOf(sw * s, sh * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0, c.width, c.height);
    const corners = edgesOf(c);
    const page = { canvas: c, pixels: g.getImageData(0, 0, c.width, c.height), corners: corners || wholeOf(c), auto: !!corners, thumb: '' };
    pages.push(page);
    return page;
  }
  async function pageFromFile(pages, file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
      addPage(pages, bmp, bmp.width, bmp.height);
      bmp.close?.();
      return true;
    } catch {
      // Older browsers: through an <img>
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        addPage(pages, img, img.naturalWidth, img.naturalHeight);
        return true;
      } catch { return false; } finally { URL.revokeObjectURL(url); }
    }
  }

  // peer: the device the PDF is for (null: chosen at the end)
  function open(peer) {
    addStyle();
    const dlg = dialog();
    const pages = [];
    let stream = null;
    let bw = false;
    try { bw = localStorage.getItem('omnibeam-scan-bw') === '1'; } catch {}
    let adjusting = null; // the page whose corners are being moved
    let pdf = null; // { blob, name } once made for the current pages
    const target = () => (peer && peers.get(peer.info.id) === peer ? peer : null);
    const stage = (name) => {
      for (const el of dlg.querySelectorAll('[data-stage]')) el.hidden = el.dataset.stage !== name;
      if (name !== 'camera') { stopStream(stream); stream = null; }
    };
    dlg.innerHTML = `
      <h3 id="scan-title">${esc(t('Scan to PDF'))}${peer ? ` · <span class="who"></span>` : ''}</h3>
      <div data-stage="camera">
        <div class="scan-stage"><video playsinline muted autoplay></video><p class="scan-msg" hidden></p><span class="scan-count" hidden></span></div>
        <p class="muted small center">${esc(t('Hold the page flat in good light, with all four corners in the picture.'))}</p>
        <div class="row">
          <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
          <button type="button" class="btn ghost" data-act="app">${esc(t('Use the camera app'))}</button>
          <button type="button" class="btn" data-act="snap">${esc(t('Take page'))}</button>
          <button type="button" class="btn" data-act="done" hidden></button>
        </div>
      </div>
      <div data-stage="pages" hidden>
        <div class="scan-mode" role="group" aria-label="${esc(t('Colour'))}">
          <button type="button" class="btn small ghost" data-mode="colour">${esc(t('Colour'))}</button>
          <button type="button" class="btn small ghost" data-mode="bw">${esc(t('Black and white'))}</button>
        </div>
        <div class="scan-pages"></div>
        <p class="muted small scan-info"></p>
        <div class="row">
          <button type="button" class="btn ghost" data-act="close">${esc(t('Cancel'))}</button>
          <button type="button" class="btn ghost" data-act="more">${esc(t('Add page'))}</button>
          <button type="button" class="btn ghost" data-act="save">${esc(t('Save PDF'))}</button>
          <button type="button" class="btn ghost" data-act="link">${esc(t('Share by link'))}</button>
          <button type="button" class="btn" data-act="send"></button>
        </div>
      </div>
      <div data-stage="adjust" hidden>
        <p class="muted small center">${esc(t('Drag the four corners onto the corners of the page.'))}</p>
        <div class="scan-adjust"><canvas></canvas></div>
        <div class="row">
          <button type="button" class="btn ghost" data-act="whole">${esc(t('Whole photo'))}</button>
          <button type="button" class="btn ghost" data-act="auto">${esc(t('Find edges again'))}</button>
          <button type="button" class="btn" data-act="adjusted">${esc(t('Done'))}</button>
        </div>
      </div>`;
    if (peer) dlg.querySelector('.who').textContent = peer.info.name;
    const video = $('video', dlg);
    const msg = $('.scan-msg', dlg);
    const countEl = $('.scan-count', dlg);
    const doneBtn = $('[data-act=done]', dlg);
    const updateCount = () => {
      countEl.hidden = !pages.length;
      countEl.textContent = t('{n} page(s)', { n: pages.length });
      doneBtn.hidden = !pages.length;
      doneBtn.textContent = t('Done ({n})', { n: pages.length });
    };
    const startCamera = async () => {
      stage('camera');
      msg.hidden = true;
      video.hidden = false;
      updateCount();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('none');
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } } });
        if (!dlg.open) return stopStream(stream);
        video.srcObject = stream;
        await video.play().catch(() => {});
        $('[data-act=snap]', dlg).hidden = false;
      } catch (err) {
        video.hidden = true;
        msg.hidden = false;
        msg.textContent = err && err.name === 'NotAllowedError'
          ? t('Camera access was not allowed. You can use the camera app instead, or allow the camera in the browser settings.')
          : t('The camera could not be opened here. You can use the camera app instead.');
        $('[data-act=snap]', dlg).hidden = true;
      }
    };
    const thumbOf = async (page) => {
      const c = render(page, THUMB_MAX, bw);
      const blob = await toBlob(c, 'image/jpeg', 0.7);
      if (page.thumb) URL.revokeObjectURL(page.thumb);
      page.thumb = blob ? URL.createObjectURL(blob) : '';
    };
    const showPages = async () => {
      stage('pages');
      pdf = null;
      for (const b of dlg.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', String((b.dataset.mode === 'bw') === bw));
      const list = $('.scan-pages', dlg);
      list.innerHTML = '';
      $('[data-act=send]', dlg).textContent = target() ? t('Send to {name}', { name: peer.info.name }) : t('Send to a device');
      $('[data-act=link]', dlg).hidden = !window.OmniLink?.available();
      $('.scan-info', dlg).textContent = pages.length ? t('{n} page(s). Tap a page to move its corners.', { n: pages.length }) : t('No pages yet.');
      for (const b of dlg.querySelectorAll('[data-act=send], [data-act=save], [data-act=link]')) b.disabled = !pages.length;
      for (const [i, page] of pages.entries()) {
        if (!page.thumb) await thumbOf(page);
        const el = document.createElement('div');
        el.className = 'scan-page';
        el.innerHTML = `<img alt=""><span class="scan-no"></span><div class="scan-tools">
          <button type="button" class="scan-arrow" data-page="back" title="${esc(t('Move earlier'))}" aria-label="${esc(t('Move earlier'))}">◀</button>
          <button type="button" data-page="adjust" title="${esc(t('Adjust corners'))}" aria-label="${esc(t('Adjust corners'))}">⤢</button>
          <button type="button" data-page="delete" title="${esc(t('Delete page'))}" aria-label="${esc(t('Delete page'))}">✕</button>
          <button type="button" class="scan-arrow" data-page="next" title="${esc(t('Move later'))}" aria-label="${esc(t('Move later'))}">▶</button></div>`;
        $('img', el).src = page.thumb;
        $('img', el).alt = t('Page {n}', { n: i + 1 });
        $('img', el).dataset.page = 'adjust';
        $('.scan-no', el).textContent = t('Page {n}', { n: i + 1 });
        $('[data-page=back]', el).disabled = i === 0;
        $('[data-page=next]', el).disabled = i === pages.length - 1;
        el.dataset.i = i;
        list.appendChild(el);
      }
    };
    // Moving the corners by hand: the photo drawn on a canvas, four round handles that follow the finger or mouse
    const adjust = (page) => {
      adjusting = { page, corners: page.corners.map((p) => p.slice()) };
      stage('adjust');
      const canvas = $('.scan-adjust canvas', dlg);
      const src = page.canvas;
      const s = Math.min(1, 900 / Math.max(src.width, src.height));
      canvas.width = Math.round(src.width * s);
      canvas.height = Math.round(src.height * s);
      const g = canvas.getContext('2d');
      const radius = Math.max(10, Math.round(Math.max(canvas.width, canvas.height) / 40));
      const draw = () => {
        g.drawImage(src, 0, 0, canvas.width, canvas.height);
        const q = adjusting.corners.map(([x, y]) => [x * s, y * s]);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.rect(0, 0, canvas.width, canvas.height);
        g.moveTo(q[0][0], q[0][1]);
        for (let i = 3; i >= 1; i--) g.lineTo(q[i][0], q[i][1]);
        g.closePath();
        g.fill('evenodd');
        g.strokeStyle = '#7c5cff';
        g.lineWidth = Math.max(2, radius / 4);
        g.beginPath();
        q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.stroke();
        for (const [x, y] of q) {
          g.beginPath();
          g.arc(x, y, radius, 0, Math.PI * 2);
          g.fillStyle = 'rgba(124,92,255,0.35)';
          g.fill();
          g.lineWidth = 3;
          g.strokeStyle = '#fff';
          g.stroke();
        }
      };
      const at = (e) => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * canvas.width / s, ((e.clientY - r.top) / r.height) * canvas.height / s];
      };
      let drag = -1;
      canvas.onpointerdown = (e) => {
        const p = at(e);
        let best = -1, bestD = Infinity;
        adjusting.corners.forEach((c, i) => { const d = dist(c, p); if (d < bestD) { bestD = d; best = i; } });
        const r = canvas.getBoundingClientRect();
        if (bestD * s * (r.width / canvas.width) > 60) return; // not near a corner
        drag = best;
        canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
      };
      canvas.onpointermove = (e) => {
        if (drag < 0) return;
        const [x, y] = at(e);
        adjusting.corners[drag] = [Math.max(0, Math.min(src.width, x)), Math.max(0, Math.min(src.height, y))];
        draw();
      };
      canvas.onpointerup = canvas.onpointercancel = () => { drag = -1; };
      adjusting.draw = draw;
      draw();
    };
    const build = async () => {
      if (pdf) return pdf;
      const btns = dlg.querySelectorAll('[data-stage=pages] button');
      btns.forEach((b) => { b.disabled = true; });
      $('.scan-info', dlg).textContent = t('Making the PDF…');
      await new Promise((r) => setTimeout(r, 30)); // let the text show before the work starts
      try {
        const images = [];
        for (const page of pages) {
          const c = render(page, PAGE_MAX, bw);
          const blob = await toBlob(c, 'image/jpeg', bw ? 0.85 : 0.82);
          images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height });
          c.width = c.height = 0;
        }
        const name = `${t('Scan')} ${stamp()}.pdf`;
        const blob = makePdf(images, name.replace(/\.pdf$/, ''));
        pdf = { blob, name, file: new File([blob], name, { type: 'application/pdf', lastModified: Date.now() }) };
        $('.scan-info', dlg).textContent = t('{n} page(s) · {size}', { n: pages.length, size: formatSize(blob.size) });
        return pdf;
      } finally {
        btns.forEach((b) => { b.disabled = false; });
      }
    };
    const close = () => {
      stopStream(stream);
      stream = null;
      for (const p of pages) if (p.thumb) URL.revokeObjectURL(p.thumb);
      pages.length = 0;
      if (dlg.open) dlg.close();
    };
    const fromApp = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.setAttribute('capture', 'environment');
      input.onchange = async () => {
        const files = [...input.files];
        if (!files.length) return;
        $('.scan-info', dlg).textContent = t('Making the PDF…');
        let bad = 0;
        for (const f of files) if (!(await pageFromFile(pages, f))) bad++;
        if (bad) toast(t('{n} picture(s) could not be read.', { n: bad }));
        showPages();
      };
      input.click();
    };
    dlg.onclose = () => { stopStream(stream); stream = null; };
    dlg.oncancel = (e) => {
      // Esc while moving corners goes back to the pages instead of closing everything
      if (adjusting) { e.preventDefault(); adjusting = null; showPages(); }
    };
    dlg.onclick = async (e) => {
      const modeBtn = e.target.closest('[data-mode]');
      if (modeBtn) {
        bw = modeBtn.dataset.mode === 'bw';
        try { localStorage.setItem('omnibeam-scan-bw', bw ? '1' : '0'); } catch {}
        for (const p of pages) await thumbOf(p);
        return showPages();
      }
      const pageBtn = e.target.closest('[data-page]');
      if (pageBtn) {
        const i = Number(pageBtn.closest('.scan-page').dataset.i);
        const act = pageBtn.dataset.page;
        if (act === 'back' && i > 0) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
        else if (act === 'next' && i < pages.length - 1) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
        else if (act === 'delete') { const [gone] = pages.splice(i, 1); if (gone.thumb) URL.revokeObjectURL(gone.thumb); }
        else if (act === 'adjust') return adjust(pages[i]);
        return showPages();
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'app') fromApp();
      else if (act === 'snap') {
        if (!video.videoWidth) return;
        addPage(pages, video, video.videoWidth, video.videoHeight);
        updateCount();
        // A short flash, so it's clear the page was taken
        video.style.opacity = '0.3';
        setTimeout(() => { video.style.opacity = ''; }, 120);
        toast(t('Page {n} added', { n: pages.length }), 1500);
      }
      else if (act === 'done') showPages();
      else if (act === 'more') startCamera();
      else if (act === 'whole' && adjusting) { adjusting.corners = wholeOf(adjusting.page.canvas); adjusting.draw(); }
      else if (act === 'auto' && adjusting) {
        const found = edgesOf(adjusting.page.canvas);
        if (!found) toast(t('No page edges found. Move the corners by hand.'));
        adjusting.corners = found || wholeOf(adjusting.page.canvas);
        adjusting.draw();
      }
      else if (act === 'adjusted' && adjusting) {
        adjusting.page.corners = ordered(adjusting.corners);
        await thumbOf(adjusting.page);
        adjusting = null;
        showPages();
      }
      else if (act === 'save') {
        const { blob, name } = await build();
        downloadBlob({ name, blob });
      }
      else if (act === 'link') {
        const { file } = await build();
        close();
        window.OmniLink.share([file]);
      }
      else if (act === 'send') {
        const { file } = await build();
        let to = target();
        if (!to) {
          to = await chooseDevice();
          if (!to || peers.get(to.info.id) !== to) return dlg.open || dlg.showModal();
        }
        close();
        wsSend({ type: 'stat', kind: 'scan' });
        to.sendFiles([file]);
      }
    };
    dlg.showModal();
    startCamera();
  }

  window.Scan = { open, edgesOf, makePdf, warp, homography, ordered };
})();
