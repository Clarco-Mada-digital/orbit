// ---------------------------------------------------------------------------
// Réseau privé d'Orbit : Tor et VPN WireGuard intégrés — logique pure.
//
// Principe : chaque moteur tourne en local et expose un proxy SOCKS5 sur
// 127.0.0.1. Une app, un profil ou tout Orbit y est branché par une règle de
// proxy spéciale (`orbit:tor`, `orbit:vpn`), traduite ici en adresse locale.
//
//   - Tor : le « Tor Expert Bundle » officiel (signé par le Tor Project),
//     téléchargé à la demande et vérifié par empreinte.
//   - VPN : un fichier WireGuard (.conf) de votre fournisseur — Proton VPN
//     gratuit, Mullvad, votre propre serveur… — porté par wireproxy, qui
//     n'exige NI droits administrateur NI carte réseau virtuelle.
//   - VPN Orbit : sans compte ni fichier, pour quelques minutes. Une instance
//     Tor DÉDIÉE dont on choisit le pays de sortie (ou « Auto » : Tor prend
//     les sorties les plus rapides). Séparée de « Tor » pour que le choix d'un
//     pays ne touche pas les apps réglées sur Tor.
//
// Sécurité par défaut (« fail-closed ») : si le moteur n'est pas prêt, la
// règle pointe vers un port fermé — les pages échouent au lieu de passer en
// direct. Jamais de repli silencieux sur la connexion normale.
//
// Ce fichier est partagé par le processus principal et l'interface : aucune
// dépendance à Electron ni à Node.
// ---------------------------------------------------------------------------

export const NETWORK_RULES = {
  tor: 'orbit:tor',
  vpn: 'orbit:vpn',
  orbitvpn: 'orbit:orbitvpn',
};

// Nom affiché, avec article, pour les phrases (« passe par … »).
export const NETWORK_NAMES = { tor: 'Tor', vpn: 'le VPN', orbitvpn: 'le VPN Orbit' };

// Port où rien n'écoute (« discard ») : toute requête y échoue aussitôt.
export const CLOSED_PROXY = 'socks5://127.0.0.1:9';

export function networkOfRule(rule) {
  const r = String(rule || '').trim().toLowerCase();
  if (r === NETWORK_RULES.tor) return 'tor';
  if (r === NETWORK_RULES.vpn) return 'vpn';
  if (r === NETWORK_RULES.orbitvpn) return 'orbitvpn';
  return null;
}

// Règle de proxy → règle Chromium. `ports` : { tor, vpn } des moteurs PRÊTS.
export function resolveNetworkRule(rule, ports = {}) {
  const net = networkOfRule(rule);
  if (!net) return String(rule || '').trim();
  const port = Number(ports[net]);
  // socks5:// : Chromium envoie le NOM d'hôte au proxy (résolution DNS à
  // distance) — pas de fuite DNS hors du tunnel.
  return Number.isInteger(port) && port > 0 && port < 65536 ? `socks5://127.0.0.1:${port}` : CLOSED_PROXY;
}

// --- Tor --------------------------------------------------------------------

// « Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors »
export function parseBootstrap(line) {
  const m = /Bootstrapped (\d{1,3})%(?: \(([\w-]+)\))?:?\s*(.*)$/.exec(String(line || ''));
  if (!m) return null;
  return { percent: Math.min(100, Number(m[1])), tag: m[2] || '', summary: (m[3] || '').trim() };
}

// Ponts : lignes « Bridge » collées par l'utilisateur (bridges.torproject.org)
// → transport + ligne propre. Les lignes peuvent commencer ou non par « Bridge ».
export const BRIDGE_TRANSPORTS = ['obfs4', 'snowflake', 'webtunnel', 'meek_lite', 'conjure'];
export function parseBridgeLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^bridge\s+/i, '');
    if (!line || line.startsWith('#')) continue;
    // Pas de retour à la ligne ni de caractère de contrôle : la ligne est
    // recopiée telle quelle dans torrc.
    if ([...line].some((ch) => ch.charCodeAt(0) < 32) || line.length > 1500) continue;
    const first = line.split(/\s+/)[0].toLowerCase();
    const transport = BRIDGE_TRANSPORTS.includes(first) ? first : /^\[?[0-9a-f.:]+\]?:\d+$/i.test(first) ? 'vanilla' : null;
    if (!transport) continue;
    out.push({ transport, line });
  }
  return out;
}

