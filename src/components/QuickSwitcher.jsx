import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EyeOff,
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
  Calculator,
  Ruler,
  Coins,
  RefreshCw,
  Binary,
  Palette,
  CalendarClock,
  Globe,
  Copy,
  Check,
  PanelsTopLeft,
  History,
  Bot,
  Trash2,
  KeyRound,
  Clapperboard,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import AppIcon from './AppIcon';
import { shortcutKeys } from '../lib/shortcuts';
import { useT, resolveLang } from '../lib/i18n';
import { useSmartResults } from '../lib/smartSearch';
import { resolveOmniInput, engineUrl } from '../lib/searchEngines';
import { useBangCatalog, wantsBangs } from '../lib/useBangs';
import { useHistoryStore } from '../lib/historyStore';
import { searchHistory, searchOpenPages, hostLabel, countSince } from '../lib/historySearch';
import { searchVaultEntries } from '../lib/vaultSearch';
import { navigateApp } from '../lib/webviewRegistry';

// Icône + couleur de chaque type de résultat instantané (calcul, conversion…)
const SMART_STYLE = {
  calc: { icon: Calculator, color: '#6366f1' },
  unit: { icon: Ruler, color: '#0ea5e9' },
  currency: { icon: Coins, color: '#f59e0b' },
  fxRefresh: { icon: RefreshCw, color: '#f59e0b' },
  base: { icon: Binary, color: '#8b5cf6' },
  color: { icon: Palette, color: '#ec4899' },
  time: { icon: CalendarClock, color: '#10b981' },
};

