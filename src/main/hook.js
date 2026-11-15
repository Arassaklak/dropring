'use strict';
// Küresel hareket algılayıcı: tetik tuşu (Windows: Ctrl, macOS: Option) basılıyken
// fare sürüklenmeye başlarsa imlecin yanında halka açılır. Gezgin/Finder sürüklemesi sürer,
// dosya halkaya bırakılır. Kaynak dosyalar hiçbir zaman taşınmaz/silinmez (bırakma "kopyala"dır).

const EventEmitter = require('events');
const { screen, systemPreferences } = require('electron');

const THRESHOLD = 14; // px — tıklamayla sürüklemeyi ayırır

class GestureHook extends EventEmitter {
  constructor() {
    super();
    this.hook = null;
    this.down = null;
    this.opened = false;
    this.key = 'ctrl';
    this.running = false;
  }

  /** macOS'ta Erişilebilirlik izni gerekir. prompt=true ise sistem izni sorar. */
  static permitted(prompt = false) {
    if (process.platform !== 'darwin') return true;
    return systemPreferences.isTrustedAccessibilityClient(prompt);
  }

  start(key) {
    this.key = key || this.key;
    if (this.running) return true;
    if (!GestureHook.permitted(false)) return false;
    let mod;
    try { mod = require('uiohook-napi'); } catch (e) { this.emit('error', e); return false; }
    this.hook = mod.uIOhook;
    const toDip = (x, y) => (process.platform === 'win32' ? screen.screenToDipPoint({ x, y }) : { x, y });
    const held = (e) => ({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }[this.key]);

    this.hook.on('mousedown', (e) => {
      if (e.button !== 1) return;
      this.down = { x: e.x, y: e.y };
      this.opened = false;
    });
    const move = (e) => {
      if (!this.down || this.opened) return;
      if (!held(e)) return;
      if (Math.hypot(e.x - this.down.x, e.y - this.down.y) < THRESHOLD) return;
      this.opened = true;
      this.emit('drag-start', toDip(e.x, e.y));
    };
    this.hook.on('mousemove', move);
    this.hook.on('mouseup', (e) => {
      if (e.button !== 1) return;
      const was = this.opened;
      this.down = null; this.opened = false;
      if (was) this.emit('drag-end', toDip(e.x, e.y));
    });
    this.hook.on('keydown', (e) => { if (e.keycode === 1 /* Esc */) this.emit('escape'); });
    try { this.hook.start(); this.running = true; } catch (e) { this.emit('error', e); return false; }
    return true;
  }

  stop() {
    if (!this.running) return;
    try { this.hook.removeAllListeners(); this.hook.stop(); } catch { /* yoksay */ }
    this.running = false;
  }
}

module.exports = { GestureHook };