// pt_config.json du Tor Expert Bundle : transports enfichables et ponts
// recommandés par le Tor Project. `${pt_path}` = dossier des exécutables.
export function readPtConfig(json, ptDir, sep = '/') {
  const cfg = json && typeof json === 'object' ? json : {};
  const dir = ptDir.endsWith(sep) ? ptDir : ptDir + sep;
  const plugins = (Array.isArray(cfg.pluggableTransports) ? cfg.pluggableTransports : Object.values(cfg.pluggableTransports || {}))
    .filter((l) => typeof l === 'string' && /^ClientTransportPlugin\s/.test(l))
    .map((l) => l.split('${pt_path}').join(dir));
  const bridges = {};
  for (const [transport, lines] of Object.entries(cfg.bridges || {})) {
    if (Array.isArray(lines)) bridges[transport] = lines.filter((l) => typeof l === 'string' && !/[\r\n]/.test(l));
  }
  return { plugins, bridges };
}

// --- VPN Orbit -----------------------------------------------------------------

// Pays proposés : ceux où le réseau Tor compte assez de relais de sortie pour
// qu'une connexion tienne (Allemagne, Pays-Bas et États-Unis en tête). Un pays
// avec deux ou trois sorties seulement donnerait une connexion lente et
// fragile : il n'est pas proposé.
export const ORBIT_VPN_COUNTRIES = [
  { id: 'de', label: 'Allemagne', flag: '🇩🇪' },
  { id: 'at', label: 'Autriche', flag: '🇦🇹' },
  { id: 'ca', label: 'Canada', flag: '🇨🇦' },
  { id: 'us', label: 'États-Unis', flag: '🇺🇸' },
  { id: 'fi', label: 'Finlande', flag: '🇫🇮' },
  { id: 'fr', label: 'France', flag: '🇫🇷' },
  { id: 'lu', label: 'Luxembourg', flag: '🇱🇺' },
  { id: 'no', label: 'Norvège', flag: '🇳🇴' },
  { id: 'nl', label: 'Pays-Bas', flag: '🇳🇱' },
  { id: 'pl', label: 'Pologne', flag: '🇵🇱' },
  { id: 'ro', label: 'Roumanie', flag: '🇷🇴' },
  { id: 'gb', label: 'Royaume-Uni', flag: '🇬🇧' },
  { id: 'se', label: 'Suède', flag: '🇸🇪' },
  { id: 'ch', label: 'Suisse', flag: '🇨🇭' },
];

// Durées proposées (minutes) ; 0 = jusqu'à l'arrêt.
export const ORBIT_VPN_DURATIONS = [15, 30, 60, 0];

export function orbitVpnLocationValid(id) {
  return id === 'auto' || ORBIT_VPN_COUNTRIES.some((c) => c.id === id);
}

export function orbitVpnCountry(id) {
  return ORBIT_VPN_COUNTRIES.find((c) => c.id === String(id || '').toLowerCase()) || null;
}

// Commandes du port de contrôle pour changer de pays SANS redémarrer Tor.
// « auto » : plus aucune restriction, Tor pondère les sorties par débit.
export function exitCountryCommands(location) {
  if (!orbitVpnLocationValid(location) || location === 'auto') return ['RESETCONF ExitNodes StrictNodes'];
  return [`SETCONF ExitNodes={${location}} StrictNodes=1`];
}

// Réponse de « GETINFO ip-to-country/<ip> » → code pays, ou ''.
export function parseIpCountry(reply) {
  const m = /ip-to-country\/[^=\s]+=([a-z?]{2})/i.exec(String(reply || ''));
  return m && m[1] !== '??' ? m[1].toLowerCase() : '';
}

