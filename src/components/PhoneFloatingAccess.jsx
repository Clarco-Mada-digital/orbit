import { useCallback, useEffect, useState } from 'react';
import { Phone, PhoneOff, Pin, X } from 'lucide-react';
import { usePhoneStore } from '../lib/phoneStore';
import { phoneCallKey } from '../lib/phone';

const api = () => window.electronAPI?.phone;

export default function PhoneFloatingAccess() {
  const incomingCall = usePhoneStore((state) => state.incomingCall);
  const [serial, setSerial] = useState(null);
  const [apps, setApps] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const state = await api()?.status();
      if (!state?.success) {
        setSerial(null);
        setApps([]);
        return;
      }
      const activeSerial = state.serial || null;
      setSerial(activeSerial);
      if (!activeSerial || !state.settings?.pinnedPackages?.length) {
        setApps([]);
        return;
      }
      const result = await api()?.listApps({
        serial: activeSerial,
        showSystemApps: state.settings.showSystemApps,
      });
      if (!result?.success) {
        setApps([]);
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
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(refresh);
    const onPinsChanged = () => refresh();
    window.addEventListener('orbit:phone-pins-changed', onPinsChanged);
    const timer = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener('orbit:phone-pins-changed', onPinsChanged);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const launch = async (app) => {
    if (!serial || busy) return;
    setBusy(app.package);
    setError('');
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
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-emerald-200">
              <Phone size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-200/80">Appel entrant</p>
              <p className="mt-1 truncate text-sm font-semibold">
                {incomingCall.notification.title || incomingCall.notification.package}
              </p>
              {incomingCall.notification.text && (
                <p className="mt-1 line-clamp-2 text-xs text-white/60">{incomingCall.notification.text}</p>
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
        </section>
      )}
      {apps.length > 0 && serial && (
        <nav
          aria-label="Applications Android épinglées"
          className="fixed bottom-5 right-5 z-[11000] flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-2xl border border-white/15 bg-slate-950/75 p-2 shadow-xl shadow-black/25 backdrop-blur-2xl"
        >
          {apps.map((app) => (
            <div key={app.package} className="group relative">
              <button
                type="button"
                onClick={() => launch(app)}
                disabled={Boolean(busy)}
                title={`Ouvrir ${app.name}`}
                aria-label={`Ouvrir ${app.name}`}
                className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/10 text-xs font-semibold text-white/80 transition hover:-translate-y-0.5 hover:bg-white/20 disabled:opacity-50"
              >
                {app.icon
                  ? <img src={app.icon} alt="" className="h-full w-full object-contain" />
                  : app.name.slice(0, 2).toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => unpin(app)}
                title={`Désépingler ${app.name}`}
                aria-label={`Désépingler ${app.name}`}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-white/20 bg-slate-800 text-white/70 opacity-0 transition hover:bg-rose-500 hover:text-white focus:opacity-100 group-hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <span className="ml-1 border-l border-white/15 pl-2 text-[10px] text-white/45">
            <Pin size={12} />
          </span>
        </nav>
      )}
    </>
  );
}
