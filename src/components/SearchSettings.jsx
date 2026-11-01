import { Search, History, PanelsTopLeft, KeyRound, Timer } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';

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

  const toggle = (id, value) =>
    updateSettings({ search: { ...(settings.search || {}), [id]: value } });

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
    </div>
  );
}
