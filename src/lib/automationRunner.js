// ---------------------------------------------------------------------------
// Exécution des automatisations (voir automations.js pour le « quand »).
//
// Le moteur d'exécution ne connaît Orbit qu'à travers `api` — l'état du store
// et quelques effets (recharger une page, notifier, attendre). C'est ce qui
// permet de le tester sans Electron ni React (test/automationRunner.test.js).
//
//   api = {
//     getState(),                      // état zustand, actions comprises
//     reloadApp(appId, url),
//     notify(title, body),
//     setThemeMode(mode),
//     isPlaying?(appId),               // média en lecture → pas de veille
//     sleep?(ms),                      // attente (injectable pour les tests)
//     now?(),
//   }
//
// Garde-fous :
//   • une automatisation lancée PAR un événement ne peut pas en déclencher
//     d'autres pendant qu'elle s'exécute (« quand Slack s'ouvre → ouvrir
//     Slack » ne boucle pas) ;
//   • une même automatisation d'événement ne repart pas avant `cooldownMs` ;
//   • une action qui échoue (app supprimée…) est notée, les suivantes
//     s'exécutent quand même.
// ---------------------------------------------------------------------------
import {
  ACTIVE_APP,
  MAX_WAIT_SECONDS,
  ruleActions,
  rulesForEvent,
  dueTimeRules,
  dueIntervalRules,
} from './automations.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAutomationRunner(api, { cooldownMs = 3000, onLog = () => {} } = {}) {
  const sleep = api.sleep || defaultSleep;
  const now = api.now || (() => Date.now());
  const lastRun = {}; // id → horodatage (tout déclencheur)
  const startedAt = now();
  let running = 0;

  const allApps = (st) => [...(st.apps || []), ...(st.flyPages || [])];
  const findApp = (st, id) => {
    const real = id === ACTIVE_APP ? st.activeApp : id;
    return real ? allApps(st).find((a) => a.id === real) || null : null;
  };

  // Une action → null si tout va bien, sinon un code d'erreur lisible.
  async function runAction(action) {
    const st = api.getState();
    switch (action.type) {
      case 'switchProfile': {
        if (!(st.profiles || []).some((p) => p.id === action.profileId)) return 'auto.err.missingProfile';
        st.setActiveProfile(action.profileId);
        return null;
      }
      case 'openApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        if (app.sleeping) st.toggleAppSleep(app.id);
        // Une app d'un autre profil : on va dans son profil (sauf portée
        // « tous les profils », visible partout).
        if (app.scope !== 'all' && app.profileId && app.profileId !== st.activeProfile) {
          st.setActiveProfile(app.profileId);
        }
        api.getState().setActiveApp(app.id);
        return null;
      }
      case 'openUrl': {
        const id = st.openFlyPage(String(action.url || '').trim(), { private: Boolean(action.private) });
        return id ? null : 'auto.err.url';
      }
      case 'reloadApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        if (app.sleeping || app.native) return null;
        api.reloadApp(app.id, app.url);
        return null;
      }
      case 'sleepApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        if (!app.sleeping && (st.apps || []).some((a) => a.id === app.id)) st.toggleAppSleep(app.id);
        return null;
      }
      case 'wakeApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        if (app.sleeping) st.toggleAppSleep(app.id);
        return null;
      }
      case 'sleepOthers': {
        // Jamais : l'app affichée, celles de l'écran partagé, celles qui jouent.
        const keep = new Set([st.activeApp, ...(st.splitView?.appIds || [])]);
        for (const app of st.apps || []) {
          if (app.sleeping || keep.has(app.id)) continue;
          if (api.isPlaying?.(app.id)) continue;
          api.getState().toggleAppSleep(app.id);
        }
        return null;
      }
      case 'muteApp':
      case 'unmuteApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        st.updateApp(app.id, { muted: action.type === 'muteApp' });
        return null;
      }
      case 'zoomApp': {
        const app = findApp(st, action.appId);
        if (!app) return 'auto.err.missingApp';
        const zoom = Math.min(3, Math.max(0.5, Number(action.zoom) || 1));
        st.updateApp(app.id, { zoom });
        return null;
      }
      case 'split': {
        const ids = (action.appIds || []).filter((id) => findApp(st, id));
        if (ids.length !== 2) return 'auto.err.missingApp';
        st.setSplitView({
          appIds: ids,
          direction: action.direction === 'col' ? 'col' : 'row',
          sizes: [0.5, 0.5],
        });
        api.getState().setActiveApp(ids[0]);
        return null;
      }
      case 'clearSplit':
        st.clearSplitView();
        return null;
      case 'applyWorkspace': {
        if (!(st.workspaces || []).some((w) => w.id === action.workspaceId)) return 'auto.err.missingWorkspace';
        st.applyWorkspace(action.workspaceId);
        return null;
      }
      case 'markAllRead':
        st.markAllRead();
        return null;
      case 'setThemeMode':
        api.setThemeMode?.(action.mode);
        return null;
      case 'setDnd':
        st.updateSettings({ dnd: Boolean(action.on) });
        return null;
      case 'notify':
        api.notify?.(String(action.title || '').slice(0, 120), String(action.body || '').slice(0, 500));
        return null;
      case 'wait': {
        const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number(action.seconds) || 1));
        await sleep(seconds * 1000);
        return null;
      }
      default:
        return 'auto.err.actionType';
    }
  }

  // Exécute une automatisation, action par action. `reason` : 'manual',
  // 'time', 'interval' ou le type d'événement.
  async function run(rule, reason = 'manual') {
    lastRun[rule.id] = now();
    running += 1;
    const errors = [];
    try {
      for (const action of ruleActions(rule)) {
        try {
          const err = await runAction(action);
          if (err) errors.push({ type: action.type, error: err });
        } catch (e) {
          errors.push({ type: action.type, error: 'auto.err.crash', detail: String(e?.message || e) });
        }
      }
    } finally {
      running -= 1;
    }
    const entry = { ruleId: rule.id, name: rule.name || '', reason, at: now(), ok: errors.length === 0, errors };
    onLog(entry);
    return entry;
  }

  // Événement de l'application → automatisations correspondantes.
  function dispatch(event) {
    if (running > 0) return []; // pas de cascade
    const st = api.getState();
    const t = now();
    const due = rulesForEvent(st.rules, event, { now: new Date(t), activeProfile: st.activeProfile })
      .filter((rule) => !lastRun[rule.id] || t - lastRun[rule.id] >= cooldownMs);
    return due.map((rule) => run(rule, event.type));
  }

  // À appeler régulièrement (≈ toutes les 30 s) : heures et intervalles.
  function tick() {
    const st = api.getState();
    const date = new Date(now());
    const opts = { now: date, lastRun, activeProfile: st.activeProfile };
    const due = [
      ...dueTimeRules(st.rules, opts).map((rule) => [rule, 'time']),
      ...dueIntervalRules(st.rules, { ...opts, startedAt }).map((rule) => [rule, 'interval']),
    ];
    return due.map(([rule, reason]) => run(rule, reason));
  }

  return { run, dispatch, tick, isBusy: () => running > 0 };
}
