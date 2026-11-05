import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grip, Loader2, Monitor, Phone, PhoneOff, Pin, User, X } from 'lucide-react';
import { usePhoneStore } from '../lib/phoneStore';
import { describeCallNotification, phoneCallKey } from '../lib/phone';

const api = () => window.electronAPI?.phone;
const DOCK_POSITION_KEY = 'orbit.phone.pinned-dock-position.v1';
const DOCK_SIZE = 52;
const DOCK_MARGIN = 12;

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

export default function PhoneFloatingAccess() {
  const incomingCall = usePhoneStore((state) => state.incomingCall);
  const notifications = usePhoneStore((state) => state.notifications);
  const [serial, setSerial] = useState(null);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [ring, setRing] = useState({ key: null, seconds: 0 });
  const [dockPosition, setDockPosition] = useState(readDockPosition);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const dockRef = useRef(null);
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
    const notification = incomingCall?.notification;
    if (!notification) return null;
    const appName =
      notification.appName || apps.find((app) => app.package === notification.package)?.name || '';
    return describeCallNotification(notification, appName);
  }, [incomingCall, apps]);

  // « Sonne depuis… » : un appel qui sonne depuis 40 s ne se décroche pas comme
  // un appel qui vient d'arriver. La durée est datée de l'appel qui l'a
  // produite : celle d'un appel précédent n'a pas à s'afficher une seconde sur
  // le suivant.
  useEffect(() => {
    const key = incomingCall?.notification?.key;
    if (!key) return undefined;
    const startedAt = Number(incomingCall.notification?.when) || Date.now();
    const timer = window.setInterval(() => {
      setRing({ key, seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [incomingCall?.notification?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ringing = ring.key && ring.key === incomingCall?.notification?.key ? ring.seconds : 0;

  const maxLeft = Math.max(0, viewport.width - DOCK_SIZE);
  const maxTop = Math.max(0, viewport.height - DOCK_SIZE);
  const dockLeft = Math.round(dockPosition.x * maxLeft);
  const dockTop = Math.round(dockPosition.y * maxTop);
  const panelWidth = Math.max(1, Math.min(264, viewport.width - DOCK_MARGIN * 2));
  const panelHeight = Math.max(1, Math.min(232, viewport.height - DOCK_MARGIN * 2));
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
        setApps([]);
        setExpanded(false);
        return;
      }
      const activeSerial = state.serial || null;
      setSerial(activeSerial);
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
    const timer = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener('orbit:phone-pins-changed', onPinsChanged);
      window.removeEventListener('resize', onResize);
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

  const actOnCall = async (action) => {
    const key = phoneCallKey(action);
    if (!key || !incomingCall?.serial || busy) return;
    setBusy('call');
    setError('');
    try {
      const result = await api()?.key({ serial: incomingCall.serial, key });
      if (!result?.success) {
        setError(result?.error || 'Le téléphone n’a pas accepté la commande d’appel.');
        return;
      }
      usePhoneStore.getState().setIncomingCall(null);
    } catch (err) {
      console.error('[orbit] action sur l’appel du téléphone échouée:', err);
      setError(String(err.message || err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      {incomingCall && (
        <section
          role="alert"
          aria-live="assertive"
          className="fixed right-4 top-4 z-[13000] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/15 bg-slate-950/85 text-white shadow-2xl shadow-black/30 backdrop-blur-2xl"
        >
          <div className="flex items-start gap-3 p-4">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200"
            >
              {caller?.unknown
                ? <User size={19} />
                : callerInitials(caller?.named ? caller.who : '') || <Phone size={19} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-200/80">
                Appel entrant
                {ringing > 0 && ringing < 600 && (
                  <span className="font-normal normal-case tracking-normal text-white/40">
                    · sonne depuis {formatRinging(ringing)}
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
              onClick={() => usePhoneStore.getState().setIncomingCall(null)}
              className="rounded-lg p-1.5 text-white/55 hover:bg-white/10 hover:text-white"
              aria-label="Fermer l’alerte d’appel"
            >
              <X size={15} />
            </button>
          </div>
          {error && <p role="status" className="px-4 pb-2 text-xs text-rose-300">{error}</p>}
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
          {/* Dernier recours quand Orbit ne sait pas qui appelle (ou pour un
              appel vidéo) : l'écran du téléphone, qui l'affiche toujours. */}
          <button
            type="button"
            onClick={() => usePhoneStore.getState().requestOpen(incomingCall.notification.package)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 px-3 py-2 text-[11px] font-medium text-white/55 transition hover:bg-white/5 hover:text-white"
          >
            <Monitor size={13} /> Voir l’écran du téléphone
          </button>
        </section>
      )}
      {apps.length > 0 && serial && (
        <div
          ref={dockRef}
          className="fixed z-[11000] h-[52px] w-[52px]"
          style={{ left: dockLeft, top: dockTop }}
        >
          {expanded && (
            <nav
              aria-label="Applications Android épinglées"
              className="absolute rounded-2xl border border-white/15 bg-slate-950/85 p-3 text-white shadow-2xl shadow-black/35 backdrop-blur-2xl"
              style={{
                left: panelLeft - dockLeft,
                top: panelTop - dockTop,
                width: panelWidth,
                maxHeight: panelHeight,
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold text-white/80">
                  <Pin size={13} className="text-violet-300" />
                  Applications épinglées
                </span>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  aria-label="Fermer les applications épinglées"
                  className="rounded-lg p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2 overflow-y-auto">
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
                      className="mx-auto grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-[10px] font-semibold text-white/80 transition hover:-translate-y-0.5 hover:bg-white/20 disabled:opacity-50"
                    >
                      {busy === app.package
                        ? <Loader2 size={16} className="animate-spin" />
                        : app.icon
                          ? <img src={app.icon} alt="" draggable={false} className="h-full w-full object-contain" />
                          : app.name.slice(0, 2).toUpperCase()}
                    </button>
                    <span className="mt-1 block truncate text-[10px] text-white/65">{app.name}</span>
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
              </div>
            </nav>
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
            aria-label={expanded ? 'Fermer les applications épinglées' : `Ouvrir les ${apps.length} applications épinglées`}
            aria-expanded={expanded}
            title="Déplacer ou ouvrir les applications épinglées"
            className="group relative grid h-[52px] w-[52px] touch-none place-items-center overflow-hidden rounded-[19px] border border-white/20 bg-slate-950/85 p-1 text-white shadow-xl shadow-black/35 backdrop-blur-2xl transition hover:scale-105 hover:border-white/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"
          >
            {apps[0]?.icon
              ? <img src={apps[0].icon} alt="" draggable={false} className="h-full w-full rounded-[14px] object-contain" />
              : <Pin size={21} className="text-violet-200" />}
            {pinnedNotificationCount > 0 && (
              <span
                aria-label={`${pinnedNotificationCount} notification${pinnedNotificationCount === 1 ? '' : 's'} dans les applications épinglées`}
                className="absolute -right-0.5 -top-0.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border border-slate-950 bg-rose-500 px-1 text-[10px] font-bold text-white"
              >
                {pinnedNotificationCount > 99 ? '99+' : pinnedNotificationCount}
              </span>
            )}
            <Grip size={12} className="absolute bottom-1 left-1 text-white/60 opacity-0 transition group-hover:opacity-100" />
          </button>
        </div>
      )}
    </>
  );
}
