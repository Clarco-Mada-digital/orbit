import { Rocket, Grid, Command, Search, MousePointerClick, Users } from 'lucide-react';

// Écran de bienvenue affiché au tout premier lancement (flag `onboarded`).
// Oriente l'utilisateur : ajouter une app, profils, et raccourcis clés.
export default function Welcome({ onClose, onOpenStore }) {
  const tips = [
    {
      icon: <Grid size={18} />,
      title: 'Ajoutez vos apps',
      text: 'Bouton « + » de la barre latérale → choisissez parmi le catalogue ou une URL.',
    },
    {
      icon: <Users size={18} />,
      title: 'Profils & comptes',
      text: 'Séparez pro et perso ; les conteneurs permettent plusieurs comptes d’un même service.',
    },
    {
      icon: <Command size={18} />,
      title: 'Palette de commandes',
      text: 'Ctrl/Cmd + K : aller à une app, un espace, ou lancer une action. Tapez « help » pour les raccourcis.',
    },
    {
      icon: <Search size={18} />,
      title: 'Rechercher dans la page',
      text: 'Ctrl/Cmd + F cherche à l’intérieur de l’app affichée.',
    },
    {
      icon: <MousePointerClick size={18} />,
      title: 'Clic droit sur une app',
      text: 'Veille, favori, fenêtre détachée, conteneur, effacer les données…',
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-bg-elevated border border-border rounded-2xl shadow-2xl overflow-hidden animate-scale-in">
        <div className="px-6 pt-6 pb-4 text-center border-b border-border">
          <div className="w-14 h-14 rounded-2xl bg-accent-primary/15 flex items-center justify-center mx-auto mb-3">
            <Rocket size={28} className="text-accent-primary" />
          </div>
          <h2 className="text-xl font-bold">Bienvenue dans Orbit 🛰</h2>
          <p className="text-sm text-text-muted mt-1">
            Toutes vos apps web dans une seule fenêtre. Voici l’essentiel pour démarrer.
          </p>
        </div>

        <div className="p-4 space-y-2 max-h-[52vh] overflow-y-auto">
          {tips.map((t) => (
            <div key={t.title} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-bg-hover transition-colors">
              <div className="w-9 h-9 rounded-lg bg-accent-primary/10 flex items-center justify-center flex-shrink-0 text-accent-primary">
                {t.icon}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{t.title}</div>
                <div className="text-xs text-text-muted">{t.text}</div>
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
            <Grid size={16} /> Ajouter ma première app
          </button>
          <button onClick={onClose} className="btn btn-secondary">
            Commencer
          </button>
        </div>
      </div>
    </div>
  );
}
