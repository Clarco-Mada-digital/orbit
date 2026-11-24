import { useEffect, useState } from 'react';
import { Lock, Shield } from 'lucide-react';

// ---------------------------------------------------------------------------
// Repère visuel d'une app passée par Tor ou un VPN : un liseré de couleur
// autour de la page et une pastille d'état. Monté UNIQUEMENT pour ces apps —
// les autres n'en paient rien (ni rendu, ni abonnement).
//   Tor : violet (la couleur de Tor) · VPN : turquoise
//   État : vert = protégé, orange = connexion, rouge = coupé (rien ne charge)
// ---------------------------------------------------------------------------
const LOOK = {
  tor: { color: '125 70 152', label: 'Tor', Icon: Lock },
  vpn: { color: '20 184 166', label: 'VPN', Icon: Shield },
};

export default function TunnelBadge({ network }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const pn = window.electronAPI?.privateNet;
    if (!pn) return undefined;
    let alive = true;
    const seen = (st) => alive && st?.[network] && setStatus(st[network].status);
    pn.state().then(seen);
    const off = pn.onChanged(seen);
    return () => {
      alive = false;
      off?.();
    };
  }, [network]);

  const look = LOOK[network];
  if (!look) return null;
  const { Icon } = look;
  const state =
    status === 'ready'
      ? { dot: 'bg-emerald-500', text: 'protégé' }
      : status === 'starting'
        ? { dot: 'bg-amber-500 animate-pulse', text: 'connexion…' }
        : { dot: 'bg-red-500', text: 'coupé' };

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10"
        style={{ boxShadow: `inset 0 0 0 2px rgb(${look.color} / 0.85)` }}
      />
      <div
        role="status"
        title={`Cette app passe par ${network === 'tor' ? 'Tor' : 'le VPN'} — ${state.text}`}
        className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-white opacity-90 shadow-md"
        style={{ background: `rgb(${look.color} / 0.92)` }}
      >
        <Icon size={11} />
        {look.label}
        <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
        <span className="opacity-90">{state.text}</span>
      </div>
    </>
  );
}
