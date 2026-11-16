/* global window, document */

// Menu contextuel dessiné DANS la page d'une fenêtre secondaire.
//
// Pourquoi ce module : dans la fenêtre principale, le clic droit d'une app
// embarquée ouvre le menu HTML de l'interface (GuestContextMenu). Une fenêtre
// détachée ou une pop-up, elle, n'a pas d'interface Orbit : le processus
// principal y affichait donc un menu NATIF — que l'on ne peut pas styler, d'où
// cette liste grise sans rapport avec le reste de l'app.
//
// Ici, le menu est une superposition HTML injectée par `executeJavaScript`,
// donc rendue dans la page du site, mais isolée dans un shadow root fermé (le
// CSS du site ne la touche pas). Aucune fenêtre n'est créée : le focus et la
// sélection restent dans la page, ce qui compte pour « Coller », « Relire » ou
// le remplacement d'un mot souligné.
//
// Le contenu ne vient PAS d'ici : `serializeMenuTemplate` transforme la même
// description que le menu natif (buildGuestContextMenu dans main.js) en une
// liste d'entrées visibles ; le choix renvoie un identifiant, et main.js appelle
// le `click` de l'entrée d'origine. Une seule source de vérité, deux rendus.
//
// Les styles sont posés par `cssText` (et non par des balises <style>) : une
// page à CSP stricte laisserait passer la création d'éléments, pas forcément
// une feuille de style en ligne.

// Icônes du menu : des tracés SVG (aucune image, aucun paquet) transmis à la
// page comme données. Plusieurs sous-tracés sont séparés par `|`.
const ICON_PATHS = {
  back: 'M19 12H5|M12 19l-7-7 7-7',
  forward: 'M5 12h14|M12 5l7 7-7 7',
  reload: 'M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8|M21 3v5h-5',
  reset: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  orbit: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z|M3 12h18|M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z',
  external: 'M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1|M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  camera:
    'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z|M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14|M2 6h14a2 2 0 0 1 2 2v14',
  copy: 'M8 8h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z|M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2',
  scissors:
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M20 4 8.1 15.9|M14.5 14.5 20 20',
  paste:
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2|M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
  select: 'M4 7V4h3|M20 7V4h-3|M4 17v3h3|M20 17v3h-3|M9 12h6',
  spell: 'M6 17 12 5l6 12|M8.6 12h6.8|M16 19l2 2 4-4',
  bot: 'M12 8V4H8|M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z|M9 15v-2|M15 15v-2',
  undo: 'M9 14 4 9l5-5|M4 9h11a5 5 0 0 1 0 10h-4',
  redo: 'M15 14l5-5-5-5|M20 9H9a5 5 0 0 0 0 10h4',
  key: 'M14 10a4 4 0 1 0-5.7 3.6L4 18v3h3v-2h2v-2h2l1.4-1.4A4 4 0 0 0 14 10z',
  languages: 'M3 5h12|M9 3v2|M5 9c0 4 3 7 7 8|M15 21l4-10 4 10|M16.5 17h5',
  volume: 'M11 5 6 9H3v6h3l5 4z|M16 9a4 4 0 0 1 0 6|M19 6a8 8 0 0 1 0 12',
  volumeX: 'M11 5 6 9H3v6h3l5 4z|M22 9l-6 6|M16 9l6 6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.3-4.3',
  download: 'M12 3v12|M7 10l5 5 5-5|M4 20h16',
  music: 'M9 18V6l12-2v12|M9 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M21 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z|M21 16l-5-5-9 9',
  pip: 'M3 5h18v14H3z|M12 12h7v5h-7z',
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.3-4.3|M11 8v6|M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z|M21 21l-4.3-4.3|M8 11h6',
  bug: 'M8 2l2 3|M16 2l-2 3|M12 20a5 5 0 0 0 5-5V9a5 5 0 0 0-10 0v6a5 5 0 0 0 5 5z|M3 13h4|M17 13h4|M3 18h3|M18 18h3',
  chevron: 'M9 6l6 6-6 6',
};

