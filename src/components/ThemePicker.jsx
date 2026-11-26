import { useRef, useState } from 'react';
import { Palette, Upload, Download, Trash2, AlertTriangle, Check, Sun, Moon, Monitor, Users, RefreshCw, Share2 } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../lib/i18n';
import {
  MODES,
  SKIN_META,
  migrateThemeSetting,
  resolveTheme,
} from '../lib/themes';
import { exportTheme, parseTheme, removeTheme, themeFileName, upsertTheme } from '../lib/customTheme';

// ---------------------------------------------------------------------------
// Réglages → Apparence → Thème.
//
// Deux axes côte à côte (identité et ambiance), les thèmes importés mêlés aux
// thèmes livrés, et l'import/export d'un fichier.
//
// L'aperçu de chaque thème est DESSINÉ AVEC SES PROPRES COULEURS, pas avec une
// capture ni une pastille de couleur : on y voit le fond, une surface posée
// dessus, le texte, le liseré et l'accent — c'est-à-dire ce qui change
// vraiment. Une rangée de ronds colorés ne dit rien de la silhouette d'un
// thème, et c'est justement ce qu'on cherche à montrer.
// ---------------------------------------------------------------------------

// Vignette d'aperçu : une mini-fenêtre d'Orbit rendue dans le thème visé.
function ThemeSwatch({ theme, size = 'normal' }) {
  const p = theme.palette;
  const tr = theme.traits;
  const small = size === 'small';
  return (
    <div
      className="w-full overflow-hidden"
      style={{
        background: `rgb(${p.bgPrimary})`,
        borderRadius: tr.radiusCard,
        border: `${tr.borderWidth} solid rgb(${p.border})`,
        height: small ? 44 : 66,
        padding: small ? 5 : 8,
        // La texture du thème, en réduction : c'est elle qui distingue
        // immédiatement un thème « grille » d'un thème uni.
        backgroundImage:
          tr.texture === 'grid'
            ? `linear-gradient(rgb(${p.accent} / 0.10) 1px, transparent 1px),
               linear-gradient(90deg, rgb(${p.accent} / 0.10) 1px, transparent 1px)`
            : tr.texture === 'glow'
              ? `radial-gradient(120% 90% at 50% -20%, rgb(${p.accent} / 0.22) 0%, transparent 65%)`
              : 'none',
        backgroundSize: tr.texture === 'grid' ? '11px 11px' : 'auto',
      }}
    >
      {/* Une surface posée sur le fond : c'est le contraste entre les deux qui
          se juge d'un coup d'œil. */}
      <div
        className="flex items-center gap-1.5"
        style={{
          background: `rgb(${p.bgElevated})`,
          borderRadius: tr.radiusCard,
          border: `${tr.borderWidth} solid rgb(${p.border})`,
          boxShadow: tr.shadowCard === 'none' ? 'none' : tr.shadowCard,
          padding: small ? '4px 5px' : '6px 7px',
        }}
      >
        <span
          style={{
            background: `rgb(${p.accent})`,
            borderRadius: tr.radiusPill,
            width: small ? 7 : 10,
            height: small ? 7 : 10,
            flexShrink: 0,
            boxShadow: tr.glow > 0 ? `0 0 ${8 * tr.glow}px rgb(${p.accent})` : 'none',
          }}
        />
        <span className="flex-1 min-w-0" style={{ display: 'grid', gap: small ? 2 : 3 }}>
          <span
            style={{
              background: `rgb(${p.textPrimary})`,
              height: small ? 3 : 4,
              width: '62%',
              borderRadius: 2,
            }}
          />
          <span
            style={{
              background: `rgb(${p.textMuted})`,
              height: small ? 2 : 3,
              width: '88%',
              borderRadius: 2,
            }}
          />
        </span>
      </div>
      {!small && (
        <div
          className="mt-1.5"
          style={{
            background: `rgb(${p.accent})`,
            borderRadius: tr.radiusControl,
            height: 11,
            width: '44%',
            boxShadow: tr.glow > 0 ? `0 0 ${10 * tr.glow}px rgb(${p.accent} / 0.6)` : 'none',
          }}
        />
      )}
    </div>
  );
}

