// ---------------------------------------------------------------------------
// Souris & Défilement (Orbit)
//
// Trois outils qui tiennent au même geste — la souris :
//   • défilement LISSÉ (la page glisse au lieu de sauter), vitesse et sens
//     réglables, par site ;
//   • défilement AUTOMATIQUE au clic du milieu, pour lire sans toucher à rien ;
//   • une PALETTE DE PRÉSENTATION (Alt+Maj+D) : pointeur laser, stylo,
//     surligneur, flèche, rectangle, ellipse, couleurs, épaisseurs, spot
//     lumineux, halo de clic — de quoi commenter une page en direct ou filmer
//     une démonstration avec le studio d'Orbit.
//
// Tout est local, rien ne sort de la machine. La logique délicate (molette ou
// pavé tactile ? combien de pixels par cran ?) vit dans `lib.js`, testée par
// `node --test`.
//
// UN SEUL raccourci, et c'est volontaire : Orbit intercepte les combinaisons
// Alt avant la page, et s'en est déjà réservé beaucoup (Alt+Maj+P profils,
// Alt+Maj+H barres, Alt+Maj+M tout marquer comme lu…). Le reste se choisit
// dans la palette, où on le VOIT.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var LIB = globalThis.OrbitScroll;
  if (!LIB) return; // lib.js absent : on ne touche à rien

  var HOST = '';
  try {
    HOST = location.hostname || '';
  } catch (err) {
    return;
  }

  var config = LIB.normalizeConfig({});
  var site = LIB.resolveSite(config, HOST);
  var nativeHost = LIB.hostUsesNativeScroll(HOST);
  var TOP_FRAME = window.top === window.self;

  // ── Réglages (chrome.storage.local) ───────────────────────────────────────

  function applyConfig(raw) {
    config = LIB.normalizeConfig(raw);
    site = LIB.resolveSite(config, HOST);
    // Les réglages peuvent venir d'un AUTRE onglet (page d'options) : si la
    // palette est ouverte ici, elle doit refléter le changement.
    if (paletteOpen) {
      rebuildPalette();
      refreshFollowers();
      applyPointerMode();
    }
  }

  function saveConfig(next) {
    try {
      chrome.storage.local.set({ config: LIB.normalizeConfig(next) });
    } catch (err) {
      /* stockage indisponible : les réglages restent en mémoire */
    }
  }

  try {
    chrome.storage.local.get(['config'], function (res) {
      if (chrome.runtime.lastError) return;
      applyConfig(res && res.config);
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local' || !changes.config) return;
      applyConfig(changes.config.newValue);
    });
  } catch (err) {
    /* hors contexte d'extension */
  }

  // ── Défilement lissé ──────────────────────────────────────────────────────

  var wheelState = {};
  // Une animation par conteneur et par axe : deux zones défilables peuvent
  // glisser en même temps sans se voler la vedette.
  var animations = new Map();

  function scrollableAncestor(node, axis, direction) {
    var el = node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.nodeType === 1) {
        var style = null;
        try {
          style = window.getComputedStyle(el);
        } catch (err) {
          style = null;
        }
        if (style) {
          var overflow = axis === 'x' ? style.overflowX : style.overflowY;
          var size = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
          var position = axis === 'x' ? el.scrollLeft : el.scrollTop;
          var canMove = direction > 0 ? position < size - 1 : position > 1;
          if (size > 2 && canMove && /auto|scroll|overlay/.test(overflow)) return el;
        }
      }
      // Sortie d'un arbre d'ombre : on remonte par l'élément hôte.
      var parent = el.parentNode;
      if (parent && parent.nodeType === 11 && parent.host) parent = parent.host;
      el = parent;
    }
    return document.scrollingElement || document.documentElement;
  }

  function positionOf(el, axis) {
    return axis === 'x' ? el.scrollLeft : el.scrollTop;
  }

  function maxScroll(el, axis) {
    return axis === 'x'
      ? Math.max(0, el.scrollWidth - el.clientWidth)
      : Math.max(0, el.scrollHeight - el.clientHeight);
  }

  function animate(el, axis, delta) {
    var key = axis;
    var running = animations.get(el);
    if (!running) {
      running = {};
      animations.set(el, running);
    }
    var current = running[key];
    var from = positionOf(el, axis);
    // Un nouveau cran s'ajoute à la cible en cours : enchaîner deux crans doit
    // aller deux fois plus loin, pas repartir de zéro.
    var base = current ? current.target : from;
    var target = Math.max(0, Math.min(maxScroll(el, axis), base + delta));
    if (current) {
      current.target = target;
      return;
    }

    // `scroll-behavior: smooth` de la page ferait lutter deux animations : on
    // la neutralise le temps de la nôtre, puis on remet l'état d'origine.
    var inlineBehavior = el.style ? el.style.scrollBehavior : '';
    if (el.style) el.style.scrollBehavior = 'auto';

    var entry = { target: target, frame: 0 };
    running[key] = entry;

    var tick = function () {
      var position = positionOf(el, axis);
      var next = LIB.stepTowards(position, entry.target, config.intensity);
      if (axis === 'x') el.scrollLeft = next;
      else el.scrollTop = next;
      var reached = Math.abs(entry.target - next) <= 0.5;
      // Butée atteinte (ou défilement bloqué par la page) : inutile d'insister.
      var stuck = Math.abs(positionOf(el, axis) - position) < 0.2 && !reached;
      entry.stall = stuck ? (entry.stall || 0) + 1 : 0;
      if (reached || entry.stall > 4) {
        delete running[key];
        if (!Object.keys(running).length) animations.delete(el);
        if (el.style) el.style.scrollBehavior = inlineBehavior || '';
        return;
      }
      entry.frame = requestAnimationFrame(tick);
    };
    entry.frame = requestAnimationFrame(tick);
  }

  function stopAnimations() {
    animations.forEach(function (running, el) {
      Object.keys(running).forEach(function (axis) {
        cancelAnimationFrame(running[axis].frame);
        delete running[axis];
      });
      if (el.style) el.style.scrollBehavior = '';
    });
    animations.clear();
  }

  function insideNativeScroll(target) {
    if (!target || !target.closest) return false;
    try {
      return Boolean(target.closest(LIB.NATIVE_SCROLL_SELECTORS.join(',')));
    } catch (err) {
      return false;
    }
  }

  function fastPressed(event) {
    if (config.fastModifier === 'alt') return event.altKey;
    if (config.fastModifier === 'shift') return event.shiftKey;
    if (config.fastModifier === 'ctrl') return event.ctrlKey || event.metaKey;
    return false;
  }

  function onWheel(event) {
    if (!site.enabled || !site.smooth || nativeHost) return;
    if (event.defaultPrevented || !event.cancelable) return;
    // Ctrl+molette = zoom du navigateur ; jamais du défilement.
    if (event.ctrlKey || event.metaKey) return;
    if (insideNativeScroll(event.target)) return;

    // Maj + molette : le delta vertical pilote l'axe horizontal (sauf si la
    // souris envoie déjà un delta horizontal — molette inclinable).
    var shiftHorizontal = config.horizontal && event.shiftKey && !event.deltaX;
    var axis = shiftHorizontal || Math.abs(event.deltaX) > Math.abs(event.deltaY) ? 'x' : 'y';
    var raw = shiftHorizontal || axis === 'y' ? event.deltaY : event.deltaX;
    if (!raw) return;

    var sample = { delta: raw, deltaMode: event.deltaMode, timeStamp: event.timeStamp };
    if (config.trackpadPassthrough && !LIB.isWheelLike(sample, wheelState)) return;

    var pixels = LIB.wheelStep(sample, {
      step: config.step,
      speed: site.speed,
      invert: site.invert,
      fast: fastPressed(event),
      fastFactor: config.fastFactor,
    });
    if (!pixels) return;

    var el = scrollableAncestor(event.target, axis, pixels);
    if (!el) return;
    // Rien à faire si ce conteneur est déjà en butée : on laisse l'événement
    // remonter (la page parente, ou le rebond natif).
    var limit = maxScroll(el, axis);
    var at = positionOf(el, axis);
    if ((pixels > 0 && at >= limit - 1) || (pixels < 0 && at <= 1)) return;

    event.preventDefault();
    animate(el, axis, pixels);
  }

  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('mousedown', stopAnimations, true);
  window.addEventListener('keydown', function (event) {
    // Les touches de défilement reprennent la main sur l'animation.
    if (/^(Page|Arrow|Home|End|Space)/.test(event.key) || event.key === ' ') stopAnimations();
  }, true);

  // ── Défilement automatique (clic du milieu) ───────────────────────────────

  var auto = null;

  function removeAutoMarker() {
    if (auto && auto.marker && auto.marker.parentNode) auto.marker.parentNode.removeChild(auto.marker);
  }

  function stopAutoScroll(swallowClick) {
    if (!auto) return;
    cancelAnimationFrame(auto.frame);
    removeAutoMarker();
    var engaged = auto.engaged;
    auto = null;
    if (swallowClick && engaged) {
      // Le clic de fin ne doit pas coller le presse-papiers X11 ni ouvrir un
      // onglet : on avale le prochain `auxclick`.
      window.addEventListener('auxclick', function swallow(event) {
        event.preventDefault();
        event.stopPropagation();
        window.removeEventListener('auxclick', swallow, true);
      }, true);
    }
  }

  function autoMarker(x, y) {
    var marker = document.createElement('div');
    marker.setAttribute('aria-hidden', 'true');
    marker.style.cssText = [
      'position:fixed',
      'left:' + (x - 13) + 'px',
      'top:' + (y - 13) + 'px',
      'width:26px',
      'height:26px',
      'border-radius:50%',
      'border:2px solid rgba(255,255,255,.85)',
      'background:rgba(15,23,42,.55)',
      'box-shadow:0 0 0 1px rgba(2,6,23,.6), 0 4px 12px rgba(2,6,23,.45)',
      'pointer-events:none',
      'z-index:2147483000',
    ].join(';');
    return marker;
  }

  function onPointerDown(event) {
    if (config.autoScroll !== 'middle' || !site.enabled) return;
    if (event.button !== 1 || auto) return;
    var el = scrollableAncestor(event.target, 'y', 1);
    if (!el || maxScroll(el, 'y') < 4) return;
    auto = {
      el: el,
      originY: event.clientY,
      pointerId: event.pointerId,
      engaged: false,
      marker: null,
      frame: 0,
      y: event.clientY,
    };

    var tick = function () {
      if (!auto) return;
      if (auto.engaged) {
        var velocity = LIB.autoScrollVelocity(auto.y - auto.originY, { speed: config.autoScrollSpeed });
        if (velocity) auto.el.scrollTop = auto.el.scrollTop + velocity;
      }
      auto.frame = requestAnimationFrame(tick);
    };
    auto.frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event) {
    if (!auto || event.pointerId !== auto.pointerId) return;
    auto.y = event.clientY;
    if (!auto.engaged && Math.abs(event.clientY - auto.originY) > 4) {
      // Engagement seulement après un vrai mouvement : un clic du milieu seul
      // garde son comportement habituel (collage, nouvel onglet).
      auto.engaged = true;
      auto.marker = autoMarker(event.clientX, auto.originY);
      (document.body || document.documentElement).appendChild(auto.marker);
      stopAnimations();
    }
    if (auto.engaged) event.preventDefault();
  }

  function onPointerUp(event) {
    if (!auto || (event.pointerId !== undefined && event.pointerId !== auto.pointerId)) return;
    stopAutoScroll(true);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', function () {
    stopAutoScroll(false);
  });


  // ── Palette de présentation ───────────────────────────────────────────────
  //
  // Un seul raccourci : Alt+Maj+D ouvre la palette. Tout le reste se CHOISIT
  // dedans (outil, couleur, épaisseur) — une bascule invisible au clavier ne
  // se retient pas, et Orbit s'est déjà réservé la plupart des combinaisons
  // Alt (voir ORBIT_ALT_SHIFT_KEYS dans lib.js).
  //
  // Deux couches, toujours dans cet ordre :
  //   • `canvas` — les tracés. Transparent au pointeur SAUF quand un outil de
  //     dessin est choisi (sinon on ne pourrait pas dessiner).
  //   • `palette` — la barre d'outils, déplaçable, toujours cliquable.

  var PALETTE_LABELS = {
    laser: ['Pointeur laser', '🔴'],
    pen: ['Stylo', '✏️'],
    highlight: ['Surligneur', '🖍️'],
    arrow: ['Flèche', '↗'],
    rect: ['Rectangle', '▭'],
    ellipse: ['Ellipse', '◯'],
  };

  var stage = null; // conteneur des couches
  var canvas = null;
  var ctx = null;
  var palette = null;
  var paletteOpen = false;
  var strokes = []; // tracés conservés (redessinés au redimensionnement)
  var drawing = null; // tracé en cours
  var trail = []; // traîne du pointeur laser
  var laserDot = null;
  var spot = null;
  var cursorRing = null;
  var pointer = { x: -9999, y: -9999 };
  var frame = 0;

  function cfgSet(patch) {
    var next = {};
    Object.keys(config).forEach(function (key) {
      next[key] = config[key];
    });
    Object.keys(patch).forEach(function (key) {
      next[key] = patch[key];
    });
    config = LIB.normalizeConfig(next);
    site = LIB.resolveSite(config, HOST);
    saveConfig(config);
  }

  // ── Couches ───────────────────────────────────────────────────────────────

  function ensureStage() {
    if (stage && stage.isConnected) return stage;
    stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483001;';

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    stage.appendChild(canvas);
    ctx = canvas.getContext('2d');

    (document.body || document.documentElement).appendChild(stage);
    resizeCanvas();
    return stage;
  }

  function resizeCanvas() {
    if (!canvas) return;
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redrawStrokes();
  }

  function dropStage() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
    canvas = null;
    ctx = null;
    spot = null;
    cursorRing = null;
    laserDot = null;
  }

  // ── Tracés ────────────────────────────────────────────────────────────────

  function strokeStyle(stroke) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    if (stroke.tool === 'highlight') {
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = stroke.width * 4;
    }
  }

  function drawStroke(stroke) {
    if (!ctx) return;
    strokeStyle(stroke);
    if (stroke.tool === 'pen' || stroke.tool === 'highlight') {
      ctx.beginPath();
      for (var i = 0; i < stroke.points.length; i += 1) {
        var point = stroke.points[i];
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
    } else if (stroke.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(stroke.from.x, stroke.from.y);
      ctx.lineTo(stroke.to.x, stroke.to.y);
      ctx.stroke();
      var head = LIB.arrowHead(stroke.from, stroke.to, stroke.width);
      ctx.beginPath();
      ctx.moveTo(head[0].x, head[0].y);
      ctx.lineTo(head[1].x, head[1].y);
      ctx.lineTo(head[2].x, head[2].y);
      ctx.stroke();
    } else if (stroke.tool === 'rect') {
      ctx.strokeRect(
        Math.min(stroke.from.x, stroke.to.x),
        Math.min(stroke.from.y, stroke.to.y),
        Math.abs(stroke.to.x - stroke.from.x),
        Math.abs(stroke.to.y - stroke.from.y)
      );
    } else if (stroke.tool === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        (stroke.from.x + stroke.to.x) / 2,
        (stroke.from.y + stroke.to.y) / 2,
        Math.max(1, Math.abs(stroke.to.x - stroke.from.x) / 2),
        Math.max(1, Math.abs(stroke.to.y - stroke.from.y) / 2),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  function redrawStrokes() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = 0; i < strokes.length; i += 1) drawStroke(strokes[i]);
    if (drawing) drawStroke(drawing);
    drawTrail();
  }

  // Traîne du laser : segments dont l'opacité décroît avec l'âge.
  function drawTrail() {
    if (!ctx || config.tool !== 'laser' || trail.length < 2) return;
    var now = Date.now();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(3, config.width);
    for (var i = 1; i < trail.length; i += 1) {
      var age = now - trail[i].at;
      var alpha = Math.max(0, 1 - age / 420) * 0.55;
      if (!alpha) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = config.color;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Boucle d'affichage ────────────────────────────────────────────────────
  //
  // Elle ne tourne QUE si quelque chose bouge (laser, spot, curseur) : une
  // page au repos ne doit pas payer une trame par seconde pour rien.
  function needsLoop() {
    return paletteOpen && (config.tool === 'laser' || config.spotlight || config.bigCursor);
  }

  function loop() {
    if (!needsLoop()) {
      frame = 0;
      return;
    }
    if (config.tool === 'laser') {
      trail = LIB.trimTrail(trail, Date.now(), 420);
      redrawStrokes();
    }
    paintFollowers();
    frame = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (!frame && needsLoop()) frame = requestAnimationFrame(loop);
  }

  function paintFollowers() {
    if (spot) {
      spot.style.background =
        'radial-gradient(circle 150px at ' + pointer.x + 'px ' + pointer.y + 'px,' +
        ' rgba(2,6,23,0) 0%, rgba(2,6,23,0) 60%, rgba(2,6,23,.62) 100%)';
    }
    if (cursorRing) cursorRing.style.transform = 'translate(' + pointer.x + 'px,' + pointer.y + 'px)';
    if (laserDot) laserDot.style.transform = 'translate(' + pointer.x + 'px,' + pointer.y + 'px)';
  }

  // ── Suiveurs (spot, curseur, point laser) ─────────────────────────────────

  function follower(style) {
    var node = document.createElement('div');
    node.style.cssText = style;
    stage.appendChild(node);
    return node;
  }

  function refreshFollowers() {
    if (!paletteOpen) {
      if (spot && spot.parentNode) spot.parentNode.removeChild(spot);
      if (cursorRing && cursorRing.parentNode) cursorRing.parentNode.removeChild(cursorRing);
      if (laserDot && laserDot.parentNode) laserDot.parentNode.removeChild(laserDot);
      spot = null;
      cursorRing = null;
      laserDot = null;
      return;
    }
    ensureStage();

    if (config.spotlight && !spot) {
      spot = follower('position:absolute;inset:0;');
    } else if (!config.spotlight && spot) {
      if (spot.parentNode) spot.parentNode.removeChild(spot);
      spot = null;
    }

    if (config.bigCursor && !cursorRing) {
      cursorRing = follower(
        'position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;' +
          'border:2px solid rgba(250,204,21,.95);background:rgba(250,204,21,.18);' +
          'box-shadow:0 0 14px rgba(250,204,21,.55);'
      );
    } else if (!config.bigCursor && cursorRing) {
      if (cursorRing.parentNode) cursorRing.parentNode.removeChild(cursorRing);
      cursorRing = null;
    }

    if (config.tool === 'laser' && !laserDot) {
      laserDot = follower(
        'position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;' +
          'background:' + config.color + ';box-shadow:0 0 16px 4px ' + config.color + '99;'
      );
    } else if (config.tool !== 'laser' && laserDot) {
      if (laserDot.parentNode) laserDot.parentNode.removeChild(laserDot);
      laserDot = null;
    } else if (laserDot) {
      laserDot.style.background = config.color;
      laserDot.style.boxShadow = '0 0 16px 4px ' + config.color + '99';
    }
    paintFollowers();
    startLoop();
  }

  // ── Dessin sur la page ────────────────────────────────────────────────────
  //
  // Un outil de dessin rend la couche OPAQUE au pointeur : la page ne reçoit
  // plus les clics (c'est le prix pour pouvoir tracer par-dessus). Le bandeau
  // de la palette le dit, et Échap rend la main.

  function applyPointerMode() {
    if (!canvas) return;
    var drawMode = paletteOpen && LIB.isDrawingTool(config.tool);
    canvas.style.pointerEvents = drawMode ? 'auto' : 'none';
    canvas.style.cursor = drawMode ? 'crosshair' : '';
    if (palette) palette.dataset.drawMode = drawMode ? 'on' : 'off';
    var hint = palette && palette.querySelector('[data-role="hint"]');
    if (hint) hint.style.display = drawMode ? 'block' : 'none';
  }

  function onCanvasDown(event) {
    if (!LIB.isDrawingTool(config.tool) || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    var at = { x: event.clientX, y: event.clientY };
    drawing =
      config.tool === 'pen' || config.tool === 'highlight'
        ? { tool: config.tool, color: config.color, width: config.width, points: [at] }
        : { tool: config.tool, color: config.color, width: config.width, from: at, to: at };
  }

  function onCanvasMove(event) {
    if (!drawing) return;
    var at = { x: event.clientX, y: event.clientY };
    if (drawing.points) drawing.points.push(at);
    else drawing.to = at;
    redrawStrokes();
  }

  function onCanvasUp() {
    if (!drawing) return;
    var finished = drawing;
    drawing = null;
    var meaningful = finished.points
      ? finished.points.length > 1
      : Math.abs(finished.to.x - finished.from.x) > 4 || Math.abs(finished.to.y - finished.from.y) > 4;
    if (meaningful) strokes.push(finished);
    redrawStrokes();
  }

  // ── Palette ───────────────────────────────────────────────────────────────

  function button(label, title, onClick, pressed) {
    var node = document.createElement('button');
    node.type = 'button';
    node.title = title;
    node.setAttribute('aria-label', title);
    if (pressed !== undefined) node.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    node.textContent = label;
    node.style.cssText = [
      'all:unset',
      'display:grid',
      'place-items:center',
      'width:30px',
      'height:30px',
      'border-radius:9px',
      'cursor:pointer',
      'font:500 15px/1 system-ui,-apple-system,sans-serif',
      'color:#e5e7eb',
      'background:' + (pressed ? 'rgba(99,102,241,.35)' : 'transparent'),
      'box-shadow:' + (pressed ? 'inset 0 0 0 1px rgba(165,180,252,.65)' : 'none'),
    ].join(';');
    node.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return node;
  }

  // Lissage coupé (ou rétabli) pour CE site, sans ouvrir les options.
  function toggleSiteSmooth() {
    var sites = {};
    Object.keys(config.sites).forEach(function (pattern) {
      sites[pattern] = config.sites[pattern];
    });
    if (site.smooth) sites[HOST] = { smooth: false };
    else delete sites[HOST];
    cfgSet({ sites: sites });
    stopAnimations();
    rebuildPalette();
    toast(site.smooth ? 'Défilement lissé sur ' + HOST : 'Défilement natif sur ' + HOST);
  }

  function separator() {
    var node = document.createElement('span');
    node.style.cssText = 'width:1px;height:20px;background:rgba(148,163,184,.35);margin:0 2px;';
    return node;
  }

  function buildPalette() {
    palette = document.createElement('div');
    palette.setAttribute('role', 'toolbar');
    palette.setAttribute('aria-label', 'Palette de présentation Orbit');
    palette.style.cssText = [
      'position:fixed',
      'display:flex',
      'flex-direction:column',
      'gap:6px',
      'padding:8px',
      'border-radius:16px',
      'border:1px solid rgba(148,163,184,.3)',
      'background:rgba(15,23,42,.94)',
      'box-shadow:0 18px 44px rgba(2,6,23,.55)',
      'backdrop-filter:blur(12px)',
      'pointer-events:auto',
      'z-index:2147483002',
      'font:500 13px/1.3 system-ui,-apple-system,sans-serif',
      'color:#e5e7eb',
      'user-select:none',
    ].join(';');

    var top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;gap:4px;';

    // Poignée de déplacement : la palette ne doit jamais masquer ce qu'on
    // montre.
    var grip = document.createElement('div');
    grip.textContent = '⠿';
    grip.title = 'Déplacer la palette';
    grip.style.cssText = 'cursor:grab;padding:0 4px;color:#94a3b8;font-size:15px;';
    grip.addEventListener('pointerdown', startDrag);
    top.appendChild(grip);

    LIB.PALETTE_TOOLS.forEach(function (tool) {
      var label = PALETTE_LABELS[tool];
      top.appendChild(
        button(label[1], label[0], function () {
          cfgSet({ tool: tool });
          rebuildPalette();
          refreshFollowers();
          applyPointerMode();
        }, config.tool === tool)
      );
    });

    top.appendChild(separator());
    top.appendChild(
      button('💡', 'Spot lumineux autour du curseur', function () {
        cfgSet({ spotlight: !config.spotlight });
        rebuildPalette();
        refreshFollowers();
      }, config.spotlight)
    );
    top.appendChild(
      button('◎', 'Halo à chaque clic', function () {
        cfgSet({ clickHalo: !config.clickHalo });
        rebuildPalette();
      }, config.clickHalo)
    );
    top.appendChild(
      button('✛', 'Curseur mis en évidence', function () {
        cfgSet({ bigCursor: !config.bigCursor });
        rebuildPalette();
        refreshFollowers();
      }, config.bigCursor)
    );

    top.appendChild(separator());
    // Le réglage de molette le plus utile au quotidien, là où on le voit : la
    // règle est enregistrée pour ce site et vaut pour les prochaines visites.
    top.appendChild(
      button('🖱️', 'Défilement lissé sur ' + HOST, toggleSiteSmooth, site.smooth)
    );
    top.appendChild(
      button('↶', 'Annuler le dernier tracé', function () {
        strokes.pop();
        redrawStrokes();
      })
    );
    top.appendChild(
      button('🧽', 'Effacer tous les tracés', function () {
        strokes = [];
        redrawStrokes();
      })
    );
    top.appendChild(separator());
    top.appendChild(button('✕', 'Fermer la palette (Échap)', closePalette));
    palette.appendChild(top);

    // Deuxième rangée : couleurs et épaisseurs — ce qu'on vient chercher.
    var bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 4px;';

    LIB.PALETTE_COLORS.forEach(function (color) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.title = 'Couleur ' + color;
      swatch.setAttribute('aria-label', 'Couleur ' + color);
      swatch.setAttribute('aria-pressed', config.color === color ? 'true' : 'false');
      swatch.style.cssText = [
        'all:unset',
        'width:20px',
        'height:20px',
        'border-radius:50%',
        'cursor:pointer',
        'background:' + color,
        'box-shadow:0 0 0 ' + (config.color === color ? '2px #e5e7eb' : '1px rgba(148,163,184,.5)'),
      ].join(';');
      swatch.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cfgSet({ color: color });
        rebuildPalette();
        refreshFollowers();
      });
      bottom.appendChild(swatch);
    });

    bottom.appendChild(separator());

    LIB.PALETTE_WIDTHS.forEach(function (width) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.title = 'Épaisseur ' + width + ' px';
      dot.setAttribute('aria-label', 'Épaisseur ' + width + ' px');
      dot.setAttribute('aria-pressed', config.width === width ? 'true' : 'false');
      dot.style.cssText = [
        'all:unset',
        'display:grid',
        'place-items:center',
        'width:24px',
        'height:24px',
        'border-radius:8px',
        'cursor:pointer',
        'background:' + (config.width === width ? 'rgba(99,102,241,.35)' : 'transparent'),
      ].join(';');
      var inner = document.createElement('span');
      inner.style.cssText =
        'display:block;border-radius:999px;background:#e5e7eb;width:' +
        Math.min(16, width + 4) + 'px;height:' + Math.min(10, width / 1.6 + 2) + 'px;';
      dot.appendChild(inner);
      dot.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        cfgSet({ width: width });
        rebuildPalette();
      });
      bottom.appendChild(dot);
    });

    palette.appendChild(bottom);

    var hint = document.createElement('div');
    hint.dataset.role = 'hint';
    hint.textContent = 'La page ne reçoit plus les clics — Échap pour lui rendre la main.';
    hint.style.cssText = 'display:none;max-width:320px;padding:0 4px;color:#fbbf24;font-size:11px;';
    palette.appendChild(hint);

    (document.body || document.documentElement).appendChild(palette);
    placePalette();
    applyPointerMode();
  }

  function rebuildPalette() {
    if (!paletteOpen) return;
    var previous = palette;
    buildPalette();
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);
  }

  function placePalette() {
    if (!palette) return;
    var width = palette.offsetWidth || 320;
    var height = palette.offsetHeight || 80;
    var left = config.paletteX * (window.innerWidth - width);
    var top = config.paletteY * (window.innerHeight - height);
    palette.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, left)) + 'px';
    palette.style.top = Math.max(8, Math.min(window.innerHeight - height - 8, top)) + 'px';
  }

  function startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    var rect = palette.getBoundingClientRect();
    var offsetX = event.clientX - rect.left;
    var offsetY = event.clientY - rect.top;
    var move = function (moveEvent) {
      var left = moveEvent.clientX - offsetX;
      var top = moveEvent.clientY - offsetY;
      palette.style.left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, left)) + 'px';
      palette.style.top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top)) + 'px';
    };
    var up = function () {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      var box = palette.getBoundingClientRect();
      cfgSet({
        paletteX: (window.innerWidth - box.width) ? box.left / (window.innerWidth - box.width) : 0,
        paletteY: (window.innerHeight - box.height) ? box.top / (window.innerHeight - box.height) : 0,
      });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }

  function openPalette() {
    if (!TOP_FRAME || paletteOpen) return;
    paletteOpen = true;
    ensureStage();
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointermove', onCanvasMove);
    canvas.addEventListener('pointerup', onCanvasUp);
    canvas.addEventListener('pointercancel', onCanvasUp);
    buildPalette();
    refreshFollowers();
    toast('Palette de présentation — Alt+Maj+D pour la fermer');
  }

  function closePalette() {
    if (!paletteOpen) return;
    paletteOpen = false;
    strokes = [];
    drawing = null;
    trail = [];
    if (palette && palette.parentNode) palette.parentNode.removeChild(palette);
    palette = null;
    refreshFollowers();
    dropStage();
  }

  function togglePalette() {
    if (paletteOpen) closePalette();
    else openPalette();
  }

  // ── Message éphémère ──────────────────────────────────────────────────────

  function toast(message) {
    if (!TOP_FRAME) return;
    var pill = document.createElement('div');
    pill.textContent = message;
    pill.setAttribute('role', 'status');
    pill.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:24px',
      'transform:translateX(-50%)',
      'padding:9px 16px',
      'border-radius:999px',
      'border:1px solid rgba(255,255,255,.18)',
      'background:rgba(15,23,42,.92)',
      'color:#f8fafc',
      'font:500 13px/1.3 system-ui,-apple-system,sans-serif',
      'box-shadow:0 10px 30px rgba(2,6,23,.5)',
      'pointer-events:none',
      'z-index:2147483003',
      'transition:opacity .25s ease',
    ].join(';');
    (document.body || document.documentElement).appendChild(pill);
    window.setTimeout(function () {
      pill.style.opacity = '0';
    }, 1600);
    window.setTimeout(function () {
      if (pill.parentNode) pill.parentNode.removeChild(pill);
    }, 1950);
  }

  // ── Pointeur et clavier ───────────────────────────────────────────────────

  window.addEventListener('pointermove', function (event) {
    pointer = { x: event.clientX, y: event.clientY };
    if (paletteOpen && config.tool === 'laser') {
      trail.push({ x: pointer.x, y: pointer.y, at: Date.now() });
      startLoop();
    }
  }, { passive: true, capture: true });

  window.addEventListener('pointerdown', function (event) {
    if (!config.clickHalo || !paletteOpen || !TOP_FRAME) return;
    var halo = document.createElement('div');
    halo.style.cssText = [
      'position:absolute',
      'left:' + event.clientX + 'px',
      'top:' + event.clientY + 'px',
      'width:14px',
      'height:14px',
      'margin:-7px 0 0 -7px',
      'border-radius:50%',
      'border:2px solid ' + config.color,
      'background:' + config.color + '4d',
      'transition:transform .45s ease-out, opacity .45s ease-out',
    ].join(';');
    ensureStage().appendChild(halo);
    requestAnimationFrame(function () {
      halo.style.transform = 'scale(4)';
      halo.style.opacity = '0';
    });
    window.setTimeout(function () {
      if (halo.parentNode) halo.parentNode.removeChild(halo);
    }, 520);
  }, { passive: true, capture: true });

  window.addEventListener('resize', function () {
    resizeCanvas();
    placePalette();
  });

  window.addEventListener('keydown', function (event) {
    if (LIB.isPaletteShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      togglePalette();
      return;
    }
    if (!paletteOpen) return;
    if (event.key === 'Escape') {
      // Premier Échap : on rend la main à la page (le dessin bloquait les
      // clics). Deuxième : on ferme la palette.
      if (LIB.isDrawingTool(config.tool)) {
        event.preventDefault();
        cfgSet({ tool: 'laser' });
        rebuildPalette();
        refreshFollowers();
        applyPointerMode();
      } else {
        closePalette();
      }
    }
  }, true);
})();