// Une icône par entrée, reconnue à son libellé. Le libellé le plus long gagne
// (« Copier l'adresse du lien » n'est pas « Copier »).
const ICON_RULES = [
  ['Ouvrir la page dans Orbit', 'orbit'],
  ['Ouvrir le lien dans Orbit', 'orbit'],
  ['Ouvrir la page dans le navigateur', 'external'],
  ['Ouvrir le lien dans le navigateur', 'external'],
  ["Ouvrir l'image dans le navigateur", 'external'],
  ["Copier l'adresse de la page", 'link'],
  ["Copier l'adresse du lien", 'link'],
  ["Copier l'adresse de l'image", 'link'],
  ["Copier l'image", 'image'],
  ["Enregistrer l'image", 'download'],
  ['Télécharger le lien', 'download'],
  ['Télécharger la vidéo', 'download'],
  ['Télécharger l’audio', 'music'],
  ['Image dans l’image', 'pip'],
  ['Relire la sélection', 'spell'],
  ['Demander à l’assistant', 'bot'],
  ['Annuler', 'undo'],
  ['Rétablir', 'redo'],
  ['Couper', 'scissors'],
  ['Copier', 'copy'],
  ['Coller', 'paste'],
  ['Tout sélectionner', 'select'],
  ['Générer un mot de passe', 'key'],
  ['Traduire la sélection', 'languages'],
  ['Lire la page à voix haute', 'volume'],
  ['Lire à voix haute', 'volume'],
  ['Arrêter la lecture', 'volumeX'],
  ['Rechercher', 'search'],
  ["Capture d'écran", 'camera'],
  ['Zone visible', 'camera'],
  ['Page entière', 'crop'],
  ['Sélection…', 'crop'],
  ['Précédent', 'back'],
  ['Suivant', 'forward'],
  ['Recharger', 'reload'],
  ['Zoom', 'zoomIn'],
  ['Agrandir', 'zoomIn'],
  ['Réduire', 'zoomOut'],
  ['Taille normale', 'reset'],
  ['Inspecter', 'bug'],
].sort((a, b) => b[0].length - a[0].length);

function iconFor(label) {
  const text = String(label || '');
  for (const [prefix, icon] of ICON_RULES) {
    if (text.startsWith(prefix)) return icon;
  }
  return '';
}

// Rangée d'icônes en tête du menu : les gestes qu'on reconnaît sans lire. Ces
// entrées quittent la liste texte (elles y feraient doublon), sauf la capture
// qui garde son sous-menu pour les autres modes.
const BAR_RULES = [
  { match: (label) => label === 'Précédent', icon: 'back', remove: true },
  { match: (label) => label === 'Suivant', icon: 'forward', remove: true },
  { match: (label) => label === 'Recharger', icon: 'reload', remove: true },
  { match: (label) => /^Ouvrir (la page|le lien) dans Orbit$/.test(label), icon: 'orbit', remove: true },
  {
    match: (label) => /^Ouvrir (la page|le lien) dans le navigateur$/.test(label),
    icon: 'external',
    remove: true,
  },
  { match: (label) => label === "Copier l'adresse de la page", icon: 'link', remove: true },
  {
    match: (label) => label === "Capture d'écran",
    icon: 'camera',
    remove: false,
    // Le bouton appareil photo capture directement la zone visible.
    child: 'Zone visible',
  },
];

