import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDomain } from 'tldts-experimental';

import * as rules from '../electron/shields-rules.js';

// electron/shields-rules.js décide, electron/main.js exécute. Ces tests
// verrouillent les DÉCISIONS — en particulier celles qui cassent un site quand
// elles sont fausses. Les domaines utilisés sont ceux que tldts considère comme
// enregistrables (voir `domain()` plus bas).

const OFF = {
  enabled: true,
  adblock: 'standard',
  httpsUpgrade: false,
  blockScripts: false,
  fingerprinting: 'off',
  cookies: 'allow',
  forgetOnClose: false,
};

function site(over) {
  return { ...OFF, ...over };
}

function domain(url) {
  return getDomain(new URL(url).hostname);
}

function mainFrame(url) {
  return { url, resourceType: 'mainFrame' };
}

// ---------------------------------------------------------------------------
// Mise à niveau HTTPS
// ---------------------------------------------------------------------------

test('https : une navigation http est redirigée vers https', () => {
  const d = rules.decideRequest(site({ httpsUpgrade: true }), mainFrame('http://exemple.com/page'));
  assert.deepEqual(d, {
    action: 'redirect',
    url: 'https://exemple.com/page',
    reason: 'https',
  });
});

test('https : une URL déjà en https n’est jamais redirigée', () => {
  assert.equal(rules.decideRequest(site({ httpsUpgrade: true }), mainFrame('https://exemple.com')), null);
});

test('https : les sous-ressources ne sont PAS upgradées', () => {
  // Upgrader une image http casserait les sites qui en servent encore, et
  // onBeforeRequest ne sait pas revenir en arrière : la page resterait morte.
  const d = rules.decideRequest(site({ httpsUpgrade: true }), {
    url: 'http://exemple.com/img/logo.png',
    resourceType: 'image',
  });
  assert.equal(d, null);
});

test('https : les hôtes locaux sont préservés (pas de TLS en local)', () => {
  for (const host of ['localhost:3000', '127.0.0.1:8080', 'nas.local', '0.0.0.0']) {
    assert.equal(
      rules.decideRequest(site({ httpsUpgrade: true }), mainFrame(`http://${host}/x`)),
      null,
      `${host} ne doit pas être upgradé`
    );
  }
});

test('https : une adresse IP littérale n’est PAS upgradée (page blanche sinon)', () => {
  // Cas réel : http://109.199.112.67:3000/dashboard/home — le port applicatif
  // ne parle pas TLS. L'upgrader vers https casse la page alors qu'un
  // navigateur classique l'affiche.
  for (const host of ['109.199.112.67:3000', '192.168.1.50:8080', '10.0.0.4', '[::1]:3000', '[fe80::1]:80']) {
    assert.equal(
      rules.decideRequest(site({ httpsUpgrade: true }), mainFrame(`http://${host}/x`)),
      null,
      `${host} ne doit pas être upgradé`
    );
  }
});

test('isIpLiteral : vrai pour v4/v6, faux pour un nom de domaine', () => {
  assert.equal(rules.isIpLiteral('109.199.112.67'), true);
  assert.equal(rules.isIpLiteral('[::1]'), true);
  assert.equal(rules.isIpLiteral('fe80::1'), true);
  assert.equal(rules.isIpLiteral('exemple.com'), false);
  assert.equal(rules.isIpLiteral(''), false);
});

test('https : le réglage désactivé ne redirige rien', () => {
  assert.equal(rules.decideRequest(site({ httpsUpgrade: false }), mainFrame('http://exemple.com')), null);
});

test('upgradeToHttps : conserve port, chemin et requête', () => {
  assert.equal(
    rules.upgradeToHttps('http://exemple.com:8080/a/b?c=1&d=2#frag'),
    'https://exemple.com:8080/a/b?c=1&d=2#frag'
  );
});

test('upgradeToHttps : URL illisible ou non http → null', () => {
  assert.equal(rules.upgradeToHttps('pas une URL'), null);
  assert.equal(rules.upgradeToHttps('about:blank'), null);
  assert.equal(rules.upgradeToHttps('file:///tmp/x'), null);
  assert.equal(rules.upgradeToHttps('ftp://exemple.com'), null);
});