// Recherche « partout » : apps, profils ET actions (paramètres, boutique…)
export default function QuickSwitcher({ onClose, onOpenSettings, onOpenStore, onOpenProfileManager, initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(null);
  const inputRef = useRef(null);
  const t = useT();
  const lang = resolveLang(useStore((s) => s.settings?.language));
  const assistantChatEnabled = useStore((s) => s.settings?.assistantChatEnabled !== false);
  const assistantChatShortcutEnabled = useStore((s) => s.settings?.assistantChatShortcutEnabled !== false);
  const assistantChatShortcutKey = useStore((s) => s.settings?.assistantChatShortcutKey);
  // Sources que l'utilisateur laisse interroger (Réglages → Général →
  // Recherche). Absence de réglage = tout actif, comme à l'installation.
  const searchSources = useStore((s) => s.settings?.search);
  const searchHistoryOn = searchSources?.history !== false;
  const searchOpenPagesOn = searchSources?.openPages !== false;
  const searchVault = searchSources?.vault !== false;
  const searchVaultTotp = searchSources?.vaultTotp !== false;
  // Recherche web en repli. Les raccourcis « @moteur » restent actifs même
  // désactivée : taper « @g » est une demande explicite, pas un repli.
  const webSearchOn = searchSources?.web !== false;
  const locale = lang === 'en' ? 'en-US' : 'fr-FR';
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
    openFlyPage,
  } = useStore(
    useShallow((s) => ({ apps: s.apps, profiles: s.profiles, activeApp: s.activeApp, setActiveApp: s.setActiveApp, setActiveProfile: s.setActiveProfile, sidebarCollapsed: s.sidebarCollapsed, setSidebarCollapsed: s.setSidebarCollapsed, toggleAppSleep: s.toggleAppSleep, splitView: s.splitView, clearSplitView: s.clearSplitView, markAllRead: s.markAllRead, adjustAppZoom: s.adjustAppZoom, resetAppZoom: s.resetAppZoom, workspaces: s.workspaces, applyWorkspace: s.applyWorkspace, openFlyPage: s.openFlyPage })),
  );

  // Historique de navigation (recherche transverse). Local à la machine : il
  // n'entre pas dans la synchronisation.
  const history = useHistoryStore((s) => s.entries);
  const forgetPage = useHistoryStore((s) => s.forget);
  const forgetSince = useHistoryStore((s) => s.forgetSince);
  const clearHistory = useHistoryStore((s) => s.clear);
  // Vider l'historique est irréversible : la commande demande confirmation
  // dans la palette elle-même (un second Entrée), sans fenêtre modale qui
  // couperait le fil du clavier.
  //
  // La confirmation retient la RECHERCHE à laquelle elle appartient, et on la
  // considère caduque dès que la saisie change. C'est plus sûr qu'une remise à
  // zéro dans un effet : celle-ci laisse un rendu pendant lequel la recherche a
  // changé alors que la confirmation est encore armée — un « Entrée » rapide
  // pouvait y tomber.
  const [pendingClear, setPendingClear] = useState(null); // { mode, query } | null
  // Heure relevée APRÈS le premier rendu : lire l'horloge pendant le rendu
  // donne une valeur différente à chaque passage. La palette ne vit que le
  // temps d'une recherche, un seul relevé à l'ouverture suffit.
  const [openedAt, setOpenedAt] = useState(0);
  useEffect(() => {
    setOpenedAt(Date.now());
  }, []);

  // Identifiants des trousseaux DÉVERROUILLÉS. Le geste le plus fréquent d'un
  // gestionnaire de mots de passe — « copie-moi celui de ce site » — imposait
  // jusqu'ici d'ouvrir les réglages et de dérouler le coffre.
  //
  // Ce que la palette reçoit : titre, identifiant, site. JAMAIS le mot de
  // passe : la copie est demandée au processus principal, qui écrit lui-même
  // dans le presse-papiers et le vide au bout de 30 s. Un trousseau verrouillé
  // n'apparaît pas du tout (le coffre ne répond rien à son sujet).
  const [vaultEntries, setVaultEntries] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Source désactivée dans les réglages : on ne demande même pas la liste
      // au coffre, plutôt que de la charger pour ne pas l'afficher.
      if (!searchVault) return;
      const api = window.electronAPI?.vault;
      if (!api) return;
      try {
        const state = await api.state();
        const unlocked = (state?.vaults || []).filter((v) => v.unlocked);
        const found = [];
        for (const v of unlocked) {
          const res = await api.entries(v.id);
          if (!res?.success) continue;
          for (const e of res.entries) {
            found.push({ ...e, vaultId: v.id, vaultName: v.name, vaultIcon: v.icon });
          }
        }
        if (!cancelled) setVaultEntries(found);
      } catch {
        /* coffre indisponible : la palette fonctionne sans */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [searchVault]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // « help » → afficher le panneau d'aide complet
  const trimmed = query.trim().toLowerCase();
  const isHelpQuery =
    /^(help|aide|raccourci|shortcut|\?)$/.test(trimmed) ||
    /(raccourci|aide|help|shortcut)/.test(trimmed);

  // Nature de la confirmation en cours, UNIQUEMENT si elle porte encore sur la
  // recherche affichée (déclarée après `trimmed`, dont elle dépend).
  const confirmClear = pendingClear && pendingClear.query === trimmed ? pendingClear.mode : null;

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
      ...(assistantChatEnabled ? [{
        id: 'assistant-chat',
        name: t('assistant.chat.open'),
        subtitle: t('assistant.chat.paletteHint'),
        icon: <Bot size={22} />,
        color: '#8b5cf6',
        keywords: ['assistant', 'ia', 'ai', 'discussion', 'chat', 'rédaction'],
        run: () => window.dispatchEvent(new Event('orbit:assistant-chat-open')),
      }] : []),
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
        id: 'studio',
        name: t('studio.title'),
        subtitle: t('studio.paletteHint'),
        icon: <Clapperboard size={22} />,
        color: '#ec4899',
        keywords: ['enregistrer', 'record', 'video', 'vidéo', 'ecran', 'écran', 'camera', 'caméra', 'studio', 'capture', 'demo', 'tuto'],
        run: () => window.dispatchEvent(new Event('orbit:studio-open')),
      },
      {
        id: 'panic',
        name: 'Mode panique',
        subtitle: 'Tout cacher, couper le son, verrouiller — tout de suite',
        icon: <EyeOff size={22} />,
        color: '#ef4444',
        keywords: ['panique', 'panic', 'cacher', 'masquer', 'urgence', 'boss', 'discret', 'fermer tout'],
        run: () => window.electronAPI?.panic?.trigger?.(),
      },
      {
        id: 'readall',
        name: t('qs.readall'),
        subtitle: t('qs.readallSub'),
        icon: <CheckCheck size={22} />,
        color: '#10b981',
        keywords: ['notification', 'lu', 'badge', 'marquer'],
        run: () => markAllRead(),
      },
      // Historique : l'oubli vit ICI, là où l'historique est consulté. Il
      // était jusqu'ici impossible de vider quoi que ce soit depuis
      // l'interface, alors que la palette propose les pages visitées.
      ...(history.length
        ? [
            {
              id: 'history-hour',
              name:
                confirmClear === 'hour'
                  ? t('qs.history.confirm')
                  : t('qs.history.forgetHour', {
                      n: openedAt ? countSince(history, openedAt - 3600 * 1000) : '…',
                    }),
              subtitle:
                confirmClear === 'hour' ? t('qs.history.confirmSub') : t('qs.history.forgetHourSub'),
              icon: <History size={22} />,
              color: '#f59e0b',
              keywords: ['historique', 'history', 'oublier', 'effacer', 'vider', 'heure', 'recent'],
              keepOpen: true,
              run: () => {
                if (confirmClear !== 'hour') {
                  setPendingClear({ mode: 'hour', query: trimmed });
                  return;
                }
                // Même instant que celui annoncé par le compteur ci-dessus :
                // la commande efface exactement ce qu'elle a chiffré.
                forgetSince(openedAt - 3600 * 1000);
                setPendingClear(null);
              },
            },
            {
              id: 'history-clear',
              name:
                confirmClear === 'all'
                  ? t('qs.history.confirm')
                  : t('qs.history.clear', { n: history.length }),
              subtitle:
                confirmClear === 'all' ? t('qs.history.confirmSub') : t('qs.history.clearSub'),
              icon: <Trash2 size={22} />,
              color: '#ef4444',
              keywords: ['historique', 'history', 'vider', 'effacer', 'supprimer', 'tout', 'clear'],
              keepOpen: true,
              run: () => {
                if (confirmClear !== 'all') {
                  setPendingClear({ mode: 'all', query: trimmed });
                  return;
                }
                clearHistory();
                setPendingClear(null);
              },
            },
          ]
        : []),
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
    assistantChatEnabled,
    history,
    confirmClear,
    trimmed,
    forgetSince,
    clearHistory,
    openedAt,
  ]);

  // Résultats instantanés (calcul, conversions, couleurs, dates, devises)
  const smart = useSmartResults(isHelpQuery ? '' : query, locale);

  // Nature de la saisie : adresse, recherche web, ou raccourci de moteur en
  // cours de frappe (voir src/lib/searchEngines.js). Un seul juge pour la
  // palette ET le champ d'adresse — les deux recevaient la même chose et en
  // tiraient des conclusions différentes.
  // Catalogue de raccourcis (« @amz », « @mdn »…) : chargé à la première
  // saisie de « @ » / « ! », jamais avant.
  const bangCatalog = useBangCatalog(wantsBangs(query) && searchSources?.bangCatalog !== false);
  const bangs = bangCatalog?.index || null;
  const omni = useMemo(
    () => (isHelpQuery ? { kind: 'empty' } : resolveOmniInput(query, { search: searchSources || {}, lang, bangs })),
    [query, isHelpQuery, searchSources, lang, bangs]
  );
  const url = omni.kind === 'url' ? omni.url : null;
  // Moteur annoncé dans le champ : celui du raccourci tapé. Voir le bandeau
  // au-dessus de la liste — savoir OÙ part la recherche avant de valider.
  const activeEngine = omni.kind === 'engines' || omni.kind === 'search' ? omni.engine : null;

  // Copie une valeur dans le presse-papiers et confirme visuellement
  const copyValue = async (id, value) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* presse-papiers refusé : on ne bloque pas la palette */
    }
  };

  // Copie d'un secret du coffre. Rien n'est lu ici : on demande au processus
  // principal d'écrire dans le presse-papiers (il le vide 30 s plus tard).
  const copySecret = async (id, vaultId, entryId, field) => {
    try {
      const res = await window.electronAPI?.vault?.copy(vaultId, entryId, field);
      if (res?.success) {
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
      }
    } catch {
      /* trousseau refermé entre-temps : rien à copier */
    }
  };

  // Les quatre façons d'ouvrir une recherche — les mêmes que pour une adresse
  // tapée, et dans le même ordre : ce qui se ressemble doit se manipuler
  // pareil. Déclaré hors du useMemo des résultats, qui s'en sert deux fois
  // (raccourci explicite en tête de liste, repli en fin de liste).
  const searchRows = useCallback((res) => {
    const label = `${res.engine.name} — « ${res.terms} »`;
    const color = res.engine.color || '#0ea5e9';
    return [
      {
        type: 'search',
        id: 'search-orbit',
        name: t('qs.search.run', { terms: res.terms, engine: res.engine.name }),
        subtitle: `${res.engine.name} — ${t('qs.openUrlOrbitDesc')}`,
        color,
        engine: res.engine,
        action: () => openFlyPage(res.url),
      },
      {
        type: 'search',
        id: 'search-private',
        name: t('qs.openUrlPrivate'),
        subtitle: label,
        color: '#7c3aed',
        engine: res.engine,
        action: () => openFlyPage(res.url, { private: true }),
      },
      {
        type: 'search',
        id: 'search-detached',
        name: t('qs.openUrlDetached'),
        subtitle: label,
        color: '#0d9488',
        engine: res.engine,
        action: () =>
          window.electronAPI?.openDetached?.({
            appId: `palette:${res.url}`,
            url: res.url,
            partition: 'priv:palette-detached',
            title: `${res.engine.name} — ${res.terms}`,
          }),
      },
      {
        type: 'search',
        id: 'search-browser',
        name: t('qs.openUrl'),
        subtitle: label,
        color: '#64748b',
        engine: res.engine,
        action: () => window.open(res.url, '_blank'),
      },
    ];
  }, [t, openFlyPage]);

  // Résultats combinés : instantanés + apps + profils + actions
  const results = useMemo(() => {
    const q = trimmed;
    if (isHelpQuery) return []; // le panneau d'aide remplace la liste

    // « @… » : choix du moteur. La liste des moteurs REMPLACE les résultats —
    // on est au milieu d'un geste précis, mélanger des apps dedans ne ferait
    // que rendre la validation risquée.
    if (omni.kind === 'engines') {
      return omni.engines.slice(0, 10).map((engine) => {
        const ready = Boolean(omni.terms);
        return {
          type: 'engine',
          id: `engine-${engine.id || engine.keyword}`,
          name: engine.name,
          subtitle: ready
            ? t('qs.search.runSub', { terms: omni.terms })
            : t('qs.search.pickSub', { keyword: engine.keyword }),
          color: engine.color || '#6366f1',
          engine,
          // Tab et Entrée font la même chose sur un moteur sans termes :
          // retenir le moteur et rendre la main au clavier.
          complete: `${omni.prefix}${engine.keyword} `,
          keepOpen: !ready,
          action: () => {
            if (ready) {
              openFlyPage(engineUrl(engine, omni.terms, lang));
            } else {
              setQuery(`${omni.prefix}${engine.keyword} `);
              setSelected(0);
            }
          },
        };
      });
    }

    const list = [];

    // Raccourci explicite et termes saisis : l'utilisateur a DIT où chercher.
    // Rien ne passe devant, pas même une app qui porterait le même nom.
    if (omni.kind === 'search' && omni.bang) list.push(...searchRows(omni));

    // Les résultats instantanés passent devant : c'est la réponse cherchée
    smart.cards.forEach((card) =>
      list.push({
        type: 'smart',
        card,
        id: card.id,
        name: card.title,
        subtitle: card.subtitle,
        color: (SMART_STYLE[card.kind] || {}).color || '#6366f1',
        keepOpen: true,
        action: () => {
          // Une carte peut porter un geste (actualiser les taux) au lieu d'une
          // valeur à copier.
          if (card.run) card.run();
          else if (!card.disabled && card.copy) copyValue(card.id, card.copy);
        },
      })
    );

    // Adresse web tapée directement. Par défaut on l'ouvre DANS Orbit, en page
    // volante : c'est le geste attendu quand on a le hub sous les yeux. Le
    // navigateur système reste proposé juste en dessous.
    if (url) {
      list.push({
        type: 'url',
        id: 'smart-url-orbit',
        name: t('qs.openUrlOrbit'),
        subtitle: `${url} — ${t('qs.openUrlOrbitDesc')}`,
        color: '#0ea5e9',
        action: () => openFlyPage(url),
      });
      // Même chose sans rien garder : session en mémoire, pas d'historique,
      // aucun lien avec les apps déjà connectées au même site.
      list.push({
        type: 'url',
        id: 'smart-url-private',
        name: t('qs.openUrlPrivate'),
        subtitle: `${url} — ${t('qs.openUrlPrivateDesc')}`,
        color: '#7c3aed',
        action: () => openFlyPage(url, { private: true }),
      });
      // Fenêtre détachée : une vraie fenêtre Orbit, hors de la barre latérale.
      // C'est le geste « je veux juste voir cette page, sans l'installer » —
      // ni app, ni page volante qui reste ouverte dans l'espace de travail.
      // Session en mémoire : rien n'est gardé sur le disque à la fermeture.
      list.push({
        type: 'url',
        id: 'smart-url-detached',
        name: t('qs.openUrlDetached'),
        subtitle: `${url} — ${t('qs.openUrlDetachedDesc')}`,
        color: '#0d9488',
        action: () =>
          window.electronAPI?.openDetached?.({
            appId: `palette:${url}`,
            url,
            partition: 'priv:palette-detached',
            title: url,
          }),
      });
      list.push({
        type: 'url',
        id: 'smart-url-external',
        name: t('qs.openUrl'),
        subtitle: url,
        color: '#64748b',
        action: () => window.open(url, '_blank'),
      });
    }

    apps
      .filter(
        (app) =>
          // `url` peut manquer : une app jamais ouverte n'en a pas encore, et
          // une page volante fraîchement promue non plus.
          String(app.name || '').toLowerCase().includes(q) ||
          String(app.url || app.homeUrl || '').toLowerCase().includes(q)
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

    // Pages OUVERTES en ce moment : on cherche dans le titre courant de chaque
    // webview. C'est ce qui permet de retrouver « la facture » ouverte dans un
    // onglet Drive, alors que l'app s'appelle juste « Drive ».
    (searchOpenPagesOn ? searchOpenPages(apps, trimmed) : []).forEach((app) =>
      list.push({
        type: 'openPage',
        id: `open-${app.id}`,
        name: app.title,
        subtitle: `${app.name} — ${t('qs.openPage')}`,
        color: app.color || '#10b981',
        action: () => {
          setActiveProfile(app.profileId);
          setActiveApp(app.id);
        },
      })
    );

    // Identifiants du coffre. Jamais sans recherche explicite : en dessous de
    // deux caractères `searchVaultEntries` ne rend rien, pour ne pas dérouler
    // la liste des comptes sur un écran laissé sans surveillance.
    if (searchVault) {
      searchVaultEntries(vaultEntries, q).forEach((entry) =>
        list.push({
          type: 'vault',
          id: `vault-${entry.vaultId}-${entry.id}`,
          name: entry.title,
          subtitle: `${entry.username || t('qs.vault.noUser')} — ${entry.vaultIcon || '🔐'} ${entry.vaultName}`,
          color: '#f59e0b',
          keepOpen: true,
          copyId: `vault-${entry.id}`,
          // La copie est faite par le processus principal : le mot de passe
          // ne traverse pas cette fenêtre.
          action: () => copySecret(`vault-${entry.id}`, entry.vaultId, entry.id, 'password'),
          totp:
            entry.hasTotp && searchVaultTotp
              ? () => copySecret(`totp-${entry.id}`, entry.vaultId, entry.id, 'totp')
              : null,
          totpId: `totp-${entry.id}`,
        })
      );
    }

    // Historique : « cette page vue hier », sans se rappeler dans quelle app.
    // Un clic rouvre la page dans SON app d'origine si elle existe encore,
    // sinon en page volante — l'app a pu être désinstallée depuis.
    (searchHistoryOn ? searchHistory(history, trimmed) : []).forEach((entry) =>
      list.push({
        type: 'history',
        id: `hist-${entry.url}`,
        name: entry.title || hostLabel(entry.url),
        subtitle: `${hostLabel(entry.url)}${entry.appName ? ` — ${entry.appName}` : ''}`,
        color: '#8b5cf6',
        // Oubli d'une seule page, depuis la liste où elle apparaît : c'est là
        // qu'on se rend compte qu'on ne veut pas la garder.
        forget: () => forgetPage(entry.url),
        action: () => {
          const owner = apps.find((a) => a.id === entry.appId);
          if (owner) {
            setActiveProfile(owner.profileId);
            setActiveApp(owner.id);
            navigateApp(owner.id, entry.url);
          } else {
            openFlyPage(entry.url);
          }
        },
      })
    );

    const limited = list.slice(0, 12);

    // Repli : la saisie ne correspond à rien de connu et n'est pas une
    // adresse. Avant, la palette répondait « Aucun résultat » — un cul-de-sac
    // alors que la réponse est à une touche. La recherche web passe donc en
    // DERNIER (elle ne doit jamais voler la place d'une app), et se déploie en
    // entier quand il n'y a vraiment rien d'autre.
    if (webSearchOn && omni.kind === 'search' && !omni.bang) {
      const rows = searchRows(omni);
      return limited.length ? [...limited.slice(0, 11), rows[0]] : rows;
    }

    return limited;
  }, [
    trimmed, isHelpQuery, smart.cards, url, t, apps, profiles, actions,
    setActiveApp, setActiveProfile, openFlyPage, history, forgetPage, vaultEntries,
    searchHistoryOn, searchOpenPagesOn, searchVault, searchVaultTotp,
    omni, webSearchOn, lang, searchRows,
  ]);

  // Navigation clavier
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Tab' && results[selected]?.complete) {
        // Tab complète le raccourci de moteur sélectionné (« @g » → « @g  »)
        // sans lancer la recherche : c'est la convention de toutes les barres
        // d'adresse, et ça laisse le temps de voir QUEL moteur a été retenu.
        e.preventDefault();
        setQuery(results[selected].complete);
        setSelected(0);
      } else if (e.key === 'Enter' && results[selected]) {
        e.preventDefault();
        const r = results[selected];
        r.action();
        if (!r.keepOpen) onClose();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey && results[selected]?.forget) {
        // Maj+Suppr sur une page d'historique : on l'oublie sans quitter la
        // palette ni la souris. Maj est exigé pour ne pas effacer une page en
        // voulant corriger la recherche.
        e.preventDefault();
        results[selected].forget();
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
      <div className="w-[min(92vw,64rem)] max-w-5xl bg-bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
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
          {/* Moteur retenu, affiché DANS le champ : « @g » ne dit rien à qui
              ne connaît pas encore ses raccourcis. La pastille répond à la
              seule question qui compte avant de valider — où ça part. */}
          {activeEngine && (
            <span
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
              style={{
                color: activeEngine.color || 'var(--accent-primary)',
                borderColor: `${activeEngine.color || '#6366f1'}66`,
                backgroundColor: `${activeEngine.color || '#6366f1'}1a`,
              }}
              title={t('qs.search.engineChip', { engine: activeEngine.name })}
            >
              <Search size={12} />
              {activeEngine.name}
            </span>
          )}
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
                  {shortcutKeys(t, {
                    assistantChatEnabled,
                    assistantChatShortcutEnabled,
                    assistantChatShortcutKey,
                  }).map((s, i) => (
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
                  {[t('qs.tip1'), t('qs.tip2'), t('qs.tip3'), t('qs.tip4'), t('qs.tip5')].map((tip, i) => (
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
                      style={{
                        backgroundColor:
                          result.type === 'smart' && result.card.swatch
                            ? result.card.swatch
                            : `${result.color}20`,
                      }}
                    >
                      {result.type === 'app' ? (
                        <AppIcon app={result.app} className="w-6 h-6 rounded" fallbackClassName="text-2xl" />
                      ) : result.type === 'smart' ? (
                        result.card.swatch ? null : (
                          (() => {
                            const Icon = (SMART_STYLE[result.card.kind] || SMART_STYLE.calc).icon;
                            return <Icon size={22} style={{ color: result.color }} />;
                          })()
                        )
                      ) : result.type === 'url' ? (
                        <Globe size={22} style={{ color: result.color }} />
                      ) : result.type === 'search' || result.type === 'engine' ? (
                        <Search size={22} style={{ color: result.color }} />
                      ) : result.type === 'openPage' ? (
                        <PanelsTopLeft size={22} style={{ color: result.color }} />
                      ) : result.type === 'history' ? (
                        <History size={22} style={{ color: result.color }} />
                      ) : result.type === 'vault' ? (
                        <KeyRound size={22} style={{ color: result.color }} />
                      ) : result.type === 'action' ? (
                        result.icon
                      ) : (
                        <span className="text-2xl leading-none">{result.emoji}</span>
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      {/* Un résultat instantané met la RÉPONSE en avant : gros
                          chiffre lisible, l'expression saisie en dessous. */}
                      <div
                        className={
                          result.type === 'smart' && result.card.copy
                            ? 'text-xl font-semibold truncate tabular-nums'
                            : 'font-medium truncate'
                        }
                      >
                        {result.name}
                      </div>
                      <div className="text-sm text-text-muted truncate">{result.subtitle}</div>
                    </div>
                    {/* Oubli d'une page d'historique. Un <span> et non un
                        <button> : la ligne entière EST déjà un bouton, et
                        imbriquer deux boutons donne un HTML invalide. */}
                    {result.forget && (
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={t('qs.history.forgetOne')}
                        title={t('qs.history.forgetOne')}
                        onClick={(e) => {
                          e.stopPropagation();
                          result.forget();
                        }}
                        className="flex-shrink-0 p-1.5 rounded-lg text-text-muted hover:text-error hover:bg-error/10"
                      >
                        <Trash2 size={16} />
                      </span>
                    )}
                    {/* Code à usage unique, quand l'entrée en a un : un
                        second geste à portée de main, sans quitter la palette. */}
                    {result.totp && (
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={t('qs.vault.copyTotp')}
                        title={t('qs.vault.copyTotp')}
                        onClick={(e) => {
                          e.stopPropagation();
                          result.totp();
                        }}
                        className="flex-shrink-0 px-2 py-1 rounded-lg border border-border text-[11px] text-text-muted hover:text-accent-primary hover:border-accent-primary"
                      >
                        {copied === result.totpId ? t('qs.copied') : 'TOTP'}
                      </span>
                    )}
                    {/* Raccourci du moteur, à droite de son nom : la liste des
                        moteurs sert aussi à APPRENDRE les raccourcis, pas
                        seulement à en choisir un à la souris. */}
                    {result.type === 'engine' && (
                      <span className="flex-shrink-0 flex items-center gap-1.5 text-xs text-text-muted">
                        <kbd className="px-1.5 py-0.5 bg-bg-elevated border border-border rounded font-mono">
                          @{result.engine.keyword}
                        </kbd>
                        {index === selected && result.keepOpen && (
                          <kbd className="px-1.5 py-0.5 bg-bg-elevated border border-border rounded">
                            ⇥
                          </kbd>
                        )}
                      </span>
                    )}
                    {result.type === 'vault' ? (
                      copied === result.copyId ? (
                        <span className="flex items-center gap-1 text-xs text-success flex-shrink-0">
                          <Check size={16} /> {t('qs.vault.copied')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                          <Copy size={16} /> {t('qs.vault.copy')}
                        </span>
                      )
                    ) : result.type === 'smart' && result.card.run ? (
                      <RefreshCw size={18} className="text-text-muted flex-shrink-0" />
                    ) : result.type === 'smart' && !result.card.disabled ? (
                      copied === result.card.id ? (
                        <span className="flex items-center gap-1 text-xs text-success flex-shrink-0">
                          <Check size={16} /> {t('qs.copied')}
                        </span>
                      ) : (
                        <Copy size={18} className="text-text-muted flex-shrink-0" />
                      )
                    ) : (
                      <ArrowRight size={18} className="text-text-muted flex-shrink-0" />
                    )}
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
          <span className="hidden sm:inline">
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">4*4</kbd>{' '}
            {t('qs.hintCalc')}
          </span>
          <span className="hidden sm:inline">
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">@</kbd>{' '}
            {t('qs.hintEngines')}
          </span>
          <span>
            <kbd className="px-2 py-1 bg-bg-elevated border border-border rounded">esc</kbd> {t('qs.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
