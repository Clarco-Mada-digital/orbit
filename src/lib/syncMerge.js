// ---------------------------------------------------------------------------
// Fusion de configuration entre machines — LOGIQUE PURE, aucune dépendance.
//
// Le modèle est volontairement simple et prévisible plutôt que parfait : du
// « dernier écrivain gagne » PAR ENTITÉ (et non par fichier), plus des pierres
// tombales pour que les suppressions se propagent.
//
// Pourquoi pas un fichier entier en dernier-écrivain-gagne ? Parce qu'ajouter
// une app sur le portable pendant qu'on en renomme une sur le fixe ferait
// perdre l'une des deux modifications. Par entité, les deux survivent.
//
// Pourquoi pas un CRDT ? Parce que les conflits réels sont rares (un seul
// utilisateur, quelques machines) et qu'un CRDT rendrait la configuration
// illisible et indébogable. Le coût du modèle simple : si la MÊME app est
// modifiée sur deux machines hors ligne, la modification la plus récente
// écrase l'autre. C'est assumé et signalé dans le résumé de fusion.
//
// CE QUI NE SE SYNCHRONISE PAS, volontairement :
//   - `url` (page courante) : propre à chaque machine, la synchroniser
//     téléporterait l'onglet d'un poste à l'autre en pleine lecture.
//   - `unread`, `sleeping`, `activeApp`, `splitView`, `trash` : état transitoire.
//   - `extensions` : leur `path` pointe un dossier local, inutile ailleurs.
// ---------------------------------------------------------------------------

export const SYNC_FORMAT = 1;

// Entités synchronisées, et champs retenus pour chacune. Tout champ absent de
// cette liste reste purement local.
const APP_FIELDS = [
  'id', 'profileId', 'sessionKey', 'recipeId', 'name', 'homeUrl', 'icon',
  'color', 'favicon', 'order', 'zoom', 'scope', 'containerId', 'proxy',
  'userAgent', 'notifications', 'favorite',
];
const PROFILE_FIELDS = ['id', 'name', 'emoji', 'color', 'proxy'];
const CONTAINER_FIELDS = ['id', 'name', 'color'];
const WORKSPACE_FIELDS = ['id', 'name', 'profileId', 'activeApp', 'splitView'];
const RULE_FIELDS = [
  'id', 'enabled', 'trigger', 'pattern', 'action', 'targetAppId', 'fromAppId',
  'at', 'days', 'targetProfileId', 'order',
];

export const SYNC_COLLECTIONS = {
  profiles: PROFILE_FIELDS,
  apps: APP_FIELDS,
  containers: CONTAINER_FIELDS,
  workspaces: WORKSPACE_FIELDS,
  // Les automatisations voyagent : une règle de routage de liens a autant de
  // sens sur le portable que sur le fixe.
  rules: RULE_FIELDS,
};

// Les pierres tombales sont purgées au-delà de ce délai : passé un mois, toutes
// les machines ont forcément vu la suppression. Sans purge, le fichier de
// synchronisation grossirait indéfiniment.
export const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Le fichier de synchronisation transite par un dossier partagé : son contenu
// n'est PAS de confiance. Un identifiant d'entité valant « __proto__ » écrit
// dans un objet ordinaire polluerait Object.prototype de toute l'application.
// Les pierres tombales sont donc indexées par identifiant venu du distant :
// on refuse les clefs dangereuses et on part d'un objet sans prototype.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const isSafeKey = (k) => typeof k === 'string' && k.length > 0 && !UNSAFE_KEYS.has(k);
export const emptyDict = () => Object.create(null);

// Ne garde que les champs synchronisables d'une entité, + son horodatage.
function pick(entity, fields, now) {
  const out = {};
  for (const f of fields) {
    if (entity[f] !== undefined) out[f] = entity[f];
  }
  // Une entité jamais modifiée depuis l'activation de la synchronisation n'a
  // pas d'horodatage : on lui en donne un, sinon elle perdrait tous les
  // arbitrages face à une entité distante horodatée.
  out.updatedAt = num(entity.updatedAt) || now;
  return out;
}

// Construit l'instantané à publier à partir de l'état du store.
export function buildSnapshot(state, { deviceId, deviceName, now = Date.now() } = {}) {
  const snap = {
    orbitSync: SYNC_FORMAT,
    deviceId: deviceId || '',
    deviceName: deviceName || '',
    updatedAt: now,
    settings: isObj(state.settings) ? { ...state.settings } : {},
    settingsUpdatedAt: num(state.settingsUpdatedAt) || now,
    tombstones: mergeTombstones(state.tombstones, null, now),
  };
  for (const [key, fields] of Object.entries(SYNC_COLLECTIONS)) {
    const list = Array.isArray(state[key]) ? state[key] : [];
    snap[key] = list.map((e) => pick(e, fields, now));
  }
  return snap;
}

// Un instantané distant est-il exploitable ? (fichier d'une version future,
// tronqué par une synchro cloud interrompue, ou tout simplement pas un
// instantané Orbit)
export function isValidSnapshot(snap) {
  return Boolean(
    isObj(snap) &&
      snap.orbitSync === SYNC_FORMAT &&
      Object.keys(SYNC_COLLECTIONS).every((k) => Array.isArray(snap[k]))
  );
}

