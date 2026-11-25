// Options — Sticky Notes : apparence + gestion des notes stockées
(() => {
  'use strict';

  const DEFAULTS = { opacity: 0.95, width: 300, height: 260, autoOpen: true, fontSize: 13 };

  const opacityEl = document.getElementById('opacity');
  const opacityValEl = document.getElementById('opacityVal');
  const widthEl = document.getElementById('width');
  const heightEl = document.getElementById('height');
  const fontSizeEl = document.getElementById('fontSize');
  const autoOpenEl = document.getElementById('autoOpen');
  const savedEl = document.getElementById('saved');
  const tableEl = document.getElementById('notesTable');

  chrome.storage.local.get(['config'], (res) => {
    const cfg = { ...DEFAULTS, ...((res && res.config) || {}) };
    opacityEl.value = cfg.opacity;
    opacityValEl.textContent = Math.round(cfg.opacity * 100) + '%';
    widthEl.value = cfg.width;
    heightEl.value = cfg.height;
    fontSizeEl.value = cfg.fontSize;
    autoOpenEl.checked = !!cfg.autoOpen;
  });

  opacityEl.addEventListener('input', () => {
    opacityValEl.textContent = Math.round(opacityEl.value * 100) + '%';
  });

  document.getElementById('save').addEventListener('click', () => {
    const cfg = {
      opacity: parseFloat(opacityEl.value),
      width: parseInt(widthEl.value, 10) || 300,
      height: parseInt(heightEl.value, 10) || 260,
      fontSize: parseInt(fontSizeEl.value, 10) || 13,
      autoOpen: autoOpenEl.checked,
    };
    chrome.storage.local.set({ config: cfg }, () => {
      savedEl.style.display = 'inline';
      setTimeout(() => (savedEl.style.display = 'none'), 1800);
    });
  });

  // ── Liste des notes ────────────────────────────────────────────────────────

  function renderNotes() {
    chrome.storage.local.get(null, (all) => {
      const notes = Object.keys(all || {})
        .filter((k) => k.startsWith('notes:'))
        .map((k) => ({ domain: k.slice(6), key: k, text: all[k] || '' }))
        .sort((a, b) => a.domain.localeCompare(b.domain));

      tableEl.innerHTML = '';
      if (notes.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.className = 'hint';
        td.textContent = 'Aucune note. Cliquez sur 📝 dans une page pour en créer une.';
        tr.appendChild(td);
        tableEl.appendChild(tr);
        return;
      }

      notes.forEach((n) => {
        const tr = document.createElement('tr');

        const tdDomain = document.createElement('td');
        tdDomain.textContent = n.domain;
        tdDomain.style.fontWeight = '600';

        const tdChars = document.createElement('td');
        tdChars.className = 'chars';
        tdChars.textContent = n.text.length + ' car.';

        const tdActions = document.createElement('td');
        tdActions.className = 'actions';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn ghost';
        viewBtn.textContent = 'Voir';
        viewBtn.style.marginRight = '6px';
        viewBtn.style.padding = '4px 8px';
        viewBtn.addEventListener('click', () => {
          alert(`Note — ${n.domain}\n\n${n.text || '(vide)'}`);
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'btn danger';
        delBtn.textContent = 'Supprimer';
        delBtn.style.padding = '4px 8px';
        delBtn.addEventListener('click', () => {
          if (!confirm(`Supprimer la note de ${n.domain} ?`)) return;
          chrome.storage.local.remove(n.key, renderNotes);
        });

        tdActions.appendChild(viewBtn);
        tdActions.appendChild(delBtn);
        tr.appendChild(tdDomain);
        tr.appendChild(tdChars);
        tr.appendChild(tdActions);
        tableEl.appendChild(tr);
      });
    });
  }

  document.getElementById('export').addEventListener('click', () => {
    chrome.storage.local.get(null, (all) => {
      const notes = {};
      Object.keys(all || {}).forEach((k) => {
        if (k.startsWith('notes:')) notes[k.slice(6)] = all[k];
      });
      const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sticky-notes-export.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  document.getElementById('clearAll').addEventListener('click', () => {
    if (!confirm('Supprimer TOUTES les notes de tous les sites ?')) return;
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all || {}).filter((k) => k.startsWith('notes:'));
      chrome.storage.local.remove(keys, () => {
        renderNotes();
      });
    });
  });

  renderNotes();
})();
