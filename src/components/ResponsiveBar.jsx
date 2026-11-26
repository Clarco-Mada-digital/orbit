import { useState } from 'react';
import { Camera, Columns3, Frame, Hand, LoaderCircle, RotateCw, Smartphone, Wifi, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useT } from '../lib/i18n';
import {
  DEVICES,
  BREAKPOINTS,
  NETWORK_PRESETS,
  clampSize,
  deviceById,
  responsiveState,
  viewportOf,
} from '../lib/responsive';

// Barre de la vue responsive, au-dessus de la page redimensionnée.
// Elle ne fait que décrire l'état voulu ; WebView.jsx l'applique (taille du
// <webview>, échelle d'affichage) et le processus principal émule le tactile
// et l'agent utilisateur.

const GROUPS = [
  ['custom', 'rs.groupCustom'],
  ['phone', 'rs.groupPhone'],
  ['tablet', 'rs.groupTablet'],
  ['desktop', 'rs.groupDesktop'],
];

// Champ numérique validé à la sortie (ou Entrée) : taper « 3 » en route vers
// « 390 » ne doit pas redimensionner la page à chaque frappe. Monté avec
// `key={value}` : une nouvelle valeur venue d'ailleurs repart d'un brouillon
// neuf.
function SizeInput({ value, onCommit, label }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const next = clampSize(draft);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      title={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="w-16 h-6 px-1.5 rounded bg-bg-primary border border-border text-xs text-center tabular-nums focus:outline-none focus:border-accent-primary"
    />
  );
}

