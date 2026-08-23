import { useState } from 'react';
import {
  GripVertical,
  Plus,
  X,
  RotateCcw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Clock,
  CloudSun,
  Timer,
} from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useT } from '../lib/i18n';
import {
  DEFAULT_TOPBAR,
  DEFAULT_BOTTOMBAR,
  TOPBAR_ZONES,
  availableModules,
  moduleById,
  normalizeTopbar,
} from '../lib/topbarLayout';

const ZONE_ICON = { left: AlignLeft, center: AlignCenter, right: AlignRight };

// Éditeur de disposition (3 zones gauche / centre / droite) partagé entre
// l'en-tête et la barre du bas. Glisser-déposer pour déplacer un module,
// menu « + » pour en ajouter.
function LayoutEditor({ layout, onApply }) {
  const t = useT();
  const [addMenu, setAddMenu] = useState(null); // zone en cours d'ajout
  const [drag, setDrag] = useState(null); // { zone, index }
  const [hover, setHover] = useState(null); // { zone, index }

  const apply = onApply;

  const removeAt = (zone, index) => {
    const next = { ...layout, [zone]: layout[zone].filter((_, i) => i !== index) };
    apply(next);
  };

  const addTo = (zone, id) => {
    apply({ ...layout, [zone]: [...layout[zone], id] });
    setAddMenu(null);
  };

  // Déplace un module (même zone ou d'une zone à l'autre) à la position visée
  const move = (from, to) => {
    if (!from || !to) return;
    if (from.zone === to.zone && from.index === to.index) return;
    const next = { left: [...layout.left], center: [...layout.center], right: [...layout.right] };
    const [id] = next[from.zone].splice(from.index, 1);
    let index = to.index;
    if (from.zone === to.zone && from.index < to.index) index -= 1;
    next[to.zone].splice(Math.max(0, Math.min(index, next[to.zone].length)), 0, id);
    apply(next);
  };

  const available = availableModules(layout);

  // La grille des 3 zones uniquement — l'habillage (titre, bouton reset,
  // interrupteur) est géré par le composant parent.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {TOPBAR_ZONES.map((zone) => {
            const ZoneIcon = ZONE_ICON[zone];
            const items = layout[zone];
            return (
              <div key={zone} className="bg-bg-secondary border border-border rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <ZoneIcon size={14} className="text-text-muted" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {t(`st.zone.${zone}`)}
                  </span>
                  <span className="ml-auto text-[11px] text-text-muted">{items.length}</span>
                </div>

                <div
                  className="space-y-1.5 min-h-[52px]"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHover({ zone, index: items.length });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    move(drag, hover || { zone, index: items.length });
                    setDrag(null);
                    setHover(null);
                  }}
                >
                  {items.length === 0 && (
                    <div className="text-[11px] text-text-muted italic px-2 py-3 text-center border border-dashed border-border rounded-lg">
                      {t('st.zoneEmpty')}
                    </div>
                  )}

                  {items.map((id, index) => {
                    const mod = moduleById(id);
                    const isDragged = drag && drag.zone === zone && drag.index === index;
                    const dropBefore = hover && hover.zone === zone && hover.index === index;
                    return (
                      <div
                        key={`${id}-${index}`}
                        draggable
                        onDragStart={() => setDrag({ zone, index })}
                        onDragEnd={() => {
                          setDrag(null);
                          setHover(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Moitié haute → on insère avant, moitié basse → après
                          const r = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          setHover({ zone, index: after ? index + 1 : index });
                        }}
                        className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg border transition-all cursor-grab active:cursor-grabbing ${
                          isDragged
                            ? 'opacity-40 border-accent-primary'
                            : 'bg-bg-elevated border-border hover:border-accent-primary/50'
                        } ${dropBefore ? 'border-t-2 border-t-accent-primary' : ''}`}
                        title={t(mod?.descKey || '')}
                      >
                        <GripVertical size={13} className="text-text-muted flex-shrink-0" />
                        <span className="text-sm truncate flex-1">{t(mod?.labelKey || id)}</span>
                        <button
                          onClick={() => removeAt(zone, index)}
                          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-opacity flex-shrink-0"
                          title={t('common.remove')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Ajouter un module dans cette zone */}
                <div className="relative mt-2">
                  <button
                    onClick={() => setAddMenu(addMenu === zone ? null : zone)}
                    disabled={available.length === 0}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-text-muted hover:text-accent-primary border border-dashed border-border rounded-lg transition-colors disabled:opacity-40"
                  >
                    <Plus size={13} /> {t('st.addModule')}
                  </button>
                  {addMenu === zone && available.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-bg-elevated border border-border rounded-xl shadow-2xl z-20 py-1 max-h-56 overflow-y-auto">
                      {available.map((mod) => (
                        <button
                          key={mod.id}
                          onClick={() => addTo(zone, mod.id)}
                          className="w-full text-left px-3 py-2 hover:bg-bg-hover transition-colors"
                        >
                          <div className="text-sm">{t(mod.labelKey)}</div>
                          <div className="text-[11px] text-text-muted leading-snug">{t(mod.descKey)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
    </div>
  );
}

// Réglages des barres : en-tête (barre du haut) et barre du bas (optionnelle),
// plus horloge / météo / minuteur de concentration.
export default function TopbarSettings() {
  const t = useT();
  const { settings, updateSettings } = useStore();
  const topbarLayout = normalizeTopbar(settings?.topbar);
  const bottombarLayout = normalizeTopbar(settings?.bottombar, DEFAULT_BOTTOMBAR);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h4 className="font-semibold">{t('st.topbarTitle')}</h4>
            <p className="text-sm text-text-muted">{t('st.topbarDesc')}</p>
          </div>
          <button
            onClick={() => updateSettings({ topbar: { ...DEFAULT_TOPBAR } })}
            className="btn btn-secondary btn-sm flex items-center gap-1.5 flex-shrink-0"
          >
            <RotateCcw size={13} /> {t('st.topbarReset')}
          </button>
        </div>

        <div className="mt-4">
          <LayoutEditor
            layout={topbarLayout}
            onApply={(next) => updateSettings({ topbar: normalizeTopbar(next) })}
          />
        </div>
        <p className="text-[11px] text-text-muted mt-3">{t('st.topbarHint')}</p>
      </div>

      {/* Barre du bas (optionnelle) */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h4 className="font-semibold">{t('st.bottombarTitle')}</h4>
            <p className="text-sm text-text-muted">{t('st.bottombarDesc')}</p>
          </div>
          <button
            onClick={() => updateSettings({ bottombar: { ...DEFAULT_BOTTOMBAR } })}
            className="btn btn-secondary btn-sm flex items-center gap-1.5 flex-shrink-0"
          >
            <RotateCcw size={13} /> {t('st.topbarReset')}
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm mt-3">
          <input
            type="checkbox"
            checked={settings.bottombarEnabled === true}
            onChange={(e) => updateSettings({ bottombarEnabled: e.target.checked })}
            className="w-4 h-4 accent-accent-primary"
          />
          {t('st.bottombarEnable')}
        </label>

        {settings.bottombarEnabled !== false && (
          <div className="mt-4">
            <LayoutEditor
              layout={bottombarLayout}
              onApply={(next) =>
                updateSettings({ bottombar: normalizeTopbar(next, DEFAULT_BOTTOMBAR) })
              }
            />
          </div>
        )}
      </div>

      {/* Réglages de l'horloge */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('st.clockTitle')}</h4>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">{t('st.clockFormat')}</span>
            <select
              value={settings.clock?.format || '24'}
              onChange={(e) => updateSettings({ clock: { ...settings.clock, format: e.target.value } })}
              className="input mt-1"
            >
              <option value="24">{t('st.clock24')}</option>
              <option value="12">{t('st.clock12')}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('st.clockZones')}</span>
            <input
              type="text"
              value={(settings.clock?.timezones || []).join(', ')}
              onChange={(e) =>
                updateSettings({
                  clock: {
                    ...settings.clock,
                    timezones: e.target.value
                      .split(',')
                      .map((z) => z.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="Europe/Paris, America/New_York"
              className="input mt-1"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-6 mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.clock?.seconds === true}
              onChange={(e) => updateSettings({ clock: { ...settings.clock, seconds: e.target.checked } })}
              className="w-4 h-4 accent-accent-primary"
            />
            {t('st.clockSeconds')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.clock?.showDate !== false}
              onChange={(e) => updateSettings({ clock: { ...settings.clock, showDate: e.target.checked } })}
              className="w-4 h-4 accent-accent-primary"
            />
            {t('st.clockDate')}
          </label>
        </div>
      </div>

      {/* Réglages météo */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <CloudSun size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('st.weatherTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">{t('st.weatherDesc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium">{t('st.weatherCity')}</span>
            <input
              type="text"
              value={settings.weather?.city || ''}
              onChange={(e) => updateSettings({ weather: { ...settings.weather, city: e.target.value } })}
              placeholder="Antananarivo"
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t('st.weatherUnits')}</span>
            <select
              value={settings.weather?.units || 'metric'}
              onChange={(e) => updateSettings({ weather: { ...settings.weather, units: e.target.value } })}
              className="input mt-1"
            >
              <option value="metric">{t('st.weatherMetric')}</option>
              <option value="imperial">{t('st.weatherImperial')}</option>
            </select>
          </label>
        </div>
      </div>

      {/* Réglages du minuteur de concentration */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Timer size={18} className="text-accent-primary" />
          <h4 className="font-semibold">{t('st.focusTitle')}</h4>
        </div>
        <p className="text-sm text-text-muted mb-4">{t('st.focusDesc')}</p>
        <div className="grid grid-cols-3 gap-3">
          {[
            ['workMinutes', t('st.focusWork'), 25],
            ['shortBreakMinutes', t('st.focusShort'), 5],
            ['longBreakMinutes', t('st.focusLong'), 15],
          ].map(([key, label, fallback]) => (
            <label key={key} className="block">
              <span className="text-sm font-medium">{label}</span>
              <input
                type="number"
                min="1"
                max="180"
                value={settings.focus?.[key] ?? fallback}
                onChange={(e) =>
                  updateSettings({
                    focus: { ...settings.focus, [key]: Math.max(1, parseInt(e.target.value, 10) || fallback) },
                  })
                }
                className="input mt-1"
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm mt-4">
          <input
            type="checkbox"
            checked={settings.focus?.autoContinue === true}
            onChange={(e) => updateSettings({ focus: { ...settings.focus, autoContinue: e.target.checked } })}
            className="w-4 h-4 accent-accent-primary"
          />
          {t('st.focusAuto')}
        </label>
      </div>
    </div>
  );
}
