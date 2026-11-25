import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNetworkRule, networkOfRule, CLOSED_PROXY, parseBootstrap, parseBridgeLines, readPtConfig,
  buildTorrc, parseWireguardConf, buildWireproxyConfig, guessVpnProvider, isOnionUrl, parseTorCheck, enginePlatformKey,
} from '../src/lib/privateNetwork.js';

const KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const PUB = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';

test('règles du réseau privé : moteur prêt → proxy local, sinon port fermé (jamais en direct)', () => {
  assert.equal(networkOfRule(' ORBIT:TOR '), 'tor');
  assert.equal(networkOfRule('socks5://1.2.3.4:1080'), null);
  assert.equal(resolveNetworkRule('orbit:tor', { tor: 40123 }), 'socks5://127.0.0.1:40123');
  assert.equal(resolveNetworkRule('orbit:vpn', { tor: 40123 }), CLOSED_PROXY);
  assert.equal(resolveNetworkRule('orbit:tor', { tor: 0 }), CLOSED_PROXY);
  assert.equal(resolveNetworkRule('http://proxy:8080', {}), 'http://proxy:8080');
});

test('progression de Tor', () => {
  assert.deepEqual(parseBootstrap('Nov 24 12:00:01.000 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors'), {
    percent: 45, tag: 'requesting_descriptors', summary: 'Asking for relay descriptors',
  });
  assert.equal(parseBootstrap('Bootstrapped 100% (done): Done').percent, 100);
  assert.equal(parseBootstrap('[notice] Opening Socks listener'), null);
});

test('ponts : lignes collées, transports reconnus, injections refusées', () => {
  const list = parseBridgeLines(`Bridge obfs4 192.0.2.1:443 ABCDEF cert=xyz iat-mode=0
snowflake 192.0.2.3:80 2B28 fingerprint=2B28 url=https://snowflake-broker.torproject.net/
# commentaire
198.51.100.4:9001 0123456789ABCDEF
inconnu 1.2.3.4:1
obfs4 1.2.3.4:5 x\u0000ControlPort 9051`);
  assert.deepEqual(list.map((b) => b.transport), ['obfs4', 'snowflake', 'vanilla']);
  assert.ok(list[0].line.startsWith('obfs4 192.0.2.1:443'));
});

test('pt_config.json : chemins des transports et ponts recommandés', () => {
  const pt = readPtConfig({
    pluggableTransports: {
      lyrebird: 'ClientTransportPlugin meek_lite,obfs2,obfs3,obfs4,scramblesuit,webtunnel exec ${pt_path}lyrebird',
      snowflake: 'ClientTransportPlugin snowflake exec ${pt_path}snowflake-client',
    },
    bridges: { snowflake: ['snowflake 192.0.2.3:80 2B28'], obfs4: ['obfs4 192.0.2.1:443 AB cert=c iat-mode=0', 'x\ny'] },
  }, '/opt/orbit data/pt', '/');
  assert.equal(pt.plugins[1], 'ClientTransportPlugin snowflake exec /opt/orbit data/pt/snowflake-client');
  assert.equal(pt.bridges.obfs4.length, 1);
});

test('torrc : ports locaux uniquement, dossier avec espaces, ponts', () => {
  const rc = buildTorrc({ socksPort: 40001, controlPort: 40002, dataDir: 'C:\\Users\\Jean Dupont\\tor', bridges: ['snowflake 192.0.2.3:80 2B28'], plugins: ['ClientTransportPlugin snowflake exec /x'], ownerPid: 99 });
  assert.match(rc, /^SocksPort 127\.0\.0\.1:40001$/m);
  assert.match(rc, /^ControlPort 127\.0\.0\.1:40002$/m);
  assert.match(rc, /^CookieAuthentication 1$/m);
  assert.match(rc, /^DataDirectory "C:\\\\Users\\\\Jean Dupont\\\\tor"$/m);
  assert.match(rc, /^__OwningControllerProcess 99$/m);
  assert.match(rc, /^UseBridges 1$/m);
  assert.match(rc, /^Bridge snowflake 192\.0\.2\.3:80 2B28$/m);
  assert.doesNotMatch(buildTorrc({ socksPort: 1, controlPort: 2, dataDir: '/d' }), /UseBridges/);
});

test('configuration WireGuard : résumé sans la clé privée, erreurs claires', () => {
  const conf = `[Interface]
# Key for Orbit
PrivateKey = ${KEY}
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# FR#12
PublicKey = ${PUB}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = 185.159.157.1:51820`;
  const r = parseWireguardConf(conf);
  assert.equal(r.ok, true);
  assert.deepEqual(r.summary, { endpoint: '185.159.157.1:51820', address: '10.2.0.2/32', dns: '10.2.0.1', fullTunnel: true });
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.equal(parseWireguardConf(conf.replace('DNS = 10.2.0.1\n', '')).warnings.length, 1);
  assert.match(parseWireguardConf('bonjour').error, /Interface|illisible/);
  assert.match(parseWireguardConf(conf.replace(KEY, 'abc')).error, /PrivateKey/);
  assert.match(parseWireguardConf(conf.replace(/Endpoint.*/, '')).error, /Endpoint/);
});

