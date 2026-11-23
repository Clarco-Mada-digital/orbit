import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeLoadFailure,
  isCertificateFailure,
  canFallBackToHttp,
  isDisplayableFailure,
  hostLabel,
  ERR_ABORTED,
  ERR_TOO_MANY_REDIRECTS,
} from '../src/lib/loadFailure.js';

// Ce module remplace la page blanche par une explication. Les tests verrouillent
// donc deux choses : qu'AUCUN code ne produise du vide, et que le geste proposé
// (faire confiance au certificat, revenir en http) ne soit offert que quand il a
// une chance de marcher.

test('tout code produit un libellé exploitable', () => {
  for (const code of [-2, -7, -102, -105, -106, -107, -201, -202, -324, -501]) {
    const f = describeLoadFailure(code);
    assert.ok(f.title.length > 0, `titre vide pour ${code}`);
    assert.ok(f.detail.length > 0, `détail vide pour ${code}`);
    assert.ok(f.name.length > 0, `nom vide pour ${code}`);
    assert.equal(f.code, code);
  }
});

test('un code inconnu retombe sur un message générique, jamais sur du vide', () => {
  const f = describeLoadFailure(-99999);
  assert.equal(f.kind, 'unknown');
  assert.ok(f.title.length > 0);
  assert.ok(f.detail.length > 0);
});

test('un code inconnu emprunte le nom Chromium fourni par Electron', () => {
  assert.equal(describeLoadFailure(-99999, 'ERR_WEIRD_THING').name, 'ERR_WEIRD_THING');
  // Sans description : un repli lisible, pas une chaîne vide.
  assert.equal(describeLoadFailure(-99999).name, 'ERR_-99999');
});

test('un code en chaîne est accepté (l’événement webview n’est pas typé)', () => {
  assert.equal(describeLoadFailure('-201').kind, 'cert');
});

test('les natures sont correctement attribuées', () => {
  assert.equal(describeLoadFailure(-107).kind, 'tls');
  assert.equal(describeLoadFailure(-201).kind, 'cert');
  assert.equal(describeLoadFailure(-105).kind, 'dns');
  assert.equal(describeLoadFailure(-106).kind, 'offline');
  assert.equal(describeLoadFailure(-102).kind, 'refused');
  assert.equal(describeLoadFailure(-118).kind, 'timeout');
  assert.equal(describeLoadFailure(-324).kind, 'server');
  assert.equal(describeLoadFailure(-130).kind, 'proxy');
});

test('toute la plage des erreurs de certificat est reconnue', () => {
  // -501 (ERR_INSECURE_RESPONSE) en fait partie : c'est celui que remonte une
  // sous-ressource refusée, et il doit offrir le même geste.
  for (const code of [-200, -201, -202, -203, -206, -207, -211, -501]) {
    assert.equal(isCertificateFailure(code), true, `${code} devrait être un échec de certificat`);
  }
  for (const code of [-105, -106, -107, -324]) {
    assert.equal(isCertificateFailure(code), false, `${code} n’est pas un échec de certificat`);
  }
});

test('le retour en HTTP n’est proposé que si le bouclier a mis à niveau', () => {
  assert.equal(canFallBackToHttp(-107, { upgraded: true }), true);
  assert.equal(canFallBackToHttp(-107, { upgraded: false }), false);
});

test('le retour en HTTP n’est pas proposé quand il ne peut rien résoudre', () => {
  // Nom introuvable et réseau absent le resteront en http : offrir le geste
  // mènerait à un second échec, plus déroutant que le premier.
  assert.equal(canFallBackToHttp(-105, { upgraded: true }), false);
  assert.equal(canFallBackToHttp(-106, { upgraded: true }), false);
  assert.equal(canFallBackToHttp(-21, { upgraded: true }), false);
  // En revanche, un serveur sans TLS, injoignable sur 443 ou muet : oui.
  assert.equal(canFallBackToHttp(-102, { upgraded: true }), true);
  assert.equal(canFallBackToHttp(-118, { upgraded: true }), true);
  assert.equal(canFallBackToHttp(-324, { upgraded: true }), true);
  assert.equal(canFallBackToHttp(-201, { upgraded: true }), true);
});

test('après une mise à niveau HTTPS, le message n’accuse plus le site', () => {
  // Cas vécu : http://neverssl.com → le bouclier tente https → le port 443 ne
  // répond rien (-324). Le message brut disait « l'erreur vient du site »,
  // alors que ce site fonctionne parfaitement en http.
  const brut = describeLoadFailure(-324);
  assert.match(brut.detail, /vient du site/);
  const apres = describeLoadFailure(-324, '', { upgraded: true });
  assert.equal(apres.title, 'Ce site ne gère pas HTTPS');
  assert.doesNotMatch(apres.detail, /vient du site/);
  // La nature et le code ne changent pas : seuls les mots changent.
  assert.equal(apres.kind, brut.kind);
  assert.equal(apres.code, -324);
  assert.equal(apres.name, 'ERR_EMPTY_RESPONSE');
});

test('après mise à niveau, un échec de certificat garde son propre message', () => {
  // Le serveur parle bien TLS : dire « ce site ne gère pas HTTPS » serait faux
  // dans l'autre sens, et masquerait le vrai problème.
  const f = describeLoadFailure(-202, '', { upgraded: true });
  assert.equal(f.kind, 'cert');
  assert.match(f.title, /[Cc]ertificat/);
});

test('après mise à niveau, une panne que le http ne corrige pas garde son message', () => {
  // Pas de réseau : ce n'est pas « ce site ne gère pas HTTPS ».
  const f = describeLoadFailure(-106, '', { upgraded: true });
  assert.equal(f.kind, 'offline');
  assert.match(f.title, /connexion Internet/i);
});

test('les deux codes traités ailleurs n’ouvrent pas d’interstitielle', () => {
  assert.equal(isDisplayableFailure(ERR_ABORTED), false);
  assert.equal(isDisplayableFailure(ERR_TOO_MANY_REDIRECTS), false);
  assert.equal(isDisplayableFailure(-107), true);
});

test('hostLabel garde le port et ne jette jamais', () => {
  assert.equal(hostLabel('http://exemple.com:8080/x'), 'exemple.com:8080');
  assert.equal(hostLabel('https://exemple.com/x'), 'exemple.com');
  assert.equal(hostLabel('pas une url'), '');
  assert.equal(hostLabel(undefined), '');
});
