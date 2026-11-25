// Options — QR Code Generator
(() => {
  'use strict';

  const DEFAULTS = { scale: 8, dark: '#111827', light: '#ffffff', showFab: false };

  const scaleEl = document.getElementById('scale');
  const darkEl = document.getElementById('dark');
  const lightEl = document.getElementById('light');
  const showFabEl = document.getElementById('showFab');
  const savedEl = document.getElementById('saved');

  chrome.storage.local.get(['config'], (res) => {
    const cfg = { ...DEFAULTS, ...((res && res.config) || {}) };
    scaleEl.value = cfg.scale;
    darkEl.value = cfg.dark;
    lightEl.value = cfg.light;
    showFabEl.checked = !!cfg.showFab;
  });

  document.getElementById('save').addEventListener('click', () => {
    const cfg = {
      scale: parseInt(scaleEl.value, 10) || 8,
      dark: darkEl.value,
      light: lightEl.value,
      showFab: showFabEl.checked,
    };
    chrome.storage.local.set({ config: cfg }, () => {
      savedEl.style.display = 'inline';
      setTimeout(() => (savedEl.style.display = 'none'), 1800);
    });
  });
})();
