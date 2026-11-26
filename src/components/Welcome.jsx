import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Command, Grid2X2, MousePointerClick, X } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { recipes } from '../lib/recipes';
import { migrateThemeSetting } from '../lib/themes';
import { appFromRecipe } from '../lib/installRecipe';
import { shortcutKeys } from '../lib/shortcuts';
import { useT } from '../lib/i18n';
import OrbitLogo from './OrbitLogo';
import AppIcon from './AppIcon';

// ---------------------------------------------------------------------------
// Premier lancement — trois étapes courtes plutôt qu'un mur de fonctionnalités :
//   1. Bienvenue : ce qu'est Orbit, en une phrase.
//   2. À ton goût : langue, ambiance, côté de la barre — appliqués EN DIRECT,
//      on voit l'effet avant de continuer.
//   3. Tes apps : des apps courantes à cocher (vraies icônes), installées d'un
//      coup ; et les trois gestes à connaître.
// Tout est modifiable ensuite dans Réglages ; « Passer » ferme à tout moment.
// ---------------------------------------------------------------------------

// Apps proposées : les plus courantes, de domaines variés.
const SUGGESTED = ['gmail', 'whatsapp', 'gdrive', 'calendar', 'notion', 'slack', 'teams', 'chatgpt', 'youtube', 'spotify', 'github', 'trello'];

