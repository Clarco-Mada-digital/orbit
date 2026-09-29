import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Zap, AlertCircle } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { validateRule, describeRule, LINK_ACTIONS } from '../lib/rules';

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // lundi → dimanche, comme un calendrier

// Une règle vierge, prête à être complétée.
const blank = (trigger) =>
  trigger === 'link'
    ? { trigger: 'link', pattern: '', action: 'openInApp', targetAppId: '', fromAppId: '' }
    : { trigger: 'time', at: '09:00', targetProfileId: '', days: [1, 2, 3, 4, 5] };

export default function RulesSettings() {
  const t = useT();
  const { rules, apps, profiles, addRule, updateRule, deleteRule, moveRule } = useStore();
  const [draft, setDraft] = useState(null);

  const errors = draft ? validateRule(draft) : [];

  const save = () => {
    if (errors.length) return;
    addRule(draft);
    setDraft(null);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('rules.title')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">{t('rules.desc')}</p>

        {/* Liste des règles. L'ORDRE compte : la première qui correspond
            l'emporte, d'où les flèches de réordonnancement. */}
        {rules.length === 0 ? (
          <p className="text-sm text-text-muted italic mb-4">{t('rules.empty')}</p>
        ) : (
          <div className="space-y-2 mb-4">
            {rules.map((rule, i) => {
              const d = describeRule(rule);
              const target =
                rule.trigger === 'link'
                  ? apps.find((a) => a.id === rule.targetAppId)?.name
                  : profiles.find((p) => p.id === rule.targetProfileId)?.name;
              return (
                <div
                  key={rule.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-elevated ${
                    rule.enabled === false ? 'opacity-50' : ''
                  }`}
                >
                  <span className="text-xs text-text-muted w-5 tabular-nums">{i + 1}</span>
                  <input
                    type="checkbox"
                    checked={rule.enabled !== false}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                    title={t('rules.toggle')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{t(d.key, d.vars)}</div>
                    {target && (
                      <div className="text-xs text-text-muted truncate">
                        {t('rules.towards', { target })}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => moveRule(rule.id, -1)}
                    disabled={i === 0}
                    className="btn-icon disabled:opacity-30"
                    title={t('rules.moveUp')}
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveRule(rule.id, 1)}
                    disabled={i === rules.length - 1}
                    className="btn-icon disabled:opacity-30"
                    title={t('rules.moveDown')}
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="btn-icon hover:text-error"
                    title={t('common.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {draft ? (
          <div className="border border-border rounded-lg p-3 space-y-3">
            {draft.trigger === 'link' ? (
              <>
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
                <div className="flex gap-2">
                  <select
                    value={draft.action}
                    onChange={(e) => setDraft({ ...draft, action: e.target.value })}
                    className="input flex-1"
                  >
                    {LINK_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {t(`rules.action.${a}`)}
                      </option>
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
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={draft.at}
                    onChange={(e) => setDraft({ ...draft, at: e.target.value })}
                    className="input"
                  />
                  <select
                    value={draft.targetProfileId}
                    onChange={(e) => setDraft({ ...draft, targetProfileId: e.target.value })}
                    className="input flex-1"
                  >
                    <option value="">{t('rules.chooseProfile')}</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.emoji} {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-1">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          days: draft.days.includes(d)
                            ? draft.days.filter((x) => x !== d)
                            : [...draft.days, d],
                        })
                      }
                      className={`w-9 h-8 rounded text-xs ${
                        draft.days.includes(d)
                          ? 'bg-accent-primary text-white'
                          : 'bg-bg-elevated text-text-muted'
                      }`}
                    >
                      {t(`rules.day.${d}`)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {errors.length > 0 && (
              <p className="text-xs text-error flex items-center gap-1">
                <AlertCircle size={12} /> {t(errors[0])}
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={save} disabled={errors.length > 0} className="btn btn-primary">
                {t('common.save')}
              </button>
              <button onClick={() => setDraft(null)} className="btn btn-secondary">
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setDraft(blank('link'))} className="btn btn-secondary">
              <Plus size={16} /> {t('rules.addLink')}
            </button>
            <button onClick={() => setDraft(blank('time'))} className="btn btn-secondary">
              <Plus size={16} /> {t('rules.addTime')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
