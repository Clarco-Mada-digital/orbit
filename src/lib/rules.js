// ---------------------------------------------------------------------------
// Automatisations — MOTEUR PUR, aucune dépendance.
//
// Une règle est un couple déclencheur → action, décrit par des données. Le
// moteur ne fait qu'évaluer ; c'est l'appelant qui exécute l'action. Ça le
// rend entièrement testable, et ça évite qu'une règle mal formée casse
// l'application (une règle invalide est simplement ignorée).
//
// Deux familles de déclencheurs, choisies parce qu'elles répondent à des
// frustrations réelles d'un hub applicatif :
//
//   • `link` — « ce lien s'ouvre dans CETTE app ». Sans ça, un lien Notion
//     cliqué depuis Slack s'ouvre dans le navigateur système, hors du hub et
//     hors de la session déjà connectée.
//   • `time` — « à 9 h, bascule sur le profil Travail ». Le changement de
//     contexte manuel matin et soir est le geste le plus répété.
// ---------------------------------------------------------------------------

export const TRIGGERS = ['link', 'time'];
export const LINK_ACTIONS = ['openInApp', 'flyPage', 'external', 'block'];

// --- Correspondance d'URL --------------------------------------------------

// Motif « glob » volontairement minimal : `*` remplace n'importe quoi. C'est
// ce que les gens écrivent spontanément (`*.github.com/*`), là où une vraie
// expression régulière serait une source d'erreurs silencieuses.
export function globToRegExp(pattern) {
  const escaped = String(pattern || '')
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  if (!escaped) return null;
  try {
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
}

// Un motif sans protocole ni barre oblique vise un DOMAINE : « github.com »
// doit attraper « https://github.com/x/y » sans que l'utilisateur ait à
// écrire « *github.com* ».
function candidatesFor(url) {
  const out = [url];
  try {
    const u = new URL(url);
    out.push(u.hostname, u.hostname.replace(/^www\./, ''), u.hostname + u.pathname);
  } catch {
    /* URL non analysable : on ne compare que la chaîne brute */
  }
  return out;
}

export function urlMatches(pattern, url) {
  const p = String(pattern || '').trim();
  if (!p || !url) return false;
  const re = globToRegExp(p);
  if (!re) return false;
  if (candidatesFor(url).some((c) => re.test(c))) return true;
  // Motif de domaine nu : on autorise aussi les sous-domaines et les chemins.
  if (!/[/:*]/.test(p)) {
    const loose = globToRegExp(`*${p}*`);
    return loose ? loose.test(url) : false;
  }
  return false;
}

// --- Évaluation ------------------------------------------------------------

const enabled = (r) => r && r.enabled !== false;

// Quelle règle décide du sort d'un lien ? La PREMIÈRE qui correspond, dans
// l'ordre de la liste : c'est prévisible et l'utilisateur peut réordonner.
// Renvoie null si aucune ne s'applique (comportement par défaut d'Orbit).
export function matchLinkRule(rules, url, { fromAppId } = {}) {
  if (!url) return null;
  for (const rule of rules || []) {
    if (!enabled(rule) || rule.trigger !== 'link') continue;
    if (!LINK_ACTIONS.includes(rule.action)) continue;
    // Une règle peut se limiter aux liens venant d'une app précise
    if (rule.fromAppId && rule.fromAppId !== fromAppId) continue;
    if (urlMatches(rule.pattern, url)) return rule;
  }
  return null;
}

// « 09:00 » → 540 minutes. Renvoie null si l'heure est mal formée.
export function parseTimeOfDay(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Jours actifs d'une règle : 0 = dimanche, comme Date.getDay().
// Liste absente = tous les jours.
function dayAllowed(rule, date) {
  if (!Array.isArray(rule.days) || rule.days.length === 0) return true;
  return rule.days.includes(date.getDay());
}

// Règles horaires à déclencher MAINTENANT.
//
// `lastRun` (id → horodatage du dernier déclenchement) évite de rejouer une
// règle à chaque tick : sans lui, une règle de 9 h se redéclencherait toutes
// les minutes jusqu'à 9 h 01, et empêcherait tout changement manuel de profil.
export function dueTimeRules(rules, { now = new Date(), lastRun = {}, windowMs = 90 * 1000 } = {}) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ts = now.getTime();
  return (rules || []).filter((rule) => {
    if (!enabled(rule) || rule.trigger !== 'time') return false;
    if (!dayAllowed(rule, now)) return false;
    const at = parseTimeOfDay(rule.at);
    if (at === null || at !== minutes) return false;
    // Déjà déclenchée dans la fenêtre courante ?
    const previous = lastRun[rule.id];
    return !previous || ts - previous > windowMs;
  });
}

// --- Validation ------------------------------------------------------------

// Une règle incomplète ne doit jamais atteindre le moteur : elle produirait
// des comportements inexplicables (un motif vide attraperait tout, un
// `openInApp` sans cible ouvrirait le vide).
export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') return ['rules.err.empty'];
  if (!TRIGGERS.includes(rule.trigger)) errors.push('rules.err.trigger');

  if (rule.trigger === 'link') {
    if (!String(rule.pattern || '').trim()) errors.push('rules.err.pattern');
    if (!LINK_ACTIONS.includes(rule.action)) errors.push('rules.err.action');
    if (rule.action === 'openInApp' && !rule.targetAppId) errors.push('rules.err.targetApp');
  }

  if (rule.trigger === 'time') {
    if (parseTimeOfDay(rule.at) === null) errors.push('rules.err.time');
    if (!rule.targetProfileId) errors.push('rules.err.targetProfile');
  }

  return errors;
}

export const isValidRule = (rule) => validateRule(rule).length === 0;

// Description lisible d'une règle, pour la liste des réglages. Renvoie des
// clés + variables, que l'appelant traduit.
export function describeRule(rule) {
  if (rule.trigger === 'link') {
    return { key: `rules.desc.${rule.action}`, vars: { pattern: rule.pattern } };
  }
  return { key: 'rules.desc.time', vars: { at: rule.at } };
}
