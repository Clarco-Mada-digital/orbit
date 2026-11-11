import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Battery,
  Bell,
  BellOff,
  BellRing,
  Bluetooth,
  BluetoothOff,
  ChevronLeft,
  ChevronRight,
  FolderUp,
  Grip,
  Home,
  Loader2,
  Monitor,
  Moon,
  Phone,
  PhoneOff,
  Pin,
  Power,
  Smartphone,
  Square,
  Upload,
  User,
  Vibrate,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { usePhoneStore } from '../lib/phoneStore';
import { describeCallNotification, describeCallState, phoneCallKey } from '../lib/phone';

const api = () => window.electronAPI?.phone;
const DOCK_POSITION_KEY = 'orbit.phone.pinned-dock-position.v1';
// La pastille tenait 52 px en permanence au-dessus du contenu. Réduite, et
// surtout REPLIABLE : collée à un bord, elle ne laisse qu'une languette.
const DOCK_SIZE = 44;
// Largeur de la languette repliée : assez pour être saisie à la souris, assez
// peu pour qu'on oublie qu'elle est là.
const TAB_WIDTH = 16;
const DOCK_MARGIN = 12;

// Bord contre lequel la pastille est rangée, ou null quand elle flotte. Le
// repli est AUTOMATIQUE : on pousse la pastille contre un bord et elle se
// range, on la tire vers le centre et elle revient entière. Pas de réglage à
// trouver, c'est le geste qui le dit.
function edgeOf(position) {
  if (position.x >= 0.995) return 'right';
  if (position.x <= 0.005) return 'left';
  return null;
}

function readDockPosition() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DOCK_POSITION_KEY) || 'null');
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
      return { x: Math.max(0, Math.min(1, saved.x)), y: Math.max(0, Math.min(1, saved.y)) };
    }
  } catch (err) {
    console.warn('[orbit] position des applications épinglées indisponible:', err);
  }
  return { x: 1, y: 1 };
}

