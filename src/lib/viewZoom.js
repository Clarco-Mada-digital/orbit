// Zoom de PRÉSENTATION — logique pure, partagée par l'aperçu de capture et la
// vue responsive. On agrandit l'affichage (comme une loupe), jamais le
// contenu : la capture garde ses pixels, la page garde sa largeur.

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
// Paliers des boutons − / + (ceux de la plupart des visionneuses).
export const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

// Palier suivant (dir > 0) ou précédent (dir < 0), à partir d'un zoom
// quelconque (celui de « Ajuster » tombe rarement sur un palier).
export function stepZoom(current, dir) {
  const z = clampZoom(current);
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_MIN;
}

// Molette avec Ctrl : un cran ≈ 10 %, proportionnel au défilement (pavés
// tactiles : petits deltas, zoom fluide).
export function wheelZoom(current, deltaY) {
  const factor = Math.exp(-Math.max(-300, Math.min(300, Number(deltaY) || 0)) * 0.0015);
  return clampZoom(clampZoom(current) * factor);
}
