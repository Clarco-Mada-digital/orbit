// Capture d'appareil de la vue responsive — côté interface (utilise le DOM
// et <canvas> ; la géométrie pure vit dans responsive.js et y est testée).
//
// Pourquoi par TUILES : capturePage() d'un <webview> plus grand que la zone
// visible n'est pas fiable (mesuré : ni la page entière, ni la partie
// visible). On amène donc chaque morceau de l'appareil à l'écran en faisant
// défiler la scène, on photographie la fenêtre d'Orbit à cet endroit précis,
// et on recolle les morceaux. Ce qui est capturé a donc réellement été affiché.
import { deviceFrame, tileOffsets } from './responsive.js';

const nextFrames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// `stage` : l'élément qui défile ; `frame` : le cadre de l'appareil (à
// l'échelle 1 au moment de l'appel) ; `size` : taille de l'appareil en px CSS.
// Rend un <canvas> de l'écran de l'appareil, ou null.
export async function captureTiles({ stage, frame, size, captureRect }) {
  if (!stage || !frame || typeof captureRect !== 'function') return null;
  const start = { left: stage.scrollLeft, top: stage.scrollTop };
  const s0 = stage.getBoundingClientRect();
  const f0 = frame.getBoundingClientRect();
  // Position du cadre dans le contenu défilant de la scène.
  const originX = f0.left - s0.left + stage.scrollLeft;
  const originY = f0.top - s0.top + stage.scrollTop;
  const xs = tileOffsets(size.width, stage.clientWidth);
  const ys = tileOffsets(size.height, stage.clientHeight);
  let canvas = null;
  let ctx = null;
  let ratio = 1;
  try {
    for (const y of ys) {
      for (const x of xs) {
        stage.scrollLeft = originX + x;
        stage.scrollTop = originY + y;
        await nextFrames();
        await wait(160);
        const sr = stage.getBoundingClientRect();
        const fr = frame.getBoundingClientRect();
        // Partie visible du cadre, hors barres de défilement de la scène.
        const left = Math.max(fr.left, sr.left);
        const top = Math.max(fr.top, sr.top);
        const right = Math.min(fr.right, sr.left + stage.clientWidth);
        const bottom = Math.min(fr.bottom, sr.top + stage.clientHeight);
        const rect = {
          x: Math.ceil(left),
          y: Math.ceil(top),
          width: Math.floor(right) - Math.ceil(left),
          height: Math.floor(bottom) - Math.ceil(top),
        };
        if (rect.width <= 0 || rect.height <= 0) continue;
        const res = await captureRect(rect);
        if (!res?.success || !res.dataUrl) continue;
        const img = await loadImage(res.dataUrl);
        if (!canvas) {
          // Densité réelle de la capture (2 sur un écran Retina…).
          ratio = img.naturalWidth / rect.width || 1;
          canvas = document.createElement('canvas');
          canvas.width = Math.round(size.width * ratio);
          canvas.height = Math.round(size.height * ratio);
          ctx = canvas.getContext('2d');
        }
        ctx.drawImage(img, Math.round((rect.x - fr.left) * ratio), Math.round((rect.y - fr.top) * ratio));
      }
    }
  } finally {
    stage.scrollLeft = start.left;
    stage.scrollTop = start.top;
  }
  return canvas ? { canvas, ratio } : null;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Pose l'écran capturé dans un cadre d'appareil (téléphone, tablette ou
// fenêtre). Fond transparent autour : l'image se pose telle quelle dans une
// présentation.
export function drawDeviceFrame(screen, kind, ratio = 1) {
  const g = deviceFrame(kind, screen.width / ratio, screen.height / ratio);
  const k = ratio;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(g.width * k);
  canvas.height = Math.round(g.height * k);
  const ctx = canvas.getContext('2d');
  // Coque.
  roundedRect(ctx, 0, 0, canvas.width, canvas.height, g.outerRadius * k);
  ctx.fillStyle = '#16171b';
  ctx.fill();
  ctx.lineWidth = Math.max(1, 2 * k);
  ctx.strokeStyle = '#3a3d45';
  ctx.stroke();
  // Écran, aux coins arrondis.
  ctx.save();
  roundedRect(ctx, g.bezel * k, g.bezel * k, screen.width, screen.height, g.innerRadius * k);
  ctx.clip();
  ctx.drawImage(screen, g.bezel * k, g.bezel * k);
  ctx.restore();
  // Îlot de la caméra (téléphones).
  if (g.island) {
    const { x, y, w, h } = g.island;
    roundedRect(ctx, x * k, y * k, w * k, h * k, (Math.min(w, h) / 2) * k);
    ctx.fillStyle = '#000';
    ctx.fill();
  }
  return canvas;
}
