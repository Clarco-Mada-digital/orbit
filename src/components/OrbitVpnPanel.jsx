import { useEffect, useState } from 'react';
import { CheckCircle2, Globe2, Info, Loader2, Power, RefreshCw } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { ORBIT_VPN_COUNTRIES, ORBIT_VPN_DURATIONS, orbitVpnCountry } from '../lib/privateNetwork';
import { activateOrbitVpn, deactivateOrbitVpn, orbitVpnIsGlobal } from '../lib/orbitVpn';

// ---------------------------------------------------------------------------
// VPN Orbit : un VPN « vite fait », sans compte ni fichier, pour quelques
// minutes. Il passe par le réseau Tor (instance dédiée) en choisissant le pays
// de sortie — ou Auto : Tor prend les sorties les plus rapides.
//
// Le panneau dit honnêtement ce que c'est : pratique et gratuit, mais plus
// lent qu'un vrai VPN, et refusé par certains sites. Pour un usage régulier,
// un fournisseur (Proton VPN Free…) reste meilleur — section VPN plus bas.
//
// Utilisé dans Réglages → Réseau privé et dans le module « VPN Orbit » de la
// barre (au choix, jamais ajouté d'office).
// ---------------------------------------------------------------------------

const api = () => window.electronAPI?.privateNet;

function durationLabel(m) {
  if (!m) return 'Jusqu’à l’arrêt';
  return m < 60 ? `${m} minutes` : `${m / 60} heure${m > 60 ? 's' : ''}`;
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function useOrbitVpnState() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    const pn = api();
    if (!pn) return undefined;
    let alive = true;
    pn.state().then((r) => alive && r?.success && setSt(r.orbitvpn || null));
    const off = pn.onChanged((next) => alive && next?.orbitvpn && setSt(next.orbitvpn));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  return st;
}

export default function OrbitVpnPanel({ compact = false }) {
  const settings = useStore((s) => s.settings);
  const st = useOrbitVpnState();
  const [minutes, setMinutes] = useState(30);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);
  const now = useNow(Boolean(st?.endsAt));

  if (!api()) return null;
  if (!st) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" /> VPN Orbit…
      </div>
    );
  }

  const on = st.status === 'ready' || st.status === 'starting';
  const global = orbitVpnIsGlobal(settings);
  const country = orbitVpnCountry(st.location);
  const left = st.endsAt ? Math.max(0, Math.ceil((st.endsAt - now) / 60000)) : 0;

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    const r = await fn();
    setBusy('');
    if (r && !r.success && !r.canceled) setError(r.error || 'Échec.');
    return r;
  };

  const verify = () =>
    run('check', async () => {
      const r = await api().check('orbitvpn');
      setCheck(r);
      return r;
    });

  const changeLocation = (location) =>
    run('loc', async () => {
      setCheck(null);
      const r = await api().setOrbitVpnLocation(location);
      // Nouvelle sortie active : on la montre aussitôt.
      if (r?.success && r.live) setTimeout(verify, 1500);
      return r;
    });

  const statusText =
    st.status === 'ready'
      ? `Connecté · ${country ? `${country.flag} ${country.label}` : 'Auto'}${left ? ` · encore ${left} min` : ''}`
      : st.status === 'starting'
        ? `Connexion… ${st.progress ? `${st.progress} %` : ''}`
        : st.status === 'error'
          ? 'Erreur'
          : 'Arrêté';

  const checkCountry = check?.success ? orbitVpnCountry(check.country) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Globe2 size={16} className="text-sky-500" />
        <span className="font-medium">VPN Orbit</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            st.status === 'ready'
              ? 'bg-emerald-500/15 text-emerald-500'
              : st.status === 'starting'
                ? 'bg-amber-500/15 text-amber-500'
                : st.status === 'error'
                  ? 'bg-red-500/15 text-red-500'
                  : 'bg-bg-hover text-text-secondary'
          }`}
        >
          {statusText}
        </span>
      </div>

      {!compact ? (
        <p className="text-xs leading-relaxed text-text-muted">
          Gratuit, sans compte ni fichier : choisissez un pays (ou Auto, le plus rapide) et activez. Pratique pour quelques minutes —
          consulter un site depuis un autre pays, protéger un Wi-Fi public.
        </p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block text-text-muted">Pays de sortie</span>
          <select value={st.location} onChange={(e) => changeLocation(e.target.value)} disabled={busy === 'loc'} className="input text-sm">
            <option value="auto">⚡ Auto — le plus rapide</option>
            {ORBIT_VPN_COUNTRIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.flag} {c.label}
              </option>
            ))}
          </select>
        </label>
        {!on ? (
          <label className="text-xs">
            <span className="mb-1 block text-text-muted">Durée</span>
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="input text-sm">
              {ORBIT_VPN_DURATIONS.map((m) => (
                <option key={m} value={m}>
                  {durationLabel(m)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {!on ? (
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={Boolean(busy) || st.install?.busy}
            onClick={() => run('start', () => activateOrbitVpn(minutes))}
          >
            {busy === 'start' ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}{' '}
            {st.installed ? 'Activer pour tout Orbit' : 'Installer et activer (20 à 35 Mo)'}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary text-xs" disabled={busy === 'stop'} onClick={() => run('stop', deactivateOrbitVpn)}>
            <Power size={13} /> Désactiver
          </button>
        )}
        {st.status === 'ready' ? (
          <>
            <button type="button" className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={verify}>
              {busy === 'check' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Vérifier
            </button>
            <button
              type="button"
              className="btn btn-secondary text-xs"
              disabled={Boolean(busy)}
              title="Nouvelle adresse dans le même pays"
              onClick={() => changeLocation(st.location)}
            >
              <RefreshCw size={13} /> Changer d’adresse
            </button>
          </>
        ) : null}
      </div>

      {st.status === 'starting' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${st.progress || 5}%` }} />
        </div>
      ) : null}
      {st.install?.busy ? <p className="text-[11px] text-text-muted">Téléchargement et vérification du moteur Tor officiel…</p> : null}
      {on && !global ? (
        <p className="text-[11px] text-text-muted">Actif pour les apps réglées sur « VPN Orbit » (Modifier l’app → Réseau).</p>
      ) : null}
      {on && global ? (
        <p className="text-[11px] text-text-muted">Tout Orbit passe par le VPN Orbit, sauf les apps et profils qui ont leur propre réseau.</p>
      ) : null}
      {check?.success ? (
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <CheckCircle2 size={13} className="text-emerald-500" /> Adresse vue par les sites :{' '}
          <span className="font-mono">{check.ip}</span>
          {checkCountry ? ` · ${checkCountry.flag} ${checkCountry.label}` : check.country ? ` · ${check.country.toUpperCase()}` : ''}
        </p>
      ) : null}
      {check && !check.success ? <p className="text-xs text-red-500">{check.error}</p> : null}
      {st.status === 'error' && st.error ? (
        <p className="text-xs text-red-500">
          {st.error}
          {st.location !== 'auto' ? ' Essayez Auto ou un autre pays : il y a peut-être trop peu de sorties disponibles.' : ''}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      <p className="flex gap-1.5 rounded-lg bg-bg-secondary p-2 text-[11px] leading-relaxed text-text-muted">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Le VPN Orbit passe par le réseau Tor : il cache votre adresse, mais il est plus lent qu’un vrai VPN et certains sites
          (banques, streaming, Google parfois) le refusent ou demandent un captcha. Pour un usage régulier, un fournisseur VPN reste le
          meilleur choix — Proton VPN Free est gratuit (section VPN des réglages).
        </span>
      </p>
    </div>
  );
}
