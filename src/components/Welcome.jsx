import { Rocket, Grid, Command, Search, MousePointerClick, Users } from 'lucide-react';
import { useT } from '../lib/i18n';

// Écran de bienvenue affiché au tout premier lancement (flag `onboarded`).
// Oriente l'utilisateur : ajouter une app, profils, et raccourcis clés.
export default function Welcome({ onClose, onOpenStore }) {
  const t = useT();
  const tips = [
    { icon: <Grid size={18} />, title: t('welcome.apps.title'), text: t('welcome.apps.text') },
    { icon: <Users size={18} />, title: t('welcome.profiles.title'), text: t('welcome.profiles.text') },
    { icon: <Command size={18} />, title: t('welcome.palette.title'), text: t('welcome.palette.text') },
    { icon: <Search size={18} />, title: t('welcome.find.title'), text: t('welcome.find.text') },
    {
      icon: <MousePointerClick size={18} />,
      title: t('welcome.context.title'),
      text: t('welcome.context.text'),
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        <div className="px-6 pt-6 pb-4 text-center border-b border-border">
          <div className="w-14 h-14 rounded-2xl bg-accent-primary/15 flex items-center justify-center mx-auto mb-3">
            <Rocket size={28} className="text-accent-primary" />
          </div>
          <h2 className="text-xl font-bold">{t('welcome.title')}</h2>
          <p className="text-sm text-text-muted mt-1">{t('welcome.subtitle')}</p>
        </div>

        <div className="p-4 space-y-2 max-h-[52vh] overflow-y-auto">
          {tips.map((tip) => (
            <div
              key={tip.title}
              className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-accent-primary/10 flex items-center justify-center flex-shrink-0 text-accent-primary">
                {tip.icon}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{tip.title}</div>
                <div className="text-xs text-text-muted">{tip.text}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border flex gap-2">
          <button
            onClick={() => {
              onClose();
              onOpenStore?.();
            }}
            className="flex-1 btn btn-primary"
          >
            <Grid size={16} /> {t('welcome.cta.addApp')}
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            {t('common.start')}
          </button>
        </div>
      </div>
    </div>
  );
}
