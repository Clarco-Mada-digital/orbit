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

// Description du modèle envoyé à la page : entrées et séparateurs, sous-menus
// imbriqués. `byId` retrouve l'entrée d'origine (avec son `click`).
export function serializeMenuTemplate(template) {
  const byId = new Map();
  let sequence = 0;

  const walk = (items) => {
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
      sequence += 1;
      const id = String(sequence);
      byId.set(id, item);
      const node = {
        id,
        label: String(item.label),
        disabled: item.enabled === false,
      };
      const submenu = Array.isArray(item.submenu) ? item.submenu : [];
      if (submenu.length) node.submenu = walk(submenu);
      out.push(node);
    }
    // Un séparateur en fin de liste ne sépare rien non plus.
    while (out.length && out[out.length - 1].sep) out.pop();
    return out;
  };

  return { model: walk(template), byId };
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

    var close = function (value) {
      if (finished) return;
      finished = true;
      try {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onDismiss, true);
        window.removeEventListener('blur', onDismiss, true);
        window.removeEventListener('scroll', onDismiss, true);
        if (host && host.parentNode) host.parentNode.removeChild(host);
      } catch (error) {
        /* page en cours de destruction */
      }
      if (window.__orbitPageMenuClose__ === onDismiss) window.__orbitPageMenuClose__ = null;
      resolve(value === undefined || value === null ? null : String(value));
    };

    var onDismiss = function () {
      close(null);
    };

    var onKey = function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(null);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      if (!focusables.length) return;
      if (event.key === 'Enter') {
        if (active) active.click();
        return;
      }
      var index = focusables.indexOf(active);
      var step = event.key === 'ArrowDown' ? 1 : -1;
      var next = index < 0 ? 0 : (index + step + focusables.length) % focusables.length;
      setActive(focusables[next], true);
    };

    var focusables = [];
    var active = null;

    // `scroll` seulement au clavier : au survol, `scrollIntoView` pouvait faire
    // défiler la page sous le menu — et notre écouteur « scroll » le refermait.
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
      row.style.background = on ? 'linear-gradient(90deg, rgba(99,102,241,.95), rgba(79,70,229,.95))' : 'transparent';
      row.style.color = on ? '#ffffff' : '#e5e7eb';
    };

    try {
      if (typeof window.__orbitPageMenuClose__ === 'function') window.__orbitPageMenuClose__();
      var MODEL = payload.model || [];
      if (!MODEL.length) {
        resolve(null);
        return;
      }

      host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;

      var layer = document.createElement('div');
      layer.style.cssText = 'position:absolute;inset:0;background:transparent';
      layer.addEventListener('mousedown', function (event) {
        // Le clic « ailleurs » ferme le menu et n'atteint pas la page : c'est ce
        // que fait un menu natif, et ça évite de cliquer dans le vide.
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });
      layer.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
        close(null);
      });

      var card = document.createElement('div');
      card.style.cssText = [
        'position:fixed',
        'min-width:244px',
        'max-width:min(380px, 92vw)',
        'max-height:calc(100vh - 16px)',
        'overflow:auto',
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
      card.style.left = Math.max(8, Number(payload.x) || 0) + 'px';
      card.style.top = Math.max(8, Number(payload.y) || 0) + 'px';
      card.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });

      var list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:1px';
      card.appendChild(list);

      var appendItems = function (parent, items, depth) {
        items.forEach(function (item) {
          if (!item) return;
          if (item.sep) {
            var sep = document.createElement('div');
            sep.style.cssText = 'height:1px;margin:5px 8px;background:rgba(148,163,184,.18)';
            parent.appendChild(sep);
            return;
          }

          var disabled = item.disabled === true;
          var row = document.createElement('div');
          row.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:10px',
            'padding:7px 10px',
            'border-radius:9px',
            'cursor:' + (disabled ? 'default' : 'pointer'),
            'opacity:' + (disabled ? '0.38' : '1'),
            'padding-left:' + (10 + depth * 16) + 'px',
            'background:transparent',
            'color:#e5e7eb',
          ].join(';');

          var text = document.createElement('span');
          text.textContent = String(item.label || '');
          text.style.cssText = 'flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
          row.appendChild(text);

          var arrow = null;
          if (item.submenu && item.submenu.length) {
            arrow = document.createElement('span');
            arrow.textContent = '\u25B8';
            arrow.style.cssText = 'flex:0 0 auto;font-size:11px;opacity:.7;transition:transform .12s ease';
            row.appendChild(arrow);
          }

          parent.appendChild(row);
          if (disabled) return;

          focusables.push(row);
          row.addEventListener('mouseenter', function () {
            setActive(row);
          });

          if (item.submenu && item.submenu.length) {
            var box = document.createElement('div');
            box.style.cssText = 'display:none;flex-direction:column;gap:1px';
            var built = false;
            row.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopPropagation();
              if (!built) {
                appendItems(box, item.submenu, depth + 1);
                built = true;
              }
              var open = box.style.display !== 'none';
              box.style.display = open ? 'none' : 'flex';
              if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
            });
            parent.appendChild(box);
          } else {
            row.addEventListener('click', function (event) {
              event.preventDefault();
              event.stopPropagation();
              close(item.id);
            });
          }
        });
      };

      appendItems(list, MODEL, 0);

      layer.appendChild(card);
      root.appendChild(layer);
      (document.body || document.documentElement).appendChild(host);

      // Le menu s'ouvre au clic, mais ne doit pas dépasser de la fenêtre.
      var rect = card.getBoundingClientRect();
      var left = Math.max(8, Math.min(Number(payload.x) || 0, window.innerWidth - rect.width - 8));
      var top = Math.max(8, Math.min(Number(payload.y) || 0, window.innerHeight - rect.height - 8));
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';

      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', onDismiss, true);
      window.addEventListener('blur', onDismiss, true);
      window.addEventListener('scroll', onDismiss, true);
      window.__orbitPageMenuClose__ = onDismiss;
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
export function pageMenuScript(model, point) {
  const payload = {
    model,
    x: Math.max(0, Math.round(Number(point?.x) || 0)),
    y: Math.max(0, Math.round(Number(point?.y) || 0)),
  };
  return `(${pageMenuInjected.toString()})(${JSON.stringify(payload)})`;
}