const MODE_ICON = { dark: Moon, light: Sun, auto: Monitor };

export default function ThemePicker() {
  const { settings, updateSettings } = useStore(
    useShallow((s) => ({ settings: s.settings, updateSettings: s.updateSettings })),
  );
  const t = useT();
  const fileRef = useRef(null);
  // Retour du dernier import : erreurs (refus) ou avertissements (accepté
  // quand même). Gardé affiché jusqu'au prochain geste — un message de
  // lisibilité mérite d'être lu, pas chassé au bout de deux secondes.
  const [report, setReport] = useState(null);

  const custom = settings.customThemes || [];
  const { skin, mode } = migrateThemeSetting(settings, custom);

  // Le mode effectif pour les aperçus : en « auto », on montre ce que
  // l'utilisateur voit en ce moment, pas un mode arbitraire.
  const previewMode =
    mode === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: light)')?.matches
        ? 'light'
        : 'dark'
      : mode;

  const entries = [
    ...SKIN_META.map((meta) => ({ id: meta.id, name: meta.name, desc: t(meta.descKey), custom: false })),
    ...custom.map((c) => ({ id: c.id, name: c.name, desc: t('st.skin.imported'), custom: true })),
  ];

  const pick = (id) => updateSettings({ themeSkin: id, themeMode: mode });
  const pickMode = (value) => updateSettings({ themeSkin: skin, themeMode: value });

  const onImport = async (event) => {
    const file = event.target.files?.[0];
    // Le champ est remis à zéro tout de suite : sans ça, réimporter LE MÊME
    // fichier corrigé ne déclencherait aucun événement (la valeur n'a pas
    // changé), et on croirait l'import cassé.
    event.target.value = '';
    if (!file) return;
    try {
      const res = parseTheme(await file.text());
      if (!res.ok) {
        setReport({ kind: 'error', lines: res.errors });
        return;
      }
      updateSettings({
        customThemes: upsertTheme(custom, res.theme),
        themeSkin: res.theme.id,
        themeMode: mode,
      });
      setReport({
        kind: res.warnings.length ? 'warning' : 'ok',
        lines: res.warnings.length ? res.warnings : [t('st.skin.imported.ok', { name: res.theme.name })],
      });
    } catch (error) {
      setReport({ kind: 'error', lines: [String(error.message || error)] });
    }
  };

  const onExport = () => {
    const text = exportTheme(skin, custom);
    if (!text) return;
    // Téléchargement par ancre : le thème exporté part dans le dossier de
    // téléchargement, comme n'importe quel fichier.
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = themeFileName(skin);
    a.click();
    URL.revokeObjectURL(url);
    setReport({ kind: 'ok', lines: [t('st.skin.exported')] });
  };

  const onRemove = (id) => {
    const next = removeTheme(custom, id);
    // Le thème supprimé était peut-être celui en cours : on repasse sur Orbit
    // plutôt que de laisser le réglage pointer dans le vide.
    updateSettings({
      customThemes: next,
      ...(skin === id ? { themeSkin: 'orbit' } : {}),
    });
    setReport(null);
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Palette size={18} className="text-accent-primary" />
        <h4 className="font-semibold">{t('st.theme')}</h4>
      </div>
      <p className="text-sm text-text-muted mb-4">{t('st.themeDesc')}</p>

      {/* Identité */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {entries.map((entry) => {
          const preview = resolveTheme(entry.id, previewMode, false, custom);
          const active = skin === entry.id;
          return (
            <button
              key={entry.id}
              onClick={() => pick(entry.id)}
              className={`text-left p-2 rounded-xl border-2 transition-all ${
                active ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:border-accent-primary/50'
              }`}
              title={entry.desc}
            >
              <ThemeSwatch theme={preview} />
              <div className="flex items-center gap-1 mt-2 min-w-0">
                <span className="text-sm font-medium truncate flex-1">{entry.name}</span>
                {active && <Check size={14} className="text-accent-primary flex-shrink-0" />}
                {entry.custom && (
                  <span
                    role="button"
                    tabIndex={-1}
                    title={t('st.skin.remove')}
                    aria-label={t('st.skin.remove')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(entry.id);
                    }}
                    className="flex-shrink-0 p-0.5 rounded text-text-muted hover:text-error"
                  >
                    <Trash2 size={13} />
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted truncate">{entry.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Ambiance */}
      <h5 className="text-xs font-semibold text-text-muted uppercase mt-5 mb-2">
        {t('st.themeMode')}
      </h5>
      <div className="flex gap-2">
        {MODES.map((value) => {
          const Icon = MODE_ICON[value];
          return (
            <button
              key={value}
              onClick={() => pickMode(value)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border-2 text-sm transition-all ${
                mode === value
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border hover:border-accent-primary/50'
              }`}
            >
              <Icon size={15} />
              {t(`st.theme${value === 'dark' ? 'Dark' : value === 'light' ? 'Light' : 'Auto'}`)}
            </button>
          );
        })}
      </div>

      {/* Import / export */}
      <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-border">
        <button onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-sm">
          <Upload size={14} /> {t('st.skin.import')}
        </button>
        <button onClick={onExport} className="btn btn-secondary btn-sm">
          <Download size={14} /> {t('st.skin.export')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onImport}
          className="hidden"
        />
        <p className="text-xs text-text-muted flex-1 min-w-[12rem]">{t('st.skin.hint')}</p>
      </div>

      <CommunityThemes
        custom={custom}
        skin={skin}
        mode={mode}
        previewMode={previewMode}
        onInstalled={(theme, warnings) => {
          updateSettings({ customThemes: upsertTheme(custom, theme), themeSkin: theme.id, themeMode: mode });
          setReport({
            kind: warnings.length ? 'warning' : 'ok',
            lines: warnings.length ? warnings : [t('st.skin.imported.ok', { name: theme.name })],
          });
        }}
        onError={(lines) => setReport({ kind: 'error', lines })}
        onUse={(id) => updateSettings({ themeSkin: id, themeMode: mode })}
      />

      {/* Retour d'import. Les avertissements de lisibilité sont affichés en
          entier : c'est leur précision qui les rend actionnables. */}
      {report && (
        <div
          className={`mt-3 p-3 rounded-lg text-xs space-y-1 border ${
            report.kind === 'error'
              ? 'border-error/40 bg-error/10 text-error'
              : report.kind === 'warning'
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-success/40 bg-success/10 text-success'
          }`}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {report.kind === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
            {t(
              report.kind === 'error'
                ? 'st.skin.refused'
                : report.kind === 'warning'
                  ? 'st.skin.warned'
                  : 'st.skin.done'
            )}
          </div>
          {report.lines.map((line, i) => (
            <div key={i} className="opacity-90">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thèmes de la communauté : catalogue publié avec le site (themes-dist/ du
// dépôt, voir docs/guide-themes.md). Rien n'est demandé au réseau avant le
// clic sur « Parcourir ». Le fichier reçu a déjà été vérifié par le processus
// principal (taille + SHA-256 du catalogue) ; il passe ICI le même validateur
// qu'un import manuel : un thème n'est que des valeurs, jamais du code.
// ---------------------------------------------------------------------------
const GUIDE_URL = 'https://github.com/Clarco-Mada-digital/orbit/blob/master/docs/guide-themes.md#7-partager-son-thème';

function CommunityThemes({ custom, skin, previewMode, onInstalled, onError, onUse }) {
  const t = useT();
  const [state, setState] = useState({ open: false, loading: false, themes: [], error: '', stale: false });
  const [busy, setBusy] = useState('');

  const load = async (refresh = false) => {
    setState((s) => ({ ...s, open: true, loading: true, error: '' }));
    const res = await window.electronAPI?.themeCatalog?.(refresh).catch((e) => ({ success: false, error: String(e) }));
    setState({
      open: true,
      loading: false,
      themes: res?.themes || [],
      error: res?.success ? '' : `${t('st.community.offline')}${res?.error ? ` (${res.error})` : ''}`,
      stale: Boolean(res?.stale),
    });
  };

  const install = async (entry) => {
    setBusy(entry.id);
    try {
      const res = await window.electronAPI?.themeDownload?.(entry.id);
      if (!res?.success) {
        onError([t('st.community.failed', { name: entry.name }), res?.error || '']);
        return;
      }
      const parsed = parseTheme(res.text);
      if (!parsed.ok) {
        onError(parsed.errors);
        return;
      }
      onInstalled(parsed.theme, parsed.warnings);
    } finally {
      setBusy('');
    }
  };

  const installed = new Set((custom || []).map((c) => c.id));

  return (
    <div className="mt-5 pt-4 border-t border-border">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={16} className="text-accent-primary" />
        <div className="font-medium text-sm flex-1 min-w-[10rem]">{t('st.community.title')}</div>
        {state.open ? (
          <button onClick={() => load(true)} disabled={state.loading} className="btn btn-secondary btn-sm">
            <RefreshCw size={13} className={state.loading ? 'animate-spin' : undefined} /> {t('st.community.refresh')}
          </button>
        ) : (
          <button onClick={() => load(false)} className="btn btn-secondary btn-sm">
            {t('st.community.browse')}
          </button>
        )}
        <button onClick={() => window.open(GUIDE_URL, '_blank')} className="btn btn-secondary btn-sm">
          <Share2 size={13} /> {t('st.community.share')}
        </button>
      </div>
      <p className="text-xs text-text-muted mt-1">{t('st.community.desc')}</p>

      {state.open && (
        <div className="mt-3">
          {state.error && <p className="text-xs text-warning mb-2">{state.error}</p>}
          {state.stale && !state.error && <p className="text-xs text-text-muted mb-2">{t('st.community.stale')}</p>}
          {!state.loading && !state.themes.length && !state.error && (
            <p className="text-xs text-text-muted">{t('st.community.empty')}</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {state.themes.map((entry) => {
              const colors = entry.preview[previewMode] || entry.preview.dark || entry.preview.light;
              const has = installed.has(entry.id);
              const current = skin === entry.id;
              return (
                <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                  {colors ? (
                    <div
                      className="h-12 w-16 shrink-0 rounded-lg border border-border overflow-hidden p-1.5 flex flex-col justify-between"
                      style={{ background: `rgb(${colors.bgPrimary})` }}
                      aria-hidden="true"
                    >
                      <div className="h-2 w-10 rounded-full" style={{ background: `rgb(${colors.textPrimary})`, opacity: 0.85 }} />
                      <div className="flex gap-1">
                        <div className="h-4 flex-1 rounded" style={{ background: `rgb(${colors.bgElevated})` }} />
                        <div className="h-4 w-4 rounded" style={{ background: `rgb(${colors.accent})` }} />
                      </div>
                    </div>
                  ) : (
                    <div className="h-12 w-16 shrink-0 rounded-lg bg-bg-hover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{entry.name}</div>
                    <div className="text-[11px] text-text-muted truncate">
                      {entry.author ? t('st.community.by', { author: entry.author }) : ''}
                    </div>
                    {entry.description && <div className="text-[11px] text-text-muted line-clamp-2">{entry.description}</div>}
                  </div>
                  {current ? (
                    <span className="text-xs text-accent-primary flex items-center gap-1 shrink-0">
                      <Check size={12} /> {t('st.community.active')}
                    </span>
                  ) : has ? (
                    <button onClick={() => onUse(entry.id)} className="btn btn-secondary btn-sm shrink-0">
                      {t('st.community.use')}
                    </button>
                  ) : (
                    <button onClick={() => install(entry)} disabled={busy === entry.id} className="btn btn-primary btn-sm shrink-0">
                      {busy === entry.id ? '…' : t('st.community.install')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
