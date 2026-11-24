import { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// Graphique d'une série (barres ou courbe) pour l'explorateur JSON.
//
// Une seule série → une seule teinte (bleu de référence, pas de légende : le
// titre nomme la mesure). Barres fines aux extrémités arrondies posées sur la
// ligne de base, grille discrète, info-bulle au survol avec une zone de
// survol plus large que la marque. La vue « Tableau » de l'explorateur sert
// de version tabulaire.
// ---------------------------------------------------------------------------
const W = 760;
const H = 320;
const M = { top: 16, right: 16, bottom: 64, left: 56 };

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export const formatNumber = (v) =>
  Number.isFinite(v)
    ? Math.abs(v) >= 1e6
      ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
      : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
    : '—';

export default function JsonChart({ points, kind = 'bar', title }) {
  const [hover, setHover] = useState(null);
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = niceMax(Math.max(...values, 0));
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const y = (v) => M.top + ih - ((v - min) / (max - min || 1)) * ih;
  const band = iw / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(36, band * 0.62));
  const x = (i) => M.left + band * i + band / 2;
  const ticks = useMemo(() => Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4), [min, max]);
  const labelEvery = Math.ceil(points.length / 14);
  // Peu de catégories aux noms courts : étiquettes droites et centrées.
  const tilt = points.length > 6 || points.some((p) => String(p.label).length > 12);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  return (
    <figure className="orbit-viz m-0 max-w-4xl">
      {title ? <figcaption className="mb-2 text-sm font-medium text-text-primary">{title}</figcaption> : null}
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title || 'Graphique'}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-text-muted)">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth="1" />
          {kind === 'line' ? (
            <>
              <path d={line} fill="none" stroke="var(--viz-series)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {points.length <= 60
                ? points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={hover === i ? 5 : 4} fill="var(--viz-series)" stroke="var(--viz-surface)" strokeWidth="2" />)
                : null}
              {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--viz-axis)" strokeDasharray="3 3" /> : null}
            </>
          ) : (
            points.map((p, i) => {
              const top = y(Math.max(p.value, 0));
              const h = Math.max(0, Math.abs(y(p.value) - y(0)));
              const r = Math.min(4, barW / 2, h);
              const x0 = x(i) - barW / 2;
              // Extrémité arrondie côté donnée, base droite sur la ligne de base.
              const d = `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z`;
              return <path key={i} d={d} fill="var(--viz-series)" opacity={hover === null || hover === i ? 1 : 0.55} />;
            })
          )}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`l${i}`}
                x={x(i)}
                y={M.top + ih + (tilt ? 14 : 18)}
                fontSize="11"
                fill="var(--color-text-secondary)"
                textAnchor={tilt ? 'end' : 'middle'}
                transform={tilt ? `rotate(-35 ${x(i)} ${M.top + ih + 14})` : undefined}
              >
                {String(p.label).length > 16 ? `${String(p.label).slice(0, 15)}…` : p.label}
              </text>
            ) : null
          )}
          {/* Zones de survol : toute la largeur de la bande, toute la hauteur. */}
          {points.map((p, i) => (
            <rect key={`h${i}`} x={M.left + band * i} y={M.top} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
        {hover !== null && points[hover] ? (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover].value) / H) * 100}%`, transform: 'translate(-50%, calc(-100% - 8px))' }}
          >
            <div className="font-medium text-text-primary">{String(points[hover].label)}</div>
            <div className="text-text-secondary">
              {formatNumber(points[hover].value)}
              {points[hover].n > 1 ? <span className="text-text-muted"> · {points[hover].n} éléments</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </figure>
  );
}
