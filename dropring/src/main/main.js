'use strict';
// DropRing — ana süreç. Pencereler, tepsi, küresel hareket, izlenen klasörler, pano ve iş kuyruğu.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, clipboard, nativeImage,
  globalShortcut, Notification, dialog, net, nativeTheme,
} = require('electron');

// Gizli CLI yardımcı modu: PDF/HTML çizimi gereken komut satırı işleri buradan geçer.
if (process.argv.includes('--cli-render')) {
  require('../cli').renderEntry();
  return;
}

const { Engine, formats, recipes: recipeLib } = require('../engine');
const { Store } = require('./store');
const { GestureHook } = require('./hook');
const renderer = require('./renderer');

const UI = path.join(__dirname, '..', 'ui');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const ICON = path.join(__dirname, '..', '..', 'build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');

let store, engine, hook, tray;
let mainWin = null, ringWin = null, toastWin = null, bubbleWin = null;
const jobs = new Map();       // etkin işler: id → { label, progress, controller }
const watchers = new Map();   // klasör → chokidar
const recentOutputs = new Set(); // izlenen klasörde kendi ürettiğimiz dosyaları yeniden işlememek için
let ringState = { open: false, mode: null, dropped: false };

// ——— Tek örnek ———
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', (_e, argv) => {
  const files = filesFromArgv(argv);
  if (files.length) queueOpen(files); else showMain();
});

function filesFromArgv(argv) {
  // Paketli uygulamada: "DropRing.exe dosya1 dosya2" ya da "--open dosya". Geliştirmede yalnızca --open.
  const i = argv.indexOf('--open');
  const list = i >= 0 ? argv.slice(i + 1) : app.isPackaged ? argv.slice(1) : [];
  return list.filter((a) => a && !a.startsWith('-') && fs.existsSync(a));
}

// Gezgin'de çoklu seçimle "DropRing ile dönüştür" her dosya için ayrı süreç açar: 350 ms içinde gelenleri topla.
let openBatch = [], openTimer = null;
function queueOpen(files) {
  openBatch.push(...files);
  clearTimeout(openTimer);
  openTimer = setTimeout(() => { const f = [...new Set(openBatch)]; openBatch = []; openRingClick(f); }, 350);
}
app.on('open-file', (e, file) => { e.preventDefault(); if (app.isReady()) queueOpen([file]); else openBatch.push(file); });

const dbg = (m) => process.env.DROPRING_DEBUG && console.log('[dbg]', m);
// ——— Başlangıç ———
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  store = new Store(path.join(app.getPath('userData'), 'veri'));
  engine = new Engine({ renderer, dataDir: app.getPath('userData'), concurrency: store.settings.concurrency || undefined });
  hook = new GestureHook();
  hook.on('drag-start', (pt) => openRingDrag(pt));
  hook.on('drag-end', () => { if (ringWin && ringState.mode === 'drag') ringWin.webContents.send('ring:drag-end'); });
  hook.on('escape', () => { if (ringState.open && ringState.mode === 'drag') hideRing(); });

  createRing();
  dbg('ring');
  createTray();
  dbg('tray');
  applySettings(true);
  dbg('settings');
  startWatches();
  dbg('watch');

  const initial = [...openBatch, ...filesFromArgv(process.argv)];
  openBatch = [];
  if (initial.length) setTimeout(() => openRingClick(initial), 400);
  else if (!store.settings.onboarded || !process.argv.includes('--hidden')) showMain();
}).catch((e) => { console.error('Başlatma hatası:', e); dialog.showErrorBox('DropRing', String(e && e.stack || e)); });

app.on('window-all-closed', (e) => e.preventDefault()); // tepside yaşamaya devam
app.on('will-quit', () => { globalShortcut.unregisterAll(); hook && hook.stop(); engine && engine.cleanup(); });
app.on('activate', () => showMain());

