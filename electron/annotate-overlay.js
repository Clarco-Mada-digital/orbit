// Annotation de l'écran — code de rendu de la couche plein écran.
//
// Deux modes, et tout tient dans cette distinction :
//   • « pointeur » : la fenêtre est TRAVERSANTE (le processus principal appelle
//     `setIgnoreMouseEvents`), on continue de travailler normalement dans les
//     applications, les tracés restent affichés par-dessus ;
//   • un outil de dessin : la fenêtre capte la souris, on trace sur l'écran.
//
// La palette, elle, doit rester cliquable dans les deux cas : le survol le
// signale au processus principal, qui rend la fenêtre opaque au pointeur le
// temps nécessaire.
(() => {
  'use strict';

  const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#f8fafc'];
  const WIDTHS = [3, 6, 12];
  const DRAWING_TOOLS = ['laser', 'pen', 'highlight', 'arrow', 'rect', 'ellipse'];
  const LASER_LIFETIME = 420;

  const board = document.getElementById('board');
  const ctx = board.getContext('2d');
  const palette = document.getElementById('palette');
  const hint = document.getElementById('hint');

  let tool = 'pen';
  let color = COLORS[0];
  let width = WIDTHS[1];
  let strokes = [];
  let drawing = null;
  let trail = [];
  let frame = 0;
  let pointer = { x: -9999, y: -9999 };

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    board.width = Math.round(window.innerWidth * ratio);
    board.height = Math.round(window.innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  // Pointe de flèche : deux ailes à ~28°, longueur liée à l'épaisseur, jamais
  // plus longue que la flèche elle-même.
  function arrowHead(from, to, thickness) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const head = Math.min(Math.max(12, thickness * 4.5), Math.max(4, length * 0.6));
    const spread = 0.49;
    return [
      { x: to.x - head * Math.cos(angle - spread), y: to.y - head * Math.sin(angle - spread) },
      to,
      { x: to.x - head * Math.cos(angle + spread), y: to.y - head * Math.sin(angle + spread) },
    ];
  }

  function drawStroke(stroke) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    if (stroke.tool === 'highlight') {
      ctx.globalAlpha = 0.32;
      ctx.lineWidth = stroke.width * 3.5;
    }
    if (stroke.tool === 'pen' || stroke.tool === 'highlight') {
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    } else if (stroke.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(stroke.from.x, stroke.from.y);
      ctx.lineTo(stroke.to.x, stroke.to.y);
      ctx.stroke();
      const head = arrowHead(stroke.from, stroke.to, stroke.width);
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

  function drawTrail(now) {
    if (tool !== 'laser' || trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(4, width);
    ctx.strokeStyle = color;
    for (let i = 1; i < trail.length; i += 1) {
      const alpha = Math.max(0, 1 - (now - trail[i].at) / LASER_LIFETIME) * 0.6;
      if (!alpha) continue;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (pointer.x > -9000) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, Math.max(6, width), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function redraw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const stroke of strokes) drawStroke(stroke);
    if (drawing) drawStroke(drawing);
    drawTrail(Date.now());
    schedulePublish();
  }

  // --- Relais vers le studio -------------------------------------------------
  // La capture d'écran ne reprend pas toujours cette fenêtre transparente (cas
  // courant sous Linux) : le studio redessine donc les tracés dans sa vidéo.
  // On lui envoie l'état au plus 30 fois par seconde ; la liste complète des
  // tracés ne part que lorsqu'elle a changé, et une fois par seconde pour
  // resynchroniser un studio ouvert après coup.
  const PUBLISH_EVERY = 33;
  let publishTimer = 0;
  let sentVersion = -1;
  let sentAt = 0;
  let version = 0;

  function strokesChanged() {
    version += 1;
  }

  function publish() {
    publishTimer = 0;
    const now = Date.now();
    const full = version !== sentVersion || now - sentAt > 1000;
    window.annotate?.publish?.({
      version,
      ...(full ? { strokes } : {}),
      drawing,
      trail: tool === 'laser' ? trail : [],
      pointer: tool === 'laser' ? pointer : null,
      tool,
      color,
      width,
    });
    if (full) {
      sentVersion = version;
      sentAt = now;
    }
  }

  function schedulePublish() {
    if (!publishTimer) publishTimer = setTimeout(publish, PUBLISH_EVERY);
  }

  function loop() {
    if (tool !== 'laser') {
      frame = 0;
      return;
    }
    const now = Date.now();
    trail = trail.filter((point) => now - point.at <= LASER_LIFETIME);
    redraw();
    frame = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (!frame && tool === 'laser') frame = requestAnimationFrame(loop);
  }

  // Le mode est la seule chose que le processus principal doit connaître :
  // c'est lui qui rend la fenêtre traversante ou non.
  function applyMode() {
    const drawMode = DRAWING_TOOLS.includes(tool);
    document.body.dataset.mode = drawMode ? 'draw' : 'pointer';
    hint.textContent = drawMode
      ? 'L’écran est en mode dessin — Échap rend la main aux applications.'
      : 'Mode pointeur : vos clics passent aux applications, les tracés restent visibles.';
    window.annotate?.setMode?.(drawMode ? 'draw' : 'pointer');
    for (const button of palette.querySelectorAll('[data-tool]')) {
      button.setAttribute('aria-pressed', button.dataset.tool === tool ? 'true' : 'false');
    }
    startLoop();
  }

  function setTool(next) {
    tool = next;
    if (tool !== 'laser') trail = [];
    applyMode();
    redraw();
  }

  // --- Palette --------------------------------------------------------------

  const colorsRow = document.getElementById('colors');
  for (const value of COLORS) {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.style.background = value;
    swatch.title = `Couleur ${value}`;
    swatch.setAttribute('aria-label', `Couleur ${value}`);
    swatch.setAttribute('aria-pressed', value === color ? 'true' : 'false');
    swatch.addEventListener('click', () => {
      color = value;
      for (const node of colorsRow.querySelectorAll('.swatch')) {
        node.setAttribute('aria-pressed', node.style.background === value ? 'true' : 'false');
      }
      redraw();
    });
    colorsRow.appendChild(swatch);
  }
  const widthSep = document.createElement('span');
  widthSep.className = 'sep';
  colorsRow.appendChild(widthSep);
  for (const value of WIDTHS) {
    const button = document.createElement('button');
    button.title = `Épaisseur ${value} px`;
    button.setAttribute('aria-label', `Épaisseur ${value} px`);
    button.setAttribute('aria-pressed', value === width ? 'true' : 'false');
    const dot = document.createElement('span');
    dot.style.cssText = `display:block;border-radius:999px;background:#e5e7eb;width:${Math.min(16, value + 4)}px;height:${Math.min(10, value / 1.6 + 2)}px;`;
    button.appendChild(dot);
    button.addEventListener('click', () => {
      width = value;
      for (const node of colorsRow.querySelectorAll('button:not(.swatch)')) {
        node.setAttribute('aria-pressed', 'false');
      }
      button.setAttribute('aria-pressed', 'true');
    });
    colorsRow.appendChild(button);
  }

  for (const button of palette.querySelectorAll('[data-tool]')) {
    button.addEventListener('click', () => setTool(button.dataset.tool));
  }
  document.getElementById('undo').addEventListener('click', () => {
    strokes.pop();
    strokesChanged();
    redraw();
  });
  document.getElementById('clear').addEventListener('click', () => {
    strokes = [];
    trail = [];
    strokesChanged();
    redraw();
  });
  document.getElementById('close').addEventListener('click', () => window.annotate?.close?.());

  // La palette reste cliquable même quand la fenêtre est traversante : on
  // prévient le processus principal à l'entrée et à la sortie du pointeur.
  palette.addEventListener('mouseenter', () => window.annotate?.setHover?.(true));
  palette.addEventListener('mouseleave', () => window.annotate?.setHover?.(false));

  // Déplacement de la palette : elle ne doit pas masquer ce qu'on montre.
  document.getElementById('grip').addEventListener('mousedown', (event) => {
    event.preventDefault();
    const rect = palette.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    palette.classList.add('dragging');
    const move = (moveEvent) => {
      palette.style.left = `${Math.max(8, Math.min(window.innerWidth - rect.width - 8, moveEvent.clientX - offsetX))}px`;
      palette.style.top = `${Math.max(8, Math.min(window.innerHeight - rect.height - 8, moveEvent.clientY - offsetY))}px`;
      palette.style.bottom = 'auto';
      palette.style.transform = 'none';
    };
    const up = () => {
      palette.classList.remove('dragging');
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
    };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  });

  // --- Tracé ----------------------------------------------------------------

  board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !DRAWING_TOOLS.includes(tool) || tool === 'laser') return;
    board.setPointerCapture(event.pointerId);
    const at = { x: event.clientX, y: event.clientY };
    drawing =
      tool === 'pen' || tool === 'highlight'
        ? { tool, color, width, points: [at] }
        : { tool, color, width, from: at, to: at };
  });

  board.addEventListener('pointermove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (tool === 'laser') {
      trail.push({ x: pointer.x, y: pointer.y, at: Date.now() });
      startLoop();
      return;
    }
    if (!drawing) return;
    if (drawing.points) drawing.points.push({ x: pointer.x, y: pointer.y });
    else drawing.to = { x: pointer.x, y: pointer.y };
    redraw();
  });

  const endStroke = () => {
    if (!drawing) return;
    const finished = drawing;
    drawing = null;
    const meaningful = finished.points
      ? finished.points.length > 1
      : Math.abs(finished.to.x - finished.from.x) > 4 || Math.abs(finished.to.y - finished.from.y) > 4;
    if (meaningful) {
      strokes.push(finished);
      strokesChanged();
    }
    redraw();
  };
  board.addEventListener('pointerup', endStroke);
  board.addEventListener('pointercancel', endStroke);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // Premier Échap : retour au pointeur (les applications reprennent la
      // main). Deuxième : on ferme la couche.
      if (DRAWING_TOOLS.includes(tool)) setTool('pointer');
      else window.annotate?.close?.();
    } else if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
      strokes.pop();
      strokesChanged();
      redraw();
    }
  });

  window.addEventListener('resize', resize);
  resize();
  applyMode();
})();
