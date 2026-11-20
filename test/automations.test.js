import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleActions, conditionsMet, inTimeRange, dueTimeRules, dueIntervalRules, rulesForEvent,
  validateAutomation, describeTrigger, sanitizeImportedRules,
} from '../src/lib/automations.js';
import { createAutomationRunner } from '../src/lib/automationRunner.js';
import { validateRule } from '../src/lib/rules.js';

// Lundi 2026-11-16, 09:00 (heure locale).
const LUNDI_9H = new Date(2026, 10, 16, 9, 0, 0);
const at = (h, m = 0, day = 16) => new Date(2026, 10, day, h, m, 0);

// --- Format et compatibilité ----------------------------------------------

test('ancienne règle horaire lue comme « changer de profil »', () => {
  assert.deepEqual(ruleActions({ trigger: 'time', at: '09:00', targetProfileId: 'work' }), [
    { type: 'switchProfile', profileId: 'work' },
  ]);
  assert.deepEqual(ruleActions({ trigger: 'time', actions: [{ type: 'nope' }, { type: 'markAllRead' }] }), [
    { type: 'markAllRead' },
  ]);
});

// --- Conditions -------------------------------------------------------------

test('plage horaire, y compris à cheval sur minuit', () => {
  assert.equal(inTimeRange({ from: '09:00', to: '18:00' }, at(10)), true);
  assert.equal(inTimeRange({ from: '09:00', to: '18:00' }, at(18)), false);
  assert.equal(inTimeRange({ from: '22:00', to: '07:00' }, at(23)), true);
  assert.equal(inTimeRange({ from: '22:00', to: '07:00' }, at(6)), true);
  assert.equal(inTimeRange({ from: '22:00', to: '07:00' }, at(12)), false);
});

test('conditions : jours, plage, profil actif', () => {
  const rule = { conditions: { days: [1], between: { from: '08:00', to: '12:00' }, profileId: 'work' } };
  assert.equal(conditionsMet(rule, { now: LUNDI_9H, activeProfile: 'work' }), true);
  assert.equal(conditionsMet(rule, { now: LUNDI_9H, activeProfile: 'home' }), false);
  assert.equal(conditionsMet(rule, { now: at(9, 0, 17), activeProfile: 'work' }), false); // mardi
  assert.equal(conditionsMet(rule, { now: at(13), activeProfile: 'work' }), false);
});

// --- Quand partir -----------------------------------------------------------

test('heure : nouvelle forme avec actions et conditions', () => {
  const rule = { id: 'a', trigger: 'time', at: '09:00', actions: [{ type: 'markAllRead' }], conditions: { profileId: 'work' } };
  assert.equal(dueTimeRules([rule], { now: LUNDI_9H, activeProfile: 'work' }).length, 1);
  assert.equal(dueTimeRules([rule], { now: LUNDI_9H, activeProfile: 'home' }).length, 0);
});

test('intervalle : attend un intervalle complet, puis se répète', () => {
  const rule = { id: 'i', trigger: 'interval', every: 15, actions: [{ type: 'markAllRead' }] };
  const start = LUNDI_9H.getTime();
  assert.equal(dueIntervalRules([rule], { now: at(9, 5), startedAt: start }).length, 0);
  assert.equal(dueIntervalRules([rule], { now: at(9, 15), startedAt: start }).length, 1);
  const lastRun = { i: at(9, 15).getTime() };
  assert.equal(dueIntervalRules([rule], { now: at(9, 20), startedAt: start, lastRun }).length, 0);
  assert.equal(dueIntervalRules([rule], { now: at(9, 30), startedAt: start, lastRun }).length, 1);
});