// ——— Ayarlar ———
function applySettings(first = false) {
  const s = store.settings;
  nativeTheme.themeSource = s.theme;
  if (s.gesture) {
    const ok = hook.start(s.gestureKey);
    if (!ok && process.platform === 'darwin' && !first) GestureHook.permitted(true);
  } else hook.stop();
  hook.key = s.gestureKey;
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!s.launchAtLogin, args: ['--hidden'] });
  globalShortcut.unregisterAll();
  const reg = (acc, fn) => { try { if (acc) globalShortcut.register(acc, fn); } catch { /* geçersiz kısayol */ } };
  reg(s.clipboardShortcut, () => clipboardAction());
  reg(s.ringShortcut, () => {
    const files = clipboardFiles();
    if (files.length) openRingClick(files); else openRingWait();
  });
  s.bubble ? showBubble() : bubbleWin && bubbleWin.hide();
  if (ringWin) ringWin.setOpacity(Math.max(0.6, Math.min(1, s.opacity || 1)));
  updateTray();
}

// ——— Pencereler ———
function webPrefs() { return { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }; }

function showMain(page) {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show(); mainWin.focus();
    if (page) mainWin.webContents.send('navigate', page);
    return mainWin;
  }
  mainWin = new BrowserWindow({
    width: 1040, height: 720, minWidth: 820, minHeight: 560, show: false, title: 'DropRing',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16161c' : '#f6f6f9',
    autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  mainWin.loadFile(path.join(UI, 'index.html'), { query: { page: page || '' } });
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.on('closed', () => { mainWin = null; });
  if (process.platform === 'darwin' && app.dock) { app.dock.show(); mainWin.on('closed', () => app.dock.hide()); }
  return mainWin;
}

const RING = 600;
function createRing() {
  ringWin = new BrowserWindow({
    width: RING, height: RING, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, fullscreenable: false, minimizable: false, maximizable: false,
    backgroundColor: '#00000000', focusable: true, webPreferences: webPrefs(),
  });
  ringWin.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') ringWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ringWin.loadFile(path.join(UI, 'ring.html'));
  ringWin.on('blur', () => { if (ringState.open && ringState.mode !== 'drag') hideRing(); });
  ringWin.on('closed', () => { ringWin = null; });
}

function placeRing(pt) {
  const d = screen.getDisplayNearestPoint(pt).workArea;
  const x = Math.round(Math.min(Math.max(pt.x - RING / 2, d.x - RING / 4), d.x + d.width - RING * 3 / 4));
  const y = Math.round(Math.min(Math.max(pt.y - RING / 2, d.y - RING / 4), d.y + d.height - RING * 3 / 4));
  ringWin.setBounds({ x, y, width: RING, height: RING });
  return { cx: pt.x - x, cy: pt.y - y };
}

function ringPayload(mode, files, center) {
  return { mode, files, center, options: files ? fullOptions(files) : null, settings: publicSettings() };
}

function openRingDrag(pt) {
  if (!ringWin) createRing();
  ringState = { open: true, mode: 'drag', dropped: false };
  const center = placeRing(pt);
  ringWin.webContents.send('ring:open', ringPayload('drag', null, center));
  ringWin.showInactive();
}

function openRingClick(files, pt = screen.getCursorScreenPoint()) {
  if (!files.length) return;
  if (!ringWin) createRing();
  ringState = { open: true, mode: 'click', dropped: true };
  const center = placeRing(pt);
  ringWin.webContents.send('ring:open', ringPayload('click', files, center));
  ringWin.show(); ringWin.focus();
}

function openRingWait() {
  if (!ringWin) createRing();
  ringState = { open: true, mode: 'wait', dropped: false };
  const center = placeRing(screen.getCursorScreenPoint());
  ringWin.webContents.send('ring:open', ringPayload('wait', null, center));
  ringWin.show(); ringWin.focus();
}

function hideRing() {
  ringState.open = false;
  if (ringWin && !ringWin.isDestroyed()) { ringWin.webContents.send('ring:hide'); setTimeout(() => ringWin && !ringState.open && ringWin.hide(), 140); }
}

function toast(payload) {
  if (!toastWin || toastWin.isDestroyed()) {
    toastWin = new BrowserWindow({
      width: 380, height: 120, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true,
      alwaysOnTop: true, focusable: false, hasShadow: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
    });
    toastWin.setAlwaysOnTop(true, 'screen-saver');
    toastWin.loadFile(path.join(UI, 'toast.html'));
    toastWin.once('ready-to-show', () => sendToast(payload));
    toastWin.on('closed', () => { toastWin = null; });
    return;
  }
  sendToast(payload);
}
function sendToast(payload) {
  if (!toastWin) return;
  toastWin.webContents.send('toast', payload);
  if (!toastWin.isVisible()) { positionToast(toastWin.getBounds().height); toastWin.showInactive(); }
}
function positionToast(h) {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  toastWin.setBounds({ x: d.x + d.width - 392, y: d.y + d.height - h - 12, width: 380, height: h });
}

function showBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) { bubbleWin.showInactive(); return; }
  const d = screen.getPrimaryDisplay().workArea;
  const pos = store.settings.bubblePos || { x: d.x + d.width - 110, y: d.y + Math.round(d.height * 0.6) };
  bubbleWin = new BrowserWindow({
    ...pos, width: 84, height: 84, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, focusable: false, backgroundColor: '#00000000', webPreferences: webPrefs(),
  });
  bubbleWin.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.loadFile(path.join(UI, 'bubble.html'));
  bubbleWin.once('ready-to-show', () => bubbleWin.showInactive());
}

