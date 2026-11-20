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

import {
  EVENT_TRIGGERS,
  parseTimeOfDay,
  dueTimeRules,
  validateAutomation,
  describeTrigger,
} from './automations.js';

// Les déclencheurs « événement » (heure, intervalle, ouverture d'app…) et
// leur moteur vivent dans automations.js ; ce module garde les règles de
// liens, que le processus principal évalue au clic. Les fonctions horaires
// sont ré-exportées ici pour les appelants historiques.
export { parseTimeOfDay, dueTimeRules };

export const TRIGGERS = ['link', ...EVENT_TRIGGERS];
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

  if (rule.trigger !== 'link' && TRIGGERS.includes(rule.trigger)) {
    // Ancienne règle horaire sans action : le message historique, plus clair.
    if (rule.trigger === 'time' && !Array.isArray(rule.actions) && !rule.targetProfileId) {
      if (parseTimeOfDay(rule.at) === null) errors.push('rules.err.time');
      errors.push('rules.err.targetProfile');
      return errors;
    }
    errors.push(...validateAutomation(rule));
  }

  return errors;
}

export const isValidRule = (rule) => validateRule(rule).length === 0;

// Description lisible d'une règle, pour la liste des réglages. Renvoie des
// clés + variables, que l'appelant traduit.
export function describeRule(rule, names) {
  if (rule.trigger === 'link') {
    return { key: `rules.desc.${rule.action}`, vars: { pattern: rule.pattern } };
  }
  if (rule.trigger === 'time' && !Array.isArray(rule.actions)) {
    return { key: 'rules.desc.time', vars: { at: rule.at } };
  }
  return describeTrigger(rule, names);
}