test('événements : filtre par app / profil, « toutes » sans filtre', () => {
  const rules = [
    { id: '1', trigger: 'appOpen', appId: 'slack', actions: [{ type: 'markAllRead' }] },
    { id: '2', trigger: 'appOpen', appId: '', actions: [{ type: 'markAllRead' }] },
    { id: '3', trigger: 'profileSwitch', profileId: 'work', actions: [{ type: 'markAllRead' }] },
    { id: '4', trigger: 'online', actions: [{ type: 'markAllRead' }], enabled: false },
  ];
  assert.deepEqual(rulesForEvent(rules, { type: 'appOpen', appId: 'slack' }).map((r) => r.id), ['1', '2']);
  assert.deepEqual(rulesForEvent(rules, { type: 'appOpen', appId: 'mail' }).map((r) => r.id), ['2']);
  assert.deepEqual(rulesForEvent(rules, { type: 'profileSwitch', profileId: 'work' }).map((r) => r.id), ['3']);
  assert.deepEqual(rulesForEvent(rules, { type: 'online' }), []);
  assert.deepEqual(rulesForEvent(rules, { type: 'link' }), []);
});

// --- Validation -------------------------------------------------------------

test('validation des automatisations', () => {
  const ok = { trigger: 'interval', every: 10, actions: [{ type: 'reloadApp', appId: '@active' }] };
  assert.deepEqual(validateAutomation(ok), []);
  assert.ok(validateAutomation({ ...ok, every: 0 }).includes('auto.err.interval'));
  assert.ok(validateAutomation({ ...ok, actions: [] }).includes('auto.err.noAction'));
  assert.ok(validateAutomation({ ...ok, actions: [{ type: 'wait', seconds: 5 }] }).includes('auto.err.noAction'));
  assert.ok(validateAutomation({ ...ok, actions: [{ type: 'openUrl', url: 'javascript:alert(1)' }] }).includes('auto.err.url'));
  assert.ok(validateAutomation({ ...ok, actions: [{ type: 'split', appIds: ['a', 'a'] }] }).includes('auto.err.splitApps'));
  assert.ok(validateAutomation({ ...ok, actions: [{ type: 'wait', seconds: 9999 }, { type: 'markAllRead' }] }).includes('auto.err.wait'));
  assert.ok(validateAutomation({ ...ok, conditions: { between: { from: 'x', to: '10:00' } } }).includes('auto.err.between'));
  // validateRule (rules.js) délègue aux automatisations
  assert.deepEqual(validateRule(ok), []);
});

test('description du déclencheur', () => {
  const names = { app: (id) => ({ slack: 'Slack' }[id]), profile: () => 'Travail' };
  assert.deepEqual(describeTrigger({ trigger: 'appOpen', appId: 'slack' }, names), {
    key: 'auto.when.appOpen', vars: { app: 'Slack' },
  });
  assert.equal(describeTrigger({ trigger: 'startup' }).key, 'auto.when.startup');
});

test('import : identifiants régénérés, règles invalides écartées', () => {
  const res = sanitizeImportedRules(
    { rules: [
      { id: 'x', trigger: 'startup', actions: [{ type: 'markAllRead' }] },
      { trigger: 'startup', actions: [] },
      'n’importe quoi',
      { trigger: 'link', pattern: 'a.test', action: 'external' },
    ] },
    { validateLink: validateRule },
  );
  assert.equal(res.rules.length, 2);
  assert.equal(res.rejected, 2);
  assert.notEqual(res.rules[0].id, 'x');
  assert.equal(sanitizeImportedRules({}).error, 'auto.err.importFormat');
});

// --- Exécution --------------------------------------------------------------

