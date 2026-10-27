import {
  Command,
  Download,
  Grid2X2,
  MousePointerClick,
  Puzzle,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useT } from '../lib/i18n';

const apps = [
  { name: 'Gmail', mark: 'G', color: 'from-rose-500 to-amber-400' },
  { name: 'Drive', mark: 'D', color: 'from-emerald-500 to-cyan-400' },
  { name: 'Notion', mark: 'N', color: 'from-slate-500 to-slate-300' },
];

export default function Welcome({ onClose, onOpenStore }) {
  const t = useT();
  const features = [
    { icon: <Grid2X2 size={18} />, title: t('welcome.apps.title'), text: t('welcome.apps.text') },
    { icon: <Users size={18} />, title: t('welcome.profiles.title'), text: t('welcome.profiles.text') },
    { icon: <Command size={18} />, title: t('welcome.palette.title'), text: t('welcome.palette.text') },
    { icon: <Search size={18} />, title: t('welcome.find.title'), text: t('welcome.find.text') },
    {
      icon: <MousePointerClick size={18} />,
      title: t('welcome.context.title'),
      text: t('welcome.context.text'),
    },
    { icon: <Sparkles size={18} />, title: t('welcome.ai.title'), text: t('welcome.ai.text') },
    { icon: <Download size={18} />, title: t('welcome.downloads.title'), text: t('welcome.downloads.text') },
    { icon: <ShieldCheck size={18} />, title: t('welcome.vault.title'), text: t('welcome.vault.text') },
    { icon: <Puzzle size={18} />, title: t('welcome.extensions.title'), text: t('welcome.extensions.text') },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="relative my-auto w-full max-w-5xl overflow-hidden rounded-[28px] border border-white/15 bg-slate-950/80 text-white shadow-[0_32px_120px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-scale-in">
        <div className="pointer-events-none absolute -left-28 -top-32 h-80 w-80 rounded-full bg-violet-500/25 blur-[100px]" />
        <div className="pointer-events-none absolute -right-20 top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-[100px]" />

        <header className="relative grid gap-8 border-b border-white/10 px-6 pb-7 pt-7 sm:px-9 sm:pt-9 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-medium text-slate-200 shadow-lg shadow-black/10">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.9)]" />
              {t('welcome.eyebrow')}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-gradient-to-br from-violet-400/30 to-cyan-300/10 text-cyan-100 shadow-inner shadow-white/10">
                <Rocket size={24} />
              </div>
              <h2 id="welcome-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
                {t('welcome.title')}
              </h2>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
              {t('welcome.subtitle')}
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-sm rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-1.5 border-b border-white/10 pb-3">
              <span className="h-2 w-2 rounded-full bg-rose-300/90" />
              <span className="h-2 w-2 rounded-full bg-amber-200/90" />
              <span className="h-2 w-2 rounded-full bg-emerald-200/90" />
              <span className="ml-2 h-2 w-24 rounded-full bg-white/10" />
            </div>
            <div className="flex gap-3">
              {apps.map((app) => (
                <div
                  key={app.name}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2 rounded-xl border border-white/10 bg-slate-900/45 px-2 py-3"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${app.color} text-sm font-bold text-white shadow-lg`}
                  >
                    {app.mark}
                  </span>
                  <span className="text-xs text-slate-300">{app.name}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-cyan-200/10 bg-cyan-300/[0.07] px-3 py-2.5">
              <Sparkles size={15} className="shrink-0 text-cyan-200" />
              <span className="h-2 w-3/4 rounded-full bg-white/15" />
              <span className="h-2 w-1/4 rounded-full bg-white/10" />
            </div>
            <div className="absolute -bottom-4 -right-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-slate-900/80 text-violet-200 shadow-xl backdrop-blur-lg">
              <ShieldCheck size={20} />
            </div>
          </div>
        </header>

        <main className="relative max-h-[45vh] overflow-y-auto px-6 py-6 sm:px-9">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/10" />
            {t('welcome.features')}
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/10" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article
                key={feature.title}
                className="group rounded-2xl border border-white/[0.09] bg-white/[0.045] p-4 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/25 hover:bg-white/[0.08]"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-400/20 to-cyan-300/10 text-cyan-100 transition group-hover:border-cyan-200/20">
                  {feature.icon}
                </div>
                <h3 className="text-sm font-semibold text-slate-100">{feature.title}</h3>
                <p className="mt-1.5 text-xs leading-5 text-slate-400">{feature.text}</p>
              </article>
            ))}
          </div>
        </main>

        <footer className="relative flex flex-col-reverse gap-3 border-t border-white/10 bg-black/10 px-6 py-5 sm:flex-row sm:justify-end sm:px-9">
          <button onClick={onClose} className="btn btn-secondary">
            {t('common.start')}
          </button>
          <button
            onClick={() => {
              onClose();
              onOpenStore?.();
            }}
            className="btn btn-primary"
          >
            <Grid2X2 size={16} /> {t('welcome.cta.addApp')}
          </button>
        </footer>
      </div>
    </div>
  );
}
