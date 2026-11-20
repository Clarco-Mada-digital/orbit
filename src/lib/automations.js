// ---------------------------------------------------------------------------
// Automatisations « Quand… / Si… / Alors… » — MOTEUR PUR, aucune dépendance.
//
// Une automatisation est une donnée :
//
//   {
//     id, name, enabled,
//     trigger: 'time' | 'interval' | 'startup' | 'appOpen' | 'profileSwitch'
//            | 'unread' | 'online' | 'offline',
//     …paramètres du déclencheur (at, days, every, appId, profileId),
//     conditions: { days?: [0-6], between?: { from, to }, profileId? },
//     actions: [{ type, …paramètres }],
//   }
//
// Le moteur dit QUAND une automatisation doit partir et vérifie qu'elle est
// bien formée ; l'exécution des actions vit dans automationRunner.js. Les
// règles de liens (`trigger: 'link'`) restent dans rules.js : le processus
// principal les évalue de façon synchrone, au clic.
//
// Compatibilité : les anciennes règles horaires `{ trigger: 'time', at, days,
// targetProfileId }` restent valides — `ruleActions` les lit comme une
// automatisation à une seule action « changer de profil ».
// ---------------------------------------------------------------------------

export const EVENT_TRIGGERS = [
  'time',
  'interval',
  'startup',
  'appOpen',
  'profileSwitch',
  'unread',
  'online',
  'offline',
];

// Paramètres attendus par action : le formulaire et la validation en
// découlent. `app` accepte '@active' (l'app affichée au moment de l'action).
export const ACTION_SPECS = {
  switchProfile: { profileId: 'profile' },
  openApp: { appId: 'app' },
  openUrl: { url: 'url', private: 'bool?' },
  reloadApp: { appId: 'appOrActive' },
  sleepApp: { appId: 'appOrActive' },
  wakeApp: { appId: 'app' },
  sleepOthers: {},
  muteApp: { appId: 'appOrActive' },
  unmuteApp: { appId: 'appOrActive' },
  zoomApp: { appId: 'appOrActive', zoom: 'zoom' },
  split: { appIds: 'appPair', direction: 'direction' },
  clearSplit: {},
  applyWorkspace: { workspaceId: 'workspace' },
  markAllRead: {},
  setThemeMode: { mode: 'themeMode' },
  setDnd: { on: 'bool' },
  notify: { title: 'text', body: 'text?' },
  wait: { seconds: 'seconds' },
};
export const ACTION_TYPES = Object.keys(ACTION_SPECS);

export const ACTIVE_APP = '@active';
export const MAX_ACTIONS = 20;
export const MAX_WAIT_SECONDS = 300;
export const MIN_INTERVAL = 1;
export const MAX_INTERVAL = 24 * 60;

// --- Lecture tolérante ------------------------------------------------------

