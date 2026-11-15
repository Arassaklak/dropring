// Ana pencere: ana sayfa, tarifler, izlenen klasörler, ayarlar.
'use strict';

const t = (k, v) => i18n.t(k, v);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB');
const base = (p) => String(p).split(/[\\/]/).pop();
const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 60) return i18n.lang === 'tr' ? 'şimdi' : 'now'; if (s < 3600) return Math.floor(s / 60) + (i18n.lang === 'tr' ? ' dk' : ' min'); if (s < 86400) return Math.floor(s / 3600) + (i18n.lang === 'tr' ? ' sa' : ' h'); return new Date(ms).toLocaleDateString(); };

let ST = null;
let curRecipe = null;
const liveJobs = new Map();

async function load() {
  ST = await dropring.invoke('state');
  i18n.set(ST.settings.language);
  applyTheme();
  document.body.classList.toggle('mac', ST.platform === 'darwin');
  document.documentElement.classList.toggle('mac', ST.platform === 'darwin');
  i18n.apply();
  $('#ver').textContent = 'v' + ST.version;
  renderHome(); renderRecipes(); renderWatches(); renderSettings();
  $('#engines').textContent = i18n.lang === 'tr'
    ? `${ST.formats.length} format · çok adımlı rotalar otomatik bulunur (ör. DOCX → HTML → PDF).`
    : `${ST.formats.length} formats · multi-step routes are found automatically (e.g. DOCX → HTML → PDF).`;
}

function applyTheme() {
  const dark = ST.settings.theme === 'dark' || (ST.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.setProperty('--accent', ST.settings.accent || '#6c5ce7');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => ST && applyTheme());

// ——— Gezinme ———
function go(p) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  document.querySelectorAll('.page').forEach((s) => s.classList.toggle('on', s.id === 'p-' + p));
}
document.querySelectorAll('nav a').forEach((a) => (a.onclick = () => go(a.dataset.p)));
dropring.on('navigate', go);
const qp = new URLSearchParams(location.search).get('page');
if (qp) go(qp);

// ——— Ana sayfa ———
function renderHome() {
  const s = ST.settings;
  $('#access').innerHTML = ST.platform === 'darwin' && s.gesture && !ST.gestureOk
    ? `<div class="banner"><div style="flex:1"><b>${t('accessTitle')}</b><div class="muted">${esc(t('accessText', { key: accLabel(s.ringShortcut) }))}</div></div><button class="btn pri" id="grant">${t('grant')}</button></div>` : '';
  if ($('#grant')) $('#grant').onclick = () => dropring.invoke('accessibility:request');
  $('#how').innerHTML = [t('how1'), t('how2'), t('how3')].map((x, i) => `<div><b>${i + 1}</b>${esc(x)}</div>`).join('');
  $('#clip').title = accLabel(s.clipboardShortcut);
  renderJobs();
  const h = ST.history;
  $('#hist').innerHTML = h.length ? h.map(histRow).join('') : `<div class="empty">${esc(t('empty'))}</div>`;
  $('#hist').querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => histAction(b.dataset.a, b.dataset.id)));
}

function histRow(h) {
  const diff = h.bytesIn && h.bytesOut ? Math.round((1 - h.bytesOut / h.bytesIn) * 100) : null;
  const err = h.results.find((r) => r.error);
  const sizes = h.bytesOut ? `${fmt(h.bytesIn)} → ${fmt(h.bytesOut)}${diff != null ? (diff >= 0 ? ` · %${diff} ${t('saved')}` : ` · %${-diff} ${t('bigger')}`) : ''}` : '';
  const names = h.results.slice(0, 2).map((r) => base(r.input)).join(', ') + (h.results.length > 2 ? ` +${h.results.length - 2}` : '');
  const th = h.thumb ? `<img class="th" src="${h.thumb}">` : `<div class="th">${h.ok ? '✓' : '!'}</div>`;
  return `<div class="row ${h.undone ? 'undone' : ''}">${th}
    <div><div class="t">${esc(h.label)} <span class="muted" style="font-weight:400">· ${ago(h.time)}${h.source === 'watch' ? ' · ◉' : h.source === 'clipboard' ? ' · 📋' : ''}</span></div>
    <div class="s">${esc(names)}</div>
    <div class="s ${err ? 'err' : ''}">${err ? esc(err.error) : `${h.ok}/${h.total} ${t('files')}${sizes ? ' · ' + sizes : ''}`}</div></div>
    <div class="acts">${h.undone ? `<span class="muted">${t('undone')}</span>` : h.ok ? `<button class="btn sm" data-a="reveal" data-id="${h.id}">${t('reveal')}</button><button class="btn sm" data-a="undo" data-id="${h.id}">${t('undo')}</button>` : ''}</div></div>`;
}