// `onCapture` : capture de l'appareil (taille réelle, avec ou sans cadre) ;
// `capturing` : capture en cours (le bouton patiente).
export default function ResponsiveBar({ state, scale, onChange, onClose, onCapture, onZoomStep, capturing = false }) {
  const t = useT();
  const view = viewportOf(state);
  const device = deviceById(state.deviceId);
  const set = (patch) => onChange({ ...state, ...patch });
  // Changer une dimension à la main fait passer en taille libre.
  const resize = (patch) => set({ deviceId: 'responsive', rotated: false, ...patch });
  const chip = (active) =>
    `h-6 px-2 rounded text-xs flex items-center gap-1 transition-colors ${
      active ? 'bg-accent-primary/15 text-accent-primary' : 'hover:bg-bg-hover text-text-secondary'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 border-b border-border bg-bg-secondary text-xs text-text-secondary">
      <Smartphone size={13} className="text-text-muted" />
      <select
        value={state.deviceId}
        onChange={(e) => onChange(responsiveState(e.target.value, state))}
        aria-label={t('rs.device')}
        className="h-6 px-1 rounded bg-bg-primary border border-border text-xs focus:outline-none focus:border-accent-primary"
      >
        {GROUPS.map(([kind, label]) => (
          <optgroup key={kind} label={t(label)}>
            {DEVICES.filter((d) => d.kind === kind).map((d) => (
              <option key={d.id} value={d.id}>
                {d.kind === 'custom' ? t('rs.custom') : d.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <SizeInput
        key={`w${view.width}`}
        value={view.width}
        label={t('rs.width')}
        onCommit={(w) => resize({ width: w, height: view.height })}
      />
      <span className="text-text-muted">×</span>
      <SizeInput
        key={`h${view.height}`}
        value={view.height}
        label={t('rs.height')}
        onCommit={(h) => resize({ width: view.width, height: h })}
      />
      <button
        type="button"
        className={chip(state.rotated)}
        onClick={() => set({ rotated: !state.rotated })}
        title={t('rs.rotate')}
        aria-label={t('rs.rotate')}
      >
        <RotateCw size={13} />
      </button>
      {/* Zoom de présentation : la LOUPE sur les appareils (Ctrl + molette
          fonctionne aussi, sur la scène comme dans les pages). */}
      <button type="button" className={chip(false)} onClick={() => onZoomStep?.(-1)} title={t('rs.zoomOut')} aria-label={t('rs.zoomOut')}>
        <ZoomOut size={13} />
      </button>
      <select
        value={String(state.zoom)}
        onChange={(e) => set({ zoom: e.target.value === 'fit' ? 'fit' : Number(e.target.value) })}
        aria-label={t('rs.zoom')}
        title={t('rs.zoom')}
        className="h-6 px-1 rounded bg-bg-primary border border-border text-xs focus:outline-none focus:border-accent-primary"
      >
        <option value="fit">{t('rs.fit', { pct: Math.round(scale * 100) })}</option>
        {[0.5, 0.75, 1, 1.5, 2].map((z) => (
          <option key={z} value={String(z)}>
            {Math.round(z * 100)} %
          </option>
        ))}
        {/* Valeur atteinte à la molette, hors des paliers proposés. */}
        {state.zoom !== 'fit' && ![0.5, 0.75, 1, 1.5, 2].includes(Number(state.zoom)) && (
          <option value={String(state.zoom)}>{Math.round(Number(state.zoom) * 100)} %</option>
        )}
      </select>
      <button type="button" className={chip(false)} onClick={() => onZoomStep?.(1)} title={t('rs.zoomIn')} aria-label={t('rs.zoomIn')}>
        <ZoomIn size={13} />
      </button>
      <span className="w-px h-4 bg-border mx-0.5" />
      <button
        type="button"
        className={chip(state.touch)}
        onClick={() => set({ touch: !state.touch })}
        title={t('rs.touchHint')}
        aria-pressed={state.touch}
      >
        <Hand size={13} /> {t('rs.touch')}
      </button>
      <button
        type="button"
        className={chip(state.mobileUa)}
        onClick={() => set({ mobileUa: !state.mobileUa })}
        title={t('rs.uaHint')}
        aria-pressed={state.mobileUa}
      >
        {t('rs.ua')}
      </button>
      {/* Réseau simulé : la page se charge comme sur un mobile en 3G, ou
          hors ligne (service workers, messages d'erreur). */}
      <label className="flex items-center gap-1" title={t('rs.networkHint')}>
        <Wifi size={13} className={state.network && state.network !== 'none' ? 'text-warning' : 'text-text-muted'} />
        <select
          value={state.network || 'none'}
          onChange={(e) => set({ network: e.target.value })}
          aria-label={t('rs.network')}
          className="h-6 px-1 rounded bg-bg-primary border border-border text-xs focus:outline-none focus:border-accent-primary"
        >
          {NETWORK_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t(`rs.net.${p.id}`)}
            </option>
          ))}
        </select>
      </label>
      <span className="w-px h-4 bg-border mx-0.5" />
      {/* Capture de l'appareil à sa taille RÉELLE, avec ou sans cadre. */}
      <button
        type="button"
        className={chip(false)}
        onClick={onCapture}
        disabled={capturing}
        title={t('rs.captureHint')}
      >
        {capturing ? <LoaderCircle size={13} className="animate-spin" /> : <Camera size={13} />} {t('rs.capture')}
      </button>
      <button
        type="button"
        className={chip(state.frame)}
        onClick={() => set({ frame: !state.frame })}
        title={t('rs.frameHint')}
        aria-pressed={Boolean(state.frame)}
      >
        <Frame size={13} /> {t('rs.frame')}
      </button>
      <button
        type="button"
        className={chip(state.multi)}
        onClick={() => set({ multi: !state.multi })}
        title={t('rs.multiHint')}
        aria-pressed={Boolean(state.multi)}
      >
        <Columns3 size={13} /> {t('rs.multi')}
      </button>
      <span className="w-px h-4 bg-border mx-0.5" />
      {/* Points de rupture courants : un clic, la largeur. */}
      <div className="flex items-center gap-0.5" role="group" aria-label={t('rs.breakpoints')}>
        {BREAKPOINTS.map((bp) => (
          <button
            key={bp}
            type="button"
            className={chip(view.width === bp && device.kind === 'custom')}
            onClick={() => resize({ width: bp, height: view.height })}
            title={t('rs.breakpointHint', { px: bp })}
          >
            {bp}
          </button>
        ))}
      </div>
      <span className="flex-1" />
      <button
        type="button"
        className="btn btn-ghost btn-sm h-6 w-6 p-0"
        onClick={onClose}
        title={t('rs.close')}
        aria-label={t('rs.close')}
      >
        <X size={14} />
      </button>
    </div>
  );
}