// Fusionne deux listes d'entités par identifiant.
// Renvoie la liste fusionnée + le détail de ce qui a bougé.
function mergeList(localList, remoteList, fields, tombstones, now) {
  const byId = new Map();
  const stats = { added: 0, updated: 0, removed: 0 };

  for (const e of localList) {
    if (e && isSafeKey(e.id)) byId.set(e.id, { entity: pick(e, fields, now), from: 'local' });
  }

  for (const r of remoteList) {
    if (!r || !isSafeKey(r.id)) continue;
    const remote = pick(r, fields, now);
    const current = byId.get(r.id);
    if (!current) {
      byId.set(r.id, { entity: remote, from: 'remote' });
      stats.added += 1;
    } else if (remote.updatedAt > current.entity.updatedAt) {
      // Le distant est plus récent : il gagne. On remplace l'entité ENTIÈRE
      // plutôt que de fusionner champ à champ — un renommage suivi d'un
      // changement d'icône doit arriver en bloc, pas en panaché.
      byId.set(r.id, { entity: remote, from: 'remote' });
      stats.updated += 1;
    }
  }

  // Les suppressions l'emportent si elles sont postérieures à la dernière
  // modification connue de l'entité.
  for (const [id, { entity }] of [...byId]) {
    const deletedAt = num(tombstones[id]);
    if (deletedAt && deletedAt >= entity.updatedAt) {
      byId.delete(id);
      stats.removed += 1;
    }
  }

  return { list: [...byId.values()].map((v) => v.entity), stats };
}

// Union des pierres tombales, en gardant la date la plus récente, et purge de
// celles qui ont dépassé leur durée de vie.
export function mergeTombstones(a, b, now = Date.now()) {
  const out = emptyDict();
  for (const src of [a, b]) {
    if (!isObj(src)) continue;
    for (const [id, at] of Object.entries(src)) {
      // Clef venue d'un fichier qu'on ne contrôle pas : on l'écarte plutôt que
      // de risquer une pollution de prototype.
      if (!isSafeKey(id)) continue;
      const t = num(at);
      if (!t || now - t > TOMBSTONE_TTL_MS) continue;
      if (!out[id] || t > out[id]) out[id] = t;
    }
  }
  return out;
}

// Fusionne l'état local avec un instantané distant.
//
// `remote` peut être null (première synchronisation, ou dossier vide) : on
// renvoie alors simplement l'état local normalisé — il n'y a rien à arbitrer.
//
// Renvoie { snapshot, changes } où `changes` résume ce qui a été repris du
// distant, pour l'afficher à l'utilisateur.
export function mergeSnapshots(local, remote, { now = Date.now() } = {}) {
  const base = buildSnapshot(local, { deviceId: local.deviceId, deviceName: local.deviceName, now });

  if (!isValidSnapshot(remote)) {
    return {
      snapshot: { ...base, tombstones: mergeTombstones(base.tombstones, null, now) },
      changes: { first: true, settings: false, collections: {} },
    };
  }

  const tombstones = mergeTombstones(base.tombstones, remote.tombstones, now);
  const merged = { ...base, tombstones, updatedAt: now };
  const collections = {};

  for (const [key, fields] of Object.entries(SYNC_COLLECTIONS)) {
    const { list, stats } = mergeList(base[key], remote[key], fields, tombstones, now);
    merged[key] = list;
    collections[key] = stats;
  }

  // Les réglages sont un bloc : les fusionner clé à clé mélangerait des
  // préférences cohérentes entre elles (thème + couleur d'accent, par ex.).
  const remoteSettingsAt = num(remote.settingsUpdatedAt);
  const takeRemoteSettings = remoteSettingsAt > num(base.settingsUpdatedAt) && isObj(remote.settings);
  if (takeRemoteSettings) {
    merged.settings = { ...remote.settings };
    merged.settingsUpdatedAt = remoteSettingsAt;
  }

  return {
    snapshot: merged,
    changes: { first: false, settings: takeRemoteSettings, collections },
  };
}

// Réconcilie un instantané avec les entités LOCALES avant de l'appliquer.
//
// Un instantané ne transporte que les champs synchronisés (voir `pick`) : il
// ignore volontairement `url`, `unread`, `sleeping`, `favicon`, `iconImage`,
// `signedOut`… Appliquer l'instantané tel quel remplacerait les entités
// locales par ces versions amputées — chaque synchronisation effacerait donc
// la page courante, les compteurs de non-lus, les icônes téléversées et l'état
// de veille de TOUTES les apps.
//
// On superpose donc les champs synchronisés SUR l'entité locale existante :
// le distant gagne sur ce qui voyage, le local garde le reste.
export function reconcileLocal(localList, snapshotList) {
  const byId = new Map((localList || []).map((e) => [e.id, e]));
  return (snapshotList || []).map((entity) => {
    const local = byId.get(entity.id);
    return local ? { ...local, ...entity } : entity;
  });
}

// Y a-t-il réellement quelque chose de nouveau à appliquer localement ?
// Sert à n'écrire dans le store (donc à ne re-rendre l'interface) que si
// nécessaire — une synchronisation périodique à vide doit être invisible.
export function hasIncomingChanges(changes) {
  if (!changes || changes.first) return false;
  if (changes.settings) return true;
  return Object.values(changes.collections || {}).some(
    (s) => s.added > 0 || s.updated > 0 || s.removed > 0
  );
}

// Résumé lisible : { added, updated, removed } tous types confondus.
export function summarize(changes) {
  const total = { added: 0, updated: 0, removed: 0 };
  for (const s of Object.values(changes?.collections || {})) {
    total.added += s.added;
    total.updated += s.updated;
    total.removed += s.removed;
  }
  return total;
}