async function histAction(a, id) {
  if (a === 'reveal') dropring.invoke('reveal', { id });
  if (a === 'undo') { await dropring.invoke('history:undo', id); }
}

function renderJobs() {
  $('#jobs').innerHTML = [...liveJobs.values()].map((j) => `<div class="row"><div class="th">⟳</div><div><div class="t">${esc(j.label)}</div><div class="prog"><i style="width:${Math.round((j.value || 0) * 100)}%"></i></div></div><div class="acts"><button class="btn sm" data-c="${j.id}">${t('cancel')}</button></div></div>`).join('');
  $('#jobs').querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => dropring.invoke('cancel', b.dataset.c)));
}

dropring.on('job', (p) => {
  if (p.type === 'done') liveJobs.delete(p.id);
  else liveJobs.set(p.id, { ...(liveJobs.get(p.id) || {}), id: p.id, label: p.label, value: p.value ?? (liveJobs.get(p.id) || {}).value });
  renderJobs();
});
dropring.on('state-changed', async () => { ST = await dropring.invoke('state'); renderHome(); });

const drop = $('#drop');
drop.onclick = async () => { const f = await dropring.invoke('pick-files'); if (f.length) dropring.invoke('open-ring-for', f); };
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  let files = [...e.dataTransfer.files].map((f) => dropring.pathOf(f)).filter(Boolean);
  if (!files.length) {
    const urls = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter((u) => /^https?:/i.test(u));
    if (urls.length) files = await dropring.invoke('ring:urls', urls);
  }
  if (files.length) dropring.invoke('open-ring-for', files);
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());
$('#clip').onclick = () => dropring.invoke('clipboard:save');
$('#clearH').onclick = async () => { await dropring.invoke('history:clear'); ST.history = []; renderHome(); };

const accLabel = (a) => String(a || '').replace('CommandOrControl', ST && ST.platform === 'darwin' ? '⌘' : 'Ctrl').replace('Alt', ST && ST.platform === 'darwin' ? '⌥' : 'Alt');

// ——— Tarifler ———
const OPS = ['resize', 'quality', 'target', 'convert', 'strip', 'grayscale', 'rotate', 'trim', 'fps', 'mute', 'pages', 'rename', 'folder', 'replace', 'action'];
const CATS = ['image', 'video', 'audio', 'document', 'data', 'archive'];
const ACTIONS = ['strip', 'zip-all', 'merge-pdf', 'split-pdf', 'frames', 'extract'];

function renderRecipes() {
  $('#recipesLead').textContent = i18n.lang === 'tr'
    ? 'Birden çok adımı tek bırakışta çalıştırın: küçült → dönüştür → EXIF sil → yeniden adlandır. Tarifler halkanın ikinci yüzünde (Tab) görünür.'
    : 'Run several steps in one drop: resize → convert → strip EXIF → rename. Recipes appear on the second side of the ring (Tab).';
  $('#rlist').innerHTML = ST.recipes.map((r) => `<a data-id="${esc(r.id)}" class="${curRecipe === r.id ? 'on' : ''}"><span class="em">${esc(r.icon || '★')}</span>${esc(r.name)}</a>`).join('');
  $('#rlist').querySelectorAll('a').forEach((a) => (a.onclick = () => { curRecipe = a.dataset.id; renderRecipes(); }));
  if (!curRecipe && ST.recipes[0]) { curRecipe = ST.recipes[0].id; return renderRecipes(); }
  const r = ST.recipes.find((x) => x.id === curRecipe);
  $('#redit').innerHTML = r ? recipeEditor(r) : `<div class="empty">—</div>`;
  if (r) bindRecipe(r);
}

