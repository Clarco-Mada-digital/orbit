// Réglages d'extension partagés entre toutes les sessions d'Orbit.
//
// Chaque app, lien libre ou fenêtre détachée a sa propre session Chromium,
// donc son propre `chrome.storage.local`. Pour une extension comme Text
// Snippets, cela voulait dire : des snippets saisis depuis une app, et les
// valeurs par défaut partout ailleurs. Une extension qui déclare
// `"orbit": { "sharedSettings": true }` dans son manifeste voit son stockage
// tenu à jour dans toutes les sessions à partir d'une copie de référence.
//
// Ce module ne fait que la comptabilité (copie de référence, révision, quelle
// session a reçu quelle révision) ; l'écriture dans les sessions vit dans
// main.js.

import fs from 'node:fs';
import path from 'node:path';

// Un réglage d'extension n'est pas une base de données : au-delà, on refuse
// plutôt que de recopier des mégaoctets dans chaque session.
export const MAX_SHARED_BYTES = 512 * 1024;

export function readOrbitManifestFlags(extPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
    return {
      name: typeof manifest.name === 'string' ? manifest.name : '',
      optionsPage: manifest.options_ui?.page || manifest.options_page || '',
      sharedSettings: manifest.orbit?.sharedSettings === true,
    };
  } catch {
    return { name: '', optionsPage: '', sharedSettings: false };
  }
}

export function createSharedSettingsStore(file) {
  let state = { settings: {}, pushed: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') {
      state = {
        settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
        pushed: raw.pushed && typeof raw.pushed === 'object' ? raw.pushed : {},
      };
    }
  } catch {
    /* premier lancement */
  }

  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[orbit] réglages partagés non enregistrés :', err.message);
    }
  };

  const pushedRev = (partition, key) => state.pushed[partition]?.[key] || 0;

  const markPushed = (partition, key, rev) => {
    if (pushedRev(partition, key) >= rev) return;
    state.pushed[partition] = { ...state.pushed[partition], [key]: rev };
    save();
  };

  return {
    get(key) {
      return state.settings[key] || null;
    },

    // Nouvelle copie de référence, venue de `fromPartition` (qui l'a donc
    // déjà). Renvoie la révision, ou null si rien n'a changé ou si la donnée
    // est invalide / trop lourde.
    update(key, data, fromPartition) {
      if (!key || !data || typeof data !== 'object' || Array.isArray(data)) return null;
      if (JSON.stringify(data).length > MAX_SHARED_BYTES) return null;
      const current = state.settings[key];
      if (current && JSON.stringify(current.data) === JSON.stringify(data)) {
        if (fromPartition) markPushed(fromPartition, key, current.rev);
        return null;
      }
      const rev = (current?.rev || 0) + 1;
      state.settings[key] = { rev, data };
      if (fromPartition) state.pushed[fromPartition] = { ...state.pushed[fromPartition], [key]: rev };
      save();
      return rev;
    },

    // Copie de référence à écrire dans cette session, ou null si elle l'a déjà.
    pending(partition, key) {
      const entry = state.settings[key];
      if (!entry) return null;
      return pushedRev(partition, key) >= entry.rev ? null : entry;
    },

    markPushed,
  };
}
