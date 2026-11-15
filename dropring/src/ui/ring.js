// Halka menü: iç halka = hedef formatlar / işlemler / tarifler, dış halka = alt seçenekler.
// Üç kip: 'drag' (tuş+sürükle ile açıldı, dosya bekleniyor), 'click' (dosyalar belli, tıkla), 'wait' (kısayolla açıldı, bırakılmayı bekler).
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const R0 = 60, R1 = 152, R2 = 160, R3 = 222, PER_PAGE = 10, SUB_DEG = 30, EXPAND_MS = 260;
const $wrap = document.getElementById('wrap');
const t = (k, v) => window.i18n.t(k, v);

let S = reset();
function reset() {
  return { mode: null, cx: 300, cy: 300, files: null, opts: null, pages: [], page: 0, hot: null, sub: null, expanded: null, timer: null, dropped: false, unknown: false, kbd: -1 };
}

// ——— Ana süreçten gelenler ———
dropring.on('ring:open', async (p) => {
  clearTimeout(S.closeTimer);
  S = reset();
  entered = false;
  window.i18n.set(p.settings.language);
  document.documentElement.style.setProperty('--accent', p.settings.accent || '#6c5ce7');
  S.mode = p.mode; S.cx = p.center.cx; S.cy = p.center.cy; S.files = p.files;
  document.documentElement.style.setProperty('--cx', S.cx + 'px');
  document.documentElement.style.setProperty('--cy', S.cy + 'px');
  if (p.options) setOptions(p.options); else { S.unknown = true; build(); }
  draw();
  requestAnimationFrame(() => $wrap.classList.add('on'));
});
dropring.on('ring:hide', () => { $wrap.classList.remove('on'); S.mode = null; });
dropring.on('ring:drag-end', () => {
  // Fare bırakıldı; dosya halkaya bırakılmadıysa kısa süre sonra kapan
  S.closeTimer = setTimeout(() => { if (!S.dropped) close(); }, 450);
});

function close() { dropring.invoke('ring:close'); }

// ——— Dilimler ———
function setOptions(o) {
  S.opts = o; S.unknown = false;
  build();
}

function build() {
  const o = S.opts;
  if (!o) { S.pages = [[]]; return; }
  const targets = o.targets.map((x) => ({ kind: 't', id: x.id, label: x.label, hint: x.same ? (i18n.lang === 'tr' ? 'sıkıştır' : 'compress') : '', sub: x.sub || [] }));
  const actions = o.actions.map((x) => ({ kind: 'a', id: x.id, label: x.label, hint: x.icon, sub: [] }));
  const recs = (o.recipes || []).map((x) => ({ kind: 'r', id: x.id, label: x.name, hint: x.icon || '★', sub: [] }));
  const first = targets.slice(0, PER_PAGE);
  const rest = [...actions, ...recs, ...targets.slice(PER_PAGE)];
  S.pages = [];
  if (first.length) S.pages.push(first);
  for (let i = 0; i < rest.length; i += PER_PAGE) S.pages.push(rest.slice(i, i + PER_PAGE));
  // Az sayıda hedef varsa işlemleri/tarifleri aynı yüze koy
  if (S.pages.length === 2 && first.length + S.pages[1].length <= PER_PAGE) S.pages = [[...first, ...S.pages[1]]];
  if (!S.pages.length) S.pages = [[]];
  S.page = 0;
}

const slices = () => S.pages[S.page] || [];