function opParams(s, i) {
  const num = (k, ph, w = 80) => `<label>${ph}<input type="number" data-k="${k}" data-i="${i}" value="${esc(s[k] ?? '')}" style="width:${w}px"></label>`;
  const txt = (k, ph, w = 160) => `<input type="text" data-k="${k}" data-i="${i}" value="${esc(s[k] ?? '')}" placeholder="${esc(ph)}" style="width:${w}px">`;
  const sel = (k, opts) => `<select data-k="${k}" data-i="${i}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(s[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  switch (s.op) {
    case 'resize': return num('maxWidth', i18n.lang === 'tr' ? 'G' : 'W', 72) + num('maxHeight', i18n.lang === 'tr' ? 'Y' : 'H', 72);
    case 'quality': return num('value', '1–100');
    case 'target': return txt('size', '16MB', 100);
    case 'convert': return sel('to', [['same', i18n.lang === 'tr' ? '(aynı format)' : '(same format)'], ...ST.formats.map((f) => [f.id, `${f.label} · ${t('cat_' + f.cat)}`])]);
    case 'rotate': return sel('deg', [[90, '90°'], [180, '180°'], [270, '270°']]);
    case 'trim': return txt('start', '00:00:05', 90) + txt('end', '00:00:30', 90);
    case 'fps': return num('value', 'fps');
    case 'pages': return txt('value', '1-3,5', 100);
    case 'rename': return txt('pattern', '{name}-web', 200);
    case 'folder': return sel('path', [['same', t('same')], ['subfolder', t('subfolder')], ['downloads', t('downloads')], ...(s.path && !['same', 'subfolder', 'downloads'].includes(s.path) ? [[s.path, s.path]] : []), ['__pick', t('custom')]]);
    case 'action': return sel('id', ACTIONS.map((a) => [a, a]));
    default: return '';
  }
}

function recipeEditor(r) {
  return `
    <div class="field"><div class="lbl">${t('name')}</div><div style="display:flex;gap:8px"><input type="text" id="rIcon" value="${esc(r.icon || '')}" style="width:52px;min-width:0;text-align:center" title="${t('icon')}"><input type="text" id="rName" value="${esc(r.name)}" style="width:240px"></div></div>
    <div class="field"><div class="lbl">${t('appliesTo')}</div><div class="cats">${CATS.map((c) => `<label><input type="checkbox" value="${c}" ${(r.cats || []).includes(c) ? 'checked' : ''}>${t('cat_' + c)}</label>`).join('')}</div></div>
    <h2 style="margin-top:14px">${t('steps')}</h2>
    <div id="steps">${(r.steps || []).map((s, i) => `<div class="step"><div class="n">${i + 1}</div>
      <select data-op="${i}">${OPS.map((o) => `<option value="${o}" ${o === s.op ? 'selected' : ''}>${t('op_' + o)}</option>`).join('')}</select>
      <div class="params">${opParams(s, i)}</div>
      <div><button class="btn sm" data-up="${i}" title="↑">↑</button> <button class="btn sm danger" data-del="${i}">✕</button></div></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn sm" id="sAdd">+ ${t('addStep')}</button>
      <span style="flex:1"></span>
      <button class="btn sm" id="rDup">${t('duplicate')}</button>
      <button class="btn sm danger" id="rDel">${t('delete')}</button>
      <button class="btn pri sm" id="rSave">${t('save')}</button>
    </div>
    <p class="muted" style="font-size:12.5px;margin-top:12px">${esc(t('tokens'))}</p>`;
}

function bindRecipe(r) {
  const draft = JSON.parse(JSON.stringify(r));
  const rerender = () => { $('#redit').innerHTML = recipeEditor(draft); bindDraft(); };
  const bindDraft = () => {
    $('#rName').oninput = (e) => (draft.name = e.target.value);
    $('#rIcon').oninput = (e) => (draft.icon = e.target.value);
    $('#redit').querySelectorAll('.cats input').forEach((c) => (c.onchange = () => (draft.cats = [...$('#redit').querySelectorAll('.cats input:checked')].map((x) => x.value))));
    $('#redit').querySelectorAll('[data-op]').forEach((s) => (s.onchange = () => { draft.steps[+s.dataset.op] = { op: s.value, ...(s.value === 'convert' ? { to: 'webp' } : s.value === 'action' ? { id: 'strip' } : {}) }; rerender(); }));
    $('#redit').querySelectorAll('[data-k]').forEach((inp) => (inp.onchange = async () => {
      const st = draft.steps[+inp.dataset.i];
      let v = inp.value;
      if (v === '__pick') { v = await dropring.invoke('pick-folder'); if (!v) return rerender(); }
      st[inp.dataset.k] = inp.type === 'number' ? (v === '' ? undefined : Number(v)) : v;
      if (v === '__pick' || inp.dataset.k === 'path') rerender();
    }));
    $('#redit').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { draft.steps.splice(+b.dataset.del, 1); rerender(); }));
    $('#redit').querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; rerender(); }));
    $('#sAdd').onclick = () => { draft.steps.push({ op: 'convert', to: 'webp' }); rerender(); };
    $('#rSave').onclick = async () => { ST.recipes = await dropring.invoke('recipes:save', ST.recipes.map((x) => (x.id === draft.id ? { ...draft, builtin: false } : x))); renderRecipes(); };
    $('#rDup').onclick = async () => { const c = { ...JSON.parse(JSON.stringify(draft)), id: 'r' + Date.now().toString(36), name: draft.name + ' (2)', builtin: false }; ST.recipes = await dropring.invoke('recipes:save', [...ST.recipes, c]); curRecipe = c.id; renderRecipes(); };
    $('#rDel').onclick = async () => { ST.recipes = await dropring.invoke('recipes:save', ST.recipes.filter((x) => x.id !== draft.id)); curRecipe = null; renderRecipes(); };
  };
  bindDraft();
}
$('#rNew').onclick = async () => {
  const r = { id: 'r' + Date.now().toString(36), name: i18n.lang === 'tr' ? 'Yeni tarif' : 'New recipe', icon: '★', cats: ['image'], steps: [{ op: 'resize', maxWidth: 1600 }, { op: 'convert', to: 'webp' }] };
  ST.recipes = await dropring.invoke('recipes:save', [...ST.recipes, r]); curRecipe = r.id; renderRecipes();
};
$('#rReset').onclick = async () => { ST.recipes = await dropring.invoke('recipes:reset'); curRecipe = null; renderRecipes(); };

