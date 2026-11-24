import { useEffect, useRef, useState } from 'react';
import { Pin } from 'lucide-react';
import { useStore, appVisibleIn } from '../stores/useStore';
import { useShallow } from 'zustand/react/shallow';

// ---------------------------------------------------------------------------
// Changement de profil : une transition qui SE VOIT, et un indice qui reste.
//
// 1. Carte 3D : une face aux couleurs du profil (emoji, nom, nombre d'apps)
//    pivote comme la face d'un cube — vers la gauche pour le profil suivant,
//    vers la droite pour le précédent. Les pages d'apps sont des surfaces
//    natives qu'on ne peut pas transformer en CSS : la carte est donc un voile
//    posé AU-DESSUS, qui couvre la bascule.
// 2. Pastille : « Profil Travail » reste quelques secondes en haut de la zone
//    de contenu. Quand l'app affichée est partagée entre profils (épinglée),
//    rien ne change à l'écran — la pastille le dit, sinon on ne sait pas où
//    l'on est.
//
// Réglages : `profileTransition` ('cube' | 'flash' | 'none') et
// `profileHint` (pastille, activée par défaut).
// ---------------------------------------------------------------------------
export default function ProfileTransition() {
  const { activeProfile, profiles, apps, activeApp, settings } = useStore(
    useShallow((s) => ({ activeProfile: s.activeProfile, profiles: s.profiles, apps: s.apps, activeApp: s.activeApp, settings: s.settings }))
  );
  const previous = useRef(activeProfile);
  const [show, setShow] = useState(null); // { key, profile, dir, shared, count }
  const [hint, setHint] = useState(null);

  const style = settings.profileTransition || 'cube';
  const animationsOff = (settings.animationStyle ?? (settings.animationsEnabled === false ? 'none' : 'fade')) === 'none';

  useEffect(() => {
    if (previous.current === activeProfile) return undefined;
    const from = profiles.findIndex((p) => p.id === previous.current);
    const to = profiles.findIndex((p) => p.id === activeProfile);
    previous.current = activeProfile;
    const profile = profiles[to];
    if (!profile) return undefined;
    const current = apps.find((a) => a.id === activeApp);
    const shared = current && current.scope === 'all' && appVisibleIn(current, activeProfile) ? current.name : null;
    const count = apps.filter((a) => appVisibleIn(a, activeProfile)).length;
    const key = Date.now();
    const dir = to >= from ? 1 : -1;
    // Publication différée : jamais de setState pendant l'effet lui-même.
    const t0 = setTimeout(() => {
      if (style !== 'none' && !animationsOff) setShow({ key, profile, dir, count });
      if (settings.profileHint !== false) setHint({ key, profile, shared });
    }, 0);
    const t1 = setTimeout(() => setShow((s) => (s?.key === key ? null : s)), 760);
    const t2 = setTimeout(() => setHint((h) => (h?.key === key ? null : h)), shared ? 4200 : 2600);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // Seul le changement de profil déclenche la transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile]);

  const color = show?.profile.color || '#6366f1';
  return (
    <>
      {show ? (
        <div key={show.key} aria-hidden="true" className="orbit-profile-stage" style={{ '--profile-dir': show.dir }}>
          <div
            className={`orbit-profile-card ${style === 'flash' ? 'is-flash' : ''}`}
            style={{ background: `radial-gradient(circle at 30% 20%, ${color}55, transparent 60%), linear-gradient(135deg, ${color}40, transparent 70%), rgb(var(--bg-secondary))` }}
          >
            <div className="orbit-profile-emoji">{show.profile.emoji || '👤'}</div>
            <div className="orbit-profile-name">{show.profile.name}</div>
            <div className="orbit-profile-meta">
              {show.count} application{show.count > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      ) : null}
      {hint ? (
        <div key={`h${hint.key}`} role="status" aria-live="polite" className="orbit-profile-hint" style={{ '--hint-out': hint.shared ? '3.8s' : '2.2s' }}>
          <span className="orbit-profile-hint-dot" style={{ background: hint.profile.color || 'rgb(var(--accent-primary))' }} />
          <span>
            Profil <strong>{hint.profile.emoji} {hint.profile.name}</strong>
          </span>
          {hint.shared ? (
            <span className="orbit-profile-hint-shared">
              <Pin size={11} /> {hint.shared} reste ouverte (partagée entre profils)
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