// ——— Tepsi ———
function createTray() {
  let img = nativeImage.createFromPath(ICON);
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'icon.png')).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('DropRing');
  tray.on('click', () => (process.platform === 'win32' ? showMain() : null));
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const s = store.settings;
  const recent = store.history.slice(0, 6).map((h) => ({
    label: `${h.label} — ${h.ok}/${h.total}`, submenu: [
      { label: 'Göster', click: () => revealEntry(h) },
      { label: 'Geri al', enabled: !h.undone, click: () => undoEntry(h.id) },
    ],
  }));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'DropRing\'i aç', click: () => showMain() },
    { label: 'Dosya seç ve dönüştür…', click: () => pickAndOpen() },
    { label: `Panodan kaydet  (${accLabel(s.clipboardShortcut)})`, click: () => clipboardAction() },
    { type: 'separator' },
    { label: 'Sürükleme hareketi', type: 'checkbox', checked: !!s.gesture, click: (i) => { store.saveSettings({ gesture: i.checked }); applySettings(); } },
    { label: 'Yüzen balon', type: 'checkbox', checked: !!s.bubble, click: (i) => { store.saveSettings({ bubble: i.checked }); applySettings(); } },
    { type: 'separator' },
    { label: 'Son dönüşümler', submenu: recent.length ? recent : [{ label: 'Henüz yok', enabled: false }] },
    { label: 'Ayarlar', click: () => showMain('settings') },
    { type: 'separator' },
    { label: 'Çıkış', role: 'quit' },
  ]));
}
const accLabel = (a) => String(a || '').replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl').replace('Alt', process.platform === 'darwin' ? '⌥' : 'Alt');

async function pickAndOpen() {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
  if (!r.canceled && r.filePaths.length) openRingClick(r.filePaths);
}

// ——— Seçenekler (halka içeriği) ———
function fullOptions(files) {
  const o = engine.options(files);
  const ids = o.formats.filter(Boolean);
  const cats = new Set(ids.map((i) => formats.category(i)));
  const pinned = store.settings.pinned || [];
  o.targets.sort((a, b) => (pinned.includes(b.id) ? 1 : 0) - (pinned.includes(a.id) ? 1 : 0));
  const cat = cats.size === 1 ? [...cats][0] : null;
  o.targets = o.targets.map((t) => ({ ...t, sub: recipeLib.subOptions(t.id, cat) }));
  o.recipes = store.recipes.filter((r) => !r.cats || !r.cats.length || (ids.length && ids.every((i) => r.cats.includes(formats.category(i)))))
    .filter((r) => recipeUsable(r, ids)).map((r) => ({ id: r.id, name: r.name, icon: r.icon }));
  o.count = files.length;
  o.names = files.slice(0, 3).map((f) => path.basename(f));
  return o;
}

function recipeUsable(r, ids) {
  const conv = (r.steps || []).filter((s) => s.op === 'convert' && s.to !== 'same').map((s) => s.to);
  if (!conv.length) return ids.length > 0;
  return ids.every((id) => conv.every((to, i) => !!engine.planner.plan(i === 0 ? id : conv[i - 1], to)));
}

function publicSettings() {
  const s = store.settings;
  return { language: s.language, theme: s.theme, accent: s.accent, opacity: s.opacity, gestureKey: s.gestureKey, platform: process.platform };
}

