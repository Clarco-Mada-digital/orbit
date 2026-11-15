import { useState } from 'react';
import { Search, History, PanelsTopLeft, KeyRound, Timer, Globe, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import { BUILTIN_ENGINES, allEngines, isValidEngine, normalizeKeyword } from '../lib/searchEngines';

// ---------------------------------------------------------------------------
// Réglages → Général → Recherche (Alt+K)
//
// La palette agrège des sources de natures très différentes : des apps, mais
// aussi des pages visitées et, depuis peu, les entrées des trousseaux
// déverrouillés. Toutes ne conviennent pas à tous les contextes — un poste
// partagé, une démonstration, un écran dans un espace ouvert.
//
// Les apps, profils, actions, calculs et conversions ne figurent pas ici :
// c'est le cœur de la palette, le désactiver n'aurait aucun sens.
// ---------------------------------------------------------------------------
const SOURCES = [
  { id: 'history', icon: History },
  { id: 'openPages', icon: PanelsTopLeft },
  { id: 'vault', icon: KeyRound },
];

export default function SearchSettings() {
  const { settings, updateSettings } = useStore();
  const t = useT();
  const search = settings.search || {};
  const on = (id) => search[id] !== false;

  // Les réglages de recherche voyagent en un seul objet : toute écriture
  // repart de l'existant, sinon régler un moteur effacerait les sources.
  const patch = (updates) => updateSettings({ search: { ...(settings.search || {}), ...updates } });
  const toggle = (id, value) => patch({ [id]: value });

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <Search size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.search.title')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.search.desc')}</p>

      <div className="space-y-3">
        {SOURCES.map(({ id, icon: Icon }) => (
          <div key={id}>
            <label className="flex items-center justify-between gap-3">
              <span className="flex items-start gap-3 min-w-0">
                <Icon size={16} className={`mt-0.5 flex-shrink-0 ${on(id) ? 'text-accent-primary' : 'text-text-muted'}`} />
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{t(`st.search.${id}`)}</span>
                  <span className="block text-xs text-text-muted">{t(`st.search.${id}Desc`)}</span>
                </span>
              </span>
              <input
                type="checkbox"
                checked={on(id)}
                onChange={(e) => toggle(id, e.target.checked)}
                className="flex-shrink-0 w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
              />
            </label>

            {/* Le code à usage unique dépend des identifiants : l'afficher en
                sous-option évite de laisser un réglage sans effet visible. */}
            {id === 'vault' && on('vault') && (
              <label className="flex items-center justify-between gap-3 mt-3 ml-7 pl-3 border-l border-border">
                <span className="flex items-start gap-3 min-w-0">
                  <Timer size={16} className={`mt-0.5 flex-shrink-0 ${on('vaultTotp') ? 'text-accent-primary' : 'text-text-muted'}`} />
                  <span className="min-w-0">
                    <span className="block font-medium text-sm">{t('st.search.vaultTotp')}</span>
                    <span className="block text-xs text-text-muted">{t('st.search.vaultTotpDesc')}</span>
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={on('vaultTotp')}
                  onChange={(e) => toggle('vaultTotp', e.target.checked)}
                  className="flex-shrink-0 w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-text-muted mt-4">{t('st.search.hint')}</p>

      <WebSearchSection search={search} toggle={toggle} patch={patch} on={on} t={t} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recherche web : moteur par défaut, raccourcis « @… », moteurs personnalisés.
//
// Vit dans le même bloc de réglages que les sources ci-dessus, parce que
// c'est la même question posée à l'envers : ce que la palette interroge DANS
// Orbit, et ce qu'elle propose quand la réponse n'y est pas.
// ---------------------------------------------------------------------------
function WebSearchSection({ search, toggle, patch, on, t }) {
  const engines = allEngines(search);
  const hidden = search.hiddenEngines || [];
  const custom = search.customEngines || [];
  const [draft, setDraft] = useState({ name: '', keyword: '', url: '' });

  // Raccourci déjà pris : le laisser passer donnerait un « @g » qui répond
  // tantôt l'un tantôt l'autre selon l'ordre de la liste. On le dit avant.
  const draftKeyword = normalizeKeyword(draft.keyword);
  const taken =
    Boolean(draftKeyword) &&
    engines.some((e) => normalizeKeyword(e.keyword) === draftKeyword);
  const canAdd = isValidEngine(draft) && !taken;

  const addEngine = () => {
    if (!canAdd) return;
    patch({
      customEngines: [
        ...custom,
        {
          id: `engine-${Date.now()}`,
          name: draft.name.trim(),
          keyword: draftKeyword,
          url: draft.url.trim(),
          color: '#6366f1',
        },
      ],
    });
    setDraft({ name: '', keyword: '', url: '' });
  };

  const removeEngine = (id) => {
    // Le moteur supprimé était peut-être celui par défaut : on ne laisse pas
    // le réglage pointer dans le vide (defaultEngine sait retomber, mais la
    // liste déroulante afficherait une valeur fantôme).
    const next = { customEngines: custom.filter((e) => e.id !== id) };
    if (search.engine === id) next.engine = 'google';
    patch(next);
  };

  const toggleHidden = (id) =>
    patch({
      hiddenEngines: hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id],
      // Masquer le moteur par défaut n'a pas de sens : on en reprend un autre.
      ...(search.engine === id && !hidden.includes(id) ? { engine: 'google' } : {}),
    });

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="flex items-center gap-2 mb-2">
        <Globe size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.search.webTitle')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.search.webDesc')}</p>

      <label className="flex items-center justify-between gap-3">
        <span className="flex items-start gap-3 min-w-0">
          <Search size={16} className={`mt-0.5 flex-shrink-0 ${on('web') ? 'text-accent-primary' : 'text-text-muted'}`} />
          <span className="min-w-0">
            <span className="block font-medium text-sm">{t('st.search.web')}</span>
            <span className="block text-xs text-text-muted">{t('st.search.webToggleDesc')}</span>
          </span>
        </span>
        <input
          type="checkbox"
          checked={on('web')}
          onChange={(e) => toggle('web', e.target.checked)}
          className="flex-shrink-0 w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>

      {/* Moteur par défaut */}
      <div className="mt-4">
        <label className="block text-sm font-medium mb-1">{t('st.search.defaultEngine')}</label>
        <select
          value={search.engine || 'google'}
          onChange={(e) => patch({ engine: e.target.value })}
          className="input w-full"
        >
          {engines.map((e) => (
            <option key={e.id || e.keyword} value={e.id || e.keyword}>
              {e.name} — @{e.keyword}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted mt-1">{t('st.search.defaultEngineDesc')}</p>
      </div>

      {/* Raccourcis intégrés, avec leur interrupteur de visibilité */}
      <div className="mt-5">
        <h5 className="text-xs font-semibold text-text-muted uppercase mb-2">
          {t('st.search.shortcuts')}
        </h5>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {BUILTIN_ENGINES.map((e) => {
            const off = hidden.includes(e.id);
            return (
              <button
                key={e.id}
                onClick={() => toggleHidden(e.id)}
                title={off ? t('st.search.showEngine') : t('st.search.hideEngine')}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-left min-w-0 transition-colors ${
                  off
                    ? 'border-border text-text-muted opacity-60 hover:opacity-100'
                    : 'border-border hover:border-accent-primary'
                }`}
              >
                <span
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: off ? 'transparent' : e.color }}
                />
                <span className="font-mono text-xs flex-shrink-0">@{e.keyword}</span>
                <span className="text-xs truncate flex-1">{e.name}</span>
                {off ? (
                  <EyeOff size={13} className="flex-shrink-0" />
                ) : (
                  <Eye size={13} className="flex-shrink-0 text-text-muted" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Moteurs personnalisés */}
      <div className="mt-5">
        <h5 className="text-xs font-semibold text-text-muted uppercase mb-2">
          {t('st.search.customTitle')}
        </h5>

        {custom.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {custom.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-bg-secondary border border-border min-w-0"
              >
                <span className="font-mono text-xs flex-shrink-0">@{e.keyword}</span>
                <span className="text-sm font-medium flex-shrink-0">{e.name}</span>
                <span className="text-xs text-text-muted truncate flex-1 font-mono">{e.url}</span>
                <button
                  onClick={() => removeEngine(e.id)}
                  className="btn-icon flex-shrink-0 hover:text-error"
                  title={t('common.remove')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_6rem] gap-2">
          <input
            type="text"
            value={draft.name}
            onChange={(ev) => setDraft({ ...draft, name: ev.target.value })}
            placeholder={t('st.search.customName')}
            className="input w-full"
          />
          <input
            type="text"
            value={draft.keyword}
            onChange={(ev) => setDraft({ ...draft, keyword: ev.target.value })}
            placeholder="@intra"
            className="input w-full font-mono"
          />
        </div>
        <input
          type="text"
          value={draft.url}
          onChange={(ev) => setDraft({ ...draft, url: ev.target.value })}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') addEngine();
          }}
          placeholder="https://intranet.local/recherche?q={q}"
          spellCheck={false}
          className="input w-full font-mono mt-2"
        />
        <div className="flex items-center justify-between gap-3 mt-2">
          <p className="text-xs text-text-muted">
            {taken ? (
              <span className="text-error">{t('st.search.keywordTaken', { keyword: draftKeyword })}</span>
            ) : (
              t('st.search.customHint')
            )}
          </p>
          <button onClick={addEngine} disabled={!canAdd} className="btn btn-primary flex-shrink-0 disabled:opacity-40">
            <Plus size={14} /> {t('st.search.customAdd')}
          </button>
        </div>
      </div>
    </div>
  );
}
