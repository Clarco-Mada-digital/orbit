import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as shields from '../electron/shields.js';

// electron/shields.js est la source de vérité des réglages de sécurité. Les
// tests tournent dans un dossier temporaire : on ne touche jamais au vrai
// shields.json de l'utilisateur.

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-shields-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function loaded(dir) {
  shields.init(dir);
}

test('origine : seuls http(s) comptent, le reste est refusé', () => {
  assert.equal(shields.originOf('https://exemple.com/a/b?c=1'), 'https://exemple.com');
  assert.equal(shields.originOf('http://exemple.com:8080/x'), 'http://exemple.com:8080');
  assert.equal(shields.originOf('about:blank'), null);
  assert.equal(shields.originOf('file:///tmp/x.html'), null);
  assert.equal(shields.originOf('orbit://page'), null);
  assert.equal(shields.originOf(''), null);
  assert.equal(shields.originOf(null), null);
  assert.equal(shields.originOf(undefined), null);
});

test('valeurs par défaut : shields activés, https et cookies tiers', () => {
  withDir((dir) => {
    loaded(dir);
    const s = shields.getSiteSettings('https://jamais-vu.example');
    assert.equal(s.enabled, true);
    assert.equal(s.httpsUpgrade, true);
    assert.equal(s.cookies, 'cross-site');
    assert.equal(s.blockScripts, false);
  });
});

test('un réglage par site ne déborde pas sur les autres', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://a.example', { blockScripts: true });
    assert.equal(shields.getSiteSettings('https://a.example').blockScripts, true);
    assert.equal(shields.getSiteSettings('https://b.example').blockScripts, false);
  });
});

test('un site sans configuration hérite des valeurs par défaut', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateDefaults({ blockScripts: true, cookies: 'all' });
    const s = shields.getSiteSettings('https://jamais-vu.example');
    assert.equal(s.blockScripts, true);
    assert.equal(s.cookies, 'all');
    // Un site qui a surchargé autre chose garde SES valeurs pour les autres clés.
    shields.updateSiteSettings('https://c.example', { cookies: 'allow' });
    const c = shields.getSiteSettings('https://c.example');
    assert.equal(c.cookies, 'allow');
    assert.equal(c.blockScripts, true);
  });
});

test('les updates sont filtrées : ni clé inconnue, ni valeur hors liste', () => {
  withDir((dir) => {
    loaded(dir);
    const s = shields.updateSiteSettings('https://x.example', {
      blockScripts: true, // booléen valide
      enabled: 'oui', // mauvais type → ignoré
      cookies: 'parfois', // hors liste → ignoré
      fingerprinting: 'strict', // valide
      __proto__: { polluted: true }, // pollution de prototype
      cleInconnue: 42, // clé inconnue
    });
    assert.equal(s.blockScripts, true);
    assert.equal(s.fingerprinting, 'strict');
    assert.equal(s.enabled, true, 'la valeur rejetée ne doit pas écraser le défaut');
    assert.equal(s.cookies, 'cross-site');
    assert.equal('cleInconnue' in s, false);
    assert.equal({}.polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });
});

test('updateSiteSettings renvoie les réglages effectifs (source de vérité UI)', () => {
  withDir((dir) => {
    loaded(dir);
    const r = shields.updateSiteSettings('https://y.example', { enabled: false });
    assert.equal(r.enabled, false);
    assert.equal(typeof r.httpsUpgrade, 'boolean');
  });
});

test('resetSiteSettings ramène aux valeurs par défaut', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateDefaults({ blockScripts: true });
    shields.updateSiteSettings('https://z.example', { blockScripts: false });
    assert.equal(shields.getSiteSettings('https://z.example').blockScripts, false);
    shields.resetSiteSettings('https://z.example');
    assert.equal(shields.getSiteSettings('https://z.example').blockScripts, true);
  });
});

test('persistance : les réglages survivent à un redémarrage', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://persiste.example', {
      blockScripts: true,
      cookies: 'all',
    });
    // re-init : simule le lancement suivant d'Orbit
    loaded(dir);
    const s = shields.getSiteSettings('https://persiste.example');
    assert.equal(s.blockScripts, true);
    assert.equal(s.cookies, 'all');
  });
});

test('un fichier corrompu ne casse pas le démarrage', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'shields.json'), '{ ceci n’est pas du JSON');
    assert.doesNotThrow(() => loaded(dir));
    assert.equal(shields.getSiteSettings('https://exemple.com').enabled, true);
  });
});