// ——— İş çalıştırma ———
async function runJob(job, { silent = false, source = 'ring' } = {}) {
  const id = crypto.randomBytes(5).toString('hex');
  const controller = new AbortController();
  const label = jobLabel(job);
  const entry = { id, label, progress: 0, total: job.files.length, done: 0 };
  jobs.set(id, { ...entry, controller });
  const out = { ...store.settings.output, ...(job.output || {}) };
  const broadcast = (ev) => {
    const payload = { id, label, ...ev };
    if (!silent) toast(payload);
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('job', payload);
  };
  broadcast({ type: 'start', total: job.files.length });
  let results = [];
  try {
    const r = await engine.run({ ...job, output: out }, (ev) => {
      if (ev.type === 'progress') broadcast({ type: 'progress', value: ev.value });
      if (ev.type === 'file-done' || ev.type === 'file-error') broadcast({ type: ev.type, result: slim(ev.result) });
    }, controller.signal);
    results = r.results;
  } catch (e) {
    results = job.files.map((f) => ({ input: f, outputs: [], error: e.message }));
  }
  jobs.delete(id);
  for (const r of results) for (const o of r.outputs || []) { recentOutputs.add(path.resolve(o)); setTimeout(() => recentOutputs.delete(path.resolve(o)), 60000); }
  const ok = results.filter((r) => !r.error && !r.skipped).length;
  const h = { id, time: Date.now(), label, source, ok, total: results.length, results: results.map(slim),
    bytesIn: results.reduce((a, r) => a + (r.bytesIn || 0), 0), bytesOut: results.reduce((a, r) => a + (r.bytesOut || 0), 0), thumb: await thumbFor(results) };
  store.addHistory(h);
  broadcast({ type: 'done', entry: h });
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state-changed');
  updateTray();
  if (silent && store.settings.notify && Notification.isSupported()) {
    new Notification({ title: 'DropRing', body: `${label}: ${ok}/${results.length} dosya tamam` }).show();
  }
  if (store.settings.revealAfter && ok) revealEntry(h);
  return h;
}

const slim = (r) => ({ input: r.input, outputs: r.outputs || [], error: r.error, skipped: r.skipped, bytesIn: r.bytesIn, bytesOut: r.bytesOut, backup: r.backup, route: r.route });

function jobLabel(job) {
  if (job.recipe) return job.recipe.name;
  if (job.action) return ({ 'merge-pdf': 'PDF birleştir', 'zip-all': 'ZIP', extract: 'Arşivi aç', 'split-pdf': 'PDF böl', frames: 'Karelere ayır', strip: 'Gizlilik temizliği' })[job.action] || job.action;
  const from = [...new Set(job.files.map((f) => (formats.detect(f) || '?').toUpperCase()))].slice(0, 2).join('+');
  return `${from} → ${(formats.get(job.target) || {}).label || String(job.target).toUpperCase()}`;
}

