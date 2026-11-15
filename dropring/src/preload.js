'use strict';
// Arayüz ile ana süreç arasındaki tek köprü. Yalnızca izin verilen kanallar açılır.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = new Set([
  'state', 'options', 'run', 'ring:close', 'ring:ready', 'ring:resize', 'ring:urls', 'ring:clickmode',
  'settings:save', 'recipes:save', 'recipes:reset', 'watches:save', 'history:clear', 'history:undo',
  'reveal', 'open-path', 'copy-result', 'pick-files', 'pick-folder', 'open-ring-for', 'cancel',
  'clipboard:save', 'accessibility:request', 'toast:resize', 'toast:hide', 'bubble:drop', 'bubble:move', 'show-main',
]);
const EVENTS = new Set(['ring:open', 'ring:drag-end', 'ring:hide', 'job', 'state-changed', 'navigate', 'toast']);

contextBridge.exposeInMainWorld('dropring', {
  platform: process.platform,
  invoke: (ch, ...args) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, ...args) : Promise.reject(new Error('kanal yok: ' + ch))),
  on: (ch, cb) => {
    if (!EVENTS.has(ch)) return () => {};
    const h = (_e, ...a) => cb(...a);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
