import { useCallback, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { useZoneHold } from '../../lib/autoHide';
import { useDismiss } from '../../lib/useDismiss';
import { orbitVpnCountry } from '../../lib/privateNetwork';
import OrbitVpnPanel, { useOrbitVpnState } from '../OrbitVpnPanel';

// Accès rapide au VPN Orbit depuis la barre : l'état d'un coup d'œil (pastille,
// drapeau du pays), le panneau complet au clic. Module AU CHOIX : il n'est
// dans aucune disposition par défaut (Personnaliser → En-tête pour l'ajouter).
export default function OrbitVpnWidget({ placement = 'top', align = 'right-0' }) {
  const st = useOrbitVpnState();
  const [open, setOpen] = useState(false);
  useZoneHold(placement, 'panel', open);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  const status = st?.status || 'off';
  const country = orbitVpnCountry(st?.location);
  const dot =
    status === 'ready' ? 'bg-emerald-500' : status === 'starting' ? 'bg-amber-500 animate-pulse' : status === 'error' ? 'bg-red-500' : '';
  const menuPos = placement === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2';

  return (
    <div className="relative app-no-drag" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`relative h-8 px-2 rounded-lg flex items-center gap-1 transition-colors ${
          status === 'ready' ? 'bg-sky-500/15 text-sky-500' : open ? 'bg-bg-hover' : 'hover:bg-bg-hover'
        }`}
        title={status === 'ready' ? `VPN Orbit connecté${country ? ` · ${country.label}` : ' · Auto'}` : 'VPN Orbit'}
        aria-label="VPN Orbit"
      >
        <Globe2 size={16} />
        {status === 'ready' && country ? <span className="text-xs leading-none">{country.flag}</span> : null}
        {dot ? <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
      </button>
      {open ? (
        <div className={`absolute ${align} ${menuPos} z-50 w-80 rounded-xl border border-border bg-bg-elevated p-4 text-sm shadow-2xl animate-scale-in`}>
          <OrbitVpnPanel compact />
        </div>
      ) : null}
    </div>
  );
}
