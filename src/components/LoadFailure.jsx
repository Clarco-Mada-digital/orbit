import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCw, ShieldAlert, ExternalLink, Unlock } from 'lucide-react';
import {
  describeLoadFailure,
  isCertificateFailure,
  canFallBackToHttp,
  hostLabel,
} from '../lib/loadFailure';

// ---------------------------------------------------------------------------
// Interstitielle d'échec de chargement — ce qui remplace la page blanche.
//
// Avant : un `did-fail-load` ne produisait qu'un `console.warn`. L'utilisateur
// voyait un cadre vide et ne pouvait rien en conclure : site en panne ? Orbit
// cassé ? faut-il attendre ? Le cas le plus fréquent était d'ailleurs de NOTRE
// fait : le bouclier réécrit toute navigation http en https, et un serveur sans
// TLS échouait alors en silence alors qu'un navigateur l'affiche très bien.
//
// Ce composant dit ce qui s'est passé et propose les seuls gestes qui ont une
// chance d'aboutir. Les deux gestes « risqués » sont traités comme dans un
// navigateur : nommés, expliqués, jamais automatiques.
//   • « Continuer en HTTP » n'apparaît que si le bouclier a bien mis à niveau
//     la navigation (sinon le bouton ne corrigerait rien) ;
//   • « Continuer quand même » n'apparaît que sur un échec de certificat, et la
//     dérogation expire à la fermeture d'Orbit.
//
// Les décisions (quel message, quel geste) vivent dans lib/loadFailure.js, testé
// sous `node --test`. Ici il n'y a que de l'affichage.
// ---------------------------------------------------------------------------

