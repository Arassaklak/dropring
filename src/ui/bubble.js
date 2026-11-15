  'use strict';
  const b = document.getElementById('b');
  ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; b.classList.add('over'); }));
  document.addEventListener('dragleave', () => b.classList.remove('over'));
  document.addEventListener('drop', (e) => {
    e.preventDefault(); b.classList.remove('over');
    const files = [...e.dataTransfer.files].map((f) => dropring.pathOf(f)).filter(Boolean);
    if (files.length) dropring.invoke('bubble:drop', files);
  });
  // Sürükleyerek taşı, tıklayınca ana pencere
  let drag = null, moved = false;
  b.addEventListener('mousedown', (e) => { drag = { x: e.screenX, y: e.screenY }; moved = false; });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.screenX - drag.x, dy = e.screenY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) { moved = true; dropring.invoke('bubble:move', dx, dy); drag = { x: e.screenX, y: e.screenY }; }
  });
  window.addEventListener('mouseup', () => { if (drag && !moved) dropring.invoke('show-main'); drag = null; });
