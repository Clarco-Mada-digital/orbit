import { useMemo, useRef, useState } from 'react';
import { Search, History, PanelsTopLeft, KeyRound, Timer, Globe, Plus, Trash2, Eye, EyeOff, Pencil, BookOpen, Wand2, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../lib/i18n';
import { BUILTIN_ENGINES, allEngines, isValidEngine, normalizeKeyword } from '../lib/searchEngines';
import { searchBangCatalog } from '../lib/bangs';
import { useBangCatalog } from '../lib/useBangs';

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
  const { settings, updateSettings } = useStore(
    useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings })),
  );
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
  // Moteur personnalisé en cours de modification (null = ajout).
  const [editingId, setEditingId] = useState(null);
  const nameRef = useRef(null);

  // Raccourci déjà pris : le laisser passer donnerait un « @g » qui répond
  // tantôt l'un tantôt l'autre selon l'ordre de la liste. On le dit avant.
  // Le moteur qu'on modifie ne compte pas : garder son propre raccourci est
  // permis. Le catalogue non plus : un moteur à soi a justement vocation à
  // passer devant lui.
  const draftKeyword = normalizeKeyword(draft.keyword);
  const taken =
    Boolean(draftKeyword) &&
    engines.some((e) => e.id !== editingId && normalizeKeyword(e.keyword) === draftKeyword);
  const canAdd = isValidEngine(draft) && !taken;

  const resetDraft = () => {
    setDraft({ name: '', keyword: '', url: '' });
    setEditingId(null);
  };

  const addEngine = () => {
    if (!canAdd) return;
    const engine = {
      name: draft.name.trim(),
      keyword: draftKeyword,
      url: draft.url.trim(),
    };
    patch({
      customEngines: editingId
        ? custom.map((e) => (e.id === editingId ? { ...e, ...engine } : e))
        : [...custom, { id: `engine-${Date.now()}`, color: '#6366f1', ...engine }],
    });
    resetDraft();
  };

  // Charge un moteur dans le formulaire : pour le modifier (moteur à soi) ou
  // pour en faire une copie personnalisée (entrée du catalogue).
  const loadDraft = (engine, id = null) => {
    setDraft({ name: engine.name, keyword: engine.keyword, url: engine.url });
    setEditingId(id);
    requestAnimationFrame(() => {
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      nameRef.current?.focus();
    });
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

      <BangCatalogSection toggle={toggle} on={on} t={t} onCustomize={(e) => loadDraft(e)} />

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
                  onClick={() => loadDraft(e, e.id)}
                  className="btn-icon flex-shrink-0"
                  title={t('st.search.customEdit')}
                >
                  <Pencil size={14} />
                </button>
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
            ref={nameRef}
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {(editingId || draft.name || draft.keyword || draft.url) && (
              <button onClick={resetDraft} className="btn btn-secondary">
                {t('st.search.customCancel')}
              </button>
            )}
            <button onClick={addEngine} disabled={!canAdd} className="btn btn-primary disabled:opacity-40">
              <Plus size={14} /> {editingId ? t('st.search.customSave') : t('st.search.customAdd')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalogue de raccourcis (« @amz », « @mdn »… — voir lib/bangs.js).
//
// On peut le couper, y chercher un site, et surtout « personnaliser » une
// entrée : elle est copiée dans le formulaire de vos moteurs, où l'on change
// librement nom, raccourci et URL. Un moteur à soi passe toujours devant le
// catalogue, donc la copie remplace l'original dès qu'elle est enregistrée.
// ---------------------------------------------------------------------------
function BangCatalogSection({ toggle, on, t, onCustomize }) {
  const enabled = on('bangCatalog');
  const [query, setQuery] = useState('');
  // Les réglages ouverts ne chargent pas le catalogue : seulement la recherche.
  const catalog = useBangCatalog(Boolean(query.trim()));
  const results = useMemo(
    () => (catalog ? searchBangCatalog(catalog.data, query, 30) : []),
    [catalog, query]
  );
  const count = catalog ? catalog.index.size.toLocaleString() : '10 000+';

  return (
    <div className="mt-5">
      <h5 className="text-xs font-semibold text-text-muted uppercase mb-2">
        {t('st.search.catalogTitle')}
      </h5>
      <label className="flex items-center justify-between gap-3">
        <span className="flex items-start gap-3 min-w-0">
          <BookOpen size={16} className={`mt-0.5 flex-shrink-0 ${enabled ? 'text-accent-primary' : 'text-text-muted'}`} />
          <span className="min-w-0">
            <span className="block font-medium text-sm">{t('st.search.catalog', { count })}</span>
            <span className="block text-xs text-text-muted">{t('st.search.catalogDesc')}</span>
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => toggle('bangCatalog', e.target.checked)}
          className="flex-shrink-0 w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>

      <div className="relative mt-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('st.search.catalogSearch')}
          spellCheck={false}
          className="input w-full pl-9 pr-8"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon"
            title={t('st.search.customCancel')}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="mt-2 max-h-72 overflow-y-auto space-y-1 pr-1">
          {!catalog && <p className="text-xs text-text-muted px-1 py-2">{t('st.search.catalogLoading')}</p>}
          {catalog && results.length === 0 && (
            <p className="text-xs text-text-muted px-1 py-2">{t('st.search.catalogEmpty')}</p>
          )}
          {results.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border min-w-0"
            >
              <span className="font-mono text-xs flex-shrink-0 text-accent-primary">@{e.keyword}</span>
              <span className="text-sm font-medium flex-shrink-0 max-w-[40%] truncate">{e.name}</span>
              <span className="text-xs text-text-muted truncate flex-1 font-mono" title={e.url}>
                {e.url}
              </span>
              <button
                onClick={() => onCustomize(e)}
                className="btn btn-secondary flex-shrink-0 !px-2 !py-1 text-xs"
                title={t('st.search.catalogCustomizeTitle')}
              >
                <Wand2 size={12} /> {t('st.search.catalogCustomize')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
