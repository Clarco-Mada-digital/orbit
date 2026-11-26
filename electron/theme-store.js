// ---------------------------------------------------------------------------
// Thèmes de la communauté — réseau et cache (processus principal).
//
// Même modèle que le magasin d'extensions (electron/extension-store.js) :
// catalogue HTTPS borné en taille, gardé 24 h en cache (et servi daté hors
// ligne), fichier téléchargé vérifié octet pour octet contre l'empreinte du
// catalogue. L'interface reçoit le TEXTE du thème et le passe au validateur
// d'import : un thème n'est que des valeurs, jamais du code.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { httpGet } from './extension-store.js';
import {
  THEME_CATALOG_URL,
  MAX_THEME_CATALOG_BYTES,
  MAX_THEME_FILE_BYTES,
  normalizeThemeCatalog,
  themeFileUrl,
  themeCatalogIsStale,
} from '../src/lib/themeCatalog.js';

// Détournable pour un déploiement interne ou une mise au point.
export function themeCatalogUrl() {
  const override = String(process.env.ORBIT_THEMES_URL || '').trim();
  return override || THEME_CATALOG_URL;
}

function readCache(cachePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return { url: String(raw.url || ''), fetchedAt: Number(raw.fetchedAt) || 0, catalog: normalizeThemeCatalog(raw.catalog) };
  } catch {
    return null;
  }
}

function writeCache(cachePath, url, catalog) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ url, fetchedAt: Date.now(), catalog }, null, 2));
  } catch (err) {
    console.warn('[orbit] cache du catalogue de thèmes non écrit :', err.message);
  }
}

export async function fetchThemeCatalog({ cachePath, refresh = false } = {}) {
  const url = themeCatalogUrl();
  const cached = cachePath ? readCache(cachePath) : null;
  const usable = cached && cached.url === url ? cached : null;
  if (!refresh && usable && !themeCatalogIsStale(usable.fetchedAt)) {
    return { success: true, themes: usable.catalog.themes, fetchedAt: usable.fetchedAt, stale: false };
  }
  try {
    const body = await httpGet(url, { maxBytes: MAX_THEME_CATALOG_BYTES });
    const catalog = normalizeThemeCatalog(JSON.parse(body.toString('utf8')));
    if (cachePath) writeCache(cachePath, url, catalog);
    return { success: true, themes: catalog.themes, fetchedAt: Date.now(), stale: false };
  } catch (err) {
    if (usable) {
      return { success: true, themes: usable.catalog.themes, fetchedAt: usable.fetchedAt, stale: true, error: String(err.message || err) };
    }
    return { success: false, themes: [], fetchedAt: 0, stale: true, error: String(err.message || err) };
  }
}

// Le texte du thème `id`, vérifié contre le catalogue (taille + SHA-256).
// Un catalogue en cache peut décrire une version précédente du thème : en cas
// d'écart, on le recharge UNE fois avant de conclure.
export async function downloadTheme({ id, cachePath } = {}) {
  const first = await downloadOnce({ id, cachePath, refresh: false });
  if (first.success || !first.mismatch) return first;
  return downloadOnce({ id, cachePath, refresh: true });
}

async function downloadOnce({ id, cachePath, refresh }) {
  const catalog = await fetchThemeCatalog({ cachePath, refresh });
  const entry = catalog.themes.find((t) => t.id === id);
  if (!entry) return { success: false, error: 'thème absent du catalogue' };
  try {
    const bytes = await httpGet(themeFileUrl(entry, themeCatalogUrl()), { maxBytes: MAX_THEME_FILE_BYTES });
    if (bytes.length !== entry.size) return { success: false, mismatch: true, error: 'taille différente de celle du catalogue' };
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    if (sha !== entry.sha256) return { success: false, mismatch: true, error: 'empreinte différente de celle du catalogue' };
    return { success: true, text: bytes.toString('utf8') };
  } catch (err) {
    return { success: false, error: String(err.message || err) };
  }
}
