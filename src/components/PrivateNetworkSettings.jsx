import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, Lock, Play, RefreshCw, Shield, Square, Trash2, Upload } from 'lucide-react';
import { useStore } from '../stores/useStore';
import NetworkChoice from './NetworkChoice';
import OrbitVpnPanel from './OrbitVpnPanel';
import { parseBridgeLines, NETWORK_RULES } from '../lib/privateNetwork';
import { ONION_SITES, ONION_CATEGORIES, ONION_VERIFIED_AT } from '../lib/onionDirectory';

// Annuaire des sites .onion officiels : un clic les ajoute comme apps, déjà
// réglées sur Tor (jamais ouvertes hors du tunnel).
function OnionDirectory() {
  const apps = useStore((s) => s.apps);
  const addApp = useStore((s) => s.addApp);
  const activeProfile = useStore((s) => s.activeProfile);
  const [open, setOpen] = useState(false);
  const added = (site) => apps.some((a) => a.url === site.url || a.homeUrl === site.url);
  const add = (site) =>
    addApp({
      profileId: activeProfile,
      recipeId: null,
      name: site.name,
      url: site.url,
      homeUrl: site.url,
      icon: '🧅',
      iconEmoji: true,
      color: '#7d4698',
      proxy: NETWORK_RULES.tor,
      unread: 0,
      sleeping: false,
    });
  return (
    <div className="mt-4 border-t border-border pt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-xs font-medium">🧅 Sites .onion officiels ({ONION_SITES.length})</span>
        <span className="text-[11px] text-accent-primary">{open ? 'Masquer' : 'Afficher'}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-3">
          <p className="text-[11px] leading-relaxed text-text-muted">
            Chaque adresse est publiée par l’organisation elle-même et a été vérifiée par Tor (le {ONION_VERIFIED_AT.split('-').reverse().join('/')}).
            Méfiez-vous des « annuaires » trouvés ailleurs : les fausses adresses .onion servent souvent à voler des identifiants.
          </p>
          {Object.entries(ONION_CATEGORIES).map(([cat, label]) => (
            <div key={cat}>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</div>
              <ul className="space-y-1">
                {ONION_SITES.filter((x) => x.category === cat).map((site) => (
                  <li key={site.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{site.name}</div>
                      <div className="truncate text-[11px] text-text-muted" title={`${site.url}\nSource : ${site.source}`}>
                        {site.description}
                      </div>
                    </div>
                    {added(site) ? (
                      <span className="text-[11px] text-text-muted">Ajouté</span>
                    ) : (
                      <button type="button" onClick={() => add(site)} className="rounded-md bg-accent-primary px-2.5 py-1 text-[11px] font-medium text-white">
                        Ajouter
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Réglages → Confidentialité → Réseau privé : Tor et VPN intégrés.
//
// Chaque moteur s'installe à la demande (exécutable officiel vérifié), puis
// sert les apps, profils ou tout Orbit selon le choix « Réseau ». Le texte dit
// honnêtement ce que chacun protège — et ce qu'il ne protège pas.
// ---------------------------------------------------------------------------

const api = () => window.electronAPI?.privateNet;

function StatusPill({ status, progress }) {
  const map = {
    off: ['Arrêté', 'bg-bg-hover text-text-secondary'],
    starting: [progress ? `Connexion… ${progress} %` : 'Démarrage…', 'bg-amber-500/15 text-amber-500'],
    ready: ['Connecté', 'bg-emerald-500/15 text-emerald-500'],
    error: ['Erreur', 'bg-red-500/15 text-red-500'],
  };
  const [label, cls] = map[status] || map.off;
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function InstallProgress({ install }) {
  if (!install?.busy) return null;
  const pct = install.total ? Math.round((install.received / install.total) * 100) : null;
  return (
    <div className="mt-2">
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
        <div className="h-full bg-accent-primary transition-all" style={{ width: `${pct ?? 30}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-muted">Téléchargement et vérification… {pct !== null ? `${pct} %` : ''}</p>
    </div>
  );
}

function CheckResult({ result }) {
  if (!result) return null;
  if (!result.success) return <p className="mt-2 text-xs text-red-500">{result.error}</p>;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
      <CheckCircle2 size={13} className="text-emerald-500" /> Adresse vue par les sites : <span className="font-mono">{result.ip}</span>
      {result.tor ? ' · sortie Tor confirmée' : ''}
    </p>
  );
}

export default function PrivateNetworkSettings() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({});
  const [checks, setChecks] = useState({});
  const [bridgesDraft, setBridgesDraft] = useState(null);

  useEffect(() => {
    let alive = true;
    api()
      ?.state()
      .then((r) => alive && r?.success && setSt(r));
    const off = api()?.onChanged((next) => alive && setSt((prev) => ({ ...prev, ...next })));
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  if (!api()) return null;
  if (!st) {
    return (
      <div className="card flex items-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin" /> Réseau privé…
      </div>
    );
  }

  const act = async (key, fn, after) => {
    setBusy(key);
    setMsg((m) => ({ ...m, [key.split(':')[0]]: '' }));
    const r = await fn();
    setBusy('');
    if (r && !r.success && !r.canceled) setMsg((m) => ({ ...m, [key.split(':')[0]]: r.error || 'Échec.' }));
    after?.(r);
    const fresh = await api().state();
    if (fresh?.success) setSt(fresh);
  };

  const check = (network) =>
    act(`${network}:check`, () => api().check(network), (r) => setChecks((c) => ({ ...c, [network]: r })));

  const tor = st.tor;
  const vpn = st.vpn;
  const bridges = bridgesDraft ?? tor.customBridges;
  const validBridges = parseBridgeLines(bridges).length;

  return (
    <div className="card space-y-5">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <Shield size={18} className="text-accent-primary" />
          <h4 className="font-semibold">Réseau privé</h4>
        </div>
        <p className="text-sm text-text-muted">
          Tor et un VPN intégrés, activables quand vous voulez — pour tout Orbit, un profil ou une seule app (Modifier l’app →
          Réseau). Rien n’est installé dans le système ni ne demande de droits administrateur.
        </p>
      </div>

      <div>
        <div className="mb-1.5 text-sm font-medium">Réseau de tout Orbit</div>
        <NetworkChoice value={settings.globalProxy || ''} onChange={(v) => updateSettings({ globalProxy: v })} />
        <p className="mt-1.5 text-[11px] text-text-muted">Un profil ou une app peut choisir autrement : son choix prime.</p>
      </div>

      {!st.platformSupported ? (
        <p className="text-xs text-amber-500">Tor et le VPN intégrés ne sont pas disponibles pour ce système.</p>
      ) : null}

      {/* --------------------------- VPN Orbit ---------------------------- */}
      {st.platformSupported ? (
        <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
          <OrbitVpnPanel />
        </section>
      ) : null}

      {/* ------------------------------- Tor ------------------------------- */}
      <section className="rounded-xl border border-border p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Lock size={16} className="text-accent-primary" />
          <span className="font-medium">Tor</span>
          <StatusPill status={tor.status} progress={tor.progress} />
          <span className="text-[11px] text-text-muted">
            Tor {tor.torVersion} · paquet officiel {tor.version}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-text-muted">
          Votre adresse IP est cachée derrière trois relais bénévoles ; les sites en <span className="font-mono">.onion</span> deviennent
          accessibles. Plus lent qu’une connexion normale.
        </p>
        <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-amber-500">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Orbit n’est pas Tor Browser : il cache votre adresse, mais ne rend pas votre navigateur indiscernable de celui des autres
            utilisateurs de Tor. Pour un anonymat fort (journalisme, militantisme), utilisez{' '}
            <a href="https://www.torproject.org/download/" target="_blank" rel="noreferrer" className="underline">
              Tor Browser
            </a>
            . Et un compte connecté (Gmail…) vous identifie, Tor ou pas.
          </span>
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {!tor.installed ? (
            <button type="button" className="btn btn-primary text-xs" disabled={Boolean(busy) || tor.install?.busy} onClick={() => act('tor:install', () => api().install('tor'))}>
              <Download size={13} /> Installer Tor (20 à 35 Mo)
            </button>
          ) : tor.status === 'off' || tor.status === 'error' ? (
            <button type="button" className="btn btn-primary text-xs" disabled={Boolean(busy)} onClick={() => act('tor:start', () => api().startTor())}>
              {busy === 'tor:start' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Se connecter à Tor
            </button>
          ) : (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => act('tor:stop', () => api().stopTor())}>
              <Square size={13} /> Arrêter
            </button>
          )}
          {tor.status === 'ready' ? (
            <>
              <button type="button" className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => act('tor:newid', () => api().newIdentity(), (r) => r?.success && setChecks((c) => ({ ...c, tor: null })))}>
                <RefreshCw size={13} /> Nouvelle identité
              </button>
              <button type="button" className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => check('tor')}>
                {busy === 'tor:check' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Vérifier
              </button>
            </>
          ) : null}
        </div>
        <InstallProgress install={tor.install} />
        {tor.status === 'starting' ? (
          <div className="mt-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-hover">
              <div className="h-full bg-accent-primary transition-all" style={{ width: `${tor.progress}%` }} />
            </div>
            <p className="mt-1 truncate text-[11px] text-text-muted">{tor.summary}</p>
          </div>
        ) : null}
        {tor.error && tor.status === 'error' ? <p className="mt-2 text-xs text-red-500">{tor.error}</p> : null}
        {msg.tor ? <p className="mt-2 text-xs text-red-500">{msg.tor}</p> : null}
        {tor.install?.error ? <p className="mt-2 text-xs text-red-500">{tor.install.error}</p> : null}
        <CheckResult result={checks.tor} />

        <OnionDirectory />

        <div className="mt-4 border-t border-border pt-3">
          <div className="mb-1 text-xs font-medium">Ponts (pays où Tor est bloqué)</div>
          <select
            value={tor.bridges}
            onChange={(e) => act('tor:bridges', () => api().setBridges({ mode: e.target.value }))}
            className="input text-sm"
          >
            <option value="none">Aucun — connexion directe au réseau Tor</option>
            <option value="snowflake">Snowflake (recommandé si Tor est bloqué)</option>
            <option value="obfs4">obfs4 — ponts intégrés</option>
            <option value="meek">meek — passe par un grand service cloud (lent, dernier recours)</option>
            <option value="custom">Mes propres ponts</option>
          </select>
          {tor.bridges === 'custom' ? (
            <div className="mt-2">
              <textarea
                value={bridges}
                onChange={(e) => setBridgesDraft(e.target.value)}
                onBlur={() => bridgesDraft !== null && act('tor:bridges', () => api().setBridges({ custom: bridgesDraft }))}
                rows={3}
                placeholder="obfs4 192.0.2.1:443 … cert=… iat-mode=0"
                className="input font-mono text-[11px]"
              />
              <p className="mt-1 text-[11px] text-text-muted">
                {validBridges} pont(s) reconnu(s). Obtenez-en sur{' '}
                <a href="https://bridges.torproject.org/" target="_blank" rel="noreferrer" className="underline">
                  bridges.torproject.org
                </a>{' '}
                ou par e-mail à bridges@torproject.org (obfs4, WebTunnel…).
              </p>
            </div>
          ) : null}
          <p className="mt-1 text-[11px] text-text-muted">Changement pris en compte à la prochaine connexion.</p>
        </div>
      </section>

      {/* ------------------------------- VPN ------------------------------- */}
      <section className="rounded-xl border border-border p-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Shield size={16} className="text-accent-primary" />
          <span className="font-medium">VPN (WireGuard)</span>
          <StatusPill status={vpn.status} />
        </div>
        <p className="text-xs leading-relaxed text-text-muted">
          Rapide, pour masquer votre adresse aux sites et votre navigation à votre fournisseur d’accès ou au Wi-Fi public. Il faut un
          fichier de configuration WireGuard de votre fournisseur VPN.
        </p>
        <div className="mt-2 rounded-lg bg-bg-secondary p-2.5 text-xs leading-relaxed text-text-secondary">
          <strong>Gratuit et fiable : Proton VPN Free</strong> — sans limite de données, sans publicité, sans journal d’activité, par
          l’équipe de Proton Mail (Suisse) ; serveurs dans quelques pays seulement. Créez un compte, puis{' '}
          <a href="https://account.protonvpn.com/downloads" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
            Téléchargements → Configuration WireGuard <ExternalLink size={10} />
          </a>
          , et importez le fichier ici. Fonctionne aussi avec Mullvad, IVPN, Windscribe ou votre propre serveur.
        </div>

        {vpn.configured ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">{vpn.name}</span>
            {vpn.provider ? <span className="text-text-muted">· {vpn.provider}</span> : null}
            {vpn.summary?.endpoint ? <span className="font-mono text-text-muted">{vpn.summary.endpoint}</span> : null}
            {vpn.summary && !vpn.summary.dns ? <span className="text-amber-500">· sans DNS dans le tunnel</span> : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`btn ${vpn.configured ? 'btn-secondary' : 'btn-primary'} text-xs`} disabled={Boolean(busy)} onClick={() => act('vpn:import', () => api().importVpn())}>
            <Upload size={13} /> {vpn.configured ? 'Remplacer la configuration' : 'Importer un fichier .conf'}
          </button>
          {vpn.configured ? (
            vpn.status === 'off' || vpn.status === 'error' ? (
              <button type="button" className="btn btn-primary text-xs" disabled={Boolean(busy) || vpn.install?.busy} onClick={() => act('vpn:start', () => api().startVpn())}>
                {busy === 'vpn:start' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {vpn.installed ? 'Se connecter' : 'Installer et se connecter (≈ 4 Mo)'}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary text-xs" onClick={() => act('vpn:stop', () => api().stopVpn())}>
                <Square size={13} /> Arrêter
              </button>
            )
          ) : null}
          {vpn.status === 'ready' ? (
            <button type="button" className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => check('vpn')}>
              {busy === 'vpn:check' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Vérifier
            </button>
          ) : null}
          {vpn.configured ? (
            <button type="button" className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => act('vpn:remove', () => api().removeVpn())} title="Supprimer la configuration (et sa clé privée)">
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
        <InstallProgress install={vpn.install} />
        {vpn.error && vpn.status === 'error' ? <p className="mt-2 text-xs text-red-500">{vpn.error}</p> : null}
        {msg.vpn ? <p className="mt-2 text-xs text-red-500">{msg.vpn}</p> : null}
        <CheckResult result={checks.vpn} />
        <p className="mt-2 text-[11px] text-text-muted">
          La configuration (et sa clé privée) est chiffrée par le trousseau du système. Les appels audio/vidéo (WebRTC) des apps
          passant par le VPN ou Tor sont limités au tunnel : certains peuvent ne plus aboutir.
        </p>
      </section>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="font-medium">Repère visuel</span>
          <span className="block text-xs text-text-muted">
            Liseré violet (Tor) ou turquoise (VPN) autour des apps en tunnel, avec leur état : protégé, connexion, coupé.
          </span>
        </span>
        <input
          type="checkbox"
          checked={settings.privateNetIndicator !== false}
          onChange={(e) => updateSettings({ privateNetIndicator: e.target.checked })}
          className="w-12 h-6 shrink-0 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="font-medium">Prévenir avant de sortir du tunnel</span>
          <span className="block text-xs text-text-muted">
            Un lien, une recherche ou « ouvrir dans le navigateur » depuis une app en tunnel vous exposerait : Orbit le dit et
            vous laisse choisir (rester protégé, continuer, annuler).
          </span>
        </span>
        <input
          type="checkbox"
          checked={st.warnings !== false}
          onChange={(e) => act('warn', () => window.electronAPI.privateNet.setWarnings(e.target.checked))}
          className="w-12 h-6 shrink-0 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>

      <label className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="font-medium">Connexion automatique</span>
          <span className="block text-xs text-text-muted">Démarre Tor ou le VPN dès qu’une app réglée dessus s’ouvre.</span>
        </span>
        <input
          type="checkbox"
          checked={st.autoStart}
          onChange={(e) => act('auto', () => api().setAutoStart(e.target.checked))}
          className="w-12 h-6 bg-bg-hover rounded-full relative cursor-pointer appearance-none checked:bg-accent-primary transition-colors after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-6"
        />
      </label>
    </div>
  );
}