// ——— İzlenen klasörler ———
function renderWatches() {
  $('#watchLead').textContent = i18n.lang === 'tr'
    ? 'Bu klasörlere düşen her dosya otomatik dönüştürülür ve "Dönüştürülenler" alt klasörüne kaydedilir. Örn. İndirilenler → HEIC’leri JPG yap, Taramalar → PDF.'
    : 'Every file that lands in these folders is converted automatically into a "Converted" subfolder.';
  const all = ST.formats.map((f) => f.id);
  $('#wlist').innerHTML = ST.watches.length ? ST.watches.map((w, i) => `<div class="wrow">
      <div class="path" title="${esc(w.folder)}">${esc(w.folder)}</div>
      <select data-w="${i}" data-k="mode">${all.map((id) => `<option value="t:${id}" ${!w.recipeId && w.target === id ? 'selected' : ''}>→ ${esc(ST.formats.find((f) => f.id === id).label)}</option>`).join('')}
        ${ST.recipes.map((r) => `<option value="r:${esc(r.id)}" ${w.recipeId === r.id ? 'selected' : ''}>${esc((r.icon || '★') + ' ' + r.name)}</option>`).join('')}</select>
      <label class="muted" style="display:flex;gap:8px;align-items:center;font-size:12.5px"><span class="switch"><input type="checkbox" data-w="${i}" data-k="moveOriginals" ${w.moveOriginals ? 'checked' : ''}><span></span></span>${t('moveOriginals')}</label>
      <div style="display:flex;gap:8px;align-items:center"><span class="switch" title="${t('enabled')}"><input type="checkbox" data-w="${i}" data-k="enabled" ${w.enabled !== false ? 'checked' : ''}><span></span></span><button class="btn sm danger" data-wdel="${i}">✕</button></div>
    </div>`).join('') : `<div class="empty" style="margin-bottom:12px">—</div>`;
  $('#wlist').querySelectorAll('[data-k]').forEach((el) => (el.onchange = () => {
    const w = ST.watches[+el.dataset.w];
    if (el.dataset.k === 'mode') { const [k, v] = el.value.split(':'); if (k === 't') { w.target = v; delete w.recipeId; } else { w.recipeId = v; delete w.target; } }
    else w[el.dataset.k] = el.checked;
    saveWatches();
  }));
  $('#wlist').querySelectorAll('[data-wdel]').forEach((b) => (b.onclick = () => { ST.watches.splice(+b.dataset.wdel, 1); saveWatches(); renderWatches(); }));
}
async function saveWatches() { ST.watches = await dropring.invoke('watches:save', ST.watches); }
$('#wAdd').onclick = async () => {
  const f = await dropring.invoke('pick-folder');
  if (!f) return;
  ST.watches.push({ folder: f, target: 'jpg', enabled: true, moveOriginals: false });
  await saveWatches(); renderWatches();
};