// « 09:00 » → 540 minutes. null si mal formée.
export function parseTimeOfDay(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Actions d'une automatisation, ancien format compris.
export function ruleActions(rule) {
  if (!rule) return [];
  if (Array.isArray(rule.actions)) return rule.actions.filter((a) => a && ACTION_SPECS[a.type]);
  if (rule.trigger === 'time' && rule.targetProfileId) {
    return [{ type: 'switchProfile', profileId: rule.targetProfileId }];
  }
  return [];
}

const enabled = (r) => r && r.enabled !== false;
const isEventRule = (r) => enabled(r) && EVENT_TRIGGERS.includes(r.trigger);

// --- Conditions -------------------------------------------------------------

// Jours actifs : 0 = dimanche (Date.getDay). Liste absente ou vide = tous.
// Les anciennes règles horaires portent `days` au premier niveau.
function daysOf(rule) {
  return rule.conditions?.days || rule.days;
}

// Plage horaire « de 09:00 à 18:00 ». Une plage qui passe minuit (22:00 →
// 07:00) est comprise comme telle.
export function inTimeRange(between, now) {
  if (!between) return true;
  const from = parseTimeOfDay(between.from);
  const to = parseTimeOfDay(between.to);
  if (from === null || to === null) return true;
  const m = now.getHours() * 60 + now.getMinutes();
  if (from === to) return true;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export function conditionsMet(rule, { now = new Date(), activeProfile = null } = {}) {
  const days = daysOf(rule);
  if (Array.isArray(days) && days.length && !days.includes(now.getDay())) return false;
  if (!inTimeRange(rule.conditions?.between, now)) return false;
  const onlyProfile = rule.conditions?.profileId;
  if (onlyProfile && onlyProfile !== activeProfile) return false;
  return true;
}

// --- Quand partir ? ---------------------------------------------------------

// Automatisations horaires à lancer MAINTENANT. `lastRun` (id → horodatage)
// évite de rejouer une règle à chaque passage dans la même minute.
export function dueTimeRules(rules, { now = new Date(), lastRun = {}, windowMs = 90 * 1000, activeProfile = null } = {}) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ts = now.getTime();
  return (rules || []).filter((rule) => {
    if (!isEventRule(rule) || rule.trigger !== 'time') return false;
    if (parseTimeOfDay(rule.at) !== minutes) return false;
    if (!conditionsMet(rule, { now, activeProfile })) return false;
    const previous = lastRun[rule.id];
    return !previous || ts - previous > windowMs;
  });
}

// Automatisations « toutes les N minutes » à lancer maintenant. La première
// exécution attend un intervalle complet après `startedAt` : « recharger
// toutes les 15 min » ne recharge pas tout au démarrage.
export function dueIntervalRules(rules, { now = new Date(), lastRun = {}, startedAt = now.getTime(), activeProfile = null } = {}) {
  const ts = now.getTime();
  return (rules || []).filter((rule) => {
    if (!isEventRule(rule) || rule.trigger !== 'interval') return false;
    const every = Number(rule.every);
    if (!Number.isFinite(every) || every < MIN_INTERVAL) return false;
    const since = lastRun[rule.id] || startedAt;
    if (ts - since < every * 60 * 1000 - 1000) return false;
    return conditionsMet(rule, { now, activeProfile });
  });
}

// Automatisations déclenchées par un ÉVÉNEMENT de l'application :
//   { type: 'startup' | 'online' | 'offline' }
//   { type: 'appOpen', appId }   { type: 'unread', appId }
//   { type: 'profileSwitch', profileId }
export function rulesForEvent(rules, event, { now = new Date(), activeProfile = null } = {}) {
  if (!event || !EVENT_TRIGGERS.includes(event.type)) return [];
  return (rules || []).filter((rule) => {
    if (!isEventRule(rule) || rule.trigger !== event.type) return false;
    if ((rule.trigger === 'appOpen' || rule.trigger === 'unread') && rule.appId && rule.appId !== event.appId) {
      return false;
    }
    if (rule.trigger === 'profileSwitch' && rule.profileId && rule.profileId !== event.profileId) return false;
    return conditionsMet(rule, { now, activeProfile });
  });
}

// --- Validation ------------------------------------------------------------

const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || '').trim());

export function validateAction(action) {
  if (!action || !ACTION_SPECS[action.type]) return 'auto.err.actionType';
  switch (action.type) {
    case 'switchProfile':
      return action.profileId ? null : 'auto.err.profile';
    case 'openApp':
    case 'wakeApp':
      return action.appId ? null : 'auto.err.app';
    case 'reloadApp':
    case 'sleepApp':
    case 'muteApp':
    case 'unmuteApp':
      return action.appId ? null : 'auto.err.app';
    case 'zoomApp': {
      if (!action.appId) return 'auto.err.app';
      const z = Number(action.zoom);
      return Number.isFinite(z) && z >= 0.5 && z <= 3 ? null : 'auto.err.zoom';
    }
    case 'openUrl':
      return isHttpUrl(action.url) ? null : 'auto.err.url';
    case 'split': {
      const ids = Array.isArray(action.appIds) ? action.appIds.filter(Boolean) : [];
      return ids.length === 2 && ids[0] !== ids[1] ? null : 'auto.err.splitApps';
    }
    case 'applyWorkspace':
      return action.workspaceId ? null : 'auto.err.workspace';
    case 'setThemeMode':
      return ['dark', 'light', 'auto'].includes(action.mode) ? null : 'auto.err.theme';
    case 'notify':
      return String(action.title || '').trim() ? null : 'auto.err.notify';
    case 'wait': {
      const s = Number(action.seconds);
      return Number.isFinite(s) && s >= 1 && s <= MAX_WAIT_SECONDS ? null : 'auto.err.wait';
    }
    default:
      return null;
  }
}