async function thumbFor(results) {
  const outs = results.flatMap((r) => r.outputs || []);
  const vid = outs.find((o) => /\.(mp4|mov|mkv|webm|avi)$/i.test(o));
  if (vid) return videoThumb(vid);
  const first = outs.find((o) => /\.(jpe?g|png|webp|avif|gif|tiff?|bmp)$/i.test(o));
  if (!first) return null;
  try { const b = await require('sharp')(first, { animated: false }).resize(96, 96, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer(); return 'data:image/jpeg;base64,' + b.toString('base64'); } catch { return null; }
}

function videoThumb(file) {
  return new Promise((resolve) => {
    const { ffmpeg } = require('../engine/converters/media').bins();
    const p = require('child_process').spawn(ffmpeg, ['-v', 'error', '-ss', '0.5', '-i', file, '-frames:v', '1', '-vf', 'scale=96:96:force_original_aspect_ratio=increase,crop=96:96', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1']);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('close', () => resolve(chunks.length ? 'data:image/jpeg;base64,' + Buffer.concat(chunks).toString('base64') : null));
    p.on('error', () => resolve(null));
  });
}

function revealEntry(h) {
  const o = (h.results || []).flatMap((r) => r.outputs || []).find((p) => fs.existsSync(p));
  if (o) shell.showItemInFolder(o);
}

async function undoEntry(id) {
  const h = store.history.find((x) => x.id === id);
  if (!h || h.undone) return false;
  await engine.undo(h, (p) => shell.trashItem(p).catch(() => fs.promises.rm(p, { recursive: true, force: true })));
  store.updateHistory(id, { undone: true });
  updateTray();
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('state-changed');
  return true;
}

// ——— Pano ———
function clipboardFiles() {
  try {
    if (process.platform === 'darwin') {
      const url = clipboard.read('public.file-url');
      if (url) return [decodeURIComponent(new URL(url).pathname)].filter((p) => fs.existsSync(p));
    } else if (process.platform === 'win32') {
      const raw = clipboard.readBuffer('FileNameW');
      if (raw && raw.length) return [raw.toString('ucs2').replace(/\0+$/, '')].filter((p) => fs.existsSync(p));
    }
  } catch { /* yoksay */ }
  return [];
}

async function clipboardAction() {
  const files = clipboardFiles();
  if (files.length) return openRingClick(files);
  const img = clipboard.readImage();
  if (img.isEmpty()) {
    const text = clipboard.readText().trim();
    if (/^https?:\/\/\S+$/i.test(text)) { const f = await download(text); return f && openRingClick([f]); }
    return toast({ id: 'pano', type: 'info', label: 'Pano', text: 'Panoda resim, dosya ya da bağlantı yok.' });
  }
  const fmt = store.settings.clipboardFormat || 'png';
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = app.getPath('downloads');
  const tmp = path.join(os.tmpdir(), `dropring-pano-${stamp}.png`);
  await fs.promises.writeFile(tmp, img.toPNG());
  const h = await runJob({ files: [tmp], target: fmt, opts: { quality: 90 }, output: { folder: dir, pattern: `Pano ${stamp}`, conflict: 'rename', replaceOriginal: false } }, { source: 'clipboard' });
  fs.promises.rm(tmp, { force: true });
  return h;
}

// ——— Tarayıcıdan sürüklenen bağlantılar ———
async function download(url) {
  try {
    const dir = app.getPath('downloads');
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      const ext = formats.ext(formats.fromMime(m[1]) || 'bin');
      const p = require('../engine/output').unique(path.join(dir, `indirilen.${ext}`));
      await fs.promises.writeFile(p, m[2] ? Buffer.from(m[3], 'base64') : decodeURIComponent(m[3]));
      return p;
    }
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    let name = (/filename\*=UTF-8''([^;]+)/i.exec(cd) || [])[1] || (/filename="?([^";]+)"?/i.exec(cd) || [])[1] || decodeURIComponent(new URL(res.url).pathname.split('/').pop() || 'indirilen');
    name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!formats.detect(name)) { const id = formats.fromMime((res.headers.get('content-type') || '').split(';')[0]); if (id) name += '.' + formats.ext(id); }
    const p = require('../engine/output').unique(path.join(dir, name));
    await fs.promises.writeFile(p, Buffer.from(await res.arrayBuffer()));
    return p;
  } catch (e) {
    toast({ id: 'indir', type: 'info', label: 'İndirme', text: `İndirilemedi: ${e.message}` });
    return null;
  }
}

// ——— İzlenen klasörler ———
function startWatches() {
  const chokidar = require('chokidar');
  for (const [dir, w] of watchers) { w.close(); watchers.delete(dir); }
  for (const w of store.watches.filter((x) => x.enabled !== false && fs.existsSync(x.folder))) {
    const watcher = chokidar.watch(w.folder, { ignoreInitial: true, depth: 0, awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }, ignored: (p) => /(^|[\\/])\.|\.(tmp|crdownload|part|download)$/i.test(p) });
    watcher.on('add', (file) => {
      if (recentOutputs.has(path.resolve(file))) return;
      const id = formats.detect(file);
      if (!id) return;
      const job = { files: [file], output: { folder: w.outFolder || 'subfolder', subfolder: 'Dönüştürülenler', replaceOriginal: false } };
      if (w.recipeId) { const r = store.recipes.find((x) => x.id === w.recipeId); if (!r) return; job.recipe = r; }
      else { if (!engine.planner.plan(id, w.target)) return; if (id === w.target && !w.opts) return; job.target = w.target; job.opts = w.opts || {}; }
      runJob(job, { silent: true, source: 'watch' }).then(async (h) => {
        if (w.moveOriginals && h.ok) {
          const done = path.join(w.folder, 'İşlenenler');
          await fs.promises.mkdir(done, { recursive: true });
          await fs.promises.rename(file, require('../engine/output').unique(path.join(done, path.basename(file)))).catch(() => {});
        }
      });
    });
    watchers.set(w.folder, watcher);
  }
}