// ——— Geometri ———
const rad = (d) => ((d - 90) * Math.PI) / 180;
const pt = (r, d) => [S.cx + r * Math.cos(rad(d)), S.cy + r * Math.sin(rad(d))];
function arc(r1, r2, a1, a2) {
  const large = a2 - a1 > 180 ? 1 : 0;
  const [x1, y1] = pt(r2, a1), [x2, y2] = pt(r2, a2), [x3, y3] = pt(r1, a2), [x4, y4] = pt(r1, a1);
  return `M${x1},${y1} A${r2},${r2} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r1},${r1} 0 ${large} 0 ${x4},${y4} Z`;
}
function geom(i, n) {
  const step = 360 / n;
  const gap = n > 1 ? 1.2 : 0;
  return { a1: i * step - step / 2 + gap, a2: i * step + step / 2 - gap, mid: i * step };
}
function subGeom(si, n, j, m) {
  const mid = geom(si, n).mid;
  const start = mid - (m * SUB_DEG) / 2;
  return { a1: start + j * SUB_DEG + 0.8, a2: start + (j + 1) * SUB_DEG - 0.8, mid: start + (j + 0.5) * SUB_DEG };
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function text(parent, x, y, s, cls) { const e = el('text', { x, y, class: cls || '' }, parent); e.textContent = s; return e; }
const short = (s, n = 13) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function draw() {
  $wrap.innerHTML = '';
  const g = el('g', { class: 'shadow' }, $wrap);
  const list = slices();
  const n = list.length;

  if (!S.unknown && n) {
    list.forEach((s, i) => {
      const { a1, a2, mid } = n === 1 ? { a1: 0, a2: 359.99, mid: 0 } : geom(i, n);
      const cls = `slice ${s.kind}${S.hot === i ? ' hot' : ''}`;
      const sg = el('g', { class: cls }, g);
      el('path', { d: n === 1 ? ring(R0, R1) : arc(R0, R1, a1, a2) }, sg);
      const [x, y] = pt((R0 + R1) / 2 + 4, n === 1 ? 180 : mid);
      if (s.hint && s.kind !== 't') { text(sg, x, y - 9, s.hint, 'sub'); text(sg, x, y + 7, short(s.label, 12)); }
      else { text(sg, x, y - (s.hint ? 6 : 0), short(s.label)); if (s.hint) text(sg, x, y + 9, s.hint, 'sub'); }
    });
    // Dış halka
    if (S.expanded != null && list[S.expanded] && list[S.expanded].sub.length) {
      const subs = list[S.expanded].sub;
      subs.forEach((o, j) => {
        const { a1, a2, mid } = subGeom(S.expanded, n, j, subs.length);
        const og = el('g', { class: `outer${S.sub === j ? ' hot' : ''}` }, g);
        el('path', { d: arc(R2, R3, a1, a2) }, og);
        const [x, y] = pt((R2 + R3) / 2, mid);
        text(og, x, y, o.label);
      });
    }
  }

  // Merkez
  const hole = el('circle', { id: 'hole', cx: S.cx, cy: S.cy, r: S.unknown ? 74 : R0 - 4, class: S.hot === 'center' ? 'hot' : '' }, g);
  hole.id = 'hole';
  let main, sub;
  if (S.unknown) { main = S.mode === 'wait' ? t('dropHere') : t('dropChoose'); sub = '⌄'; }
  else if (!n) { main = '—'; sub = t('noTargets'); }
  else if (S.files) { main = S.files.length === 1 ? short(S.opts.names[0], 12) : `${S.files.length} ${t('files')}`; sub = S.hot === 'center' ? t('close') : (S.pages.length > 1 ? 'Tab ⇄' : ''); }
  else { main = t('drop'); sub = S.pages.length > 1 ? 'Tab ⇄' : ''; }
  text(g, S.cx, S.cy - (sub ? 6 : 0), main, 'ctext');
  if (sub) text(g, S.cx, S.cy + 12, short(sub, 22), 'csub');
  if (S.pages.length > 1) {
    S.pages.forEach((_, i) => el('circle', { cx: S.cx - (S.pages.length - 1) * 5 + i * 10, cy: S.cy + 30, r: 2.6, class: `dot${i === S.page ? ' on' : ''}` }, g));
  }
}
function ring(r1, r2) {
  return `M${S.cx - r2},${S.cy} a${r2},${r2} 0 1,0 ${r2 * 2},0 a${r2},${r2} 0 1,0 ${-r2 * 2},0 Z M${S.cx - r1},${S.cy} a${r1},${r1} 0 1,1 ${r1 * 2},0 a${r1},${r1} 0 1,1 ${-r1 * 2},0 Z`;
}

// ——— İsabet testi ———
function hit(x, y) {
  const dx = x - S.cx, dy = y - S.cy, r = Math.hypot(dx, dy);
  let ang = (Math.atan2(dy, dx) * 180) / Math.PI + 90; if (ang < 0) ang += 360;
  if (S.unknown) return r < 120 ? { center: true } : { out: r > 280 };
  if (r < R0) return { center: true };
  const list = slices(), n = list.length;
  if (S.expanded != null && r >= R2 - 6 && r <= R3 + 18) {
    const subs = list[S.expanded].sub;
    for (let j = 0; j < subs.length; j++) {
      const g = subGeom(S.expanded, n, j, subs.length);
      const a = ((ang - g.a1 + 720) % 360);
      if (a <= g.a2 - g.a1 + 1.5) return { slice: S.expanded, sub: j };
    }
  }
  if (r <= R1 + 6 && n) {
    const step = 360 / n;
    return { slice: Math.floor(((ang + step / 2) % 360) / step) };
  }
  return { out: r > R3 + 50 };
}

function hover(x, y) {
  const h = hit(x, y);
  const prevHot = S.hot, prevSub = S.sub;
  if (h.center) { S.hot = 'center'; S.sub = null; }
  else if (h.slice != null) { S.hot = h.slice; S.sub = h.sub != null ? h.sub : null; }
  else { S.hot = null; S.sub = null; }
  if (S.hot !== prevHot && typeof S.hot === 'number' && S.hot !== S.expanded) {
    clearTimeout(S.timer);
    if (S.expanded != null && h.sub == null) S.expanded = null;
    const idx = S.hot;
    S.timer = setTimeout(() => { if (S.hot === idx && slices()[idx] && slices()[idx].sub.length) { S.expanded = idx; draw(); } }, EXPAND_MS);
  }
  if (S.hot === null || S.hot === 'center') { clearTimeout(S.timer); if (h.out || S.hot === 'center') S.expanded = null; }
  if (prevHot !== S.hot || prevSub !== S.sub) draw();
}

function flip(dir = 1) {
  if (S.pages.length < 2) return;
  S.page = (S.page + dir + S.pages.length) % S.pages.length;
  S.hot = null; S.sub = null; S.expanded = null; draw();
}

// ——— Çalıştırma ———
async function runSlice(files, si, sj) {
  const s = slices()[si];
  if (!s) return;
  const job = { files };
  if (s.kind === 't') { job.target = s.id; job.opts = sj != null && s.sub[sj] ? { ...s.sub[sj].opts } : {}; }
  else if (s.kind === 'a') { job.action = s.id; job.opts = {}; }
  else job.recipeId = s.id;
  await dropring.invoke('run', job);
}

// ——— Sürükle-bırak ———
const MIME_MAP = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/tiff': 'tiff', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/webm': 'webm', 'video/x-msvideo': 'avi', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md', 'text/html': 'html', 'text/csv': 'csv', 'application/json': 'json', 'application/zip': 'zip', 'application/x-zip-compressed': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
};