export function validateAutomation(rule) {
  const errors = [];
  if (!rule || typeof rule !== 'object') return ['rules.err.empty'];
  if (!EVENT_TRIGGERS.includes(rule.trigger)) return ['rules.err.trigger'];
  if (rule.trigger === 'time' && parseTimeOfDay(rule.at) === null) errors.push('rules.err.time');
  if (rule.trigger === 'interval') {
    const every = Number(rule.every);
    if (!Number.isFinite(every) || every < MIN_INTERVAL || every > MAX_INTERVAL) errors.push('auto.err.interval');
  }
  const between = rule.conditions?.between;
  if (between && (parseTimeOfDay(between.from) === null || parseTimeOfDay(between.to) === null)) {
    errors.push('auto.err.between');
  }
  const actions = ruleActions(rule);
  if (!actions.length) errors.push('auto.err.noAction');
  if (actions.length > MAX_ACTIONS) errors.push('auto.err.tooMany');
  // Une automatisation faite UNIQUEMENT d'attentes ne fait rien.
  if (actions.length && actions.every((a) => a.type === 'wait')) errors.push('auto.err.noAction');
  for (const action of actions) {
    const err = validateAction(action);
    if (err) {
      errors.push(err);
      break;
    }
  }
  return errors;
}

// --- Description lisible ----------------------------------------------------

// Clé + variables du déclencheur, que l'appelant traduit. `names` résout les
// identifiants : { app(id), profile(id) }.
export function describeTrigger(rule, names = {}) {
  const app = (id) => (id ? names.app?.(id) || '?' : '');
  const profile = (id) => (id ? names.profile?.(id) || '?' : '');
  switch (rule.trigger) {
    case 'time':
      return { key: 'auto.when.time', vars: { at: rule.at } };
    case 'interval':
      return { key: 'auto.when.interval', vars: { every: rule.every } };
    case 'appOpen':
      return rule.appId
        ? { key: 'auto.when.appOpen', vars: { app: app(rule.appId) } }
        : { key: 'auto.when.appOpenAny', vars: {} };
    case 'unread':
      return rule.appId
        ? { key: 'auto.when.unread', vars: { app: app(rule.appId) } }
        : { key: 'auto.when.unreadAny', vars: {} };
    case 'profileSwitch':
      return rule.profileId
        ? { key: 'auto.when.profileSwitch', vars: { profile: profile(rule.profileId) } }
        : { key: 'auto.when.profileSwitchAny', vars: {} };
    default:
      return { key: `auto.when.${rule.trigger}`, vars: {} };
  }
}

// --- Import / export ----------------------------------------------------------

// Fichier d'échange : on ne garde que les champs connus, on régénère les
// identifiants, et on ne rejette pas le lot pour une seule règle cassée —
// chacune est validée, les invalides sont comptées à part.
export function sanitizeImportedRules(payload, { validateLink } = {}) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.rules) ? payload.rules : null;
  if (!list) return { rules: [], rejected: 0, error: 'auto.err.importFormat' };
  const rules = [];
  let rejected = 0;
  list.slice(0, 500).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      rejected += 1;
      return;
    }
    const rule = JSON.parse(JSON.stringify(raw));
    rule.id = `rule-${Date.now()}-${i}`;
    rule.enabled = rule.enabled !== false;
    const ok = rule.trigger === 'link'
      ? (validateLink ? validateLink(rule).length === 0 : false)
      : validateAutomation(rule).length === 0;
    if (ok) rules.push(rule);
    else rejected += 1;
  });
  return { rules, rejected, error: null };
}
