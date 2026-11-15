'use strict';
// Ayarlar, geçmiş, tarifler ve izlenen klasörler: kullanıcı veri klasöründe JSON.
// Yazmalar atomik (geçici dosya + yeniden adlandırma), böylece çökme ayarları bozmaz.

const fs = require('fs');
const path = require('path');
const { BUILTIN } = require('../engine/recipes');

const DEFAULT_SETTINGS = {
  language: 'auto',              // 'auto' | 'tr' | 'en'
  theme: 'system',               // 'system' | 'light' | 'dark'
  accent: '#6c5ce7',
  gesture: true,                 // tuş + sürükle ile halka
  gestureKey: process.platform === 'darwin' ? 'alt' : 'ctrl',
  bubble: false,                 // yüzen bırakma balonu
  launchAtLogin: false,
  clipboardShortcut: 'CommandOrControl+Alt+V',
  clipboardFormat: 'png',
  ringShortcut: 'CommandOrControl+Alt+Space',
  output: { folder: 'same', subfolder: 'DropRing', pattern: '{name}', conflict: 'rename', replaceOriginal: false },
  concurrency: 0,                // 0 = otomatik
  revealAfter: false,
  notify: true,
  pinned: [],                    // halkada öne alınan hedefler (ör. ['webp','pdf'])
  opacity: 0.96,
  onboarded: false,
};

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.settings = { ...DEFAULT_SETTINGS, ...this._read('ayarlar.json', {}) };
    this.settings.output = { ...DEFAULT_SETTINGS.output, ...(this.settings.output || {}) };
    this.history = this._read('gecmis.json', []);
    this.recipes = this._read('tarifler.json', null) || BUILTIN.map((r) => ({ ...r, builtin: true }));
    this.watches = this._read('izlenen.json', []);
  }

  _read(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8')); } catch { return fallback; }
  }

  _write(name, data) {
    const p = path.join(this.dir, name);
    fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(p + '.tmp', p);
  }

  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch, output: { ...this.settings.output, ...(patch.output || {}) } };
    this._write('ayarlar.json', this.settings);
    return this.settings;
  }

  addHistory(entry) {
    this.history.unshift(entry);
    this.history = this.history.slice(0, 300);
    this._write('gecmis.json', this.history);
  }

  updateHistory(id, patch) {
    const h = this.history.find((x) => x.id === id);
    if (h) Object.assign(h, patch);
    this._write('gecmis.json', this.history);
    return h;
  }

  clearHistory() { this.history = []; this._write('gecmis.json', []); }

  saveRecipes(list) { this.recipes = list; this._write('tarifler.json', list); return list; }
  resetRecipes() { return this.saveRecipes(BUILTIN.map((r) => ({ ...r, builtin: true }))); }

  saveWatches(list) { this.watches = list; this._write('izlenen.json', list); return list; }
}

module.exports = { Store, DEFAULT_SETTINGS };