function fakeStore(extra = {}) {
  const state = {
    activeProfile: 'home',
    activeApp: 'mail',
    profiles: [{ id: 'home' }, { id: 'work' }],
    apps: [
      { id: 'mail', profileId: 'home', url: 'https://mail.test' },
      { id: 'slack', profileId: 'work', url: 'https://slack.test', sleeping: true },
      { id: 'music', profileId: 'home', url: 'https://music.test' },
      { id: 'docs', profileId: 'home', url: 'https://docs.test' },
    ],
    flyPages: [],
    splitView: null,
    workspaces: [],
    rules: [],
    settings: {},
    calls: [],
    ...extra,
  };
  const log = (name, ...args) => state.calls.push([name, ...args]);
  Object.assign(state, {
    setActiveProfile: (id) => { log('profile', id); state.activeProfile = id; },
    setActiveApp: (id) => { log('app', id); state.activeApp = id; },
    toggleAppSleep: (id) => {
      log('sleep', id);
      state.apps = state.apps.map((a) => (a.id === id ? { ...a, sleeping: !a.sleeping } : a));
    },
    updateApp: (id, patch) => log('update', id, patch),
    openFlyPage: (url, opts) => { log('fly', url, opts); return /^https?:/.test(url) ? 'fly-1' : null; },
    setSplitView: (v) => log('split', v),
    clearSplitView: () => log('clearSplit'),
    applyWorkspace: (id) => log('workspace', id),
    markAllRead: () => log('read'),
    updateSettings: (p) => log('settings', p),
  });
  return state;
}

const makeRunner = (state, extraApi = {}) =>
  createAutomationRunner({
    getState: () => state,
    reloadApp: (id) => state.calls.push(['reload', id]),
    notify: (title) => state.calls.push(['notify', title]),
    setThemeMode: (mode) => state.calls.push(['theme', mode]),
    sleep: async () => {},
    now: () => LUNDI_9H.getTime(),
    ...extraApi,
  });

test('exécution : enchaîne les actions, réveille et ouvre une app d’un autre profil', async () => {
  const st = fakeStore();
  const runner = makeRunner(st);
  const res = await runner.run({ id: 'r', actions: [
    { type: 'openApp', appId: 'slack' },
    { type: 'reloadApp', appId: '@active' },
    { type: 'notify', title: 'Bonjour' },
  ] });
  assert.equal(res.ok, true);
  assert.deepEqual(st.calls, [
    ['sleep', 'slack'], ['profile', 'work'], ['app', 'slack'], ['reload', 'slack'], ['notify', 'Bonjour'],
  ]);
});

test('exécution : une action en échec n’arrête pas les suivantes', async () => {
  const st = fakeStore();
  const res = await makeRunner(st).run({ id: 'r', actions: [
    { type: 'openApp', appId: 'supprimée' },
    { type: 'markAllRead' },
  ] });
  assert.equal(res.ok, false);
  assert.equal(res.errors[0].error, 'auto.err.missingApp');
  assert.deepEqual(st.calls, [['read']]);
});

test('veille des autres apps : épargne l’active, le partage et la musique', async () => {
  const st = fakeStore({ splitView: { appIds: ['mail', 'docs'] } });
  st.apps.push({ id: 'news', profileId: 'home' });
  await makeRunner(st, { isPlaying: (id) => id === 'music' }).run({ id: 'r', actions: [{ type: 'sleepOthers' }] });
  assert.deepEqual(st.calls, [['sleep', 'news']]);
});

test('pas de cascade ni de rafale sur les événements', async () => {
  const st = fakeStore();
  st.rules = [{ id: 'loop', trigger: 'appOpen', appId: '', actions: [{ type: 'openApp', appId: 'mail' }] }];
  const runner = makeRunner(st);
  // Pendant l'exécution, un autre événement est ignoré.
  const first = runner.dispatch({ type: 'appOpen', appId: 'docs' });
  assert.equal(first.length, 1);
  assert.deepEqual(runner.dispatch({ type: 'appOpen', appId: 'mail' }), []);
  await Promise.all(first);
  // Puis le délai de grâce empêche la rafale.
  assert.deepEqual(runner.dispatch({ type: 'appOpen', appId: 'mail' }), []);
});

test('tick : heures et intervalles', async () => {
  const st = fakeStore();
  st.rules = [{ id: 't', trigger: 'time', at: '09:00', actions: [{ type: 'setThemeMode', mode: 'dark' }] }];
  const runs = makeRunner(st).tick();
  assert.equal(runs.length, 1);
  await Promise.all(runs);
  assert.deepEqual(st.calls, [['theme', 'dark']]);
});