// Description du modèle envoyé à la page : entrées et séparateurs, sous-menus
// imbriqués. `byId` retrouve l'entrée d'origine (avec son `click`), `bar` les
// raccourcis de la rangée d'icônes.
export function serializeMenuTemplate(template) {
  const byId = new Map();
  const shortcuts = new Map();
  let sequence = 0;

  const walk = (items, depth) => {
    const out = [];
    for (const item of items || []) {
      if (!item) continue;
      if (item.type === 'separator') {
        // Deux séparateurs qui se suivent ne séparent rien.
        if (!out.length || out[out.length - 1].sep) continue;
        out.push({ sep: true });
        continue;
      }
      if (!item.label) continue;
      const label = String(item.label);
      const rule = depth === 0 ? BAR_RULES.find((candidate) => candidate.match(label)) : null;
      sequence += 1;
      const id = String(sequence);
      byId.set(id, item);
      const node = {
        id,
        label,
        icon: iconFor(label),
        disabled: item.enabled === false,
      };
      const submenu = Array.isArray(item.submenu) ? item.submenu : [];
      if (submenu.length) node.submenu = walk(submenu, depth + 1);
      if (rule) {
        const child = rule.child
          ? (node.submenu || []).find((entry) => !entry.sep && entry.label === rule.child)
          : null;
        if (!rule.child || child) {
          shortcuts.set(rule, {
            id: child ? child.id : id,
            label,
            enabled: child ? !child.disabled : !node.disabled,
          });
        }
        if (rule.remove) continue;
      }
      out.push(node);
    }
    // Un séparateur en fin de liste ne sépare rien non plus.
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  };

  const model = walk(template, 0);
  const bar = BAR_RULES.filter((rule) => shortcuts.has(rule)).map((rule) => ({
    ...shortcuts.get(rule),
    icon: rule.icon,
  }));

  return { model, byId, bar };
}

