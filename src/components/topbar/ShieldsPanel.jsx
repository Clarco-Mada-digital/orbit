import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldBan, X, Filter } from 'lucide-react';
import { useT } from '../../lib/i18n';

// Dérivé de l'URL, pas d'un état : une variable calculée à chaque rendu ne peut
// pas être en retard d'un state, et évite un effet qui ne fait qu'appeler
// setState (warning react-hooks/set-state-in-effect).
function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    return null;
  } catch {
    return null;
  }
}

const DEFAULT_SHIELDS = {
  enabled: true,
  adblock: 'standard',
  httpsUpgrade: true,
  blockScripts: false,
  fingerprinting: 'standard',
  cookies: 'cross-site',
  forgetOnClose: false,
};

const ShieldsPanel = ({ webContentsId, url, onClose, onSiteEnabledChange }) => {
  const t = useT();
  const [stats, setStats] = useState({ total: 0, count: 0, domains: [], byReason: { ads: 0, trackers: 0, script: 0, https: 0 } });
  const [settings, setShieldSettings] = useState(DEFAULT_SHIELDS);
  const [error, setError] = useState(null);

  const api = window.electronAPI?.shields;
  const origin = originOf(url);

  useEffect(() => {
    if (!api || !webContentsId) return;
    let mounted = true;
    const load = async () => {
      try {
        const s = await api.getBlockedStats(webContentsId);
        if (mounted && s) setStats(s);
        if (mounted && origin) {
          const site = await api.getSiteSettings(origin);
          if (mounted && site && Object.keys(site).length) {
            setShieldSettings({ ...DEFAULT_SHIELDS, ...site });
          }
        }
      } catch (err) {
        if (mounted) setError(err.message || 'shields_load_failed');
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [api, webContentsId, origin]);

  const handleSettingChange = async (key, value) => {
    setShieldSettings((prev) => ({ ...prev, [key]: value }));
    try {
      if (!origin) return;
      // Le processus principal renvoie les réglages EFFECTIFS après écriture :
      // c'est cette réponse qui fait foi (il filtre les valeurs invalides).
      const next = await api?.updateSiteSettings(origin, { [key]: value });
      if (next) {
        const merged = { ...DEFAULT_SHIELDS, ...next };
        setShieldSettings(merged);
        if (key === 'enabled') onSiteEnabledChange?.(merged.enabled !== false);
      }
    } catch (err) {
      console.error('[ShieldsPanel] Error updating setting:', err);
    }
  };

  // Le blocage n'est PASPiloté ici : main.js le déduit des boucliers du site à
  // chaque requête (cohérent avec le reste des protections) puis applique le
  // réglage global et l'éventuel réglage par app.
  const handleToggleBlocker = () => handleSettingChange('enabled', !(settings.enabled === true));

  // Les statistiques viennent du processus principal : on les normalise ici
  // pour ne jamais laisser un champ absentbreaker l'affichage du panneau.
  const total = stats.total || 0;
  const domains = stats.domains || [];
  const byReason = stats.byReason || { ads: 0, trackers: 0, script: 0, https: 0 };

  const advancedSettings = [
    { key: 'adblock', type: 'select', options: [{ value: 'standard' }, { value: 'off' }] },
    { key: 'httpsUpgrade', type: 'boolean' },
    { key: 'blockScripts', type: 'boolean' },
    {
      key: 'fingerprinting',
      type: 'select',
      options: [{ value: 'standard' }, { value: 'strict' }, { value: 'off' }],
    },
    {
      key: 'cookies',
      type: 'select',
      options: [{ value: 'cross-site' }, { value: 'all' }, { value: 'allow' }],
    },
    { key: 'forgetOnClose', type: 'boolean' },
  ];

  return (
    <div
      className="w-72 p-4 bg-bg-elevated border border-border rounded-xl shadow-2xl space-y-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          {settings.enabled ? <ShieldCheck size={20} className="text-accent-primary" /> : <ShieldBan size={20} className="text-error" />}
          <h4 className="font-semibold">{t('shields.title')}</h4>
        </div>
        <button onClick={onClose} className="btn-icon">
          <X size={16} />
        </button>
      </div>

      {error && <div className="text-center py-4 text-error">{t('shields.loadError')}</div>}

      {!error && (
        <div className="space-y-4">
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="font-medium text-sm">{t('shields.enableShields')}</label>
              <input
                type="checkbox"
                checked={settings.enabled === true}
                onChange={handleToggleBlocker}
                className="toggle"
              />
            </div>
            {origin ? (
              <div className="text-xs text-text-muted break-all">{t('shields.shieldsFor', { origin })}</div>
            ) : (
              <div className="text-xs text-text-muted">{t('shields.noSite')}</div>
            )}
          </div>

          <div className="card p-3">
            <h4 className="font-semibold mb-2">{t('shields.blockedInfo', { count: total })}</h4>
            {total > 0 ? (
              <div className="text-xs text-text-muted space-y-2">
                {byReason.ads > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('shields.adsLabel')}</span>
                    <span>{byReason.ads}</span>
                  </div>
                )}
                {byReason.trackers > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('shields.trackersLabel')}</span>
                    <span>{byReason.trackers}</span>
                  </div>
                )}
                {byReason.script > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('shields.scriptsLabel')}</span>
                    <span>{byReason.script}</span>
                  </div>
                )}
                {byReason.https > 0 && (
                  <div className="flex items-center justify-between">
                    <span>{t('shields.httpsLabel')}</span>
                    <span>{byReason.https}</span>
                  </div>
                )}
                <div className="pt-1 border-t border-border space-y-0.5">
                  {domains.slice(0, 5).map((domain) => (
                    <div key={domain} className="truncate">{domain}</div>
                  ))}
                  {domains.length > 5 && (
                    <div className="text-center">{t('shields.moreSites', { count: domains.length - 5 })}</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-muted">{t('shields.noBlocked')}</div>
            )}
          </div>

          <details className="card p-3 rounded-lg border border-border">
            <summary className="font-medium text-sm cursor-pointer flex items-center justify-between">
              {t('shields.advancedSettings')}
              <Filter size={16} />
            </summary>
            <div className="mt-3 space-y-3">
              {advancedSettings.map((setting) => (
                <div key={setting.key} className="space-y-1">
                  <label className="font-medium text-sm block">{t(`shields.${setting.key}`)}</label>
                  {setting.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      checked={settings[setting.key] === true}
                      onChange={(e) => handleSettingChange(setting.key, e.target.checked)}
                      className="toggle"
                    />
                  ) : (
                    <select
                      value={settings[setting.key]}
                      onChange={(e) => handleSettingChange(setting.key, e.target.value)}
                      className="input w-full"
                    >
                      {setting.options.map((option) => {
                        // Clé namespacée par réglage : « off » ne se traduit pas
                        // pareil pour l'empreinte et pour les pubs.
                        const k = `shields.${setting.key}.${option.value}`;
                        return (
                          <option key={option.value} value={option.value}>
                            {t(k) === k ? option.value : t(k)}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
};

export default ShieldsPanel;
