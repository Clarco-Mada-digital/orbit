import { useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Loader2, QrCode, Smartphone, Wifi, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Connexion SANS CÂBLE du Téléphone.
//
// - Associer par QR code (Android 11+) : Orbit affiche un code au format
//   d'Android Studio, le téléphone le scanne dans « Débogage sans fil », Orbit
//   le voit apparaître sur le réseau, associe et se connecte. Une seule fois :
//   ensuite le téléphone est retrouvé tout seul.
// - Téléphones à proximité : ceux qui annoncent le débogage sans fil sur le
//   réseau (mDNS), connectables d'un clic.
// - Téléphones mémorisés : ceux qu'Orbit reconnecte automatiquement.
// ---------------------------------------------------------------------------

function QrSvg({ text }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const rects = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) rects.push([c, r]);
    return { n, rects };
  }, [text]);
  const m = 4; // marge (zone calme) exigée par les lecteurs de QR
  const size = cells.n + m * 2;
  return (
    // Toujours noir sur blanc, même en thème sombre : les lecteurs l'exigent.
    <svg viewBox={`0 0 ${size} ${size}`} className="h-48 w-48 rounded-lg" role="img" aria-label="QR code d'association" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      {cells.rects.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + m} y={y + m} width="1" height="1" fill="#000" />
      ))}
    </svg>
  );
}

export default function WirelessConnect({ api, onConnected }) {
  const [qr, setQr] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [remembered, setRemembered] = useState([]);
  const [pairing, setPairing] = useState([]);
  const [codes, setCodes] = useState({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(true);

  // Recherche continue tant que la carte est affichée (aucun appareil).
  useEffect(() => {
    alive.current = true;
    const tick = async () => {
      const r = await api?.discoverWireless?.().catch(() => null);
      if (!alive.current || !r?.success) return;
      setNearby(r.devices || []);
      setRemembered(r.remembered || []);
      setPairing(r.pairing || []);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive.current = false;
      clearInterval(t);
      api?.qrCancel?.();
    };
  }, [api]);

  const startQr = async () => {
    setError('');
    const r = await api?.qrStart?.();
    if (!r?.success) {
      setError(r?.error || 'QR code indisponible.');
      return;
    }
    setQr(r.payload);
    const res = await api.qrWait();
    if (!alive.current) return;
    setQr(null);
    if (res?.success) onConnected?.();
    else if (!res?.cancelled) setError(res?.error || 'Association impossible.');
  };

  const cancelQr = () => {
    api?.qrCancel?.();
    setQr(null);
  };

  const connectTo = async (d) => {
    setBusy(d.address);
    setError('');
    const r = await api.connect(d.address, d.name);
    if (!alive.current) return;
    setBusy('');
    if (r?.success) onConnected?.();
    else setError(r?.error || r?.output || 'Connexion refusée.');
  };

  const pairWithCode = async (d) => {
    const code = String(codes[d.address] || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Le code d’association fait 6 chiffres.');
      return;
    }
    setBusy(d.address);
    setError('');
    const r = await api.pair({ address: d.address, code });
    if (!alive.current) return;
    setBusy('');
    if (r?.success && r.connected) onConnected?.();
    else if (r?.success) setError('Associé ! Le téléphone apparaîtra dans « À proximité » dans quelques secondes.');
    else setError(r?.error || r?.output || 'Code refusé : vérifiez-le sur le téléphone.');
  };

  const forget = async (d) => {
    await api.forgetWireless({ name: d.name, address: d.address });
    setRemembered((list) => list.filter((x) => x !== d));
  };

  const nearbyNames = new Set(nearby.map((d) => d.name));
  const offline = remembered.filter((d) => !d.name || !nearbyNames.has(d.name));

  return (
    <div className="mt-4 space-y-3">
      {qr ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-bg-primary p-4 text-center sm:flex-row sm:items-start sm:text-left">
          <QrSvg text={qr} />
          <div className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
            <p className="mb-1 text-sm font-medium text-text-primary">Scannez avec le téléphone</p>
            <ol className="list-decimal space-y-0.5 pl-4">
              <li>Téléphone et ordinateur sur le <strong className="text-text-secondary">même Wi-Fi</strong>.</li>
              <li>
                Options pour les développeurs → <strong className="text-text-secondary">Débogage sans fil</strong> (activé).
              </li>
              <li>
                <strong className="text-text-secondary">Associer l’appareil avec un code QR</strong>, puis visez ce code.
              </li>
            </ol>
            <p className="mt-2 flex items-center gap-1.5 text-text-secondary">
              <Loader2 size={12} className="animate-spin" /> En attente du téléphone…
            </p>
            <button type="button" onClick={cancelQr} className="mt-2 rounded-lg border border-border px-3 py-1 text-xs hover:bg-bg-hover">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startQr}
          className="flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          <QrCode size={13} /> Associer sans fil (QR code)
        </button>
      )}

      {pairing.length > 0 ? (
        <div className="rounded-xl border border-accent-primary/40 bg-accent-primary/5 p-2.5">
          <div className="mb-1.5 text-xs font-medium text-text-primary">Un téléphone attend un code d’association</div>
          {pairing.map((d) => (
            <div key={d.address} className="flex items-center gap-2 text-xs">
              <Smartphone size={13} className="shrink-0 text-text-muted" />
              <span className="font-mono text-text-muted">{d.host}</span>
              <input
                value={codes[d.address] || ''}
                onChange={(e) => setCodes((c) => ({ ...c, [d.address]: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                onKeyDown={(e) => e.key === 'Enter' && pairWithCode(d)}
                placeholder="Code à 6 chiffres"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="w-28 rounded-lg border border-border bg-bg-primary px-2 py-1 font-mono tracking-widest outline-none focus:border-accent-primary"
              />
              <button
                type="button"
                onClick={() => pairWithCode(d)}
                disabled={Boolean(busy)}
                className="rounded-md bg-accent-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                {busy === d.address ? <Loader2 size={11} className="animate-spin" /> : 'Associer'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {nearby.length > 0 ? (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            <Wifi size={11} /> À proximité
          </div>
          <ul className="space-y-1">
            {nearby.map((d) => (
              <li key={d.name || d.address} className="flex items-center gap-2 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-xs">
                <Smartphone size={13} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate">
                  {d.label || d.name} <span className="font-mono text-text-muted">{d.address}</span>
                </span>
                <button
                  type="button"
                  onClick={() => connectTo(d)}
                  disabled={Boolean(busy)}
                  className="rounded-md bg-accent-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  {busy === d.address ? <Loader2 size={11} className="animate-spin" /> : 'Connecter'}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-text-muted">
            Un téléphone jamais associé demandera d’abord le QR code.
          </p>
        </div>
      ) : null}

      {offline.length > 0 ? (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">Mémorisés (reconnexion automatique)</div>
          <ul className="space-y-1">
            {offline.map((d) => (
              <li key={d.name || d.address} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-secondary">
                <Smartphone size={13} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate">
                  {d.label || d.name || d.address}
                  <span className="text-text-muted"> · hors de portée</span>
                </span>
                {d.address ? (
                  <button type="button" onClick={() => connectTo(d)} disabled={Boolean(busy)} className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-bg-hover disabled:opacity-50">
                    {busy === d.address ? <Loader2 size={11} className="animate-spin" /> : 'Réessayer'}
                  </button>
                ) : null}
                <button type="button" onClick={() => forget(d)} title="Oublier ce téléphone" aria-label="Oublier ce téléphone" className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary">
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="whitespace-pre-wrap break-words text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
