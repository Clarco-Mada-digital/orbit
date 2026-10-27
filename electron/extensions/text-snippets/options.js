// Options — Text Snippets : gestion des snippets (chrome.storage.local)
(() => {
  'use strict';

  const DEFAULT_SNIPPETS = {
    email: 'prenom.nom@example.com',
    tel: '+33 6 12 34 56 78',
    addr: '12 rue des Lilas, 75011 Paris',
    sig: 'Cordialement,\nPrénom Nom\n—\nSociété · +33 6 12 34 56 78',
  };

  const listEl = document.getElementById('list');
  const enabledEl = document.getElementById('enabled');
  const allowPasswordFieldsEl = document.getElementById('allow-password-fields');
  const triggerEl = document.getElementById('trigger');
  const savedEl = document.getElementById('saved');

  let snippets = { ...DEFAULT_SNIPPETS };

  function render() {
    listEl.innerHTML = '';
    const keys = Object.keys(snippets);
    if (keys.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Aucun snippet. Cliquez sur « + Ajouter ».';
      listEl.appendChild(p);
      return;
    }
    keys.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'row';

      const abbr = document.createElement('input');
      abbr.type = 'text';
      abbr.className = 'abbr';
      abbr.value = k;
      abbr.placeholder = 'abréviation';
      abbr.addEventListener('change', () => {
        const nk = abbr.value.trim().toLowerCase().replace(/\s+/g, '');
        if (!nk || nk === k || snippets[nk] !== undefined) {
          abbr.value = k; // invalide ou doublon : annuler
          return;
        }
        snippets[nk] = snippets[k];
        delete snippets[k];
        render();
      });

      const val = document.createElement('textarea');
      val.className = 'value';
      val.value = snippets[k];
      val.placeholder = 'Texte complet inséré à la place';
      val.addEventListener('change', () => {
        snippets[k] = val.value;
      });

      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = '✕';
      del.title = 'Supprimer ce snippet';
      del.addEventListener('click', () => {
        delete snippets[k];
        render();
      });

      row.appendChild(abbr);
      row.appendChild(val);
      row.appendChild(del);
      listEl.appendChild(row);
    });
  }

  function save() {
    // Nettoyage : clés vides supprimées
    const clean = {};
    Object.keys(snippets).forEach((k) => {
      const kk = k.trim().toLowerCase().replace(/\s+/g, '');
      if (kk) clean[kk] = snippets[k];
    });
    snippets = clean;

    const trigger = (triggerEl.value || ';').charAt(0) || ';';
    chrome.storage.local.set(
      {
        snippets,
        trigger,
        enabled: enabledEl.checked,
        allowPasswordFields: allowPasswordFieldsEl.checked,
      },
      () => {
        savedEl.style.display = 'inline';
        setTimeout(() => (savedEl.style.display = 'none'), 1800);
      }
    );
  }

  chrome.storage.local.get(['snippets', 'trigger', 'enabled', 'allowPasswordFields'], (res) => {
    if (res && res.snippets) snippets = { ...res.snippets };
    if (res && typeof res.trigger === 'string' && res.trigger) triggerEl.value = res.trigger;
    else triggerEl.value = ';';
    enabledEl.checked = !!(res && res.enabled !== false);
    allowPasswordFieldsEl.checked = res?.allowPasswordFields === true;
    render();
  });

  document.getElementById('add').addEventListener('click', () => {
    let n = 'nouveau';
    let i = 1;
    while (snippets[n + i] !== undefined) i++;
    snippets[n + i] = 'Texte à définir…';
    render();
  });

  document.getElementById('reset').addEventListener('click', () => {
    snippets = { ...DEFAULT_SNIPPETS };
    triggerEl.value = ';';
    enabledEl.checked = true;
    allowPasswordFieldsEl.checked = false;
    render();
  });

  document.getElementById('save').addEventListener('click', save);
})();
