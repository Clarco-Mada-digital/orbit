import { useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, ArrowUp, ArrowDown, Zap, AlertCircle, Pencil, Copy, Play, Link2, Clock, X,
  Download, Upload, CheckCircle2, XCircle, History, Sparkles,
  Sunrise, Sunset, Target, Coffee, Moon, Sun, RefreshCw, MemoryStick, Wifi, Rocket, BellRing, LayoutGrid,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../lib/i18n';
import { validateRule, describeRule, LINK_ACTIONS } from '../lib/rules';
import {
  EVENT_TRIGGERS, ACTION_TYPES, ACTIVE_APP, MAX_ACTIONS, ruleActions, sanitizeImportedRules,
} from '../lib/automations';
import { RECIPES } from '../lib/automationRecipes';
import { useAutomationLog, getActiveRunner } from '../lib/automationLog';

// ---------------------------------------------------------------------------
// Réglages → Automatisations.
//
// Deux familles, une seule liste dans le store :
//   • les RÈGLES DE LIENS (« ce lien s'ouvre dans telle app ») — l'ordre
//     compte, la première qui correspond l'emporte ;
//   • les AUTOMATISATIONS « Quand… / Si… / Alors… » — un déclencheur, des
//     conditions facultatives, une suite d'actions.
// Plus : des recettes prêtes à l'emploi, la modification, la duplication, un
// bouton « Tester », le journal des dernières exécutions et l'import/export.
// ---------------------------------------------------------------------------
const DAYS = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche
const RECIPE_ICONS = { Sunrise, Sunset, Target, Coffee, Moon, Sun, RefreshCw, MemoryStick, Wifi, Rocket, BellRing, LayoutGrid };

const blankLink = () => ({ trigger: 'link', pattern: '', action: 'openInApp', targetAppId: '', fromAppId: '' });
const blankAutomation = () => ({
  trigger: 'time',
  at: '09:00',
  name: '',
  conditions: {},
  actions: [{ type: 'notify', title: '', body: '' }],
});

// Valeurs par défaut d'une action, quand on en change le type.
function defaultAction(type, ctx) {
  const app = ctx.apps[0]?.id || '';
  switch (type) {
    case 'switchProfile': return { type, profileId: ctx.profiles[0]?.id || '' };
    case 'openApp':
    case 'wakeApp': return { type, appId: app };
    case 'reloadApp':
    case 'sleepApp':
    case 'muteApp':
    case 'unmuteApp': return { type, appId: ACTIVE_APP };
    case 'zoomApp': return { type, appId: ACTIVE_APP, zoom: 1.2 };
    case 'openUrl': return { type, url: 'https://', private: false };
    case 'split': return { type, appIds: [app, ctx.apps[1]?.id || ''], direction: 'row' };
    case 'applyWorkspace': return { type, workspaceId: ctx.workspaces[0]?.id || '' };
    case 'setThemeMode': return { type, mode: 'dark' };
    case 'setDnd': return { type, on: true };
    case 'notify': return { type, title: '', body: '' };
    case 'wait': return { type, seconds: 5 };
    default: return { type };
  }
}

// Ancienne règle horaire → forme « actions » le temps de l'édition.
function toEditable(rule) {
  if (rule.trigger === 'link') return { ...rule };
  const copy = JSON.parse(JSON.stringify(rule));
  copy.actions = ruleActions(rule);
  copy.conditions = copy.conditions || {};
  if (Array.isArray(copy.days) && copy.days.length && !copy.conditions.days) copy.conditions.days = copy.days;
  delete copy.days;
  delete copy.targetProfileId;
  return copy;
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function RulesSettings() {
  const t = useT();
  const { rules, allApps, profiles, workspaces, addRule, updateRule, deleteRule, moveRule } = useStore(
    useShallow((s) => ({
      rules: s.rules,
      allApps: s.apps,
      profiles: s.profiles,
      workspaces: s.workspaces || [],
      addRule: s.addRule,
      updateRule: s.updateRule,
      deleteRule: s.deleteRule,
      moveRule: s.moveRule,
    })),
  );
  const apps = useMemo(() => allApps.filter((a) => !a.native), [allApps]);
  const ctx = { apps, profiles, workspaces };
  const log = useAutomationLog((s) => s.entries);
  const lastByRule = useAutomationLog((s) => s.lastByRule);

  // { rule, editingId } — editingId null = création
  const [editor, setEditor] = useState(null);
  const [showRecipes, setShowRecipes] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, text }
  const fileRef = useRef(null);

  const linkRules = rules.filter((r) => r.trigger === 'link');
  const autoRules = rules.filter((r) => r.trigger !== 'link');

  const names = {
    app: (id) => (id === ACTIVE_APP ? t('auto.activeApp') : allApps.find((a) => a.id === id)?.name),
    profile: (id) => profiles.find((p) => p.id === id)?.name,
    workspace: (id) => workspaces.find((w) => w.id === id)?.name,
  };

  const open = (rule, editingId = null) => {
    setShowRecipes(false);
    setEditor({ rule: toEditable(rule), editingId });
  };

  const save = (rule) => {
    if (editor.editingId) {
      // Les champs de l'ancien format horaire disparaissent : la règle est
      // réécrite sous la forme « actions ».
      updateRule(
        editor.editingId,
        rule.trigger === 'link' ? rule : { ...rule, days: undefined, targetProfileId: undefined },
      );
    } else {
      addRule(rule);
    }
    setEditor(null);
  };

  // Monter / descendre DANS sa famille (les règles de liens et les
  // automatisations partagent la même liste du store).
  const moveWithin = (rule, dir) => {
    const family = rule.trigger === 'link' ? linkRules : autoRules;
    const i = family.findIndex((r) => r.id === rule.id);
    const neighbour = family[i + dir];
    if (!neighbour) return;
    const steps = Math.abs(rules.indexOf(neighbour) - rules.indexOf(rule));
    for (let k = 0; k < steps; k += 1) moveRule(rule.id, dir);
  };

  const duplicate = (rule) => {
    const copy = JSON.parse(JSON.stringify(rule));
    delete copy.id;
    if (copy.name) copy.name = `${copy.name} (2)`;
    addRule(copy);
  };

  const test = async (rule) => {
    const runner = getActiveRunner();
    if (!runner) return;
    const entry = await runner.run(rule, 'manual');
    setNotice({ ok: entry.ok, text: entry.ok ? t('auto.testOk') : t('auto.testFailed', { n: entry.errors.length }) });
  };

  const exportRules = () => {
    const blob = new Blob([JSON.stringify({ orbitRules: 1, rules }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbit-automatisations-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importRules = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('size');
      const payload = JSON.parse(await file.text());
      const res = sanitizeImportedRules(payload, { validateLink: validateRule });
      if (res.error) throw new Error(res.error);
      res.rules.forEach((r) => addRule(r));
      setNotice({
        ok: res.rejected === 0,
        text: t('auto.imported', { n: res.rules.length, rejected: res.rejected }),
      });
    } catch {
      setNotice({ ok: false, text: t('auto.err.importFormat') });
    }
  };

  const recipeRule = (recipe) => {
    const rule = recipe.build(ctx);
    rule.name = t(`auto.recipe.${recipe.id}`);
    rule.actions = rule.actions.map((a) =>
      a.type === 'notify' && !a.body ? { ...a, body: t(`auto.recipe.${recipe.id}.body`) } : a,
    );
    return rule;
  };

  return (
    <div className="space-y-6">
      {/* En-tête : création, recettes, import / export */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('rules.title')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">{t('auto.intro')}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => open(blankAutomation())} className="btn btn-primary">
            <Plus size={16} /> {t('auto.new')}
          </button>
          <button onClick={() => setShowRecipes((v) => !v)} className="btn btn-secondary">
            <Sparkles size={16} /> {t('auto.recipes')}
          </button>
          <button onClick={() => open(blankLink())} className="btn btn-secondary">
            <Link2 size={16} /> {t('rules.addLink')}
          </button>
          <span className="flex-1" />
          <button onClick={() => fileRef.current?.click()} className="btn btn-secondary" title={t('auto.importDesc')}>
            <Upload size={16} /> {t('auto.import')}
          </button>
          <button onClick={exportRules} disabled={!rules.length} className="btn btn-secondary disabled:opacity-40">
            <Download size={16} /> {t('auto.export')}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importRules} />
        </div>
        {notice && (
          <p className={`text-xs mt-3 flex items-center gap-1.5 ${notice.ok ? 'text-success' : 'text-error'}`}>
            {notice.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />} {notice.text}
            <button onClick={() => setNotice(null)} className="btn-icon ml-1"><X size={12} /></button>
          </p>
        )}

        {showRecipes && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {RECIPES.map((recipe) => {
              const Icon = RECIPE_ICONS[recipe.icon] || Zap;
              return (
                <button
                  key={recipe.id}
                  onClick={() => open(recipeRule(recipe))}
                  className="text-left px-3 py-2.5 rounded-lg border border-border bg-bg-elevated hover:border-accent-primary transition-colors"
                >
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Icon size={15} className="text-accent-primary flex-shrink-0" />
                    {t(`auto.recipe.${recipe.id}`)}
                  </div>
                  <div className="text-xs text-text-muted mt-1">{t(`auto.recipe.${recipe.id}.desc`)}</div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {editor && (
        editor.rule.trigger === 'link' ? (
          <LinkEditor
            initial={editor.rule}
            apps={apps}
            t={t}
            onCancel={() => setEditor(null)}
            onSave={save}
          />
        ) : (
          <AutomationEditor
            initial={editor.rule}
            ctx={ctx}
            t={t}
            onCancel={() => setEditor(null)}
            onSave={save}
          />
        )
      )}

      {/* Automatisations */}
      <div className="card">
        <h5 className="text-xs font-semibold text-text-muted uppercase mb-3 flex items-center gap-1.5">
          <Clock size={13} /> {t('auto.listTitle')}
        </h5>
        {autoRules.length === 0 ? (
          <p className="text-sm text-text-muted italic">{t('auto.empty')}</p>
        ) : (
          <div className="space-y-2">
            {autoRules.map((rule, i) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={autoRules.length}
                t={t}
                names={names}
                last={lastByRule[rule.id]}
                onToggle={(v) => updateRule(rule.id, { enabled: v })}
                onEdit={() => open(rule, rule.id)}
                onDuplicate={() => duplicate(rule)}
                onTest={() => test(rule)}
                onMove={(d) => moveWithin(rule, d)}
                onDelete={() => deleteRule(rule.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Règles de liens */}
      <div className="card">
        <h5 className="text-xs font-semibold text-text-muted uppercase mb-1 flex items-center gap-1.5">
          <Link2 size={13} /> {t('auto.linksTitle')}
        </h5>
        <p className="text-xs text-text-muted mb-3">{t('rules.desc')}</p>
        {linkRules.length === 0 ? (
          <p className="text-sm text-text-muted italic">{t('rules.empty')}</p>
        ) : (
          <div className="space-y-2">
            {linkRules.map((rule, i) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={linkRules.length}
                t={t}
                names={names}
                onToggle={(v) => updateRule(rule.id, { enabled: v })}
                onEdit={() => open(rule, rule.id)}
                onDuplicate={() => duplicate(rule)}
                onMove={(d) => moveWithin(rule, d)}
                onDelete={() => deleteRule(rule.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Journal */}
      {log.length > 0 && (
        <div className="card">
          <h5 className="text-xs font-semibold text-text-muted uppercase mb-3 flex items-center gap-1.5">
            <History size={13} /> {t('auto.history')}
          </h5>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {log.slice(0, 20).map((entry, k) => (
              <div key={`${entry.ruleId}-${entry.at}-${k}`} className="flex items-center gap-2 text-xs">
                {entry.ok ? (
                  <CheckCircle2 size={13} className="text-success flex-shrink-0" />
                ) : (
                  <XCircle size={13} className="text-error flex-shrink-0" />
                )}
                <span className="tabular-nums text-text-muted">{fmtTime(entry.at)}</span>
                <span className="truncate flex-1">{entry.name || entry.ruleId}</span>
                <span className="text-text-muted">{t(`auto.reason.${entry.reason}`)}</span>
                {!entry.ok && (
                  <span className="text-error truncate max-w-[40%]" title={entry.errors.map((e) => t(e.error)).join(' · ')}>
                    {t(entry.errors[0].error)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Une ligne de la liste ---------------------------------------------------
function RuleRow({ rule, index, count, t, names, last, onToggle, onEdit, onDuplicate, onTest, onMove, onDelete }) {
  const isLink = rule.trigger === 'link';
  const d = describeRule(rule, names);
  const actions = isLink ? [] : ruleActions(rule);
  const linkTarget = isLink && rule.action === 'openInApp' ? names.app(rule.targetAppId) : null;
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated ${
        rule.enabled === false ? 'opacity-50' : ''
      }`}
    >
      <input
        type="checkbox"
        checked={rule.enabled !== false}
        onChange={(e) => onToggle(e.target.checked)}
        title={t('rules.toggle')}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        {rule.name && <div className="text-sm font-medium truncate">{rule.name}</div>}
        <div className={`truncate ${rule.name ? 'text-xs text-text-muted' : 'text-sm'}`}>
          {t(d.key, d.vars)}
          {linkTarget ? ` ${t('rules.towards', { target: linkTarget })}` : ''}
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {actions.map((a, k) => (
              <span key={k} className="text-[11px] px-1.5 py-0.5 rounded bg-bg-hover text-text-secondary">
                {describeAction(a, t, names)}
              </span>
            ))}
          </div>
        )}
        {last && (
          <div className={`text-[11px] mt-1 ${last.ok ? 'text-text-muted' : 'text-error'}`}>
            {t(last.ok ? 'auto.lastRunOk' : 'auto.lastRunFailed', { at: fmtTime(last.at) })}
          </div>
        )}
      </div>
      <div className="flex items-center flex-shrink-0">
        {onTest && (
          <button onClick={onTest} className="btn-icon" title={t('auto.test')}>
            <Play size={14} />
          </button>
        )}
        <button onClick={onEdit} className="btn-icon" title={t('auto.edit')}>
          <Pencil size={14} />
        </button>
        <button onClick={onDuplicate} className="btn-icon" title={t('auto.duplicate')}>
          <Copy size={14} />
        </button>
        <button onClick={() => onMove(-1)} disabled={index === 0} className="btn-icon disabled:opacity-30" title={t('rules.moveUp')}>
          <ArrowUp size={14} />
        </button>
        <button onClick={() => onMove(1)} disabled={index === count - 1} className="btn-icon disabled:opacity-30" title={t('rules.moveDown')}>
          <ArrowDown size={14} />
        </button>
        <button onClick={onDelete} className="btn-icon hover:text-error" title={t('common.delete')}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Résumé court d'une action, pour les pastilles de la liste.
function describeAction(a, t, names) {
  const app = (id) => names.app(id) || '?';
  switch (a.type) {
    case 'switchProfile': return t('auto.do.switchProfile', { profile: names.profile(a.profileId) || '?' });
    case 'openApp':
    case 'reloadApp':
    case 'sleepApp':
    case 'wakeApp':
    case 'muteApp':
    case 'unmuteApp': return t(`auto.do.${a.type}`, { app: app(a.appId) });
    case 'zoomApp': return t('auto.do.zoomApp', { app: app(a.appId), zoom: Math.round((Number(a.zoom) || 1) * 100) });
    case 'openUrl': return t('auto.do.openUrl', { url: String(a.url || '').replace(/^https?:\/\//, '').slice(0, 40) });
    case 'split': return t('auto.do.split', { a: app(a.appIds?.[0]), b: app(a.appIds?.[1]) });
    case 'applyWorkspace': return t('auto.do.applyWorkspace', { ws: names.workspace(a.workspaceId) || '?' });
    case 'setThemeMode': return t('auto.do.setThemeMode', { mode: t(`auto.theme.${a.mode}`) });
    case 'setDnd': return t(a.on ? 'auto.do.dndOn' : 'auto.do.dndOff');
    case 'notify': return t('auto.do.notify', { title: a.title || '' });
    case 'wait': return t('auto.do.wait', { s: a.seconds });
    default: return t(`auto.action.${a.type}`);
  }
}

// --- Éditeur d'automatisation ---------------------------------------------
function AutomationEditor({ initial, ctx, t, onCancel, onSave }) {
  const [rule, setRule] = useState(initial);
  const errors = validateRule(rule);
  const set = (patch) => setRule((r) => ({ ...r, ...patch }));
  const setCond = (patch) => setRule((r) => ({ ...r, conditions: { ...(r.conditions || {}), ...patch } }));
  const actions = rule.actions || [];
  const setActions = (next) => set({ actions: next });
  const days = rule.conditions?.days || [];
  const between = rule.conditions?.between;

  const appSelect = (value, onChange, { allowActive = false, allowAny = false } = {}) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="input flex-1 min-w-0">
      {allowAny && <option value="">{t('auto.anyApp')}</option>}
      {!allowAny && !value && <option value="">{t('rules.chooseApp')}</option>}
      {allowActive && <option value={ACTIVE_APP}>{t('auto.activeApp')}</option>}
      {ctx.apps.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  );
  const profileSelect = (value, onChange, { allowAny = false } = {}) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} className="input flex-1 min-w-0">
      <option value="">{allowAny ? t('auto.anyProfile') : t('rules.chooseProfile')}</option>
      {ctx.profiles.map((p) => (
        <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
      ))}
    </select>
  );

  return (
    <div className="card border-accent-primary/50 space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={rule.name || ''}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={t('auto.namePlaceholder')}
          className="input flex-1 font-medium"
          maxLength={80}
        />
        <button onClick={onCancel} className="btn-icon" title={t('common.cancel')}><X size={16} /></button>
      </div>

      {/* QUAND */}
      <section>
        <h6 className="text-xs font-semibold uppercase text-accent-primary mb-2">{t('auto.when')}</h6>
        <div className="flex flex-wrap gap-2">
          <select
            value={rule.trigger}
            // Valeurs par défaut du nouveau déclencheur : un formulaire jamais
            // invalide dès le choix fait.
            onChange={(e) => set({ trigger: e.target.value, at: rule.at || '09:00', every: rule.every || 15 })} className="input flex-1 min-w-[12rem]">
            {EVENT_TRIGGERS.map((tr) => (
              <option key={tr} value={tr}>{t(`auto.trigger.${tr}`)}</option>
            ))}
          </select>
          {rule.trigger === 'time' && (
            <input type="time" value={rule.at || '09:00'} onChange={(e) => set({ at: e.target.value })} className="input" />
          )}
          {rule.trigger === 'interval' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="number"
                min={1}
                max={1440}
                value={rule.every ?? 15}
                onChange={(e) => set({ every: Number(e.target.value) })}
                className="input w-24"
              />
              {t('auto.minutes')}
            </label>
          )}
          {(rule.trigger === 'appOpen' || rule.trigger === 'unread') &&
            appSelect(rule.appId, (v) => set({ appId: v }), { allowAny: true })}
          {rule.trigger === 'profileSwitch' && profileSelect(rule.profileId, (v) => set({ profileId: v }), { allowAny: true })}
        </div>
        <p className="text-xs text-text-muted mt-1">{t(`auto.trigger.${rule.trigger}.help`)}</p>
      </section>

      {/* SI */}
      <section>
        <h6 className="text-xs font-semibold uppercase text-accent-primary mb-2">{t('auto.if')}</h6>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-text-muted w-28">{t('auto.cond.days')}</span>
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setCond({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] })}
                className={`w-9 h-7 rounded text-xs ${days.includes(d) ? 'bg-accent-primary text-white' : 'bg-bg-hover text-text-muted'}`}
              >
                {t(`rules.day.${d}`)}
              </button>
            ))}
            {days.length === 0 && <span className="text-xs text-text-muted ml-2">{t('auto.cond.everyDay')}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-text-muted w-28">
              <input
                type="checkbox"
                checked={Boolean(between)}
                onChange={(e) => setCond({ between: e.target.checked ? { from: '09:00', to: '18:00' } : undefined })}
              />
              {t('auto.cond.between')}
            </label>
            {between && (
              <>
                <input type="time" value={between.from} onChange={(e) => setCond({ between: { ...between, from: e.target.value } })} className="input" />
                <span className="text-xs text-text-muted">→</span>
                <input type="time" value={between.to} onChange={(e) => setCond({ between: { ...between, to: e.target.value } })} className="input" />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted w-28">{t('auto.cond.profile')}</span>
            {profileSelect(rule.conditions?.profileId, (v) => setCond({ profileId: v || undefined }), { allowAny: true })}
          </div>
        </div>
      </section>

      {/* ALORS */}
      <section>
        <h6 className="text-xs font-semibold uppercase text-accent-primary mb-2">{t('auto.then')}</h6>
        <div className="space-y-2">
          {actions.map((action, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-bg-elevated border border-border">
              <span className="text-xs text-text-muted w-5 tabular-nums">{i + 1}</span>
              <select
                value={action.type}
                onChange={(e) => setActions(actions.map((a, k) => (k === i ? defaultAction(e.target.value, ctx) : a)))}
                className="input min-w-[11rem]"
              >
                {ACTION_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`auto.action.${type}`)}</option>
                ))}
              </select>
              <ActionParams
                action={action}
                ctx={ctx}
                t={t}
                appSelect={appSelect}
                profileSelect={profileSelect}
                onChange={(patch) => setActions(actions.map((a, k) => (k === i ? { ...a, ...patch } : a)))}
              />
              <span className="flex items-center ml-auto">
                <button
                  onClick={() => {
                    const next = [...actions];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    setActions(next);
                  }}
                  disabled={i === 0}
                  className="btn-icon disabled:opacity-30"
                  title={t('rules.moveUp')}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => {
                    const next = [...actions];
                    [next[i + 1], next[i]] = [next[i], next[i + 1]];
                    setActions(next);
                  }}
                  disabled={i === actions.length - 1}
                  className="btn-icon disabled:opacity-30"
                  title={t('rules.moveDown')}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  onClick={() => setActions(actions.filter((_, k) => k !== i))}
                  className="btn-icon hover:text-error"
                  title={t('common.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
          <button
            onClick={() => setActions([...actions, defaultAction('openApp', ctx)])}
            disabled={actions.length >= MAX_ACTIONS}
            className="btn btn-secondary disabled:opacity-40"
          >
            <Plus size={14} /> {t('auto.addAction')}
          </button>
        </div>
      </section>

      {errors.length > 0 && (
        <p className="text-xs text-error flex items-center gap-1">
          <AlertCircle size={12} /> {t(errors[0])}
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={() => onSave(rule)} disabled={errors.length > 0} className="btn btn-primary disabled:opacity-40">
          {t('common.save')}
        </button>
        <button onClick={onCancel} className="btn btn-secondary">{t('common.cancel')}</button>
      </div>
    </div>
  );
}

// Champs propres à chaque type d'action.
function ActionParams({ action, ctx, t, appSelect, profileSelect, onChange }) {
  switch (action.type) {
    case 'switchProfile':
      return profileSelect(action.profileId, (v) => onChange({ profileId: v }));
    case 'openApp':
    case 'wakeApp':
      return appSelect(action.appId, (v) => onChange({ appId: v }));
    case 'reloadApp':
    case 'sleepApp':
    case 'muteApp':
    case 'unmuteApp':
      return appSelect(action.appId, (v) => onChange({ appId: v }), { allowActive: true });
    case 'zoomApp':
      return (
        <>
          {appSelect(action.appId, (v) => onChange({ appId: v }), { allowActive: true })}
          <select value={String(action.zoom ?? 1)} onChange={(e) => onChange({ zoom: Number(e.target.value) })} className="input w-24">
            {[0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((z) => (
              <option key={z} value={z}>{Math.round(z * 100)} %</option>
            ))}
          </select>
        </>
      );
    case 'openUrl':
      return (
        <>
          <input
            value={action.url || ''}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…"
            spellCheck={false}
            className="input flex-1 min-w-[12rem] font-mono text-xs"
          />
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input type="checkbox" checked={Boolean(action.private)} onChange={(e) => onChange({ private: e.target.checked })} />
            {t('auto.private')}
          </label>
        </>
      );
    case 'split':
      return (
        <>
          {appSelect(action.appIds?.[0], (v) => onChange({ appIds: [v, action.appIds?.[1] || ''] }))}
          {appSelect(action.appIds?.[1], (v) => onChange({ appIds: [action.appIds?.[0] || '', v] }))}
          <select value={action.direction || 'row'} onChange={(e) => onChange({ direction: e.target.value })} className="input w-36">
            <option value="row">{t('auto.split.row')}</option>
            <option value="col">{t('auto.split.col')}</option>
          </select>
        </>
      );
    case 'applyWorkspace':
      return ctx.workspaces.length ? (
        <select value={action.workspaceId || ''} onChange={(e) => onChange({ workspaceId: e.target.value })} className="input flex-1">
          <option value="">{t('auto.chooseWorkspace')}</option>
          {ctx.workspaces.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      ) : (
        <span className="text-xs text-text-muted">{t('auto.noWorkspace')}</span>
      );
    case 'setThemeMode':
      return (
        <select value={action.mode || 'dark'} onChange={(e) => onChange({ mode: e.target.value })} className="input w-36">
          {['dark', 'light', 'auto'].map((m) => (
            <option key={m} value={m}>{t(`auto.theme.${m}`)}</option>
          ))}
        </select>
      );
    case 'setDnd':
      return (
        <select value={action.on ? 'on' : 'off'} onChange={(e) => onChange({ on: e.target.value === 'on' })} className="input w-36">
          <option value="on">{t('auto.on')}</option>
          <option value="off">{t('auto.off')}</option>
        </select>
      );
    case 'notify':
      return (
        <>
          <input
            value={action.title || ''}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={t('auto.notifyTitle')}
            className="input flex-1 min-w-[8rem]"
            maxLength={120}
          />
          <input
            value={action.body || ''}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={t('auto.notifyBody')}
            className="input flex-[2] min-w-[10rem]"
            maxLength={500}
          />
        </>
      );
    case 'wait':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="number"
            min={1}
            max={300}
            value={action.seconds ?? 5}
            onChange={(e) => onChange({ seconds: Number(e.target.value) })}
            className="input w-20"
          />
          {t('auto.seconds')}
        </label>
      );
    default:
      return null;
  }
}

// --- Éditeur de règle de lien ------------------------------------------------
function LinkEditor({ initial, apps, t, onCancel, onSave }) {
  const [draft, setDraft] = useState(initial);
  const errors = validateRule(draft);
  return (
    <div className="card border-accent-primary/50 space-y-3">
      <div className="flex items-center justify-between">
        <h6 className="text-xs font-semibold uppercase text-accent-primary">{t('auto.linksTitle')}</h6>
        <button onClick={onCancel} className="btn-icon" title={t('common.cancel')}><X size={16} /></button>
      </div>
      <div>
        <label className="text-xs text-text-muted">{t('rules.pattern')}</label>
        <input
          value={draft.pattern}
          onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          placeholder="github.com"
          className="input w-full"
          autoFocus
        />
        <p className="text-xs text-text-muted mt-1">{t('rules.patternHelp')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} className="input flex-1">
          {LINK_ACTIONS.map((a) => (
            <option key={a} value={a}>{t(`rules.action.${a}`)}</option>
          ))}
        </select>
        {draft.action === 'openInApp' && (
          <select
            value={draft.targetAppId}
            onChange={(e) => setDraft({ ...draft, targetAppId: e.target.value })}
            className="input flex-1"
          >
            <option value="">{t('rules.chooseApp')}</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>
      {errors.length > 0 && (
        <p className="text-xs text-error flex items-center gap-1">
          <AlertCircle size={12} /> {t(errors[0])}
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={() => onSave(draft)} disabled={errors.length > 0} className="btn btn-primary disabled:opacity-40">
          {t('common.save')}
        </button>
        <button onClick={onCancel} className="btn btn-secondary">{t('common.cancel')}</button>
      </div>
    </div>
  );
}