// Script injecté dans la page. Il rend le menu et résout avec l'identifiant de
// l'entrée choisie (null si on ferme sans rien prendre).
//
// Contrainte : cette fonction est sérialisée par `toString()`, donc elle ne doit
// RIEN capturer de l'extérieur (aucune variable du module, aucun import).
function pageMenuInjected(payload) {
  return new Promise(function (resolve) {
    var finished = false;
    var host = null;
    var rows = [];
    var panels = [];
    var active = null;
    var openTimer = null;
    var closeTimer = null;
    var icons = payload.icons || {};

    var clearTimers = function () {
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };

    var close = function (value) {
      if (finished) return;
      finished = true;
      clearTimers();
      try {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', dismiss, true);
        window.removeEventListener('blur', dismiss, true);
        window.removeEventListener('scroll', onScroll, true);
        if (host && host.parentNode) host.parentNode.removeChild(host);
      } catch (error) {
        /* page en cours de destruction */
      }
      if (window.__orbitPageMenuClose__ === dismiss) window.__orbitPageMenuClose__ = null;
      resolve(value === undefined || value === null ? null : String(value));
    };

    var dismiss = function () {
      close(null);
    };

    // Au clavier seulement : au survol, `scrollIntoView` pouvait faire défiler
    // la page sous le menu — et notre écouteur « scroll » le refermait.
    var setActive = function (row, scroll) {
      if (active && active !== row) paintRow(active, false);
      active = row;
      if (!row) return;
      paintRow(row, true);
      if (!scroll) return;
      try {
        row.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        /* pas de défilement possible */
      }
    };

    var paintRow = function (row, on) {
      row.style.background = on
        ? 'linear-gradient(90deg, rgba(99,102,241,.95), rgba(79,70,229,.95))'
        : 'transparent';
      row.style.color = on ? '#ffffff' : '#e5e7eb';
    };

    var shape = function (name, size) {
      var paths = icons[name];
      if (!paths) return null;
      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.7');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('width', String(size || 15));
      svg.setAttribute('height', String(size || 15));
      svg.style.cssText = 'flex:0 0 auto;pointer-events:none';
      String(paths)
        .split('|')
        .forEach(function (d) {
          var path = document.createElementNS(ns, 'path');
          path.setAttribute('d', d);
          svg.appendChild(path);
        });
      return svg;
    };

    // Un panneau (racine ou sous-menu) : même carte sombre, même ombre.
    var PAPER = [
      'position:fixed',
      'min-width:250px',
      'max-width:min(390px, 92vw)',
      'max-height:calc(100vh - 16px)',
      'overflow:auto',
      'overscroll-behavior:contain',
      'padding:6px',
      'border-radius:14px',
      'background:rgba(17,24,39,.97)',
      'border:1px solid rgba(148,163,184,.24)',
      'box-shadow:0 24px 60px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.45)',
      'backdrop-filter:blur(16px)',
      'font:13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
      'color:#e5e7eb',
      'user-select:none',
    ].join(';');

    var layer = null;
    var rootPanel = null;

    var isDescendant = function (row, ancestor) {
      var cursor = row;
      while (cursor) {
        if (cursor === ancestor) return true;
        cursor = cursor.__parentRow;
      }
      return false;
    };

    // Un seul sous-menu ouvert par niveau : les frères se referment.
    var closePanels = function (predicate) {
      var kept = [];
      panels.forEach(function (panel) {
        if (!predicate(panel)) {
          kept.push(panel);
          return;
        }
        panel.style.display = 'none';
      });
      panels = kept;
    };

    var closeFrom = function (row) {
      closePanels(function (panel) {
        return isDescendant(panel.__owner, row);
      });
    };

    var closeBelow = function (depth) {
      closePanels(function (panel) {
        return panel.__owner.__depth >= depth;
      });
    };

    var isVisible = function (row) {
      var panel = row.__container;
      while (panel) {
        if (panel !== rootPanel && panel.style.display === 'none') return false;
        panel = panel.__owner ? panel.__owner.__container : null;
      }
      return true;
    };

    var visibleRows = function () {
      return rows.filter(isVisible);
    };

    var openPanel = function (row) {
      var panel = row.__panel;
      if (!panel) return;
      clearTimers();
      closePanels(function (other) {
        return other !== panel && other.__owner.__depth >= row.__depth;
      });
      if (panels.indexOf(panel) < 0) panels.push(panel);
      panel.style.display = 'flex';
      // Mesuré après affichage : la largeur dépend du contenu.
      var rect = panel.getBoundingClientRect();
      var anchor = row.getBoundingClientRect();
      var left = anchor.right + 2;
      if (left + rect.width > window.innerWidth - 8) {
        left = Math.max(8, anchor.left - rect.width - 2);
      }
      var top = anchor.top - 6;
      if (top + rect.height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - rect.height - 8);
      }
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
    };

    var onRowHover = function (row) {
      setActive(row, false);
      clearTimers();
      if (row.__panel) {
        openTimer = setTimeout(function () {
          openTimer = null;
          openPanel(row);
        }, 90);
        return;
      }
      closeBelow(row.__depth);
    };

    var onRowLeave = function (row) {
      if (!row.__panel) return;
      closeTimer = setTimeout(function () {
        closeTimer = null;
        closeFrom(row);
      }, 180);
    };

    var onKey = function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key === 'ArrowRight') {
        if (!active || !active.__panel) return;
        event.preventDefault();
        event.stopPropagation();
        openPanel(active);
        var first = visibleRows().filter(function (row) {
          return row.__parentRow === active;
        })[0];
        if (first) setActive(first, true);
        return;
      }
      if (event.key === 'ArrowLeft') {
        if (!active || !active.__parentRow) return;
        event.preventDefault();
        event.stopPropagation();
        var owner = active.__parentRow;
        closeFrom(owner);
        setActive(owner, true);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      var list = visibleRows();
      if (!list.length) return;
      if (event.key === 'Enter') {
        var target = active && list.indexOf(active) >= 0 ? active : list[0];
        if (!target) return;
        if (target.__panel) {
          openPanel(target);
          var child = visibleRows().filter(function (row) {
            return row.__parentRow === target;
          })[0];
          if (child) setActive(child, true);
        } else {
          close(target.__id);
        }
        return;
      }
      var index = list.indexOf(active);
      var step = event.key === 'ArrowDown' ? 1 : -1;
      var next = index < 0 ? 0 : (index + step + list.length) % list.length;
      setActive(list[next], true);
    };

    // Le défilement DANS le menu ne doit pas le refermer. La shadow root étant
    // fermée, l'événement est retargeté sur l'hôte : c'est lui qu'on reconnaît.
    var onScroll = function (event) {
      if (event && event.target === host) return;
      close(null);
    };

    try {
      if (typeof window.__orbitPageMenuClose__ === 'function') window.__orbitPageMenuClose__();
      var MODEL = payload.model || [];
      var BAR = payload.bar || [];
      if (!MODEL.length) {
        resolve(null);
        return;
      }

      host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

      // Un clic sur le fond ferme le menu et n'atteint pas la page : c'est ce
      // que fait un menu natif, et ça évite de cliquer dans le vide.
      layer = document.createElement('div');
      layer.style.cssText = 'position:absolute;inset:0;background:transparent';
      layer.addEventListener('mousedown', function (event) {
        if (event.target !== layer) return;
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });
      layer.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });

      var makePanel = function (visible) {
        var panel = document.createElement('div');
        panel.style.cssText = PAPER + ';display:' + (visible ? 'flex' : 'none') + ';flex-direction:column';
        var list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-direction:column;gap:1px';
        panel.appendChild(list);
        panel.__list = list;
        panel.addEventListener('mousedown', function (event) {
          // Ni fermeture de la superposition, ni vol du focus de la page :
          // « Coller » et le remplacement d'un mot en dépendent.
          event.preventDefault();
          event.stopPropagation();
        });
        panel.addEventListener('contextmenu', function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
        return panel;
      };

      rootPanel = makePanel(true);
      rootPanel.style.left = Math.max(8, Number(payload.x) || 0) + 'px';
      rootPanel.style.top = Math.max(8, Number(payload.y) || 0) + 'px';

      // Rangée d'icônes : les gestes de navigation, qu'on reconnaît sans les
      // lire. Ils occupaient quatre lignes de texte dans le menu natif.
      if (BAR.length) {
        var barRow = document.createElement('div');
        barRow.style.cssText =
          'display:flex;align-items:center;gap:2px;padding:1px 2px 5px;margin-bottom:4px;border-bottom:1px solid rgba(148,163,184,.18)';
        BAR.forEach(function (entry) {
          var button = document.createElement('div');
          button.style.cssText = [
            'flex:1 1 0',
            'min-width:0',
            'height:29px',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'border-radius:8px',
            'cursor:' + (entry.enabled ? 'pointer' : 'default'),
            'opacity:' + (entry.enabled ? '1' : '0.32'),
            'color:#c7d2fe',
            'background:transparent',
            'transition:background .12s ease',
          ].join(';');
          var icon = shape(entry.icon, 16);
          if (icon) button.appendChild(icon);
          button.title = String(entry.label || '');
          button.setAttribute('role', 'button');
          button.setAttribute('aria-label', String(entry.label || ''));
          if (entry.enabled) {
            button.addEventListener('mouseenter', function () {
              button.style.background = 'rgba(99,102,241,.32)';
              button.style.color = '#ffffff';
            });
            button.addEventListener('mouseleave', function () {
              button.style.background = 'transparent';
              button.style.color = '#c7d2fe';
            });
            button.addEventListener('mousedown', function (event) {
              event.preventDefault();
              event.stopPropagation();
            });
            button.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopPropagation();
              close(entry.id);
            });
          }
          barRow.appendChild(button);
        });
        rootPanel.insertBefore(barRow, rootPanel.firstChild);
      }

      // L'adresse du lien survolé : on voit où mène le clic avant de le faire.
      if (payload.hint) {
        var hint = document.createElement('div');
        hint.style.cssText =
          'display:flex;align-items:center;gap:6px;padding:2px 8px 6px;margin-bottom:3px;border-bottom:1px solid rgba(148,163,184,.18);color:#93a3b8;font-size:11.5px';
        var hintIcon = shape('link', 12);
        if (hintIcon) hint.appendChild(hintIcon);
        var hintText = document.createElement('span');
        hintText.textContent = String(payload.hint);
        hintText.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        hint.title = String(payload.hint);
        hint.appendChild(hintText);
        rootPanel.insertBefore(hint, rootPanel.__list);
      }

      var appendItems = function (panelEl, items, owner) {
        items.forEach(function (item) {
          if (!item) return;
          if (item.sep) {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;margin:5px 8px;background:rgba(148,163,184,.18)';
            panelEl.__list.appendChild(sep);
            return;
          }
          var disabled = item.disabled === true;
          var row = document.createElement('div');
          row.__id = item.id;
          row.__parentRow = owner || null;
          row.__depth = owner ? owner.__depth + 1 : 0;
          row.__container = panelEl;
          row.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:9px',
            'padding:7px 9px',
            'border-radius:9px',
            'cursor:' + (disabled ? 'default' : 'pointer'),
            'opacity:' + (disabled ? '0.38' : '1'),
            'background:transparent',
            'color:#e5e7eb',
          ].join(';');

          var icon = shape(item.icon, 15);
          if (icon) row.appendChild(icon);
          var text = document.createElement('span');
          text.textContent = String(item.label || '');
          text.style.cssText = 'flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
          row.appendChild(text);

          var hasSubmenu = Boolean(item.submenu && item.submenu.length);
          if (hasSubmenu) {
            var arrow = shape('chevron', 13);
            if (!arrow) {
              arrow = document.createElement('span');
              arrow.textContent = '\u25B8';
            }
            arrow.style.cssText += ';opacity:.5';
            row.appendChild(arrow);
          }

          panelEl.__list.appendChild(row);
          rows.push(row);
          if (disabled) return;

          row.addEventListener('mouseenter', function () {
            onRowHover(row);
          });
          row.addEventListener('mouseleave', function () {
            onRowLeave(row);
          });
          row.addEventListener('mousedown', function (event) {
            event.preventDefault();
            event.stopPropagation();
            setActive(row, false);
          });

          if (hasSubmenu) {
            // Sous-menu volant : il s'ouvre au survol, comme un menu natif, et
            // reste ouvert tant qu'on est sur la ligne ou sur le panneau.
            var box = makePanel(false);
            box.__owner = row;
            row.__panel = box;
            box.addEventListener('mouseenter', function () {
              clearTimers();
            });
            box.addEventListener('mouseleave', function () {
              onRowLeave(row);
            });
            layer.appendChild(box);
            appendItems(box, item.submenu, row);
            row.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopPropagation();
              if (panels.indexOf(box) >= 0) closeFrom(row);
              else openPanel(row);
            });
            return;
          }

          row.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            close(item.id);
          });
        });
      };

      appendItems(rootPanel, MODEL, null);

      layer.appendChild(rootPanel);
      root.appendChild(layer);
      (document.body || document.documentElement).appendChild(host);

      // Le menu s'ouvre au clic, mais ne doit pas dépasser de la fenêtre.
      var rect = rootPanel.getBoundingClientRect();
      var left = Math.max(8, Math.min(Number(payload.x) || 0, window.innerWidth - rect.width - 8));
      var top = Math.max(8, Math.min(Number(payload.y) || 0, window.innerHeight - rect.height - 8));
      rootPanel.style.left = Math.round(left) + 'px';
      rootPanel.style.top = Math.round(top) + 'px';

      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', dismiss, true);
      window.addEventListener('blur', dismiss, true);
      window.addEventListener('scroll', onScroll, true);
      window.__orbitPageMenuClose__ = dismiss;
    } catch (error) {
      // Page exotique (document en cours de navigation, DOM verrouillé…) : on
      // le dit au processus principal, qui affichera le menu natif plutôt que de
      // laisser le clic droit sans effet.
      finished = true;
      try {
        if (host && host.parentNode) host.parentNode.removeChild(host);
      } catch (cleanupError) {
        /* rien à nettoyer */
      }
      resolve('__orbit-menu-error__');
    }
  });
}

// Script prêt à exécuter. `JSON.stringify` protège les libellés (guillemets,
// retours à la ligne, caractères exotiques) : rien n'est interprété comme du JS.
export function pageMenuScript({ model, bar, hint } = {}, point) {
  const payload = {
    model: model || [],
    bar: bar || [],
    hint: String(hint || '').slice(0, 400),
    icons: ICON_PATHS,
    x: Math.max(0, Math.round(Number(point?.x) || 0)),
    y: Math.max(0, Math.round(Number(point?.y) || 0)),
  };
  return `(${pageMenuInjected.toString()})(${JSON.stringify(payload)})`;
}