// ---------------------------------------------------------------------------
// Blocage des scripts
// ---------------------------------------------------------------------------

test('scripts : <script> et <object> sont annulés', () => {
  for (const type of ['script', 'object']) {
    const d = rules.decideRequest(site({ blockScripts: true }), {
      url: 'https://cdn.exemple.com/app.js',
      resourceType: type,
    });
    assert.equal(d.action, 'cancel');
    assert.equal(d.reason, 'script');
    assert.equal(d.domain, 'cdn.exemple.com');
  }
});

test('scripts : document, CSS, images et polices passent', () => {
  for (const type of ['mainFrame', 'stylesheet', 'image', 'font', 'xhr', 'media']) {
    assert.equal(
      rules.decideRequest(site({ blockScripts: true }), {
        url: 'https://exemple.com/x',
        resourceType: type,
      }),
      null,
      `${type} ne doit pas être bloqué`
    );
  }
});

test('scripts : le réglage désactivé laisse tout passer', () => {
  assert.equal(
    rules.decideRequest(site({ blockScripts: false }), {
      url: 'https://cdn.exemple.com/app.js',
      resourceType: 'script',
    }),
    null
  );
});

test('boucliers coupés : aucune règle ne s’applique', () => {
  const off = site({ enabled: false, httpsUpgrade: true, blockScripts: true });
  assert.equal(rules.decideRequest(off, mainFrame('http://exemple.com')), null);
  assert.equal(
    rules.decideRequest(off, { url: 'https://x.example/a.js', resourceType: 'script' }),
    null
  );
});

test('réglages absents (null) : on laisse passer', () => {
  assert.equal(rules.decideRequest(null, mainFrame('http://exemple.com')), null);
  assert.equal(rules.shouldStripCookieHeader(null, 'a.com', 'b.com'), false);
  assert.deepEqual(rules.headersToStrip(null, { 'sec-ch-ua-arch': 'x' }), []);
});

// ---------------------------------------------------------------------------
// Cookies tiers
// ---------------------------------------------------------------------------

test('cookies cross-site : un tiers perd son Cookie', () => {
  const s = site({ cookies: 'cross-site' });
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://tracker.net')), true);
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://cdn.exemple.com')), false);
});

test('cookies cross-site : un sous-domaine tiers compte comme tiers', () => {
  // maritime.exemple.com appartient bien à exemple.com (domaine enregistrable
  // identique) → autorisé. Sous-domaine d'un AUTRE site → refusé.
  const s = site({ cookies: 'cross-site' });
  assert.equal(
    rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://a.b.exemple.com')),
    false
  );
  assert.equal(
    rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://stats.exemple.org')),
    true
  );
});

test('cookies cross-site : sous-domaines de cookie, pas d’hôte', () => {
  // La logique travaille sur le domaine enregistrable, donc un cookie posé
  // par un sous-domaine est bien transmis à la page mère.
  const s = site({ cookies: 'cross-site' });
  assert.equal(
    rules.shouldStripCookieHeader(s, domain('https://news.exemple.com'), domain('https://api.exemple.com')),
    false
  );
});

test('cookies all : même le premier partie est coupé', () => {
  const s = site({ cookies: 'all' });
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://exemple.com')), true);
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://cdn.net')), true);
});

test('cookies allow : rien n’est coupé', () => {
  const s = site({ cookies: 'allow' });
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), domain('https://tracker.net')), false);
});

test('cookies : domaine du site inconnu → tiers (prudence)', () => {
  // Le cas « webview tout juste créé » : sans domaine de référence, mieux vaut
  // un cookie absent qu'un cookie de suivi.
  const s = site({ cookies: 'cross-site' });
  assert.equal(rules.shouldStripCookieHeader(s, null, domain('https://exemple.com')), true);
  assert.equal(rules.shouldStripCookieHeader(s, domain('https://exemple.com'), null), true);
});

test('Set-Cookie suit exactement la même règle que l’envoi', () => {
  // Divergence = cookie déposé puis renvoyé : le blocage ne tiendrait pas.
  const s = site({ cookies: 'cross-site' });
  const site1 = domain('https://exemple.com');
  for (const req of [domain('https://exemple.com'), domain('https://tracker.net')]) {
    assert.equal(
      rules.shouldStripSetCookie(s, site1, req),
      rules.shouldStripCookieHeader(s, site1, req),
      `divergence sur ${req}`
    );
  }
});

