import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { useT } from '../lib/i18n';

// ---------------------------------------------------------------------------
// Paramètres → Confidentialité → Boucliers
//
// Deux niveaux, comme dans Brave :
//   • les VALEURS PAR DÉFAUT, appliquées à tout site jamais personnalisé ;
//   • la LISTE des sites personnalisés, révisables un par un.
//
// Sans cette liste, un réglage posé depuis le panneau d'une app serait
// invisible : l'utilisateur croirait le réglage global modifié, et n'aurait
// aucun moyen de l'annuler. C'est exactement le reproche qu'on adresse aux
// autres navigateurs.
//
// La source de vérité est le processus principal (shields.json) — ces
// réglages doivent survivre au rechargement de l'interface.
// ---------------------------------------------------------------------------

const DEFAULT_SHIELDS = {
  enabled: true,
  adblock: 'standard',
  httpsUpgrade: true,
  blockScripts: false,
  fingerprinting: 'standard',
  cookies: 'cross-site',
  forgetOnClose: false,
};

// Clés présentes dans les réglages, dans l'ordre d'affichage.
const FIELDS = [
  'enabled',
  'adblock',
  'httpsUpgrade',
  'blockScripts',
  'fingerprinting',
  'cookies',
  'forgetOnClose',
];

const TOGGLES = new Set(['enabled', 'httpsUpgrade', 'blockScripts', 'forgetOnClose']);

const OPTIONS = {
  adblock: ['standard', 'off'],
  fingerprinting: ['standard', 'strict', 'off'],
  cookies: ['allow', 'cross-site', 'all'],
};

// Libellé d'une valeur d'enum. La clé est namespacée par le réglage
// (`shields.cookies.all`) : « standard » ne veut pas dire la même chose pour les
// empreintes et pour les cookies. Repli sur la valeur brute si la traduction
// manque, pour que l'affichage ne casse jamais.
function valueLabel(t, key, value) {
  const k = `shields.${key}.${value}`;
  return t(k) === k ? value : t(k);
}

export default function ShieldSettings() {
  const t = useT();
  const [defaults, setDefaults] = useState(DEFAULT_SHIELDS);
  const [sites, setSites] = useState([]);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.shields;
    if (!api) return;
    const [d, s] = await Promise.all([api.getDefaults?.(), api.listSites?.()]);
    if (d) setDefaults({ ...DEFAULT_SHIELDS, ...d });
    setSites(Array.isArray(s) ? s : []);
  }, []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const api = window.electronAPI?.shields;
      if (!api || !alive) return;
      const [d, s] = await Promise.all([api.getDefaults?.(), api.listSites?.()]);
      if (alive && d) setDefaults({ ...DEFAULT_SHIELDS, ...d });
      if (alive) setSites(Array.isArray(s) ? s : []);
    };
    run();
    return () => {
      alive = false;
    };
  }, []);

  const changeDefault = async (key, value) => {
    setDefaults((prev) => ({ ...prev, [key]: value }));
    // Le processus principal filtre les valeurs invalides et renvoie l'état
    // effectif : c'est cette réponse qui fait foi, pas notre optimisme.
    const next = await window.electronAPI?.shields?.updateDefaults?.({ [key]: value });
    if (next) setDefaults({ ...DEFAULT_SHIELDS, ...next });
  };

  const resetSite = async (origin) => {
    await window.electronAPI?.shields?.resetSiteSettings?.(origin);
    refresh();
  };

  const resetAll = async () => {
    for (const site of sites) {
      await window.electronAPI?.shields?.resetSiteSettings?.(site.origin);
    }
    refresh();
  };

  const renderField = (key, value, onChange, disabled) => {
    if (TOGGLES.has(key)) {
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(key, e.target.checked)}
          disabled={disabled}
          className="toggle"
        />
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(key, e.target.value)}
        disabled={disabled}
        className="input max-w-[12rem]"
      >
        {(OPTIONS[key] || []).map((opt) => (
          <option key={opt} value={opt}>
            {valueLabel(t, key, opt)}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.shieldsTitle')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.shieldsDesc')}</p>

      <h5 className="text-sm font-medium mb-2">{t('st.shieldsDefaults')}</h5>
      <div className="space-y-3">
        {FIELDS.map((key) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="text-sm text-text-secondary">{t(`shields.${key}`)}</span>
            {renderField(key, defaults[key], changeDefault)}
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted mt-3">{t('st.shieldsDefaultsHint')}</p>

      <div className="mt-5 flex items-center justify-between">
        <span className="text-sm font-medium">{t('st.shieldsCustom')}</span>
        {sites.length > 0 && (
          <button onClick={resetAll} className="text-xs text-text-muted hover:text-error">
            {t('st.shieldsForgetAll')}
          </button>
        )}
      </div>

      {sites.length === 0 ? (
        <p className="text-xs text-text-muted mt-2">{t('st.shieldsEmpty')}</p>
      ) : (
        <div className="mt-2 space-y-2">
          {sites.map((site) => (
            <div key={site.origin} className="rounded-xl border border-border bg-bg-primary p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate" title={site.origin}>
                  {site.origin.replace(/^https?:\/\//, '')}
                </span>
                <button
                  onClick={() => resetSite(site.origin)}
                  className="btn-icon w-6 h-6 text-text-muted hover:text-error flex-shrink-0"
                  title={t('st.shieldsReset')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-2 space-y-1.5">
                {FIELDS.map((key) => {
                  const overridden = key in site.overrides;
                  return (
                    <div key={key} className="flex items-center justify-between gap-4">
                      <span
                        className={
                          overridden ? 'text-sm text-text-secondary' : 'text-sm text-text-muted'
                        }
                      >
                        {t(`shields.${key}`)}
                        {!overridden && (
                          <span className="ml-1.5 text-xs opacity-60">
                            {t('st.shieldsInherited')}
                          </span>
                        )}
                      </span>
                      {renderField(key, site.settings[key], () => {}, true)}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}