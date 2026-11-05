// Options — Souris & Défilement.
//
// Les réglages passent TOUS par `OrbitScroll.normalizeConfig` (lib.js, partagé
// avec le script de contenu) : la page d'options ne peut pas écrire une valeur
// que le défilement ne saurait pas appliquer.
(() => {
  'use strict';

  const LIB = globalThis.OrbitScroll;
  // Les bascules de la palette (laser, spot, halo, curseur, couleur,
  // épaisseur) ne sont PAS ici : elles se choisissent dans la palette, sur la
  // page, où l'on en voit l'effet. Cette page ne règle que le durable.
  const CHECKS = ['enabled', 'smooth', 'invert', 'horizontal', 'trackpadPassthrough'];
  // Curseurs : l'interface travaille en entiers, la configuration en facteurs.
  const SLIDERS = {
    intensity: { scale: 100, unit: '%' },
    step: { scale: 1, unit: ' px' },
    speed: { scale: 100, unit: '%' },
    fastFactor: { scale: 10, unit: '×' },
    autoScrollSpeed: { scale: 100, unit: '%' },
  };

  const el = (id) => document.getElementById(id);
  const savedEl = el('saved');
  let config = LIB.normalizeConfig({});

  function renderSites() {
    const host = el('sites');
    host.innerHTML = '';
    const patterns = Object.keys(config.sites).sort();
    if (!patterns.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Aucun site particulier : les réglages ci-dessus valent partout.';
      host.appendChild(empty);
      return;
    }
    const table = document.createElement('table');
    patterns.forEach((pattern) => {
      const rule = config.sites[pattern];
      const row = document.createElement('tr');

      const name = document.createElement('td');
      const label = document.createElement('code');
      label.textContent = pattern;
      name.appendChild(label);

      const smooth = document.createElement('td');
      const smoothBox = document.createElement('label');
      smoothBox.className = 'check';
      smoothBox.style.margin = '0';
      const smoothInput = document.createElement('input');
      smoothInput.type = 'checkbox';
      smoothInput.checked = rule.smooth !== false;
      smoothInput.addEventListener('change', () => {
        config.sites[pattern] = { ...rule, smooth: smoothInput.checked };
      });
      smoothBox.appendChild(smoothInput);
      smoothBox.appendChild(document.createTextNode('lissé'));
      smooth.appendChild(smoothBox);

      const invert = document.createElement('td');
      const invertBox = document.createElement('label');
      invertBox.className = 'check';
      invertBox.style.margin = '0';
      const invertInput = document.createElement('input');
      invertInput.type = 'checkbox';
      invertInput.checked = rule.invert === true;
      invertInput.addEventListener('change', () => {
        config.sites[pattern] = { ...config.sites[pattern], invert: invertInput.checked };
      });
      invertBox.appendChild(invertInput);
      invertBox.appendChild(document.createTextNode('sens inversé'));
      invert.appendChild(invertBox);

      const speed = document.createElement('td');
      const speedInput = document.createElement('input');
      speedInput.type = 'number';
      speedInput.min = '25';
      speedInput.max = '400';
      speedInput.step = '5';
      speedInput.style.width = '82px';
      speedInput.value = Math.round((rule.speed === undefined ? config.speed : rule.speed) * 100);
      speedInput.title = 'Vitesse sur ce site (%)';
      speedInput.addEventListener('change', () => {
        config.sites[pattern] = {
          ...config.sites[pattern],
          speed: Number(speedInput.value) / 100,
        };
      });
      speed.appendChild(speedInput);
      speed.appendChild(document.createTextNode(' %'));

      const remove = document.createElement('td');
      const removeButton = document.createElement('button');
      removeButton.className = 'btn danger';
      removeButton.textContent = '✕';
      removeButton.title = `Supprimer la règle ${pattern}`;
      removeButton.addEventListener('click', () => {
        delete config.sites[pattern];
        renderSites();
      });
      remove.appendChild(removeButton);

      [name, smooth, invert, speed, remove].forEach((cell) => row.appendChild(cell));
      table.appendChild(row);
    });
    host.appendChild(table);
  }

  function render() {
    CHECKS.forEach((key) => {
      el(key).checked = config[key] === true;
    });
    Object.keys(SLIDERS).forEach((key) => {
      const { scale, unit } = SLIDERS[key];
      const input = el(key);
      input.value = Math.round(config[key] * scale);
      const out = el(`${key}-out`);
      if (out) out.textContent = key === 'fastFactor' ? `${config[key].toFixed(1)}×` : `${input.value}${unit}`;
    });
    el('fastModifier').value = config.fastModifier;
    el('autoScroll').value = config.autoScroll;
    renderSites();
  }

  function readForm() {
    // On repart de la configuration COMPLÈTE : les choix faits dans la palette
    // (outil, couleur, épaisseur, position) ne doivent pas être effacés parce
    // qu'on a touché à un curseur de cette page.
    const next = { ...config, sites: config.sites };
    CHECKS.forEach((key) => {
      next[key] = el(key).checked;
    });
    Object.keys(SLIDERS).forEach((key) => {
      next[key] = Number(el(key).value) / SLIDERS[key].scale;
    });
    next.fastModifier = el('fastModifier').value;
    next.autoScroll = el('autoScroll').value;
    return LIB.normalizeConfig(next);
  }

  function save() {
    config = readForm();
    render();
    chrome.storage.local.set({ config }, () => {
      savedEl.style.display = 'inline';
      setTimeout(() => {
        savedEl.style.display = 'none';
      }, 1800);
    });
  }

  // Les curseurs se lisent en direct : on voit l'effet du réglage avant
  // d'enregistrer.
  Object.keys(SLIDERS).forEach((key) => {
    el(key).addEventListener('input', () => {
      config = readForm();
      render();
    });
  });
  CHECKS.concat(['fastModifier', 'autoScroll']).forEach((key) => {
    el(key).addEventListener('change', () => {
      config = readForm();
      render();
    });
  });

  el('add').addEventListener('click', () => {
    const raw = String(el('new-host').value || '').trim().toLowerCase();
    // On accepte un hôte, un joker `*.domaine`, ou une URL collée.
    const host = raw.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
    if (!host || !/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/.test(host)) {
      el('new-host').focus();
      el('new-host').select();
      return;
    }
    config.sites[host] = config.sites[host] || { smooth: true };
    el('new-host').value = '';
    renderSites();
  });

  el('save').addEventListener('click', save);
  el('reset').addEventListener('click', () => {
    config = LIB.normalizeConfig({});
    render();
  });

  chrome.storage.local.get(['config'], (res) => {
    if (!chrome.runtime.lastError) config = LIB.normalizeConfig(res && res.config);
    render();
  });
})();