// ——— IPC ———
ipcMain.handle('state', () => ({
  settings: store.settings, recipes: store.recipes, watches: store.watches, history: store.history.slice(0, 120),
  jobs: [...jobs.values()].map(({ controller, ...j }) => j), platform: process.platform, version: app.getVersion(),
  gestureOk: GestureHook.permitted(false), formats: formats.FORMATS.map((f) => ({ id: f.id, label: f.label, cat: f.cat })),
  targetsByCat: Object.fromEntries(['image', 'video', 'audio', 'document', 'data', 'archive'].map((c) => [c, [...new Set(formats.FORMATS.filter((f) => f.cat === c).flatMap((f) => engine.planner.targets(f.id).map((t) => t.id)))]])),
}));
ipcMain.handle('options', (_e, files) => fullOptions(files));
ipcMain.handle('ring:clickmode', (_e, files) => { ringState.mode = 'click'; ringState.dropped = true; ringWin.focus(); return fullOptions(files); });
ipcMain.handle('run', (e, job) => {
  if (BrowserWindow.fromWebContents(e.sender) === ringWin) hideRing();
  if (job.recipeId) job.recipe = store.recipes.find((r) => r.id === job.recipeId);
  runJob(job);
  return true;
});
ipcMain.handle('ring:close', () => hideRing());
ipcMain.handle('ring:urls', async (_e, urls) => {
  const files = [];
  for (const u of urls.slice(0, 20)) { const f = await download(u); if (f) files.push(f); }
  return files;
});
ipcMain.handle('settings:save', (_e, patch) => { const s = store.saveSettings(patch); applySettings(); if (patch.concurrency !== undefined) engine.concurrency = s.concurrency || Math.max(1, Math.min(4, os.cpus().length - 1)); return s; });
ipcMain.handle('recipes:save', (_e, list) => store.saveRecipes(list));
ipcMain.handle('recipes:reset', () => store.resetRecipes());
ipcMain.handle('watches:save', (_e, list) => { store.saveWatches(list); startWatches(); return list; });
ipcMain.handle('history:clear', () => { store.clearHistory(); updateTray(); return true; });
ipcMain.handle('history:undo', (_e, id) => undoEntry(id));
ipcMain.handle('reveal', (_e, p) => { if (typeof p === 'string') shell.showItemInFolder(p); else { const h = store.history.find((x) => x.id === p.id); if (h) revealEntry(h); } });
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('copy-result', (_e, p) => {
  if (/\.(png|jpe?g)$/i.test(p)) clipboard.writeImage(nativeImage.createFromPath(p));
  else clipboard.writeText(p);
  return true;
});
ipcMain.handle('pick-files', async () => { const r = await dialog.showOpenDialog(mainWin, { properties: ['openFile', 'multiSelections'] }); return r.canceled ? [] : r.filePaths; });
ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('open-ring-for', (_e, files) => openRingClick(files));
ipcMain.handle('cancel', (_e, id) => { const j = jobs.get(id); if (j) j.controller.abort(); });
ipcMain.handle('clipboard:save', () => clipboardAction());
ipcMain.handle('accessibility:request', () => { GestureHook.permitted(true); setTimeout(() => applySettings(), 4000); return true; });
ipcMain.handle('toast:resize', (_e, h) => { if (toastWin) { if (h <= 0) toastWin.hide(); else positionToast(Math.ceil(h)); } });
ipcMain.handle('toast:hide', () => toastWin && toastWin.hide());
ipcMain.handle('bubble:drop', (_e, files) => { const b = bubbleWin.getBounds(); openRingClick(files, { x: b.x + b.width / 2, y: b.y + b.height / 2 }); });
ipcMain.handle('bubble:move', (_e, dx, dy) => {
  const b = bubbleWin.getBounds(); bubbleWin.setBounds({ ...b, x: b.x + dx, y: b.y + dy });
  clearTimeout(bubbleWin._t); bubbleWin._t = setTimeout(() => { const n = bubbleWin.getBounds(); store.saveSettings({ bubblePos: { x: n.x, y: n.y } }); }, 500);
});
ipcMain.handle('show-main', (_e, page) => showMain(page));
