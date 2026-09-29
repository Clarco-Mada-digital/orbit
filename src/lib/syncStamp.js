// ---------------------------------------------------------------------------
// Horodatage automatique des entités synchronisées — LOGIQUE PURE.
//
// La synchronisation arbitre au « dernier écrivain gagne » par entité : chaque
// app, profil, conteneur et espace de travail a donc besoin d'un `updatedAt`
// fiable. Le tenir à jour dans les ~20 actions du store serait condamné à
// l'oubli (la prochaine action ajoutée ne le ferait pas).
//
// On le calcule donc à la source, en comparant l'état AVANT et APRÈS chaque
// `set()`. Deux garanties qui comptent :
//
//  1. Seuls les CHAMPS SYNCHRONISÉS comptent. <WebView> appelle `updateApp` à
//     chaque navigation (url, titre, favicon, non-lus) ; si ces champs
//     comptaient, `updatedAt` changerait en permanence et chaque machine
//     réécrirait le fichier de synchronisation sans arrêt.
//
//  2. Les suppressions laissent une pierre tombale, sinon la machine d'en face
//     conclurait « il me manque cette app » et la réinstallerait.
// ---------------------------------------------------------------------------
import { SYNC_COLLECTIONS } from './syncMerge.js';

// Deux entités diffèrent-elles sur au moins un champ synchronisé ?
export function syncedFieldsChanged(before, after, fields) {
  for (const f of fields) {
    if (before[f] !== after[f]) return true;
  }
  return false;
}

// Compare une collection et renvoie la version horodatée + les suppressions.
export function stampCollection(before, after, fields, now) {
  const prev = new Map((before || []).map((e) => [e.id, e]));
  const seen = new Set();
  let changed = false;

  const list = (after || []).map((entity) => {
    if (!entity || !entity.id) return entity;
    seen.add(entity.id);
    const old = prev.get(entity.id);
    // Entité nouvelle, ou modifiée sur un champ qui voyage
    if (!old || syncedFieldsChanged(old, entity, fields)) {
      changed = true;
      return { ...entity, updatedAt: now };
    }
    // Inchangée mais jamais horodatée (données d'avant la synchronisation)
    if (!entity.updatedAt) {
      changed = true;
      return { ...entity, updatedAt: old.updatedAt || now };
    }
    return entity;
  });

  const removed = [...prev.keys()].filter((id) => !seen.has(id));
  return { list, removed, changed };
}

// Marqueur d'échappement : une écriture qui le porte n'est PAS horodatée.
//
// Indispensable pour appliquer un instantané fusionné : ses `updatedAt`
// viennent d'être arbitrés entre machines. Les réécrire avec l'heure locale
// ferait gagner systématiquement la dernière machine à synchroniser, et la
// fusion ne convergerait jamais.
export const NO_STAMP = '__fromSync';

// Middleware zustand : intercepte `set` pour horodater et poser les pierres
// tombales. Se place entre `persist` et le créateur du store.
export const stampSync = (config) => (set, get, api) =>
  config(
    (partial, replace) => {
      // Le marqueur peut être posé sur un objet comme sur le retour d'une
      // fonction de mise à jour.
      let bypass = false;
      let value = partial;
      if (typeof partial === 'function') {
        value = (state) => {
          const out = partial(state);
          if (out && out[NO_STAMP]) {
            bypass = true;
            const { [NO_STAMP]: _drop, ...rest } = out;
            return rest;
          }
          return out;
        };
      } else if (partial && partial[NO_STAMP]) {
        bypass = true;
        const { [NO_STAMP]: _drop, ...rest } = partial;
        value = rest;
      }

      const before = get();
      // On laisse d'abord l'action s'appliquer normalement…
      set(value, replace);
      if (bypass) return;
      const after = get();

      // …puis on corrige l'horodatage de ce qui a réellement bougé.
      const now = Date.now();
      const patch = {};
      let tombstones = null;

      for (const [key, fields] of Object.entries(SYNC_COLLECTIONS)) {
        // Collection non touchée par cette action : rien à faire (comparaison
        // par référence — zustand remplace le tableau quand il change).
        if (before[key] === after[key]) continue;
        const { list, removed, changed } = stampCollection(before[key], after[key], fields, now);
        if (changed) patch[key] = list;
        for (const id of removed) {
          tombstones = tombstones || { ...(after.tombstones || {}) };
          tombstones[id] = now;
        }
      }

      // Les réglages voyagent en bloc : un seul horodatage pour l'ensemble.
      if (before.settings !== after.settings) patch.settingsUpdatedAt = now;
      if (tombstones) patch.tombstones = tombstones;

      if (Object.keys(patch).length) set(patch);
    },
    get,
    api
  );