test('isSameSite : symétrique et false si un côté manque', () => {
  assert.equal(rules.isSameSite('exemple.com', 'exemple.com'), true);
  assert.equal(rules.isSameSite('exemple.com', 'autre.com'), false);
  assert.equal(rules.isSameSite(null, 'exemple.com'), false);
  assert.equal(rules.isSameSite('exemple.com', null), false);
});

// ---------------------------------------------------------------------------
// Empreinte numérique
// ---------------------------------------------------------------------------

test('empreinte standard : retire les indices à haute entropie', () => {
  const headers = {
    'sec-ch-ua-arch': '"arm"',
    'Sec-CH-UA-Model': '"Pixel 8"',
    'sec-ch-ua-full-version-list': '"Chromium";v="126"',
    'sec-ch-ua-platform-version': '"15.0.0"',
    'sec-ch-ua-bitness': '"64"',
    'user-agent': 'Mozilla/5.0',
    accept: '*/*',
  };
  const stripped = rules.headersToStrip(site({ fingerprinting: 'standard' }), headers);
  assert.deepEqual(new Set(stripped), new Set(Object.keys(headers).slice(0, 5)));
  // Rien d'autre : le rendu de la page ne doit pas être touché.
  assert.ok(!stripped.includes('user-agent'));
  assert.ok(!stripped.includes('accept'));
});

test('empreinte standard : ne retire PAS la version complète', () => {
  const headers = { 'sec-ch-ua-full-version': '"126.0.6478.126"' };
  assert.deepEqual(rules.headersToStrip(site({ fingerprinting: 'standard' }), headers), []);
});

test('empreinte strict : retire aussi la version complète et ajoute DNT', () => {
  const s = site({ fingerprinting: 'strict' });
  const headers = { 'sec-ch-ua-full-version': '"126.0.6478.126"', 'sec-ch-ua-arch': '"arm"' };
  assert.deepEqual(
    new Set(rules.headersToStrip(s, headers)),
    new Set(['sec-ch-ua-full-version', 'sec-ch-ua-arch'])
  );
  assert.deepEqual(rules.headersToAdd(s), { DNT: '1' });
});

test('empreinte off : ni retrait, ni ajout', () => {
  const s = site({ fingerprinting: 'off' });
  const headers = { 'sec-ch-ua-arch': '"arm"', 'sec-ch-ua-full-version': '"126"' };
  assert.deepEqual(rules.headersToStrip(s, headers), []);
  assert.deepEqual(rules.headersToAdd(s), {});
});

test('empreinte standard : n’ajoute aucun en-tête', () => {
  assert.deepEqual(rules.headersToAdd(site({ fingerprinting: 'standard' })), {});
});

test('empreinte : la casse des en-têtes est respectée à la suppression', () => {
  // Chromium ne normalise pas les noms : on doit renvoyer la clé EXACTE
  // présente dans l'objet, sinon `delete headers[key]` ne supprime rien.
  const headers = { 'SEC-CH-UA-ARCH': '"arm"' };
  const stripped = rules.headersToStrip(site({ fingerprinting: 'standard' }), headers);
  assert.deepEqual(stripped, ['SEC-CH-UA-ARCH']);
});

test('empreinte : aucun en-tête présent → liste vide', () => {
  assert.deepEqual(rules.headersToStrip(site({ fingerprinting: 'strict' }), {}), []);
  assert.deepEqual(rules.headersToStrip(site({ fingerprinting: 'strict' }), null), []);
});

// ---------------------------------------------------------------------------
// Boucliers coupés : les en-têtes restent intacts
// ---------------------------------------------------------------------------

test('boucliers coupés : ni cookie, ni empreinte, même si les réglages le disent', () => {
  const s = site({ enabled: false, cookies: 'all', fingerprinting: 'strict' });
  assert.equal(rules.shouldStripCookieHeader(s, 'exemple.com', 'exemple.com'), false);
  assert.deepEqual(rules.headersToStrip(s, { 'sec-ch-ua-arch': 'x' }), []);
  assert.deepEqual(rules.headersToAdd(s), {});
});