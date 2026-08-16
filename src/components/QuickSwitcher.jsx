import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  ArrowRight,
  Settings,
  Grid,
  User,
  PanelLeft,
  Moon,
  Unplug,
  ZoomIn,
  ZoomOut,
  CheckCheck,
  Keyboard,
  HelpCircle,
  LayoutGrid,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import AppIcon from './AppIcon';
import { shortcutKeys } from '../lib/shortcuts';
import { useT } from '../lib/i18n';

// Recherche « partout » : apps, profils ET actions (paramètres, boutique…)
export default function QuickSwitcher({ onClose, onOpenSettings, onOpenStore, onOpenProfileManager }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const t = useT();
  const {
    apps,
    profiles,
    activeApp,
    setActiveApp,
    setActiveProfile,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleAppSleep,
    splitView,
    clearSplitView,
    markAllRead,
    adjustAppZoom,
    resetAppZoom,
    workspaces,
    applyWorkspace,
  } = useStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // « help » → afficher le panneau d'aide complet
  const trimmed = query.trim().toLowerCase();
  const isHelpQuery =
    /^(help|aide|raccourci|shortcut|\?)$/.test(trimmed) ||
    /(raccourci|aide|help|shortcut)/.test(trimmed);

  // Actions disponibles (recherchables)
  const actions = useMemo(() => {
    const list = [
      {
        id: 'help',
        name: t('qs.help'),
        subtitle: t('qs.helpSub'),
        icon: <Keyboard size={22} />,
        color: '#8b5cf6',
        keywords: ['aide', 'help', 'raccourci', 'shortcut', 'touche', 'clavier'],
        run: () => setQuery('help'),
        keepOpen: true,
      },
      {
        id: 'settings',
        name: t('common.settings'),
        subtitle: t('qs.settingsSub'),
        icon: <Settings size={22} />,
        color: '#64748b',
        keywords: ['parametre', 'settings', 'reglage', 'theme', 'police'],
        run: onOpenSettings,
      },
      {
        id: 'store',
        name: t('sb.store'),
        subtitle: t('qs.storeSub'),
        icon: <Grid size={22} />,
        color: '#6366f1',
        keywords: ['boutique', 'store', 'installer', 'app', 'application'],
        run: onOpenStore,
      },
      {
        id: 'profiles',
        name: t('sb.manageProfiles'),
        subtitle: t('qs.profilesSub'),
        icon: <User size={22} />,
        color: '#10b981',
        keywords: ['profil', 'profile', 'compte', 'espace'],
        run: onOpenProfileManager,
      },
      {
        id: 'sidebar',
        name: sidebarCollapsed ? t('qs.sidebarExpand') : t('qs.sidebarCollapse'),
        subtitle: sidebarCollapsed ? t('qs.sidebarExpandSub') : t('qs.sidebarCollapseSub'),
        icon: <PanelLeft size={22} />,
        color: '#f59e0b',
        keywords: ['sidebar', 'barre', 'lateral', 'reduire', 'etendre', 'icone'],
        run: () => setSidebarCollapsed(!sidebarCollapsed),
      },
      ...(activeApp
        ? [
            {
              id: 'sleep',
              name: t('qs.sleep', { name: apps.find((a) => a.id === activeApp)?.name || '' }),
              subtitle: t('qs.sleepSub'),
              icon: <Moon size={22} />,
              color: '#3b82f6',
              keywords: ['veille', 'sleep', 'fermer', 'arriere-plan'],
              run: () => toggleAppSleep(activeApp),
            },
            {
              id: 'zoomin',
              name: t('qs.zoomIn'),
              subtitle: t('qs.zoomInSub'),
              icon: <ZoomIn size={22} />,
              color: '#14b8a6',
              keywords: ['zoom', 'agrandir', 'grossir'],
              run: () => adjustAppZoom(activeApp, 0.1),
            },
            {
              id: 'zoomout',
              name: t('qs.zoomOut'),
              subtitle: t('qs.zoomOutSub'),
              icon: <ZoomOut size={22} />,
              color: '#14b8a6',
              keywords: ['zoom', 'reduire', 'diminuer'],
              run: () => adjustAppZoom(activeApp, -0.1),
            },
            {
              id: 'zoomreset',
              name: t('qs.zoomReset'),
              subtitle: t('qs.zoomResetSub'),
              icon: <ZoomOut size={22} />,
              color: '#14b8a6',
              keywords: ['zoom', 'reinitialiser', '100'],
              run: () => resetAppZoom(activeApp),
            },
          ]
        : []),
      ...(splitView
        ? [
            {
              id: 'unsplit',
              name: t('qs.unsplit'),
              subtitle: t('qs.unsplitSub'),
              icon: <Unplug size={22} />,
              color: '#ef4444',
              keywords: ['partage', 'split', 'ecran', 'quitter'],
              run: () => clearSplitView(),
            },
          ]
        : []),
      {
        id: 'readall',
        name: t('qs.readall'),
        subtitle: t('qs.readallSub'),
        icon: <CheckCheck size={22} />,
        color: '#10b981',
        keywords: ['notification', 'lu', 'badge', 'marquer'],
        run: () => markAllRead(),
      },
      // Espaces de travail enregistrés : ouvrables directement depuis la palette
      ...workspaces.map((ws) => ({
        id: `ws-${ws.id}`,
        name: t('qs.workspaceName', { name: ws.name }),
        subtitle: t('qs.workspaceSub'),
        icon: <LayoutGrid size={22} />,
        color: '#a855f7',
        keywords: ['espace', 'workspace', 'disposition', 'layout', ws.name.toLowerCase()],
        run: () => applyWorkspace(ws.id),
      })),
    ];
    return list;
  }, [
    t,
    workspaces,
    applyWorkspace,
    sidebarCollapsed,
    setSidebarCollapsed,
    activeApp,
    apps,
    toggleAppSleep,
    splitView,
    clearSplitView,
    markAllRead,
    adjustAppZoom,
    resetAppZoom,
    onOpenSettings,
    onOpenStore,
    onOpenProfileManager,
  ]);

  // Résultats combinés : apps + profils + actions
  const results = useMemo(() => {
    const q = trimmed;
    if (isHelpQuery) return []; // le panneau d'aide remplace la liste
    const list = [];
    apps
      .filter(
        (app) =>
          app.name.toLowerCase().includes(q) || app.url.toLowerCase().includes(q)
      )
      .forEach((app) =>
        list.push({
          type: 'app',
          id: `app-${app.id}`,
          name: app.name,
          subtitle: app.url,
          app,
          color: app.color,
          action: () => {
            setActiveProfile(app.profileId);
            setActiveApp(app.id);
          },
        })
      );
    profiles
      .filter((p) => p.name.toLowerCase().includes(q))
      .forEach((p) =>
        list.push({
          type: 'profile',
          id: `profile-${p.id}`,
          name: p.name,
          subtitle: t('qs.switchProfile'),
          emoji: p.emoji,
          color: p.color,
          action: () => setActiveProfile(p.id),
        })
      );
    actions
      .filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.subtitle.toLowerCase().includes(q) ||
          a.keywords.some((k) => k.includes(q))
      )
      .forEach((a) =>
        list.push({ type: 'action', id: `action-${a.id}`, ...a, action: a.run })
      );
    return list.slice(0, 12);
  }, [trimmed, isHelpQuery, apps, profiles, actions, setActiveApp, setActiveProfile]);

  // Navigation clavier
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && results[selected]) {
        e.preventDefault();
        const r = results[selected];
        r.action();
        if (!r.keepOpen) onClose();
      } else if (e.key === 'Escape') {
        if (isHelpQuery && query.trim()) {
          setQuery('');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, results, onClose, isHelpQuery, query]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-24 animate-fade-in">
      <div className="w-full max-w-2xl bg-bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        {/* Recherche */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <Search size={20} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={t('qs.placeholder')}
            className="flex-1 bg-transparent text-lg outline-none"
          />
          <button onClick={onClose} className="btn-icon" title={t('common.close')}>
            <X size={20} />
          </button>
        </div>

        {/* Panneau d'aide (commande « help ») */}
        {isHelpQuery ? (
          <div className="max-h-[70vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-primary/10 text-accent-primary flex items-center justify-center">
                <HelpCircle size={20} />
              </div>
              <div>
                <h3 className="font-semibold">{t('qs.helpTitle')}</h3>
                <p className="text-sm text-text-muted">{t('qs.helpSubtitle')}</p>
              </div>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <h4 className="text-xs font-semibold text-text-muted uppercase mb-2">
                  {t('qs.shortcutsLabel')}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {shortcutKeys().map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 bg-bg-secondary border border-border rounded-lg px-3 py-2"
                    >
                      <span className="text-sm">{s.desc}</span>
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {s.keys.map((k, j) => (
                          <span key={j}>
                            {j > 0 && <span className="text-text-muted mx-0.5">+</span>}
                            <kbd className="px-1.5 py-0.5 bg-bg-elevated border border-border rounded text-xs">
                              {k}
                            </kbd>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-text-muted uppercase mb-2">{t('qs.tips')}</h4>
                <ul className="space-y-1.5">
                  {[t('qs.tip1'), t('qs.tip2'), t('qs.tip3'), t('qs.tip4')].map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-accent-primary mt-0.5">✦</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          /* Résultats de recherche */
          <div className="max-h-96 overflow-y-auto">
            {results.length === 0 ? (
              <div className="p-8 text-center text-text-muted">
                <p>{t('qs.noResults', { query })}</p>
                {query.trim() && (
                  <p className="text-sm mt-1">
                    {t('qs.tryHelp')}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-2">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    onClick={() => {
                      result.action();
                      if (!result.keepOpen) onClose();
                    }}
                    className={`w-full flex items-center gap-4 p-3 rounded-lg transition-all ${
                      index === selected
                        ? 'bg-accent-primary/10 text-accent-primary'
                        : 'hover:bg-bg-hover'
                    }`}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden"
                      style={{ backgroundColor: `${result.color}20` }}
                    >
                      {result.type === 'app' ? (
                        <AppIcon app={result.app} className="w-6 h-6 rounded" fallbackClassName="text-2xl" />
                      ) : result.type === 'action' ? (
                        result.icon
                      ) : (
                        <span className="text-2xl leading-none">{result.emoji}</span>
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <div className="font-medium truncate">{result.name}</div>
                      <div className="text-sm text-text-muted truncate">{result.subtitle}</div>
                    </div>
                    <ArrowRight size={18} className="text-text-muted flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Indications */}
        <div className="px-4 py-3 bg-bg-secondary border-t border-border flex items-center gap-4 text-xs text-text-muted">
          <span>
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">↵</kbd> {t('qs.hintSelect')}
          </span>
          <span>
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">↑↓</kbd> {t('qs.hintNavigate')}
          </span>
          <span>
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">help</kbd> {t('qs.hintHelp')}
          </span>
          <span>
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">esc</kbd> {t('qs.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
