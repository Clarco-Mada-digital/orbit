// ---------------------------------------------------------------------------
// Studio d'enregistrement : DESSIN sur canvas.
//
// Toute la géométrie vient de studioLayout.js (pur, testé). Ce module ne fait
// que poser des pixels : fond, cadre arrondi avec ombre, pastille caméra.
// Séparer les deux permet de vérifier la mise en page sans navigateur, et
// garde ici un code court, qu'on relit d'un coup d'œil.
//
// C'est ce canvas qui est À LA FOIS l'aperçu affiché et la source de
// l'enregistrement (`canvas.captureStream`) : ce que le présentateur voit
// pendant qu'il parle est exactement ce qui sera enregistré, sans surprise au
// moment de relire.
// ---------------------------------------------------------------------------
import {
  BACKGROUNDS,
  composeLayout,
  containRect,
  coverRect,
  zoomSourceRect,
  haloPoint,
  screenToCanvas,
  voiceRingWidth,
} from './studioLayout.js';
import { arrowHead } from './annotate.js';

// Peint un fond par-dessus ce qui est déjà là. Le canvas est effacé avant,
// alors « aucun fond » n'a rien à faire ici — et pendant un fondu, le nouveau
// fond se pose en transparence sur l'ancien.
function paintBackground(ctx, w, h, key, accentColor, alpha = 1) {
  const bg = BACKGROUNDS[key] || BACKGROUNDS.indigo;
  if (bg.kind === 'none' || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (bg.kind === 'accent') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, accentColor || '#6366f1');
    grad.addColorStop(1, shade(accentColor || '#6366f1', -45));
    ctx.fillStyle = grad;
  } else if (bg.kind === 'gradient') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, bg.colors[0]);
    grad.addColorStop(1, bg.colors[1]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = bg.colors[0];
  }
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// Assombrit ou éclaircit une couleur hexadécimale, pour fabriquer le second
// ton d'un dégradé à partir de la couleur d'accent du profil.
function shade(hex, amount) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const [r, g, b] = [1, 2, 3].map((i) => clamp(parseInt(m[i], 16) + amount));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function roundedPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Dessine une vidéo dans une boîte, découpée en arrondi ou en cercle.
function drawClipped(ctx, video, box, { radius, circle, cover, source }) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  ctx.save();
  if (circle) {
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundedPath(ctx, box.x, box.y, box.w, box.h, radius ?? 0);
  }
  ctx.clip();

  const fit = cover
    ? coverRect(source ? source.sw : vw, source ? source.sh : vh, box.x, box.y, box.w, box.h)
    : containRect(source ? source.sw : vw, source ? source.sh : vh, box.x, box.y, box.w, box.h);

  if (source) {
    ctx.drawImage(video, source.sx, source.sy, source.sw, source.sh, fit.x, fit.y, fit.w, fit.h);
  } else {
    ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
  }
  ctx.restore();
}

// Ombre pré-calculée, redessinée seulement quand la géométrie change.
let shadowCache = null;

function cachedShadow(width, height, fit, radius) {
  const key = `${width}x${height}|${Math.round(fit.x)},${Math.round(fit.y)},${Math.round(fit.w)},${Math.round(fit.h)}|${radius}`;
  if (shadowCache?.key === key) return shadowCache.canvas;
  try {
    const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const c = canvas.getContext('2d');
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = Math.max(12, Math.min(width, height) * 0.03);
    c.shadowOffsetY = Math.max(6, Math.min(width, height) * 0.012);
    c.fillStyle = 'rgba(0,0,0,0.9)';
    roundedPath(c, fit.x, fit.y, fit.w, fit.h, radius);
    c.fill();
    shadowCache = { key, canvas };
    return canvas;
  } catch {
    return null;
  }
}

// --- Annotations d'écran ----------------------------------------------------
// Mêmes règles de tracé que la couche d'annotation (electron/annotate-overlay.js)
// : ce qu'on voit à l'écran doit être ce qu'on retrouve dans la vidéo.
const LASER_LIFETIME = 420;