test('wireproxy, fournisseur, .onion, vérification, plateformes', () => {
  assert.equal(buildWireproxyConfig({ wgConfPath: '/r/wg.conf', socksPort: 41000 }), 'WGConfig = /r/wg.conf\n\n[Socks5]\nBindAddress = 127.0.0.1:41000\n');
  assert.equal(guessVpnProvider('node-fr-12.protonvpn.net:51820'), 'Proton VPN');
  assert.equal(guessVpnProvider('1.2.3.4:51820'), '');
  assert.equal(isOnionUrl('http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/'), true);
  assert.equal(isOnionUrl('https://onion.example.com/'), false);
  assert.deepEqual(parseTorCheck({ IsTor: true, IP: '185.220.101.1' }), { ip: '185.220.101.1', tor: true });
  assert.equal(parseTorCheck({}), null);
  assert.equal(enginePlatformKey('win32', 'x64'), 'windows-x86_64');
  assert.equal(enginePlatformKey('darwin', 'arm64'), 'macos-aarch64');
  assert.equal(enginePlatformKey('freebsd', 'x64'), null);
});

test('net-engines.json : chaque archive a une adresse officielle et une empreinte', async () => {
  const { createRequire } = await import('node:module');
  const engines = createRequire(import.meta.url)('../electron/net-engines.json');
  for (const name of ['tor', 'wireproxy']) {
    for (const [key, f] of Object.entries(engines[name].files)) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, `${name}/${key}`);
      assert.match(f.url, name === 'tor' ? /^https:\/\/dist\.torproject\.org\// : /^https:\/\/github\.com\/windtf\/wireproxy\/releases\//);
    }
  }
});

test('annuaire .onion : adresses v3 valides, uniques, sources citées', async () => {
  const { ONION_SITES, ONION_CATEGORIES, isOnionV3Url } = await import('../src/lib/onionDirectory.js');
  const hosts = new Set();
  for (const s of ONION_SITES) {
    assert.ok(isOnionV3Url(s.url), s.id);
    assert.ok(ONION_CATEGORIES[s.category], s.id);
    assert.ok(s.source.length > 10, s.id);
    const h = new URL(s.url).hostname.replace(/^www\./, '');
    assert.ok(!hosts.has(h), `doublon ${s.id}`);
    hosts.add(h);
  }
  assert.equal(isOnionV3Url('http://3g2upl4pq6kufc4m.onion/'), false); // v2, abandonné
  const { faviconServiceUrl } = await import('../src/lib/appIcons.js');
  assert.equal(faviconServiceUrl(ONION_SITES[0].url), '');
});

// --- VPN Orbit -----------------------------------------------------------------
import {
  NETWORK_RULES as RULES_VO,
  networkOfRule as networkOfRuleVO,
  resolveNetworkRule as resolveVO,
  buildTorrc as buildTorrcVO,
  ORBIT_VPN_COUNTRIES,
  orbitVpnLocationValid,
  exitCountryCommands,
  parseIpCountry,
} from '../src/lib/privateNetwork.js';

test('VPN Orbit : règle reconnue, port fermé tant que le moteur n’est pas prêt', () => {
  assert.equal(networkOfRuleVO(RULES_VO.orbitvpn), 'orbitvpn');
  assert.equal(resolveVO(RULES_VO.orbitvpn, { tor: 9050 }), 'socks5://127.0.0.1:9');
  assert.equal(resolveVO(RULES_VO.orbitvpn, { orbitvpn: 41000 }), 'socks5://127.0.0.1:41000');
});

test('VPN Orbit : seuls Auto et les pays de la liste sont acceptés', () => {
  assert.ok(orbitVpnLocationValid('auto'));
  assert.ok(orbitVpnLocationValid('fr'));
  for (const bad of ['', 'FR', 'xx', '{fr}', 'fr} ExitNodes {ru', 'auto\nControlPort 1']) {
    assert.equal(orbitVpnLocationValid(bad), false, bad);
  }
  assert.ok(ORBIT_VPN_COUNTRIES.every((c) => /^[a-z]{2}$/.test(c.id)));
});

test('VPN Orbit : torrc avec pays de sortie strict, rien pour Auto ou une valeur inconnue', () => {
  const base = { socksPort: 1, controlPort: 2, dataDir: '/d' };
  const fr = buildTorrcVO({ ...base, exitCountry: 'fr' });
  assert.match(fr, /^ExitNodes \{fr\}$/m);
  assert.match(fr, /^StrictNodes 1$/m);
  assert.doesNotMatch(buildTorrcVO({ ...base, exitCountry: 'auto' }), /ExitNodes/);
  assert.doesNotMatch(buildTorrcVO({ ...base, exitCountry: 'fr}\nControlPort 0.0.0.0:1' }), /ExitNodes|0\.0\.0\.0/);
});

test('VPN Orbit : commandes de changement de pays à chaud', () => {
  assert.deepEqual(exitCountryCommands('de'), ['SETCONF ExitNodes={de} StrictNodes=1']);
  assert.deepEqual(exitCountryCommands('auto'), ['RESETCONF ExitNodes StrictNodes']);
  // Valeur invalide : retour à Auto, jamais une commande forgée.
  assert.deepEqual(exitCountryCommands('de\r\nSIGNAL HALT'), ['RESETCONF ExitNodes StrictNodes']);
});

test('VPN Orbit : pays lu dans la réponse GETINFO du port de contrôle', () => {
  assert.equal(parseIpCountry('250-AUTHENTICATE\r\n250-ip-to-country/185.220.101.1=de\r\n250 OK\r\n'), 'de');
  assert.equal(parseIpCountry('250-ip-to-country/10.0.0.1=??\r\n'), '');
  assert.equal(parseIpCountry(''), '');
});
