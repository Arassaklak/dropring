  'use strict';
  const t = (k, v) => i18n.t(k, v);
  const cards = new Map();
  const list = document.getElementById('list');
  const fmt = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function fit() { requestAnimationFrame(() => dropring.invoke('toast:resize', cards.size ? list.scrollHeight + 4 : 0)); }

  function card(id) {
    let c = cards.get(id);
    if (!c) { c = document.createElement('div'); c.className = 'card'; list.appendChild(c); cards.set(id, c); }
    clearTimeout(c._t);
    return c;
  }
  function remove(id, ms) {
    const c = cards.get(id); if (!c) return;
    c._t = setTimeout(() => { c.remove(); cards.delete(id); fit(); }, ms);
  }

  dropring.on('toast', (p) => {
    const c = card(p.id);
    if (p.type === 'info') {
      c.innerHTML = `<div class="icon">i</div><div><div class="title">${esc(p.label)}</div><div class="sub">${esc(p.text)}</div></div>`;
      remove(p.id, 4000);
    } else if (p.type === 'start' || p.type === 'progress' || p.type === 'file-done' || p.type === 'file-error') {
      if (p.type === 'start' || !c.querySelector('.fg')) {
        c.innerHTML = `<svg class="ring" viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="100.5" stroke-dashoffset="100.5"/></svg>
          <div><div class="title">${esc(p.label)}</div><div class="sub">${t('working')}…</div><div class="btns"><button data-a="cancel">${t('cancel')}</button></div></div>`;
        c.querySelector('[data-a=cancel]').onclick = () => dropring.invoke('cancel', p.id);
      }
      if (p.value != null) c.querySelector('.fg').setAttribute('stroke-dashoffset', String(100.5 * (1 - p.value)));
    } else if (p.type === 'done') {
      const e = p.entry;
      const allOk = e.ok === e.total;
      const errs = e.results.filter((r) => r.error);
      const diff = e.bytesIn && e.bytesOut ? Math.round((1 - e.bytesOut / e.bytesIn) * 100) : null;
      const sizeTxt = diff == null ? '' : diff >= 0 ? `${fmt(e.bytesIn)} → ${fmt(e.bytesOut)} · %${diff} ${t('saved')}` : `${fmt(e.bytesIn)} → ${fmt(e.bytesOut)}`;
      const head = e.thumb ? `<img class="thumb" src="${e.thumb}">` : `<div class="icon ${e.ok ? '' : 'bad'}">${e.ok ? '✓' : '!'}</div>`;
      c.innerHTML = `${head}<div><div class="title">${esc(e.label)} · ${allOk ? t('done') : e.ok ? t('partly') : t('error')}</div>
        <div class="sub ${errs.length ? 'err' : ''}">${errs.length ? esc(errs[0].error) : esc(sizeTxt || `${e.ok} ${t('files')}`)}</div>
        <div class="btns">${e.ok ? `<button data-a="reveal">${t('reveal')}</button><button data-a="copy">${t('copy')}</button><button data-a="undo">${t('undo')}</button>` : ''}</div></div>`;
      const first = e.results.flatMap((r) => r.outputs || [])[0];
      const b = (a) => c.querySelector(`[data-a=${a}]`);
      if (b('reveal')) b('reveal').onclick = () => dropring.invoke('reveal', { id: e.id });
      if (b('copy')) b('copy').onclick = () => { dropring.invoke('copy-result', first); b('copy').textContent = '✓'; };
      if (b('undo')) b('undo').onclick = async () => { await dropring.invoke('history:undo', e.id); c.querySelector('.title').textContent = t('undone'); b('undo').remove(); remove(p.id, 1200); };
      c.onmouseenter = () => clearTimeout(c._t);
      c.onmouseleave = () => remove(p.id, 2500);
      remove(p.id, errs.length ? 9000 : 6000);
    }
    fit();
  });