let entered = false;
document.addEventListener('dragenter', async (e) => {
  e.preventDefault();
  if (entered || S.files) return;
  entered = true;
  const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file');
  const ids = items.map((i) => MIME_MAP[(i.type || '').toLowerCase()] || null);
  if (items.length && ids.every(Boolean)) {
    setOptions(await dropring.invoke('options', ids));
    draw();
  }
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  clearTimeout(S.closeTimer);
  hover(e.clientX, e.clientY);
});
document.addEventListener('dragleave', (e) => {
  if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight) { S.hot = null; S.sub = null; draw(); }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  entered = false;
  S.dropped = true;
  clearTimeout(S.closeTimer);
  const hot = S.hot, sub = S.sub;
  let files = [...e.dataTransfer.files].map((f) => dropring.pathOf(f)).filter(Boolean);
  if (!files.length) {
    const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
    const urls = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^(https?:|data:)/i.test(s));
    if (urls.length) files = await dropring.invoke('ring:urls', urls);
  }
  if (!files.length) return close();
  const real = await dropring.invoke('options', files);
  // Tahmin edilen dilim gerçek dosyalarla da geçerliyse doğrudan çalıştır
  if (typeof hot === 'number' && S.opts && !S.unknown) {
    const s = slices()[hot];
    const valid = s && (s.kind === 't' ? real.targets.some((x) => x.id === s.id) : s.kind === 'a' ? real.actions.some((x) => x.id === s.id) : (real.recipes || []).some((x) => x.id === s.id));
    if (valid) return runSlice(files, hot, sub);
  }
  // Aksi hâlde tıklama kipine geç: dosyalar belli, seçim beklenir
  S.files = files; S.mode = 'click';
  setOptions(await dropring.invoke('ring:clickmode', files));
  S.hot = null; draw();
});

// ——— Tıklama kipi ———
document.addEventListener('mousemove', (e) => { if (S.mode === 'click' || S.mode === 'wait') hover(e.clientX, e.clientY); });
document.addEventListener('mousedown', (e) => {
  if (S.mode !== 'click') { if (S.mode === 'wait' && hit(e.clientX, e.clientY).out !== false) close(); return; }
  const h = hit(e.clientX, e.clientY);
  if (h.center || h.out || (h.slice == null)) return close();
  // Dış halkası olan bir dilime tıklanınca: ilk tıklama halkayı açar (gecikmesiz), ikinci tıklama varsayılanla çalıştırır
  runSlice(S.files, h.slice, h.sub);
});
document.addEventListener('wheel', (e) => { e.preventDefault(); flip(e.deltaY > 0 ? 1 : -1); }, { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return close();
  if (e.key === 'Tab') { e.preventDefault(); return flip(e.shiftKey ? -1 : 1); }
  const n = slices().length;
  if (!n || S.mode !== 'click') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { S.hot = typeof S.hot === 'number' ? (S.hot + 1) % n : 0; S.expanded = null; draw(); }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { S.hot = typeof S.hot === 'number' ? (S.hot - 1 + n) % n : n - 1; S.expanded = null; draw(); }
  if (e.key === 'Enter' && typeof S.hot === 'number') runSlice(S.files, S.hot, S.sub);
  // Sayı tuşları: 1–9 doğrudan dilim
  if (/^[1-9]$/.test(e.key) && +e.key <= n) runSlice(S.files, +e.key - 1, null);
});