export default function LoadFailure({ app, failure, onRetry, onLoadUrl, onAccepted }) {
  // Trace de mise à niveau HTTPS, demandée au processus principal : lui seul
  // sait si l'adresse d'origine était en http. `null` tant qu'on n'a pas la
  // réponse → le bouton n'apparaît pas par défaut, il apparaît s'il est justifié.
  const [upgrade, setUpgrade] = useState(null);
  const [busy, setBusy] = useState(false);

  // Le message dépend de ce qu'on sait : tant que la trace de mise à niveau
  // n'est pas revenue, on décrit l'échec brut ; dès qu'elle arrive, on dit que
  // c'est NOTRE passage en https qui n'aboutit pas, et pas le site qui est en
  // panne. Un rendu de plus, un message juste.
  const describe = describeLoadFailure(failure.code, failure.description, {
    upgraded: !!upgrade,
  });
  // L'hôte à montrer est celui que l'utilisateur a DEMANDÉ, pas celui qu'on a
  // réécrit : afficher « https://… » alors qu'il a tapé « http://… » rendrait
  // le message incompréhensible.
  const host =
    hostLabel(upgrade?.from) || hostLabel(failure.url) || hostLabel(app.url) || app.name;

  useEffect(() => {
    let alive = true;
    const ask = window.electronAPI?.shields?.lastHttpUpgrade;
    if (typeof ask !== 'function' || failure.webContentsId == null) return undefined;
    Promise.resolve(ask(failure.webContentsId))
      .then((entry) => {
        // On ne retient la trace que si elle concerne BIEN l'URL qui vient
        // d'échouer : une mise à niveau pour une autre navigation ne doit pas
        // faire apparaître un bouton qui renverrait ailleurs.
        if (alive && entry && entry.to === failure.url) setUpgrade(entry);
      })
      .catch(() => {
        /* trace indisponible : on reste sur le message simple */
      });
    return () => {
      alive = false;
    };
  }, [failure.webContentsId, failure.url]);

  const offerHttp = canFallBackToHttp(failure.code, { upgraded: !!upgrade });
  const offerTrust = isCertificateFailure(failure.code);

  // « Continuer en HTTP » : on lève la mise à niveau pour cette origine (le
  // temps de la session), puis on charge l'adresse d'origine en clair.
  const continueInHttp = async () => {
    if (!upgrade || busy) return;
    setBusy(true);
    try {
      const r = await window.electronAPI?.shields?.allowHttp?.(upgrade.from);
      if (r?.success) {
        onAccepted?.('http', upgrade.from);
        onLoadUrl(upgrade.from);
        return;
      }
    } catch {
      /* ignore : on relâche le bouton, l'utilisateur peut réessayer */
    }
    setBusy(false);
  };

  // « Continuer quand même » : on fait confiance au certificat de cet hôte
  // jusqu'à la fermeture d'Orbit, puis on recharge.
  const trustAndRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.electronAPI?.security?.trustCertificate?.(failure.url);
      if (r?.success) {
        onAccepted?.('certificate', failure.url);
        onLoadUrl(failure.url);
        return;
      }
    } catch {
      /* ignore */
    }
    setBusy(false);
  };

  const Icon = offerTrust || offerHttp ? ShieldAlert : AlertTriangle;

  return (
    // `bg-bg-primary` et pas `bg-bg-base` : seul le premier est défini dans le
    // thème (voir le bloc @theme de index.css). L'autre ne produit aucune règle
    // → le voile serait transparent, et l'interstitielle illisible par-dessus
    // la page en échec.
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-bg-primary/95 backdrop-blur-xs p-6 overflow-auto">
      <div className="w-14 h-14 rounded-2xl bg-error/15 flex items-center justify-center flex-shrink-0">
        <Icon size={28} className="text-error" />
      </div>

      <div className="text-center max-w-prose">
        <p className="font-semibold">{describe.title}</p>
        <p className="text-sm text-text-muted mt-1">{describe.detail}</p>
        <p className="text-sm text-text-muted mt-2">
          <span className="font-medium">{host}</span>
        </p>
      </div>

      {/* Ce que l'utilisateur accepte, dit avant qu'il clique — pas après. */}
      {/* Certificat refusé : c'est LUI le problème, donc la confiance passe en
          premier. Beaucoup de serveurs (Traefik, Dokploy, `*.traefik.me`…)
          renvoient de toute façon http vers https : l'offre HTTP n'y ferait
          que reproduire l'erreur. */}
      {offerTrust && (
        <p className="text-sm text-center max-w-prose text-warning">
          En continuant, vous acceptez un certificat qui ne prouve pas l’identité du
          serveur. L’exception ne vaut que pour <strong>{host}</strong> et disparaît à la
          fermeture d’Orbit.
        </p>
      )}
      {offerHttp && (
        <p className="text-sm text-center max-w-prose text-warning">
          En continuant, les données échangées avec ce site circuleront{' '}
          <strong>en clair</strong> : toute personne sur le réseau peut les lire.
          L’exception ne vaut que pour cette origine et disparaît à la fermeture d’Orbit.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button onClick={onRetry} className="btn btn-primary btn-sm" disabled={busy}>
          <RotateCw size={15} /> Réessayer
        </button>

        {offerTrust && (
          <button onClick={trustAndRetry} className="btn btn-sm" disabled={busy}>
            <Unlock size={15} /> Continuer quand même
          </button>
        )}

        {offerHttp && (
          <button onClick={continueInHttp} className="btn btn-sm" disabled={busy}>
            <Unlock size={15} /> Continuer en HTTP (non sécurisé)
          </button>
        )}

        {/* Dernier recours, et parfois le bon : laisser le navigateur du système
            s'en charger. `window.open` est redirigé vers lui par le main process. */}
        <button
          onClick={() => window.open(upgrade?.from || failure.url || app.url, '_blank')}
          className="btn btn-ghost btn-sm"
          disabled={busy}
        >
          <ExternalLink size={15} /> Ouvrir dans le navigateur
        </button>
      </div>

      {/* Le code brut : inutile au quotidien, décisif pour un rapport de bug. */}
      <p className="text-xs text-text-muted font-mono">{describe.name}</p>
    </div>
  );
}
