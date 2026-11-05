// Fenêtre d'une capture épinglée — code de rendu.
//
// Elle ne décide rien : l'image arrive par IPC (le processus principal garde
// l'original pour la copie et l'enregistrement), et chaque bouton renvoie une
// action. Les quatre niveaux d'opacité servent à garder la capture sous les
// yeux tout en lisant ce qu'elle recouvre.
(() => {
  'use strict';

  const OPACITIES = [1, 0.8, 0.55, 0.3];
  let opacityIndex = 0;

  const shot = document.getElementById('shot');
  const status = document.getElementById('status');
  let statusTimer = 0;

  function say(message) {
    status.textContent = message;
    status.classList.add('show');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => status.classList.remove('show'), 1600);
  }

  window.pin?.onImage?.((payload) => {
    if (payload?.dataUrl) shot.src = payload.dataUrl;
    if (payload?.filename) document.title = `${payload.filename} — Orbit`;
  });

  async function copy() {
    const res = await window.pin?.copy?.();
    say(res?.success ? 'Image copiée' : 'Copie impossible');
  }

  async function save() {
    const res = await window.pin?.save?.();
    if (res?.cancelled) return;
    say(res?.success ? 'Image enregistrée' : 'Enregistrement impossible');
  }

  function cycleOpacity() {
    opacityIndex = (opacityIndex + 1) % OPACITIES.length;
    const value = OPACITIES[opacityIndex];
    window.pin?.opacity?.(value);
    say(`Opacité ${Math.round(value * 100)} %`);
  }

  document.getElementById('copy').addEventListener('click', copy);
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('opacity').addEventListener('click', cycleOpacity);
  document.getElementById('close').addEventListener('click', () => window.pin?.close?.());

  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      window.pin?.close?.();
    } else if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copy();
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    } else if (event.key.toLowerCase() === 'o') {
      cycleOpacity();
    }
  });
})();