// Pastille de l'appelant : ses initiales. Un numéro n'en a pas (on garde alors
// l'icône de téléphone, plus lisible que « 06 »).
function callerInitials(name) {
  return String(name || '')
    .split(/[\s'’-]+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function formatRinging(seconds) {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`;
}

// Durée d'une conversation, à la façon d'un dialer : « 01:23 ». La sonnerie,
// elle, se compte en secondes (« 12 s ») — c'est le même écran, pas le même
// moment.
function formatTalking(seconds) {
  const min = Math.floor(seconds / 60);
  return `${String(min).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function PhoneFloatingAccess() {
  const activeCall = usePhoneStore((state) => state.activeCall);
  const notifications = usePhoneStore((state) => state.notifications);
  const [serial, setSerial] = useState(null);
  const [device, setDevice] = useState(null);
  const [mirrorRunning, setMirrorRunning] = useState(false);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // Compte rendu d'un envoi réussi : « 12 fichiers envoyés… ». Sans lui, un
  // transfert de dossier se terminait sans que rien ne bouge à l'écran.
  const [report, setReport] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dockPosition, setDockPosition] = useState(readDockPosition);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const dockRef = useRef(null);
  // Pendant le déplacement, la pastille reprend sa taille entière : on saisit
  // mal une languette de seize pixels qui reste collée au bord.
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const notificationCounts = useMemo(() => {
    const pinnedPackages = new Set(apps.map((app) => app.package));
    const counts = new Map();
    for (const notification of notifications) {
      if (pinnedPackages.has(notification.package)) {
        counts.set(notification.package, (counts.get(notification.package) || 0) + 1);
      }
    }
    return counts;
  }, [apps, notifications]);
  const pinnedNotificationCount = [...notificationCounts.values()].reduce((total, count) => total + count, 0);

  // Qui appelle : le processus principal a déjà résolu le contact quand il a
  // pu ; l'inventaire local complète le nom de l'application qui sonne.
  const caller = useMemo(() => {
    const notification = activeCall?.notification;
    if (!notification) return null;
    const appName =
      notification.appName || apps.find((app) => app.package === notification.package)?.name || '';
    return describeCallNotification(notification, appName);
  }, [activeCall, apps]);

  // Où en est l'appel. La notification le dit (elle passe de « Appel entrant »
  // à « Appel en cours ») ; un décrochage fait depuis Orbit le dit aussi, et
  // plus vite qu'elle. Dans ce cas c'est lui qui fait foi : on est déjà dans la
  // conversation, il n'y a plus rien à décrocher.
  const callPhase = useMemo(() => {
    if (!activeCall) return null;
    if (activeCall.answeredAt) return 'ongoing';
    return describeCallState(activeCall.notification);
  }, [activeCall]);

  // Une seule horloge pour les deux compteurs : « sonne depuis » tant que ça
  // sonne, puis la durée de la conversation une fois décroché.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!activeCall) return undefined;
    // Premier battement dans une tâche, pas dans le corps de l'effet : le
    // compteur doit partir de l'instant, pas de la dernière fois où il a couru.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [activeCall?.notification?.key, activeCall?.answeredAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const ringStartedAt = Number(activeCall?.notification?.when) || 0;
  const ringing =
    callPhase === 'ringing' && ringStartedAt
      ? Math.max(0, Math.round((now - ringStartedAt) / 1000))
      : 0;
  const answeredAt = Number(activeCall?.answeredAt) || 0;
  const talking = answeredAt ? Math.max(0, Math.round((now - answeredAt) / 1000)) : 0;
  const callLabel =
    callPhase === 'ringing' ? 'Appel entrant' : callPhase === 'outgoing' ? 'Appel sortant' : 'Appel en cours';

  const maxLeft = Math.max(0, viewport.width - DOCK_SIZE);
  const maxTop = Math.max(0, viewport.height - DOCK_SIZE);
  const dockLeft = Math.round(dockPosition.x * maxLeft);
  const dockTop = Math.round(dockPosition.y * maxTop);
  // Repliée tant qu'on ne s'en sert pas : ouverte ou en cours de déplacement,
  // elle redevient une pastille ordinaire.
  const edge = !dragging && !expanded ? edgeOf(dockPosition) : null;
  const dockWidth = edge ? TAB_WIDTH : DOCK_SIZE;
  const dockRenderLeft = edge === 'right' ? viewport.width - TAB_WIDTH : edge === 'left' ? 0 : dockLeft;
  // Le panneau porte maintenant deux choses : les applications épinglées ET
  // les raccourcis du téléphone. Il lui faut la place des deux.
  const panelWidth = Math.max(1, Math.min(304, viewport.width - DOCK_MARGIN * 2));
  const panelHeight = Math.max(1, Math.min(420, viewport.height - DOCK_MARGIN * 2));
  const panelLeft = Math.max(
    DOCK_MARGIN,
    Math.min(viewport.width - panelWidth - DOCK_MARGIN, dockLeft + DOCK_SIZE / 2 - panelWidth / 2)
  );
  const panelTop = Math.max(
    DOCK_MARGIN,
    Math.min(
      viewport.height - panelHeight - DOCK_MARGIN,
      dockTop > panelHeight + DOCK_MARGIN * 2
        ? dockTop - panelHeight - DOCK_MARGIN
        : dockTop + DOCK_SIZE + DOCK_MARGIN
    )
  );

  const refresh = useCallback(async () => {
    try {
      const state = await api()?.status();
      if (!state?.success) {
        setSerial(null);
        setDevice(null);
        setApps([]);
        setExpanded(false);
        return;
      }
      const activeSerial = state.serial || null;
      setSerial(activeSerial);
      setDevice(state.device || null);
      setMirrorRunning(Boolean(state.mirror?.running));
      if (!activeSerial || !state.settings?.pinnedPackages?.length) {
        setApps([]);
        setExpanded(false);
        return;
      }
      const result = await api()?.listApps({
        serial: activeSerial,
        showSystemApps: state.settings.showSystemApps,
      });
      if (!result?.success) {
        setApps([]);
        setExpanded(false);
        return;
      }
      const byPackage = new Map((result.apps || []).map((app) => [app.package, app]));
      const pinned = state.settings.pinnedPackages
        .map((pkg) => byPackage.get(pkg))
        .filter(Boolean);
      const withIcons = await Promise.all(pinned.map(async (app) => {
        try {
          const icon = await api()?.getIcon({ serial: activeSerial, package: app.package });
          return { ...app, icon: icon?.success ? icon.icon : null };
        } catch (err) {
          console.error('[orbit] icône d’application téléphone indisponible:', err);
          return { ...app, icon: null };
        }
      }));
      setApps(withIcons);
    } catch (err) {
      console.error('[orbit] chargement des applications épinglées impossible:', err);
      setSerial(null);
      setDevice(null);
      setApps([]);
      setExpanded(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(refresh);
    const onPinsChanged = () => refresh();
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('orbit:phone-pins-changed', onPinsChanged);
    window.addEventListener('resize', onResize);
    // Le miroir peut être fermé depuis sa propre fenêtre : sans cet abonnement
    // le raccourci resterait bloqué sur « Fermer le miroir ».
    const offMirror = api()?.onMirrorStopped?.(() => setMirrorRunning(false));
    const timer = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener('orbit:phone-pins-changed', onPinsChanged);
      window.removeEventListener('resize', onResize);
      offMirror?.();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!expanded) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!dockRef.current?.contains(event.target)) setExpanded(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded]);

  const onDockPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: dockLeft,
      startTop: dockTop,
      lastPosition: dockPosition,
      moved: false,
    };
  };

  const onDockPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 6) return;
    drag.moved = true;
    suppressClickRef.current = true;
    setDragging(true);
    const next = {
      x: maxLeft ? Math.max(0, Math.min(1, (drag.startLeft + deltaX) / maxLeft)) : 0,
      y: maxTop ? Math.max(0, Math.min(1, (drag.startTop + deltaY) / maxTop)) : 0,
    };
    drag.lastPosition = next;
    setDockPosition(next);
  };

  const onDockPointerUp = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (drag.moved) {
      try {
        window.localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(drag.lastPosition));
      } catch (err) {
        console.error('[orbit] mémorisation de la position des applications épinglées échouée:', err);
      }
    }
  };

  const onDockPointerCancel = (event) => {
    onDockPointerUp(event);
    suppressClickRef.current = false;
  };

  const launch = async (app) => {
    if (!serial || busy) return;
    setBusy(app.package);
    setError('');
    setExpanded(false);
    try {
      const result = await api()?.startApp({
        serial,
        package: app.package,
        name: app.name || app.package,
      });
      if (!result?.success) setError(result?.error || `Impossible d’ouvrir ${app.name}.`);
    } catch (err) {
      console.error('[orbit] ouverture de l’application téléphone épinglée échouée:', err);
      setError(String(err.message || err));
    } finally {
      setBusy('');
    }
  };

  const unpin = async (app) => {
    try {
      const current = await api()?.getSettings();
      if (!current?.success) throw new Error(current?.error || 'Réglages du téléphone indisponibles.');
      const pinnedPackages = (current.settings?.pinnedPackages || [])
        .filter((pkg) => pkg !== app.package);
      const result = await api()?.setSettings({ pinnedPackages });
      if (!result?.success) throw new Error(result?.error || 'Impossible de retirer cette application.');
      setApps((items) => items.filter((item) => item.package !== app.package));
      if (apps.length <= 1) setExpanded(false);
      window.dispatchEvent(new Event('orbit:phone-pins-changed'));
    } catch (err) {
      console.error('[orbit] retrait d’une application téléphone épinglée échoué:', err);
      setError(String(err.message || err));
    }
  };

  // Raccourcis du téléphone. Tous passent par le même garde : un seul à la
  // fois, l'erreur s'affiche dans le panneau, et le panneau reste ouvert (on
  // enchaîne souvent « réveiller » puis « accueil »).
  const runShortcut = async (id, action) => {
    if (!serial || busy) return;
    setBusy(id);
    setError('');
    setReport('');
    try {
      const result = await action();
      if (result && result.success === false && !result.cancelled) {
        setError(result.error || 'Le téléphone n’a pas accepté la commande.');
      }
    } catch (err) {
      console.error('[orbit] raccourci téléphone échoué:', err);
      setError(String(err.message || err));
    } finally {
      setBusy('');
    }
  };

  const toggleMirror = () =>
    runShortcut('mirror', async () => {
      if (mirrorRunning) {
        const result = await api()?.stopMirror();
        if (result?.success !== false) setMirrorRunning(false);
        return result;
      }
      const result = await api()?.startMirror({ serial, title: device?.model || 'Téléphone' });
      if (result?.success) setMirrorRunning(true);
      return result;
    });

  // Envoi vers le téléphone. Le sélecteur accepte PLUSIEURS entrées : un
  // transfert, c'est autant de fichiers que l'on veut — ou un dossier, dont
  // l'arborescence est recréée dans les téléchargements.
  const sendTo = (folder) =>
    runShortcut(folder ? 'folder' : 'files', async () => {
      const result = await api()?.sendFiles({ serial, folder });
      if (result?.cancelled) return null;
      const count = result?.sent?.length || 0;
      if (count) {
        setReport(
          `${count} fichier${count > 1 ? 's' : ''} envoyé${count > 1 ? 's' : ''} dans ${result.directory || 'les téléchargements'}.`
        );
      }
      return result;
    });

  // Les bascules d'état lisent la réponse du téléphone (le processus principal
  // RELIT le mode après l'avoir posé) plutôt que de supposer que l'ordre est
  // passé : un appareil qui refuse ne doit pas laisser un bouton allumé.
  const patchDevice = (fields) => setDevice((current) => ({ ...(current || {}), ...fields }));

  const toggleRinger = () =>
    runShortcut('ringer', async () => {
      const next = device?.ringerMode === 'normal' ? 'vibrate' : 'normal';
      const result = await api()?.setRingerMode({ serial, mode: next });
      if (result?.ringerMode) patchDevice({ ringerMode: result.ringerMode });
      return result;
    });

  const toggleDnd = () =>
    runShortcut('dnd', async () => {
      const result = await api()?.setDnd({ serial, enabled: device?.doNotDisturb !== true });
      if (typeof result?.doNotDisturb === 'boolean') patchDevice({ doNotDisturb: result.doNotDisturb });
      return result;
    });

  const toggleRadio = (radio) =>
    runShortcut(radio, async () => {
      const field = radio === 'wifi' ? 'wifiEnabled' : 'bluetoothEnabled';
      const enabled = device?.[field] !== true;
      const result = await api()?.setRadio({ serial, radio, enabled });
      if (result?.success) patchDevice({ [field]: enabled });
      return result;
    });

  const ringer = device?.ringerMode || null;
  const ringerIcon = ringer === 'vibrate' ? Vibrate : ringer === 'silent' ? BellOff : BellRing;
  const ringerLabel = ringer === 'vibrate' ? 'Vibreur' : ringer === 'silent' ? 'Silencieux' : 'Sonnerie';

  // Une tuile allumée veut dire « cet état est actif sur le téléphone », pas
  // « ce bouton est sélectionné » : d'où la même teinte pour le miroir ouvert,
  // le Wi-Fi activé et le vibreur.
  const tileClass = (active) =>
    `flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[10px] font-medium transition disabled:opacity-40 ${
      active
        ? 'border-violet-300/30 bg-violet-400/15 text-violet-100 hover:bg-violet-400/25'
        : 'border-white/10 bg-white/[0.05] text-white/75 hover:bg-white/[0.12] hover:text-white'
    }`;
  const iconClass = (active) =>
    `rounded-xl p-2 transition disabled:opacity-40 ${
      active
        ? 'bg-violet-400/15 text-violet-100 hover:bg-violet-400/25'
        : 'text-white/65 hover:bg-white/10 hover:text-white'
    }`;

  // Décrocher laisse le bandeau en place — il passe à « Terminer ». Refuser et
  // terminer ferment l'appel : c'est la même touche Android, `end_call`.
  const actOnCall = async (action) => {
    const key = phoneCallKey(action);
    if (!key || !activeCall?.serial || busy) return;
    setBusy('call');
    setError('');
    try {
      const result = await api()?.key({ serial: activeCall.serial, key });
      if (!result?.success) {
        setError(result?.error || 'Le téléphone n’a pas accepté la commande d’appel.');
        return;
      }
      const store = usePhoneStore.getState();
      if (action === 'answer') store.markCallAnswered();
      else store.setActiveCall(null);
    } catch (err) {
      console.error('[orbit] action sur l’appel du téléphone échouée:', err);
      setError(String(err.message || err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      {activeCall && (
        <section
          role="alert"
          aria-live="assertive"
          className="fixed right-4 top-4 z-[13000] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/15 bg-slate-950/85 text-white shadow-2xl shadow-black/30 backdrop-blur-2xl"
        >
          <div className="flex items-start gap-3 p-4">
            <span
              aria-hidden="true"
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                callPhase === 'ringing'
                  ? 'bg-emerald-400/15 text-emerald-200'
                  : 'bg-white/10 text-white/75'
              }`}
            >
              {caller?.unknown
                ? <User size={19} />
                : callerInitials(caller?.named ? caller.who : '') || <Phone size={19} />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={`flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${
                  callPhase === 'ringing' ? 'text-emerald-200/80' : 'text-white/60'
                }`}
              >
                {callLabel}
                {ringing > 0 && ringing < 600 && (
                  <span className="font-normal normal-case tracking-normal text-white/40">
                    · sonne depuis {formatRinging(ringing)}
                  </span>
                )}
                {talking > 0 && (
                  <span className="font-normal normal-case tracking-normal tabular-nums text-white/40">
                    · {formatTalking(talking)}
                  </span>
                )}
              </p>
              <p className="mt-1 truncate text-base font-semibold" title={caller?.who}>
                {caller?.unknown ? 'Appelant inconnu' : caller?.who}
              </p>
              {caller?.detail && (
                <p className="mt-0.5 truncate text-xs text-white/55">{caller.detail}</p>
              )}
              {caller?.unknown && (
                <p className="mt-0.5 truncate text-xs text-white/40">
                  Aucune identité transmise par {caller.who}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => usePhoneStore.getState().dismissCall()}
              className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white"
              aria-label="Fermer l’alerte d’appel"
            >
              <X size={15} />
            </button>
          </div>
          {error && <p role="status" className="px-4 pb-2 text-xs text-rose-300">{error}</p>}
          {/* Seul un appel qui SONNE se décroche ou se refuse. Une conversation
              établie (ou un appel sortant) n'a qu'une action : la terminer —
              proposer « Décrocher » sur un appel déjà pris n'aurait aucun sens. */}
          {callPhase === 'ringing' ? (
            <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => actOnCall('reject')}
                disabled={busy === 'call'}
                className="flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2.5 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
              >
                <PhoneOff size={16} /> Refuser
              </button>
              <button
                type="button"
                onClick={() => actOnCall('answer')}
                disabled={busy === 'call'}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500/20 px-3 py-2.5 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-50"
              >
                <Phone size={16} /> Décrocher
              </button>
            </div>
          ) : (
            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => actOnCall('end')}
                disabled={busy === 'call'}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500/20 px-3 py-2.5 text-sm font-medium text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-50"
              >
                <PhoneOff size={16} /> Terminer l’appel
              </button>
            </div>
          )}
          {/* Dernier recours quand Orbit ne sait pas qui appelle (ou pour un
              appel vidéo) : l'écran du téléphone, qui l'affiche toujours. */}
          <button
            type="button"
            onClick={() => usePhoneStore.getState().requestOpen(activeCall.notification.package)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-[11px] font-medium text-white/55 transition hover:bg-white/5 hover:text-white"
          >
            <Monitor size={13} /> Voir l’écran du téléphone
          </button>
        </section>
      )}
      {apps.length > 0 && serial && (
        <div
          ref={dockRef}
          className="fixed z-[11000]"
          style={{ left: dockRenderLeft, top: dockTop, width: dockWidth, height: DOCK_SIZE }}
        >
          {expanded && (
            <section
              aria-label="Accès rapide au téléphone"
              className="absolute flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950/90 text-white shadow-2xl shadow-black/40 backdrop-blur-2xl"
              style={{
                left: panelLeft - dockRenderLeft,
                top: panelTop - dockTop,
                width: panelWidth,
                maxHeight: panelHeight,
              }}
            >
              {/* En-tête : on sait de quel téléphone on parle avant de toucher
                  à quoi que ce soit (plusieurs appareils peuvent défiler). */}
              <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-400/15 text-violet-200">
                  <Smartphone size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{device?.model || 'Téléphone'}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-white/45">
                    {mirrorRunning ? 'Miroir ouvert' : device?.android ? `Android ${device.android}` : 'Connecté à Orbit'}
                  </span>
                </span>
                {typeof device?.battery === 'number' && (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.06] px-1.5 py-1 text-[10px] tabular-nums text-white/70"
                    title={device.charging ? 'En charge' : 'Niveau de batterie'}
                  >
                    <Battery size={12} />
                    {device.battery}%
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Fermer l’accès rapide au téléphone"
                  className="shrink-0 rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </header>

              {/* Un seul conteneur défilant pour les applications ET les
                  raccourcis : sur un petit écran, c'est la liste du bas qui
                  disparaissait sous le bord de la fenêtre. */}
              <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="px-3 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                  <Pin size={11} className="text-violet-300" />
                  Épinglées
                  <span className="ml-auto rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal tabular-nums text-white/55">
                    {apps.length}
                  </span>
                </div>
                {/* Grille fixe à quatre colonnes : jamais de défilement
                    horizontal, les noms se coupent plutôt que de pousser la
                    rangée hors du panneau. */}
                <nav aria-label="Applications Android épinglées" className="grid grid-cols-4 gap-x-2 gap-y-3">
                  {apps.map((app) => (
                    <div key={app.package} className="group relative min-w-0 text-center">
                      {notificationCounts.get(app.package) > 0 && (
                        <span
                          aria-label={`${notificationCounts.get(app.package)} notification${notificationCounts.get(app.package) === 1 ? '' : 's'}`}
                          className="absolute -right-1 -top-1 z-10 grid h-[18px] min-w-[18px] place-items-center rounded-full border border-slate-950 bg-rose-500 px-1 text-[9px] font-bold text-white"
                        >
                          {notificationCounts.get(app.package) > 99 ? '99+' : notificationCounts.get(app.package)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => launch(app)}
                        disabled={Boolean(busy)}
                        title={`Ouvrir ${app.name}`}
                        aria-label={`Ouvrir ${app.name}`}
                        className="mx-auto grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-[10px] font-semibold text-white/80 transition hover:-translate-y-0.5 hover:bg-white/20 disabled:opacity-50"
                      >
                        {busy === app.package
                          ? <Loader2 size={16} className="animate-spin" />
                          : app.icon
                            ? <img src={app.icon} alt="" draggable={false} className="h-full w-full object-contain" />
                            : app.name.slice(0, 2).toUpperCase()}
                      </button>
                      <span className="mt-1 block truncate text-[10px] leading-tight text-white/65" title={app.name}>
                        {app.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => unpin(app)}
                        title={`Désépingler ${app.name}`}
                        aria-label={`Désépingler ${app.name}`}
                        className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full border border-white/20 bg-slate-800 text-white/70 opacity-0 transition hover:bg-rose-500 hover:text-white focus:opacity-100 group-hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </nav>
              </div>

              {/* Raccourcis : ce que les applications épinglées ne savent pas
                  faire — le miroir, le volet Android, la sonnerie, la
                  connectivité, la navigation, un envoi de fichiers ou de
                  dossier. Sans ouvrir l'app Téléphone. */}
              <div className="border-t border-white/10 px-3 py-2.5">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/45">Raccourcis</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={toggleMirror}
                    disabled={Boolean(busy)}
                    title={mirrorRunning ? 'Fermer la fenêtre miroir' : 'Ouvrir l’écran du téléphone dans une fenêtre'}
                    className={tileClass(mirrorRunning)}
                  >
                    {busy === 'mirror' ? <Loader2 size={15} className="animate-spin" /> : <Monitor size={15} />}
                    {mirrorRunning ? 'Fermer' : 'Miroir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => runShortcut('shade', () => api()?.expandShade({ serial }))}
                    disabled={Boolean(busy)}
                    title="Déplier le volet de notifications sur le téléphone"
                    className={tileClass(false)}
                  >
                    {busy === 'shade' ? <Loader2 size={15} className="animate-spin" /> : <Bell size={15} />}
                    Volet
                  </button>
                  {/* Le mode sonnerie se BASCULE entre sonnerie et vibreur. Le
                      silencieux n'est pas proposé : aucune commande ADB ne le
                      pose de façon fiable (voir setRingerMode) — s'il est posé
                      sur le téléphone, la tuile l'affiche et le premier clic
                      rend la sonnerie. */}
                  <button
                    type="button"
                    onClick={toggleRinger}
                    disabled={Boolean(busy) || !ringer}
                    aria-pressed={ringer === 'vibrate' || ringer === 'silent'}
                    title={
                      ringer
                        ? `${ringerLabel} — passer en ${ringer === 'normal' ? 'vibreur' : 'sonnerie'}`
                        : 'Mode sonnerie illisible sur cet appareil'
                    }
                    className={tileClass(ringer === 'vibrate' || ringer === 'silent')}
                  >
                    {busy === 'ringer'
                      ? <Loader2 size={15} className="animate-spin" />
                      : (() => {
                          const Icon = ringerIcon;
                          return <Icon size={15} />;
                        })()}
                    {ringer ? ringerLabel : 'Sonnerie'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleDnd}
                    disabled={Boolean(busy)}
                    aria-pressed={device?.doNotDisturb === true}
                    title={device?.doNotDisturb === true ? 'Désactiver Ne pas déranger' : 'Activer Ne pas déranger'}
                    className={tileClass(device?.doNotDisturb === true)}
                  >
                    {busy === 'dnd' ? <Loader2 size={15} className="animate-spin" /> : <Moon size={15} />}
                    Ne pas déranger
                  </button>
                  <button
                    type="button"
                    onClick={() => sendTo(false)}
                    disabled={Boolean(busy)}
                    title="Envoyer un ou plusieurs fichiers dans les téléchargements du téléphone"
                    className={tileClass(false)}
                  >
                    {busy === 'files' ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    Fichiers
                  </button>
                  <button
                    type="button"
                    onClick={() => sendTo(true)}
                    disabled={Boolean(busy)}
                    title="Envoyer un dossier entier : l’arborescence est recréée dans les téléchargements"
                    className={tileClass(false)}
                  >
                    {busy === 'folder' ? <Loader2 size={15} className="animate-spin" /> : <FolderUp size={15} />}
                    Dossier
                  </button>
                </div>

                {/* Connectivité et volume : des bascules dont l'état se LIT sur
                    le téléphone, donc des icônes qui changent avec lui. */}
                <div className="mt-2 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => toggleRadio('wifi')}
                    disabled={Boolean(busy)}
                    aria-pressed={device?.wifiEnabled === true}
                    title={`Wi-Fi ${device?.wifiEnabled === true ? 'activé — désactiver' : device?.wifiEnabled === false ? 'désactivé — activer' : '(état inconnu)'}`}
                    aria-label="Wi-Fi"
                    className={iconClass(device?.wifiEnabled === true)}
                  >
                    {busy === 'wifi'
                      ? <Loader2 size={14} className="animate-spin" />
                      : device?.wifiEnabled === false
                        ? <WifiOff size={14} />
                        : <Wifi size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRadio('bluetooth')}
                    disabled={Boolean(busy)}
                    aria-pressed={device?.bluetoothEnabled === true}
                    title={`Bluetooth ${device?.bluetoothEnabled === true ? 'activé — désactiver' : device?.bluetoothEnabled === false ? 'désactivé — activer' : '(état inconnu)'}`}
                    aria-label="Bluetooth"
                    className={iconClass(device?.bluetoothEnabled === true)}
                  >
                    {busy === 'bluetooth'
                      ? <Loader2 size={14} className="animate-spin" />
                      : device?.bluetoothEnabled === false
                        ? <BluetoothOff size={14} />
                        : <Bluetooth size={14} />}
                  </button>
                  <span className="mx-1 h-5 w-px bg-white/10" />
                  {[
                    ['volume_down', Volume1, 'Baisser le volume'],
                    ['mute', VolumeX, 'Couper le son'],
                    ['volume_up', Volume2, 'Augmenter le volume'],
                  ].map(([key, Icon, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => runShortcut(key, () => api()?.key({ serial, key }))}
                      disabled={Boolean(busy)}
                      title={label}
                      aria-label={label}
                      className={iconClass(false)}
                    >
                      {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                    </button>
                  ))}
                </div>

                <div className="mt-0.5 flex items-center gap-0.5">
                  {[
                    ['back', ArrowLeft, 'Retour'],
                    ['home', Home, 'Accueil du téléphone'],
                    ['recents', Square, 'Applications récentes'],
                    ['wakeup', Power, 'Réveiller l’écran'],
                  ].map(([key, Icon, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => runShortcut(key, () => api()?.key({ serial, key }))}
                      disabled={Boolean(busy)}
                      title={label}
                      aria-label={label}
                      className={iconClass(false)}
                    >
                      {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(false);
                      usePhoneStore.getState().requestOpen(null);
                    }}
                    className="ml-auto rounded-lg px-2 py-1.5 text-[10px] font-medium text-violet-200/85 transition hover:bg-white/10 hover:text-violet-100"
                    title="Ouvrir l’app Téléphone dans Orbit"
                  >
                    Ouvrir le Téléphone
                  </button>
                </div>
              </div>
              </div>
              {/* Compte rendu d'envoi et erreurs : hors du défilement, pour ne
                  pas répondre dans une zone qu'il faut aller chercher. */}
              {(error || report) && (
                <p
                  role="status"
                  className={`shrink-0 border-t px-3 py-2 text-[10px] leading-relaxed ${
                    error ? 'border-rose-400/20 bg-rose-500/10 text-rose-200' : 'border-white/10 text-white/60'
                  }`}
                >
                  {error || report}
                </p>
              )}
            </section>
          )}
          <button
            type="button"
            onPointerDown={onDockPointerDown}
            onPointerMove={onDockPointerMove}
            onPointerUp={onDockPointerUp}
            onPointerCancel={onDockPointerCancel}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              setExpanded((value) => !value);
            }}
            aria-label={
              expanded
                ? 'Fermer l’accès rapide au téléphone'
                : `Accès rapide au téléphone — ${apps.length} application${apps.length === 1 ? '' : 's'} épinglée${apps.length === 1 ? '' : 's'}`
            }
            aria-expanded={expanded}
            title={
              edge
                ? 'Téléphone — cliquer pour ouvrir, glisser pour déplacer'
                : 'Téléphone : applications épinglées et raccourcis — glisser pour déplacer'
            }
            style={{ width: dockWidth, height: DOCK_SIZE }}
            className={`group relative grid touch-none place-items-center overflow-hidden border border-white/20 bg-slate-950/85 text-white shadow-xl shadow-black/35 backdrop-blur-2xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${
              edge === 'right'
                ? 'rounded-l-xl border-r-0 hover:-translate-x-0.5'
                : edge === 'left'
                  ? 'rounded-r-xl border-l-0 hover:translate-x-0.5'
                  : 'rounded-[16px] p-1 hover:scale-105 hover:border-white/35'
            }`}
          >
            {/* Repliée contre un bord : une languette, et un chevron qui
                montre d'où le reste va sortir. */}
            {edge ? (
              edge === 'right'
                ? <ChevronLeft size={13} className="text-violet-200" />
                : <ChevronRight size={13} className="text-violet-200" />
            ) : (
              // La pastille portait l'icône de la PREMIÈRE application
              // épinglée : elle annonçait donc une app, alors qu'un clic
              // ouvre un panneau. Elle porte maintenant sa propre identité —
              // le téléphone — et le nombre d'applications derrière elle.
              <span className="grid h-full w-full place-items-center rounded-[12px] bg-violet-400/15">
                <Smartphone size={18} className="text-violet-200" />
              </span>
            )}
            {!edge && apps.length > 1 && pinnedNotificationCount === 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 grid h-[16px] min-w-[16px] place-items-center rounded-full border border-slate-950 bg-slate-800 px-1 text-[9px] font-semibold tabular-nums text-white/70"
              >
                {apps.length}
              </span>
            )}
            {pinnedNotificationCount > 0 && (
              edge ? (
                // Sur une languette de seize pixels, le compte ne tiendrait
                // pas : un point suffit à dire « il s'est passé quelque chose ».
                <span
                  aria-label={`${pinnedNotificationCount} notification${pinnedNotificationCount === 1 ? '' : 's'} dans les applications épinglées`}
                  className="absolute right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-rose-500"
                />
              ) : (
                <span
                  aria-label={`${pinnedNotificationCount} notification${pinnedNotificationCount === 1 ? '' : 's'} dans les applications épinglées`}
                  className="absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full border border-slate-950 bg-rose-500 px-1 text-[9px] font-bold text-white"
                >
                  {pinnedNotificationCount > 99 ? '99+' : pinnedNotificationCount}
                </span>
              )
            )}
            {!edge && (
              <Grip size={11} className="absolute bottom-0.5 left-0.5 text-white/60 opacity-0 transition group-hover:opacity-100" />
            )}
          </button>
        </div>
      )}
    </>
  );
}
