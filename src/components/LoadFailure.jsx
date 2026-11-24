import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCw, ShieldAlert, ExternalLink, Unlock, Lock } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { resolveProxy } from '../lib/session';
import { networkOfRule, NETWORK_RULES } from '../lib/privateNetwork';
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
  // Réseau privé effectif de l'app (app → profil → Orbit) : il explique les
  // pages volontairement bloquées (Tor/VPN non connecté, .onion hors de Tor).
  const profile = useStore((st) => st.profiles.find((p) => p.id === app.profileId));
  const globalProxy = useStore((st) => st.settings.globalProxy);
  const updateApp = useStore((st) => st.updateApp);
  const network = networkOfRule(resolveProxy(app, profile, globalProxy));
  const describe = describeLoadFailure(failure.code, failure.description, {
    upgraded: !!upgrade,
    url: failure.url || app.url,
    network,
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

  // Réseau privé : la page est bloquée PAR PROTECTION. Le geste utile est de
  // connecter le tunnel (ou d'y passer l'app), jamais d'ouvrir ailleurs.
  const privacyBlock = describe.kind === 'onion' || describe.kind === 'privnet';
  const [netError, setNetError] = useState('');
  const connectThenRetry = async (target) => {
    if (busy) return;
    setBusy(true);
    setNetError('');
    try {
      if (target === 'tor' && network !== 'tor') updateApp(app.id, { proxy: NETWORK_RULES.tor });
      const pn = window.electronAPI?.privateNet;
      const r = target === 'vpn' ? await pn?.startVpn() : await pn?.startTor();
      if (r && !r.success) {
        setNetError(r.error || 'Connexion impossible.');
        setBusy(false);
        return;
      }
      // Le temps que la nouvelle règle de proxy soit appliquée à la session.
      setTimeout(() => {
        setBusy(false);
        onRetry();
      }, 800);
    } catch {
      setBusy(false);
    }
  };

  // Tunnel en cours de connexion (démarrage d'Orbit, « Connexion
  // automatique ») : dès qu'il est prêt, la page se recharge d'elle-même.
  const waitingFor = describe.kind === 'privnet' ? describe.network : network && privacyBlock ? network : null;
  const [tunnel, setTunnel] = useState(null);
  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  }, [onRetry]);
  useEffect(() => {
    const pn = window.electronAPI?.privateNet;
    if (!waitingFor || !pn) return undefined;
    let retried = false;
    let timer = null;
    const seen = (st) => {
      const engine = st?.[waitingFor];
      if (!engine) return;
      setTunnel({ status: engine.status, progress: engine.progress || 0 });
      if (engine.status === 'ready' && !retried) {
        retried = true;
        timer = setTimeout(() => retryRef.current?.(), 700);
      }
    };
    pn.state().then(seen);
    const off = pn.onChanged(seen);
    return () => {
      off?.();
      clearTimeout(timer);
    };
  }, [waitingFor]);

  const Icon = privacyBlock ? Lock : offerTrust || offerHttp ? ShieldAlert : AlertTriangle;

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
        {describe.kind === 'onion' && (
          <button onClick={() => connectThenRetry('tor')} className="btn btn-primary btn-sm" disabled={busy}>
            <Lock size={15} /> {busy ? 'Connexion à Tor…' : 'Ouvrir cette app avec Tor'}
          </button>
        )}
        {describe.kind === 'privnet' && (
          <button onClick={() => connectThenRetry(describe.network)} className="btn btn-primary btn-sm" disabled={busy}>
            <Lock size={15} /> {busy ? 'Connexion…' : describe.network === 'vpn' ? 'Se connecter au VPN' : 'Se connecter à Tor'}
          </button>
        )}
        <button onClick={onRetry} className={`btn ${privacyBlock ? '' : 'btn-primary'} btn-sm`} disabled={busy}>
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
        {/* Jamais pour une page protégée : le navigateur du système la
            chargerait HORS du tunnel. */}
        {!privacyBlock && !network && (
          <button
            onClick={() => window.open(upgrade?.from || failure.url || app.url, '_blank')}
            className="btn btn-ghost btn-sm"
            disabled={busy}
          >
            <ExternalLink size={15} /> Ouvrir dans le navigateur
          </button>
        )}
      </div>
      {tunnel?.status === 'starting' ? (
        <p className="text-sm text-text-muted text-center">
          Connexion à {waitingFor === 'tor' ? 'Tor' : 'au VPN'} en cours{tunnel.progress ? ` (${tunnel.progress} %)` : ''}… la page
          s’ouvrira toute seule.
        </p>
      ) : null}
      {netError ? <p className="text-sm text-error text-center max-w-prose">{netError}</p> : null}

      {/* Le code brut : inutile au quotidien, décisif pour un rapport de bug. */}
      <p className="text-xs text-text-muted font-mono">{describe.name}</p>
    </div>
  );
}