function Choice({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
        active
          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary font-medium'
          : 'border-border text-text-secondary hover:bg-bg-hover'
      }`}
    >
      {children}
    </button>
  );
}

export default function Welcome({ onClose, onOpenStore }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const apps = useStore((s) => s.apps);
  const activeProfile = useStore((s) => s.activeProfile);
  const addApp = useStore((s) => s.addApp);

  const installed = useMemo(() => new Set(apps.map((a) => a.recipeId).filter(Boolean)), [apps]);
  const suggestions = SUGGESTED.map((id) => recipes[id]).filter(Boolean);
  const [picked, setPicked] = useState(() => new Set());

  const { skin, mode } = migrateThemeSetting(settings, settings.customThemes);
  const side = settings.sidebarPosition === 'right' ? 'right' : 'left';
  const keys = shortcutKeys(t);
  const mod = keys.find((k) => k.keys.includes('K'))?.keys[0] || 'Alt';

  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const finish = () => {
    for (const id of picked) {
      const recipe = recipes[id];
      if (recipe && !installed.has(id)) addApp(appFromRecipe(recipe, activeProfile, 0));
    }
    onClose();
  };

  const steps = [
    // 1 — Bienvenue
    <div key="hello" className="flex flex-col items-center text-center px-2">
      <OrbitLogo size={88} className="drop-shadow-xl" />
      <h2 id="welcome-title" className="mt-6 text-3xl font-bold tracking-tight">
        {t('wz.hello.title')}
      </h2>
      <p className="mt-3 max-w-md text-text-secondary leading-relaxed">{t('wz.hello.text')}</p>
      <ul className="mt-6 grid gap-2 text-sm text-text-secondary text-left">
        {['wz.hello.p1', 'wz.hello.p2', 'wz.hello.p3'].map((k) => (
          <li key={k} className="flex items-start gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-accent-primary" />
            {t(k)}
          </li>
        ))}
      </ul>
    </div>,

    // 2 — À ton goût (appliqué en direct)
    <div key="taste" className="px-2">
      <h2 className="text-2xl font-bold tracking-tight">{t('wz.taste.title')}</h2>
      <p className="mt-1 text-sm text-text-muted">{t('wz.taste.text')}</p>
      <div className="mt-6 space-y-5">
        <div>
          <div className="mb-2 text-sm font-medium">{t('settings.language')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              ['auto', t('settings.language.auto')],
              ['fr', 'Français'],
              ['en', 'English'],
            ].map(([v, label]) => (
              <Choice key={v} active={(settings.language || 'auto') === v} onClick={() => updateSettings({ language: v })}>
                {label}
              </Choice>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">{t('wz.taste.mode')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              ['dark', t('wz.mode.dark')],
              ['light', t('wz.mode.light')],
              ['auto', t('wz.mode.auto')],
            ].map(([v, label]) => (
              <Choice key={v} active={mode === v} onClick={() => updateSettings({ themeSkin: skin, themeMode: v })}>
                {label}
              </Choice>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium">{t('st.sidebarSide')}</div>
          <div className="flex flex-wrap gap-2">
            {[
              ['left', t('st.sidebarSide.left')],
              ['right', t('st.sidebarSide.right')],
            ].map(([v, label]) => (
              <Choice key={v} active={side === v} onClick={() => updateSettings({ sidebarPosition: v })}>
                {label}
              </Choice>
            ))}
          </div>
        </div>
        <p className="text-xs text-text-muted">{t('wz.taste.later')}</p>
      </div>
    </div>,

    // 3 — Tes apps + les gestes à connaître
    <div key="apps" className="px-2">
      <h2 className="text-2xl font-bold tracking-tight">{t('wz.apps.title')}</h2>
      <p className="mt-1 text-sm text-text-muted">{t('wz.apps.text')}</p>
      <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
        {suggestions.map((r) => {
          const already = installed.has(r.id);
          const on = already || picked.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              disabled={already}
              onClick={() => togglePick(r.id)}
              aria-pressed={on}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-colors ${
                on ? 'border-accent-primary bg-accent-primary/10' : 'border-border hover:bg-bg-hover'
              } ${already ? 'opacity-60 cursor-default' : ''}`}
              title={already ? t('wz.apps.already') : r.name}
            >
              <AppIcon app={{ recipeId: r.id, icon: r.icon, url: r.url, name: r.name }} className="w-8 h-8 rounded-lg" fallbackClassName="text-2xl" />
              <span className="truncate max-w-full text-text-secondary">{r.name}</span>
              {on && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-white">
                  <Check size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => {
          finish();
          onOpenStore?.();
        }}
        className="mt-2 text-xs text-accent-primary hover:underline"
      >
        {t('wz.apps.more')}
      </button>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {[
          { icon: <Command size={16} />, keys: `${mod}+K`, text: t('wz.tip.palette') },
          { icon: <MousePointerClick size={16} />, keys: t('wz.tip.rightClickKey'), text: t('wz.tip.rightClick') },
          { icon: <Grid2X2 size={16} />, keys: `${mod}+T`, text: t('wz.tip.newPage') },
        ].map((tip) => (
          <div key={tip.keys} className="rounded-xl border border-border bg-bg-primary/60 p-3">
            <div className="flex items-center gap-2 text-accent-primary">
              {tip.icon}
              <kbd className="rounded-md border border-border bg-bg-elevated px-1.5 py-0.5 text-[11px] font-semibold text-text-primary">
                {tip.keys}
              </kbd>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-text-secondary">{tip.text}</p>
          </div>
        ))}
      </div>
    </div>,
  ];

  const last = step === steps.length - 1;

  return (
    <div
      // Étape « À ton goût » : fond clair et net, pour VOIR l'effet des choix.
      className={`fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 transition-colors ${
        step === 1 ? 'bg-black/15' : 'bg-black/60 backdrop-blur-sm'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="relative w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-2xl animate-scale-in">
        <button onClick={onClose} className="btn-icon absolute top-3 right-3 z-10" title={t('wz.skip')}>
          <X size={18} />
        </button>

        <div className="flex-1 overflow-y-auto px-6 pt-10 pb-6 sm:px-8">{steps[step]}</div>

        <footer className="flex items-center justify-between gap-3 border-t border-border bg-bg-primary/50 px-6 py-4 sm:px-8">
          <div className="flex items-center gap-1.5" aria-label={t('wz.progress', { n: step + 1, total: steps.length })}>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-accent-primary' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)} className="btn btn-secondary btn-sm">
                <ArrowLeft size={14} /> {t('wz.back')}
              </button>
            ) : (
              <button onClick={onClose} className="btn btn-secondary btn-sm">
                {t('wz.skip')}
              </button>
            )}
            {last ? (
              <button onClick={finish} className="btn btn-primary btn-sm">
                {picked.size ? t('wz.finishWith', { n: picked.size }) : t('wz.finish')}
              </button>
            ) : (
              <button onClick={() => setStep(step + 1)} className="btn btn-primary btn-sm" autoFocus>
                {t('wz.next')} <ArrowRight size={14} />
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