test('listSites : réglages effectifs + clés réellement surchargées', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateDefaults({ blockScripts: true, fingerprinting: 'strict' });
    // Site A : une seule surcharge → `overrides` doit le dire, sinon l'UI
    // afficherait « personnalisé » sur des champs simplement hérités.
    shields.updateSiteSettings('https://b.example', { cookies: 'allow' });
    // Site B : rien n'est enregistré → il ne doit pas apparaître.
    shields.updateSiteSettings('https://a.example', { forgetOnClose: true });

    const list = shields.listSites();
    assert.deepEqual(list.map((s) => s.origin), ['https://a.example', 'https://b.example']);

    const a = list.find((s) => s.origin === 'https://a.example');
    assert.deepEqual(a.overrides, { forgetOnClose: true });
    assert.equal(a.settings.blockScripts, true, 'hérité des valeurs par défaut');
    assert.equal(a.settings.fingerprinting, 'strict');

    const b = list.find((s) => s.origin === 'https://b.example');
    assert.deepEqual(b.overrides, { cookies: 'allow' });
    assert.equal(b.settings.blockScripts, true);
  });
});

test('updateDefaults filtre comme updateSiteSettings', () => {
  withDir((dir) => {
    loaded(dir);
    const d = shields.updateDefaults({
      cookies: 'bidon', // hors liste
      blockScripts: 'oui', // mauvais type
      cleForte: 1, // clé inconnue
    });
    assert.equal(d.cookies, 'cross-site', 'valeur hors liste ignorée');
    assert.equal(d.blockScripts, false, 'mauvais type ignoré');
    assert.equal('cleForte' in d, false);
    assert.equal(d.enabled, true);
  });
});

test('les origines « oublier à la fermeture » sont listées', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://ephemere.example', { forgetOnClose: true });
    shields.updateSiteSettings('https://durable.example', { forgetOnClose: false });
    const list = shields.sitesToForget();
    assert.deepEqual(list, ['https://ephemere.example']);
  });
});

test('origine courante d’un webContents : suivie, isolée, nettoyée', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://suivi.example', { blockScripts: true });

    // Les réglages suivent le SITE, pas l'URL de la requête : c'est ce qui
    // permet à un réglage posé sur le site de s'appliquer à ses CDN.
    shields.setContentsOrigin(7, 'https://suivi.example/page/une?x=1');
    assert.equal(shields.getSettingsForContents(7).blockScripts, true);
    assert.equal(shields.getSettingsForContents(7).enabled, true);

    // Un webview inconnu retombe sur les valeurs par défaut (protection, pas
    // trou noir) — jamais sur « rien à protéger ».
    assert.equal(shields.getSettingsForContents(99).enabled, true);

    // Navigation vers un autre site : les réglages suivent.
    shields.setContentsOrigin(7, 'https://autre.example');
    assert.equal(shields.getSettingsForContents(7).blockScripts, false);

    // Un webContents détruit ne laisse pas de trace (croissance de la Map).
    shields.clearContentsOrigin(7);
    assert.equal(shields.getSettingsForContents(7).enabled, true);
  });
});

test('les identifiants venus de l’IPC (chaînes) sont normalisés', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://stringid.example', { blockScripts: true });
    shields.setContentsOrigin('12', 'https://stringid.example');
    // '12' et 12 doivent désigner le même webview.
    assert.equal(shields.getSettingsForContents(12).blockScripts, true);
    shields.clearContentsOrigin('12');
    assert.equal(shields.getSettingsForContents(12).blockScripts, false);
  });
});

test('une origine non http(s) n’est jamais mémorisée ni réglée', () => {
  withDir((dir) => {
    loaded(dir);
    assert.equal(shields.setContentsOrigin(3, 'about:blank'), null);
    assert.equal(shields.getSettingsForContents(3).enabled, true);
    // updateSiteSettings sans origine valide : no-op, on renvoie les défauts.
    const s = shields.updateSiteSettings(null, { blockScripts: true });
    assert.equal(s.blockScripts, false);
  });
});

test('le fichier écrit reste du JSON lisible', () => {
  withDir((dir) => {
    loaded(dir);
    shields.updateSiteSettings('https://json.example', { blockScripts: true });
    const raw = JSON.parse(readFileSync(join(dir, 'shields.json'), 'utf8'));
    assert.equal(raw.sites['https://json.example'].blockScripts, true);
    assert.equal(raw.defaults.enabled, true);
  });
});