function drawStroke(ctx, stroke) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  if (stroke.tool === 'highlight') {
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = stroke.width * 3.5;
  }
  if ((stroke.tool === 'pen' || stroke.tool === 'highlight') && stroke.points?.length) {
    ctx.beginPath();
    stroke.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  } else if (stroke.from && stroke.to) {
    const { from, to } = stroke;
    if (stroke.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const head = arrowHead(from, to, stroke.width);
      ctx.beginPath();
      ctx.moveTo(head[0].x, head[0].y);
      ctx.lineTo(head[1].x, head[1].y);
      ctx.lineTo(head[2].x, head[2].y);
      ctx.stroke();
    } else if (stroke.tool === 'rect') {
      ctx.strokeRect(
        Math.min(from.x, to.x),
        Math.min(from.y, to.y),
        Math.abs(to.x - from.x),
        Math.abs(to.y - from.y)
      );
    } else if (stroke.tool === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2,
        Math.max(1, Math.abs(to.x - from.x) / 2),
        Math.max(1, Math.abs(to.y - from.y) / 2),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawLaser(ctx, { trail, pointer, color, width }) {
  const now = Date.now();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, width);
  ctx.strokeStyle = color;
  for (let i = 1; i < (trail?.length || 0); i += 1) {
    const alpha = Math.max(0, 1 - (now - trail[i].at) / LASER_LIFETIME) * 0.6;
    if (!alpha) continue;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (pointer && pointer.x > -9000) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, Math.max(6, width), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Les tracés sont en coordonnées de la couche ; `toCanvas` passe de l'écran au
// canvas. On décale d'abord de la position de la couche sur l'écran.
function drawAnnotations(ctx, annotations, toCanvas) {
  const origin = annotations.bounds || { x: 0, y: 0 };
  ctx.save();
  ctx.setTransform(
    toCanvas.a,
    0,
    0,
    toCanvas.d,
    toCanvas.e + origin.x * toCanvas.a,
    toCanvas.f + origin.y * toCanvas.d
  );
  for (const stroke of annotations.strokes || []) drawStroke(ctx, stroke);
  if (annotations.drawing) drawStroke(ctx, annotations.drawing);
  if (annotations.tool === 'laser') drawLaser(ctx, annotations);
  ctx.restore();
}

// Anneau qui respire avec la voix, posé AUTOUR de la vignette — à l'intérieur,
// il mangerait le visage. Il grossit avec le niveau au lieu de s'allumer et
// s'éteindre : un anneau binaire clignote, un anneau qui respire se regarde.
function drawVoiceRing(ctx, box, level, color) {
  const amount = voiceRingWidth(level);
  if (!amount) return;
  const width = Math.max(2, Math.min(box.w, box.h) * 0.035) * (0.5 + amount);
  ctx.save();
  ctx.globalAlpha = 0.35 + amount * 0.5;
  ctx.strokeStyle = color || '#6366f1';
  ctx.lineWidth = width;
  if (box.shape === 'circle') {
    ctx.beginPath();
    ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2 + width / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const o = width / 2;
    roundedPath(ctx, box.x - o, box.y - o, box.w + o * 2, box.h + o * 2, box.radius ?? 0);
    ctx.stroke();
  }
  ctx.restore();
}

// Carton de titre : un voile sur la composition, le titre par-dessus. Les deux
// s'effacent à leur rythme (voir titleCardPhase), si bien que la composition
// se découvre sous le texte au lieu d'apparaître après lui.
function drawTitleCard(ctx, width, height, { text, phase }) {
  if (!text || !phase) return;
  ctx.save();
  if (phase.veil > 0) {
    ctx.globalAlpha = phase.veil * 0.72;
    ctx.fillStyle = 'rgba(8,11,22,1)';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalAlpha = phase.text;
  const size = Math.round(Math.min(width, height) * 0.085);
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = '#ffffff';
  // Le titre est coupé en lignes sur les espaces : une seule ligne débordait
  // du cadre dès qu'on écrivait une phrase.
  const lines = wrapText(ctx, String(text), width * 0.78);
  const start = height / 2 - ((lines.length - 1) * size * 1.25) / 2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, start + i * size * 1.25));
  ctx.restore();
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

// Bandeau d'état — « Pause ». Sur l'image figée d'une pause, c'est lui qui dit
// au spectateur que la coupure est voulue et non un bogue d'encodage.
function drawBanner(ctx, width, height, label) {
  if (!label) return;
  const size = Math.round(Math.min(width, height) * 0.038);
  ctx.save();
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padX = size * 0.9;
  const w = ctx.measureText(label).width + padX * 2;
  const h = size * 2;
  const x = (width - w) / 2;
  const y = height * 0.06;
  ctx.fillStyle = 'rgba(8,11,22,0.72)';
  roundedPath(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, width / 2, y + h / 2);
  ctx.restore();
}

// Une image d'enregistrement. Appelée à chaque rafraîchissement : elle doit
// rester sans allocation inutile et sans effet de bord.
export function drawFrame(ctx, {
  width,
  height,
  screenVideo,
  cameraVideo,
  style,
  accentColor,
  focus,
  // Bornes de l'écran filmé (null pour une fenêtre) : sans elles, impossible
  // de replacer les annotations.
  captureBounds = null,
  annotations = null,
  // Plan déjà interpolé par l'appelant pendant un changement de disposition.
  // Sans lui, on compose directement la disposition demandée.
  plan: planOverride = null,
  // Fondu de fond en cours : `{ from, t }`, l'ancien fond et l'avancement.
  backgroundFade = null,
  // Niveau de zoom EFFECTIF : le réglage permanent, ou un coup de zoom en
  // cours. 1 = pas de zoom.
  zoomLevel = null,
  // Niveau de voix lissé (0→1), pour l'anneau de la caméra.
  voice = 0,
  // Carton de titre : `{ text, phase }` pendant les premières secondes.
  titleCard = null,
  // Image figée à redessiner telle quelle (pause), et bandeau à poser dessus.
  frozen = null,
  banner = null,
}) {
  // Pause : on redessine l'image d'avant, inchangée. Tout recomposer ferait
  // vivre la vidéo pendant la pause (le visage bouge, le curseur passe), ce
  // qui est précisément ce qu'une pause ne doit pas montrer.
  if (frozen) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(frozen, 0, 0, width, height);
    drawBanner(ctx, width, height, banner);
    return;
  }

  ctx.clearRect(0, 0, width, height);
  if (backgroundFade?.from && backgroundFade.t < 1) {
    paintBackground(ctx, width, height, backgroundFade.from, accentColor);
    paintBackground(ctx, width, height, style.background, accentColor, backgroundFade.t);
  } else {
    paintBackground(ctx, width, height, style.background, accentColor);
  }

  const hasCamera = Boolean(cameraVideo && cameraVideo.videoWidth);
  const plan = planOverride || composeLayout({ outW: width, outH: height, style, hasCamera });

  if (plan.screen && screenVideo && screenVideo.videoWidth) {
    const box = plan.screen;
    ctx.save();
    if (box.alpha != null) ctx.globalAlpha = box.alpha;
    // Le zoom choisit QUELLE PART de la capture est montrée ; le cadre, lui,
    // ne bouge pas. C'est ce qui donne l'effet « la caméra se rapproche »
    // plutôt qu'une image qui grossit en débordant.
    const z = zoomLevel ?? (style.zoom ? style.zoomLevel : 1);
    const source =
      z > 1 ? zoomSourceRect(screenVideo.videoWidth, screenVideo.videoHeight, focus, z) : null;

    const fit = containRect(
      source ? source.sw : screenVideo.videoWidth,
      source ? source.sh : screenVideo.videoHeight,
      box.x,
      box.y,
      box.w,
      box.h
    );

    // L'ombre est MISE EN CACHE : c'est un flou gaussien sur toute la surface,
    // de loin l'opération la plus chère du dessin. Or elle ne dépend que de la
    // géométrie du cadre, qui ne bouge pas d'une image à l'autre — la
    // recalculer trente fois par seconde revenait à payer le plus lourd pour
    // redessiner l'identique.
    // Mise de côté pendant un enchaînement : la géométrie change à chaque
    // image, le cache ne servirait plus à rien et le flou coûterait la cadence.
    if (style.shadow && style.background !== 'none' && !plan.animating) {
      const shadow = cachedShadow(width, height, fit, style.radius);
      if (shadow) ctx.drawImage(shadow, 0, 0);
    }

    drawClipped(ctx, screenVideo, fit, { radius: style.radius, source });

    const toCanvas =
      annotations &&
      screenToCanvas(captureBounds, screenVideo.videoWidth, screenVideo.videoHeight, source, fit);
    if (toCanvas) {
      ctx.save();
      roundedPath(ctx, fit.x, fit.y, fit.w, fit.h, style.radius);
      ctx.clip(); // rien ne déborde du cadre
      drawAnnotations(ctx, annotations, toCanvas);
      ctx.restore();
    }

    // Halo du pointeur. Sur une capture réduite dans un cadre, le curseur fait
    // quelques pixels : le spectateur le perd en permanence. Un disque doux
    // suit sa position sans masquer ce qu'il désigne.
    if (style.cursorHalo) {
      const halo = haloPoint(focus, source, screenVideo.videoWidth, screenVideo.videoHeight, fit);
      if (halo) {
        ctx.save();
        roundedPath(ctx, fit.x, fit.y, fit.w, fit.h, style.radius);
        ctx.clip(); // le halo ne déborde jamais du cadre
        const grad = ctx.createRadialGradient(halo.x, halo.y, 0, halo.x, halo.y, halo.r);
        grad.addColorStop(0, 'rgba(250, 204, 21, 0.38)');
        grad.addColorStop(0.65, 'rgba(250, 204, 21, 0.16)');
        grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(halo.x, halo.y, halo.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore(); // opacité de l'enchaînement
  }

  if (plan.camera && hasCamera) {
    const box = plan.camera;
    const circle = box.shape === 'circle';

    ctx.save();
    if (box.alpha != null) ctx.globalAlpha = box.alpha;

    if (style.voiceRing !== false) {
      drawVoiceRing(ctx, { ...box, radius: style.radius }, voice, accentColor);
    }

    ctx.save();
    // Un liseré clair détache le visage du fond, surtout quand la pastille
    // chevauche une zone sombre de la capture.
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = Math.max(8, box.w * 0.08);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if (circle) {
      ctx.beginPath();
      ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2 + 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundedPath(ctx, box.x - 2, box.y - 2, box.w + 4, box.h + 4, style.radius);
      ctx.fill();
    }
    ctx.restore();

    // Miroir : on se voit comme dans une glace. Sans ça, chacun se trouve
    // « à l'envers » et le texte derrière soi devient illisible à l'écran.
    if (style.cameraMirror) {
      ctx.save();
      ctx.translate(box.x * 2 + box.w, 0);
      ctx.scale(-1, 1);
      drawClipped(ctx, cameraVideo, box, { radius: style.radius, circle, cover: true });
      ctx.restore();
    } else {
      drawClipped(ctx, cameraVideo, box, { radius: style.radius, circle, cover: true });
    }
    ctx.restore(); // opacité de l'enchaînement
  }

  // Par-dessus tout : le carton de titre des premières secondes, puis le
  // bandeau d'état.
  if (titleCard) drawTitleCard(ctx, width, height, titleCard);
  drawBanner(ctx, width, height, banner);
}