// ——— Ayarlar ———
function renderSettings() {
  const s = ST.settings, o = s.output;
  const sw = (k, v) => `<span class="switch"><input type="checkbox" data-s="${k}" ${v ? 'checked' : ''}><span></span></span>`;
  const sel = (k, v, opts) => `<select data-s="${k}">${opts.map(([a, b]) => `<option value="${esc(a)}" ${String(v) === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  const field = (lbl, ctrl, hint = '') => `<div class="field"><div><div class="lbl">${lbl}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${ctrl}</div>`;
  const mac = ST.platform === 'darwin';
  const folderOpts = [['same', t('same')], ['subfolder', t('subfolder')], ['downloads', t('downloads')], ...(!['same', 'subfolder', 'downloads'].includes(o.folder) ? [[o.folder, o.folder]] : []), ['__pick', t('custom')]];
  $('#settingsForm').innerHTML = `
    <h2>${t('trigger')}</h2><div class="card">
      ${field(t('gesture'), sw('gesture', s.gesture), mac && !ST.gestureOk ? esc(t('accessTitle')) : '')}
      ${field(t('gestureKey'), sel('gestureKey', s.gestureKey, mac ? [['alt', '⌥ Option'], ['meta', '⌘ Command'], ['shift', '⇧ Shift']] : [['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift']]))}
      ${field(t('bubble'), sw('bubble', s.bubble))}
      ${field(t('launch'), sw('launchAtLogin', s.launchAtLogin))}
    </div>
    <h2>${t('output')}</h2><div class="card">
      ${field(t('folder'), sel('output.folder', o.folder, folderOpts))}
      ${field(t('pattern'), `<input type="text" data-s="output.pattern" value="${esc(o.pattern)}" style="width:200px">`, esc(t('tokens')))}
      ${field(t('conflict'), sel('output.conflict', o.conflict, [['rename', t('cRename')], ['skip', t('cSkip')], ['overwrite', t('cOverwrite')]]))}
      ${field(t('replace'), sw('output.replaceOriginal', o.replaceOriginal))}
      ${field(t('reveal2'), sw('revealAfter', s.revealAfter))}
      ${field(t('notify'), sw('notify', s.notify))}
    </div>
    <h2>${t('shortcuts')}</h2><div class="card">
      ${field(t('clipShortcut'), `<input type="text" data-s="clipboardShortcut" value="${esc(s.clipboardShortcut)}" class="mono" style="width:220px">`)}
      ${field(t('ringShortcut'), `<input type="text" data-s="ringShortcut" value="${esc(s.ringShortcut)}" class="mono" style="width:220px">`)}
      ${field(t('clipFormat'), sel('clipboardFormat', s.clipboardFormat, [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['avif', 'AVIF']]))}
    </div>
    <h2>${t('appearance')}</h2><div class="card">
      ${field(t('language'), sel('language', s.language, [['auto', t('system')], ['tr', 'Türkçe'], ['en', 'English']]))}
      ${field(t('theme'), sel('theme', s.theme, [['system', t('system')], ['light', t('light')], ['dark', t('dark')]]))}
      ${field(t('accent'), `<input type="color" data-s="accent" value="${esc(s.accent)}">`)}
      ${field(t('opacity'), `<input type="range" min="0.6" max="1" step="0.02" data-s="opacity" value="${s.opacity}">`)}
      ${field(t('pinned'), `<input type="text" data-s="pinned" value="${esc((s.pinned || []).join(', '))}" placeholder="webp, pdf, mp4" style="width:200px">`)}
    </div>
    <h2>${t('advanced')}</h2><div class="card">
      ${field(t('concurrency'), sel('concurrency', s.concurrency, [[0, t('auto')], [1, '1'], [2, '2'], [4, '4'], [8, '8']]))}
    </div>`;
  $('#settingsForm').querySelectorAll('[data-s]').forEach((el) => (el.onchange = async () => {
    const k = el.dataset.s;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'concurrency') v = Number(v);
    if (k === 'opacity') v = Number(v);
    if (k === 'pinned') v = v.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (v === '__pick') { v = await dropring.invoke('pick-folder'); if (!v) return renderSettings(); }
    const patch = k.startsWith('output.') ? { output: { [k.slice(7)]: v } } : { [k]: v };
    ST.settings = await dropring.invoke('settings:save', patch);
    if (['language', 'theme', 'accent'].includes(k) || k === 'output.folder') { i18n.set(ST.settings.language); applyTheme(); i18n.apply(); renderHome(); renderRecipes(); renderWatches(); renderSettings(); }
  }));
}

load();
