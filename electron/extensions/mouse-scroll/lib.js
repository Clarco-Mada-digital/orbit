// ---------------------------------------------------------------------------
// Souris & Défilement (Orbit) — LOGIQUE PURE.
//
// Ce fichier ne touche ni au DOM ni à `chrome.*` : il ne contient que les
// décisions délicates du défilement lissé — reconnaître une molette d'un pavé
// tactile, convertir un cran en pixels, approcher la position cible trame par
// trame, résoudre les réglages d'un site. `content.js` s'en sert via
// `globalThis.OrbitScroll`, et `node --test` les vérifie sans navigateur.
// ---------------------------------------------------------------------------

(function (root) {
  'use strict';

  var DEFAULTS = {
    enabled: true,
    // Défilement lissé : la page glisse vers la position visée au lieu de
    // sauter d'un cran. C'est tout l'objet de l'extension.
    smooth: true,
    intensity: 0.22, // part du chemin parcourue par trame (0,05 = très glissant)
    step: 120, // pixels par cran de molette
    speed: 1, // multiplicateur global
    invert: false, // sens inversé (molette « naturelle »)
    horizontal: true, // Maj + molette = défilement horizontal
    fastModifier: 'alt', // 'none' | 'alt' | 'shift' | 'ctrl'
    fastFactor: 3, // défilement rapide avec le modificateur
    // Les pavés tactiles envoient déjà un défilement continu : le lisser une
    // seconde fois le rend pâteux. Par défaut, on les laisse tranquilles.
    trackpadPassthrough: true,
    autoScroll: 'middle', // 'off' | 'middle' — défilement automatique (lecture)
    autoScrollSpeed: 1,
    // Palette de présentation : ce que l'utilisateur a choisi la dernière fois
    // (outil, couleur, épaisseur) et où il a posé la palette.
    tool: 'laser',
    color: '#ef4444',
    width: 4,
    paletteX: 0.5, // position relative dans la fenêtre (0 → 1)
    paletteY: 0.9,
    spotlight: false,
    clickHalo: false,
    bigCursor: false,
    sites: {}, // motif d'hôte → réglages locaux
  };

  // ── Raccourcis ─────────────────────────────────────────────────────────────
  //
  // Orbit intercepte les combinaisons Alt AVANT la page (`before-input-event`
  // dans le processus principal) : un raccourci d'extension qui tombe sur l'un
  // des siens n'est jamais reçu. Cette liste est la raison pour laquelle la
  // palette s'ouvre avec Alt+Maj+D et rien d'autre — elle est verrouillée par
  // `test/mouse-scroll.test.js`, qui la confronte au vrai `matchShortcutInput`
  // d'Orbit.
  // Ce qu'Orbit avale en Alt+Maj. Attention : plusieurs de ses branches ne
  // testent même pas Maj (`k` recherche, `l` URL, `b` barre latérale,
  // `s` veille), donc Alt+Maj+K / L / B / S sont pris aussi.
  var ORBIT_ALT_SHIFT_KEYS = ['a', 'b', 'e', 'h', 'i', 'k', 'l', 'm', 'o', 'p', 'pagedown', 'pageup', 's'];
  // Pris par ailleurs : `f` par l'extension Fake Data, et `j`/`u`/`y` sont les
  // autres touches possibles de la discussion de l'assistant (configurable).
  var RESERVED_BY_OTHERS = ['f', 'j', 'u', 'y'];
  var PALETTE_SHORTCUT = { alt: true, shift: true, key: 'd' };

  function isPaletteShortcut(event) {
    if (!event || !event.altKey || !event.shiftKey) return false;
    if (event.ctrlKey || event.metaKey) return false;
    return String(event.key || '').toLowerCase() === PALETTE_SHORTCUT.key;
  }

  // ── Palette ────────────────────────────────────────────────────────────────

  // `laser` et `spotlight` ne laissent pas de trace : ils suivent le curseur.
  // Les autres dessinent sur la page.
  var PALETTE_TOOLS = ['laser', 'pen', 'highlight', 'arrow', 'rect', 'ellipse'];
  var DRAWING_TOOLS = ['pen', 'highlight', 'arrow', 'rect', 'ellipse'];
  var PALETTE_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#f8fafc'];
  var PALETTE_WIDTHS = [2, 4, 8, 14];

  function isDrawingTool(tool) {
    return DRAWING_TOOLS.indexOf(String(tool)) >= 0;
  }

  // Applications qui gèrent la molette elles-mêmes (zoom d'une carte, canevas
  // de dessin, éditeur de code) : s'interposer y casse le geste attendu.
  var NATIVE_SCROLL_HOSTS = [
    'maps.google.com',
    'earth.google.com',
    'www.figma.com',
    'figma.com',
    'miro.com',
    'excalidraw.com',
    'app.diagrams.net',
    'www.google.com/maps',
    'openstreetmap.org',
    'www.openstreetmap.org',
  ];

  // Sélecteurs dont la molette appartient à l'application (éditeurs, canevas).
  var NATIVE_SCROLL_SELECTORS = [
    'canvas',
    'video',
    'embed',
    'object',
    'select',
    '[role="application"]',
    '.monaco-editor',
    '.cm-editor',
    '.CodeMirror',
    '.ace_editor',
    '[data-orbit-no-smooth]',
  ];

  var RANGES = {
    intensity: [0.05, 0.6],
    step: [40, 400],
    speed: [0.25, 4],
    fastFactor: [1.5, 8],
    autoScrollSpeed: [0.3, 3],
  };

  var MODIFIERS = ['none', 'alt', 'shift', 'ctrl'];
  var AUTO_SCROLL_MODES = ['off', 'middle'];

  function clamp(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  // Réglages d'un site : on ne garde que les clés connues, bornées. Un fichier
  // de réglages importé ou corrompu ne doit pas pouvoir dérégler la molette.
  function normalizeSiteRule(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var rule = {};
    if (typeof raw.enabled === 'boolean') rule.enabled = raw.enabled;
    if (typeof raw.smooth === 'boolean') rule.smooth = raw.smooth;
    if (typeof raw.invert === 'boolean') rule.invert = raw.invert;
    if (raw.speed !== undefined) {
      rule.speed = clamp(raw.speed, RANGES.speed[0], RANGES.speed[1], DEFAULTS.speed);
    }
    return Object.keys(rule).length ? rule : null;
  }

  function normalizeConfig(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var config = {
      enabled: bool(source.enabled, DEFAULTS.enabled),
      smooth: bool(source.smooth, DEFAULTS.smooth),
      intensity: clamp(source.intensity, RANGES.intensity[0], RANGES.intensity[1], DEFAULTS.intensity),
      step: Math.round(clamp(source.step, RANGES.step[0], RANGES.step[1], DEFAULTS.step)),
      speed: clamp(source.speed, RANGES.speed[0], RANGES.speed[1], DEFAULTS.speed),
      invert: bool(source.invert, DEFAULTS.invert),
      horizontal: bool(source.horizontal, DEFAULTS.horizontal),
      fastModifier: MODIFIERS.indexOf(source.fastModifier) >= 0 ? source.fastModifier : DEFAULTS.fastModifier,
      fastFactor: clamp(source.fastFactor, RANGES.fastFactor[0], RANGES.fastFactor[1], DEFAULTS.fastFactor),
      trackpadPassthrough: bool(source.trackpadPassthrough, DEFAULTS.trackpadPassthrough),
      autoScroll: AUTO_SCROLL_MODES.indexOf(source.autoScroll) >= 0 ? source.autoScroll : DEFAULTS.autoScroll,
      autoScrollSpeed: clamp(
        source.autoScrollSpeed,
        RANGES.autoScrollSpeed[0],
        RANGES.autoScrollSpeed[1],
        DEFAULTS.autoScrollSpeed
      ),
      tool: PALETTE_TOOLS.indexOf(source.tool) >= 0 ? source.tool : DEFAULTS.tool,
      color: PALETTE_COLORS.indexOf(source.color) >= 0 ? source.color : DEFAULTS.color,
      width: PALETTE_WIDTHS.indexOf(Number(source.width)) >= 0 ? Number(source.width) : DEFAULTS.width,
      paletteX: clamp(source.paletteX, 0, 1, DEFAULTS.paletteX),
      paletteY: clamp(source.paletteY, 0, 1, DEFAULTS.paletteY),
      spotlight: bool(source.spotlight, DEFAULTS.spotlight),
      clickHalo: bool(source.clickHalo, DEFAULTS.clickHalo),
      bigCursor: bool(source.bigCursor, DEFAULTS.bigCursor),
      sites: {},
    };
    // Maj ne peut pas servir à deux choses : si le défilement horizontal est
    // actif, le modificateur « rapide » ne peut pas être Maj.
    if (config.horizontal && config.fastModifier === 'shift') config.fastModifier = 'alt';
    var sites = source.sites && typeof source.sites === 'object' ? source.sites : {};
    Object.keys(sites).forEach(function (pattern) {
      var host = String(pattern || '').trim().toLowerCase();
      if (!host) return;
      var rule = normalizeSiteRule(sites[pattern]);
      if (rule) config.sites[host] = rule;
    });
    return config;
  }

  // `*` = partout, `*.exemple.fr` = le domaine et ses sous-domaines, sinon
  // égalité stricte.
  function matchHost(pattern, host) {
    var p = String(pattern || '').trim().toLowerCase();
    var h = String(host || '').trim().toLowerCase();
    if (!p || !h) return false;
    if (p === '*') return true;
    if (p.indexOf('*.') === 0) {
      var suffix = p.slice(2);
      return h === suffix || h.slice(-(suffix.length + 1)) === '.' + suffix;
    }
    return p === h;
  }

  // Réglages effectifs pour un hôte. Le motif le PLUS PRÉCIS gagne : une règle
  // sur `mail.google.com` doit l'emporter sur `*.google.com`, quel que soit
  // l'ordre dans lequel l'utilisateur les a ajoutées.
  function resolveSite(config, host) {
    var base = normalizeConfig(config);
    var effective = {
      enabled: base.enabled,
      smooth: base.smooth,
      speed: base.speed,
      invert: base.invert,
      matched: null,
    };
    var best = -1;
    Object.keys(base.sites).forEach(function (pattern) {
      if (!matchHost(pattern, host)) return;
      // Précision : hôte exact > joker le plus long > `*`.
      var score = pattern === '*' ? 0 : pattern.indexOf('*.') === 0 ? pattern.length : 1000 + pattern.length;
      if (score < best) return;
      best = score;
      var rule = base.sites[pattern];
      effective = {
        enabled: rule.enabled === undefined ? base.enabled : rule.enabled,
        smooth: rule.smooth === undefined ? base.smooth : rule.smooth,
        speed: rule.speed === undefined ? base.speed : rule.speed,
        invert: rule.invert === undefined ? base.invert : rule.invert,
        matched: pattern,
      };
    });
    return effective;
  }

  function hostUsesNativeScroll(host) {
    var h = String(host || '').trim().toLowerCase();
    if (!h) return false;
    for (var i = 0; i < NATIVE_SCROLL_HOSTS.length; i += 1) {
      if (matchHost(NATIVE_SCROLL_HOSTS[i], h)) return true;
    }
    return false;
  }

  // Molette ou pavé tactile ?
  //
  // Un cran de molette arrive seul et franc (100 px, 120 px, 53 px selon le
  // système) ; un pavé tactile envoie une rafale de petites valeurs. On garde
  // donc une mémoire courte : plusieurs petits deltas rapprochés = pavé
  // tactile, et on lui rend la main. `deltaMode` non nul (lignes/pages) est
  // toujours une molette.
  function isWheelLike(sample, state) {
    var memory = state && typeof state === 'object' ? state : {};
    var delta = Math.abs(Number(sample && sample.delta) || 0);
    var mode = Number(sample && sample.deltaMode) || 0;
    var time = Number(sample && sample.timeStamp) || 0;
    var gap = memory.last === undefined ? Infinity : time - memory.last;
    memory.last = time;

    if (mode !== 0) {
      memory.smallRun = 0;
      return true;
    }
    if (delta >= 50) {
      // Un gros delta isolé reste une molette, même après une rafale (on peut
      // lâcher le pavé tactile et prendre la souris).
      memory.smallRun = 0;
      return true;
    }
    // Petit delta : rafale si le précédent était proche dans le temps.
    memory.smallRun = gap < 100 ? (memory.smallRun || 0) + 1 : 1;
    return memory.smallRun < 3;
  }

  // Un cran de molette, en pixels. `deltaMode` 0 = pixels (on compte les crans
  // de ~100 px), 1 = lignes, 2 = pages.
  function wheelStep(sample, options) {
    var opts = options || {};
    var delta = Number(sample && sample.delta) || 0;
    var mode = Number(sample && sample.deltaMode) || 0;
    if (!delta) return 0;
    var step = clamp(opts.step, RANGES.step[0], RANGES.step[1], DEFAULTS.step);
    var speed = clamp(opts.speed, RANGES.speed[0], RANGES.speed[1], DEFAULTS.speed);
    var fastFactor = opts.fast
      ? clamp(opts.fastFactor, RANGES.fastFactor[0], RANGES.fastFactor[1], DEFAULTS.fastFactor)
      : 1;
    var notches;
    if (mode === 0) notches = Math.max(1, Math.abs(delta) / 100);
    else if (mode === 1) notches = Math.max(1, Math.abs(delta));
    else notches = Math.max(1, Math.abs(delta)) * 8; // une « page »
    var direction = (delta > 0 ? 1 : -1) * (opts.invert ? -1 : 1);
    var pixels = direction * notches * step * speed * fastFactor;
    // Plafond : un cran ne doit pas téléporter la page (molettes « libres »
    // qui envoient des deltas énormes).
    return Math.max(-6000, Math.min(6000, Math.round(pixels)));
  }

  // Approche de la position visée, trame par trame. On s'arrête net sous le
  // demi-pixel : sinon l'animation ne se termine jamais.
  function stepTowards(current, target, intensity) {
    var from = Number(current) || 0;
    var to = Number(target) || 0;
    var factor = clamp(intensity, RANGES.intensity[0], RANGES.intensity[1], DEFAULTS.intensity);
    var diff = to - from;
    if (Math.abs(diff) <= 0.5) return to;
    return from + diff * factor;
  }

  // Défilement automatique : vitesse (px/trame) selon l'éloignement du
  // curseur. Zone morte au centre, sinon le moindre tremblement ferait défiler.
  function autoScrollVelocity(distance, options) {
    var opts = options || {};
    var deadZone = clamp(opts.deadZone, 0, 200, 18);
    var max = clamp(opts.max, 4, 200, 42);
    var speed = clamp(opts.speed, RANGES.autoScrollSpeed[0], RANGES.autoScrollSpeed[1], DEFAULTS.autoScrollSpeed);
    var value = Number(distance) || 0;
    var abs = Math.abs(value);
    if (abs <= deadZone) return 0;
    var velocity = Math.pow((abs - deadZone) / 9, 1.3) * speed;
    return (value > 0 ? 1 : -1) * Math.min(max, velocity);
  }

  // Pointe de flèche : deux ailes à ~28° de la ligne, longueur liée à
  // l'épaisseur. (Même calcul que l'éditeur de captures d'Orbit, recopié ici :
  // une extension est un paquet autonome, elle ne peut rien importer de `src`.)
  function arrowHead(from, to, width) {
    var fromX = Number(from && from.x) || 0;
    var fromY = Number(from && from.y) || 0;
    var toX = Number(to && to.x) || 0;
    var toY = Number(to && to.y) || 0;
    var angle = Math.atan2(toY - fromY, toX - fromX);
    var length = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
    var head = Math.min(Math.max(10, (Number(width) || 2) * 4.5), Math.max(4, length * 0.6));
    var spread = 0.49;
    return [
      { x: toX - head * Math.cos(angle - spread), y: toY - head * Math.sin(angle - spread) },
      { x: toX, y: toY },
      { x: toX - head * Math.cos(angle + spread), y: toY - head * Math.sin(angle + spread) },
    ];
  }

  // Trace du pointeur laser : on ne garde que les points récents, c'est ce qui
  // fait la traîne (et empêche le tableau de grossir indéfiniment).
  function trimTrail(trail, now, lifetime) {
    var life = clamp(lifetime, 80, 2000, 420);
    var points = Array.isArray(trail) ? trail : [];
    var kept = [];
    for (var i = 0; i < points.length; i += 1) {
      var age = now - (Number(points[i] && points[i].at) || 0);
      if (age <= life) kept.push(points[i]);
    }
    return kept;
  }

  root.OrbitScroll = {
    DEFAULTS: DEFAULTS,
    RANGES: RANGES,
    PALETTE_TOOLS: PALETTE_TOOLS,
    DRAWING_TOOLS: DRAWING_TOOLS,
    PALETTE_COLORS: PALETTE_COLORS,
    PALETTE_WIDTHS: PALETTE_WIDTHS,
    PALETTE_SHORTCUT: PALETTE_SHORTCUT,
    ORBIT_ALT_SHIFT_KEYS: ORBIT_ALT_SHIFT_KEYS,
    RESERVED_BY_OTHERS: RESERVED_BY_OTHERS,
    isPaletteShortcut: isPaletteShortcut,
    isDrawingTool: isDrawingTool,
    arrowHead: arrowHead,
    trimTrail: trimTrail,
    MODIFIERS: MODIFIERS,
    AUTO_SCROLL_MODES: AUTO_SCROLL_MODES,
    NATIVE_SCROLL_HOSTS: NATIVE_SCROLL_HOSTS,
    NATIVE_SCROLL_SELECTORS: NATIVE_SCROLL_SELECTORS,
    clamp: clamp,
    normalizeConfig: normalizeConfig,
    normalizeSiteRule: normalizeSiteRule,
    matchHost: matchHost,
    resolveSite: resolveSite,
    hostUsesNativeScroll: hostUsesNativeScroll,
    isWheelLike: isWheelLike,
    wheelStep: wheelStep,
    stepTowards: stepTowards,
    autoScrollVelocity: autoScrollVelocity,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
