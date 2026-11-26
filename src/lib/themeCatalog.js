// ---------------------------------------------------------------------------
// Catalogue des thèmes de la communauté — LOGIQUE PURE (testable sans réseau).
//
// Le catalogue est publié avec le site (GitHub Pages) à partir de
// themes-dist/ : voir scripts/export-themes.mjs et docs/guide-themes.md.
// Rien de ce qu'il contient n'est cru sur parole : chaque entrée est
// re-validée ici, et le fichier téléchargé doit avoir exactement la taille et
// l'empreinte SHA-256 annoncées (vérifié dans electron/theme-store.js), puis
// passer le même validateur qu'un import (src/lib/customTheme.js).
// ---------------------------------------------------------------------------

export const THEME_CATALOG_URL = 'https://clarco-mada-digital.github.io/orbit/themes/catalog.json';
export const MAX_THEME_CATALOG_BYTES = 512 * 1024;
export const MAX_THEME_FILE_BYTES = 256 * 1024;
export const THEME_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

const ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
const SHA = /^[a-f0-9]{64}$/;
const TRIPLET = /^\d{1,3} \d{1,3} \d{1,3}$/;
const PREVIEW_KEYS = ['bgPrimary', 'bgElevated', 'textPrimary', 'accent'];

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function normalizePreview(raw) {
  const out = {};
  for (const mode of ['dark', 'light']) {
    const p = raw?.[mode];
    if (!p || typeof p !== 'object') continue;
    const colors = {};
    for (const k of PREVIEW_KEYS) {
      if (typeof p[k] === 'string' && TRIPLET.test(p[k]) && p[k].split(' ').every((n) => Number(n) <= 255)) colors[k] = p[k];
    }
    if (Object.keys(colors).length === PREVIEW_KEYS.length) out[mode] = colors;
  }
  return out;
}

export function normalizeThemeCatalog(raw) {
  const list = Array.isArray(raw?.themes) ? raw.themes : [];
  const seen = new Set();
  const themes = [];
  for (const e of list.slice(0, 500)) {
    const id = typeof e?.id === 'string' ? e.id : '';
    if (!ID.test(id) || seen.has(id)) continue;
    // Le fichier est TOUJOURS « <id>.json » : aucun chemin, aucune URL
    // arbitraire ne peut se glisser dans le catalogue.
    if (e.file !== `${id}.json`) continue;
    if (!SHA.test(String(e.sha256 || ''))) continue;
    const size = Number(e.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_THEME_FILE_BYTES) continue;
    const name = text(e.name, 48);
    if (!name) continue;
    seen.add(id);
    themes.push({
      id,
      name,
      author: text(e.author, 48),
      description: text(e.description, 160),
      file: e.file,
      size,
      sha256: e.sha256,
      preview: normalizePreview(e.preview),
    });
  }
  return { version: 1, themes };
}

// Adresse du fichier d'un thème : à côté du catalogue, jamais ailleurs.
export function themeFileUrl(entry, catalogUrl = THEME_CATALOG_URL) {
  return new URL(entry.file, catalogUrl).toString();
}

export function themeCatalogIsStale(fetchedAt, now = Date.now()) {
  return now - (Number(fetchedAt) || 0) > THEME_CATALOG_TTL_MS;
}