// Chemin pour torrc : guillemets si espaces (dossiers Windows « Program Files »).
const torPath = (p) => (/[\s"]/.test(p) ? `"${String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : p);

// torrc complet. `bridges` : liste de lignes ; `plugins` : ClientTransportPlugin.
export function buildTorrc({ socksPort, controlPort, dataDir, geoip, geoip6, bridges = [], plugins = [], ownerPid, exitCountry = '' }) {
  const lines = [
    `SocksPort 127.0.0.1:${socksPort}`,
    `ControlPort 127.0.0.1:${controlPort}`,
    'CookieAuthentication 1',
    `DataDirectory ${torPath(dataDir)}`,
    'ClientOnly 1',
    'AvoidDiskWrites 1',
    // Tor s'arrête si Orbit disparaît (plantage) : pas de processus orphelin.
    ...(ownerPid ? [`__OwningControllerProcess ${ownerPid}`] : []),
    'Log notice stdout',
  ];
  if (geoip) lines.push(`GeoIPFile ${torPath(geoip)}`);
  if (geoip6) lines.push(`GeoIPv6File ${torPath(geoip6)}`);
  if (bridges.length) {
    lines.push('UseBridges 1', ...plugins, ...bridges.map((b) => `Bridge ${b}`));
  }
  // Pays de sortie imposé (VPN Orbit). StrictNodes : si aucune sortie de ce
  // pays n'est joignable, la connexion échoue plutôt que de sortir ailleurs.
  if (exitCountry && exitCountry !== 'auto' && orbitVpnLocationValid(exitCountry)) {
    lines.push(`ExitNodes {${exitCountry}}`, 'StrictNodes 1');
  }
  return `${lines.join('\n')}\n`;
}

// --- VPN WireGuard ------------------------------------------------------------

// Lecture d'un fichier .conf WireGuard. On en vérifie la forme et on en tire
// un résumé affichable — la clé privée n'en sort JAMAIS.
export function parseWireguardConf(text) {
  const src = String(text || '');
  if (src.length > 20000) return { ok: false, error: 'Fichier trop volumineux pour une configuration WireGuard.' };
  const sections = [];
  let current = null;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (!line) continue;
    const head = /^\[(\w+)\]$/.exec(line);
    if (head) {
      current = { name: head[1].toLowerCase(), values: {} };
      sections.push(current);
      continue;
    }
    const kv = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(line);
    if (!kv || !current) return { ok: false, error: `Ligne illisible : « ${line.slice(0, 40)} »` };
    current.values[kv[1].toLowerCase()] = kv[2].trim();
  }
  const iface = sections.find((x) => x.name === 'interface')?.values;
  const peers = sections.filter((x) => x.name === 'peer').map((x) => x.values);
  const key = /^[A-Za-z0-9+/]{42,43}=$/;
  if (!iface) return { ok: false, error: 'Section [Interface] absente : ce n’est pas un fichier WireGuard.' };
  if (!key.test(iface.privatekey || '')) return { ok: false, error: 'Clé privée (PrivateKey) absente ou invalide.' };
  if (!iface.address) return { ok: false, error: 'Adresse (Address) absente.' };
  if (!peers.length) return { ok: false, error: 'Aucun serveur ([Peer]) dans le fichier.' };
  const peer = peers[0];
  if (!key.test(peer.publickey || '')) return { ok: false, error: 'Clé publique du serveur (PublicKey) invalide.' };
  if (!/^[^\s]+:\d{1,5}$/.test(peer.endpoint || '')) return { ok: false, error: 'Adresse du serveur (Endpoint) absente.' };
  return {
    ok: true,
    // Sans DNS dans le tunnel, les noms seraient résolus hors du VPN.
    warnings: iface.dns ? [] : ['Pas de DNS dans le fichier : la résolution des noms se fera hors du VPN.'],
    summary: {
      endpoint: peer.endpoint,
      address: iface.address,
      dns: iface.dns || '',
      fullTunnel: /(^|,)\s*0\.0\.0\.0\/0/.test(peer.allowedips || ''),
    },
  };
}

// Configuration wireproxy : la conf WireGuard + un proxy SOCKS5 local.
export function buildWireproxyConfig({ wgConfPath, socksPort }) {
  return `WGConfig = ${wgConfPath}\n\n[Socks5]\nBindAddress = 127.0.0.1:${socksPort}\n`;
}

// Nom de fournisseur lisible à partir de l'adresse du serveur.
export function guessVpnProvider(endpoint) {
  const host = String(endpoint || '').toLowerCase();
  if (/protonvpn|proton/.test(host)) return 'Proton VPN';
  if (/mullvad/.test(host)) return 'Mullvad';
  if (/windscribe/.test(host)) return 'Windscribe';
  if (/ivpn/.test(host)) return 'IVPN';
  if (/cloudflare|engage\.cloudflareclient/.test(host)) return 'Cloudflare WARP';
  return '';
}

// --- Divers -------------------------------------------------------------------

// .onion : n'a de sens QUE par Tor. Ailleurs, le navigateur tenterait une
// résolution DNS normale — et révélerait l'adresse visitée au FAI.
export function isOnionUrl(url) {
  try {
    return /\.onion\.?$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Réponse de https://check.torproject.org/api/ip → { ip, tor }.
export function parseTorCheck(json) {
  if (!json || typeof json !== 'object') return null;
  const ip = typeof json.IP === 'string' ? json.IP : null;
  return ip ? { ip, tor: Boolean(json.IsTor) } : null;
}

// Plateforme → nom d'archive (Tor Expert Bundle et wireproxy).
export function enginePlatformKey(platform, arch) {
  const os = { linux: 'linux', darwin: 'macos', win32: 'windows' }[platform];
  const cpu = { x64: 'x86_64', arm64: 'aarch64', ia32: 'i686' }[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}
