import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLoginPageUrl,
  isTokenUrl,
  stripEphemeralParams,
  reloadUrlFor,
  homeUrlFor,
  computeStartUrl,
  detectUrl,
  flyPageTarget,
  outsideFallbackFor,
} from '../src/lib/urls.js';

// --- detectUrl : « est-ce que l'utilisateur a tapé une adresse ? » --------

test('detectUrl : URL complète rendue telle quelle', () => {
  assert.equal(detectUrl('https://github.com/x'), 'https://github.com/x');
  assert.equal(detectUrl('http://localhost:5173/'), 'http://localhost:5173/');
});

test('detectUrl : domaine nu complété en https', () => {
  assert.equal(detectUrl('github.com'), 'https://github.com');
  assert.equal(detectUrl('mail.google.com/mail/u/0'), 'https://mail.google.com/mail/u/0');
  assert.equal(detectUrl('exemple.fr'), 'https://exemple.fr');
});

test('detectUrl : une recherche n’est pas une URL', () => {
  // Sinon taper « notion todo » ouvrirait un site au lieu de filtrer les apps
  assert.equal(detectUrl('notion todo'), null);
  assert.equal(detectUrl('gmail'), null);
  assert.equal(detectUrl('2+2'), null);
  assert.equal(detectUrl('fichier.'), null); // TLD manquant
  assert.equal(detectUrl(''), null);
  assert.equal(detectUrl(null), null);
});

// Ces fonctions décident sur QUELLE page une app redémarre. Une erreur ici se
// paie cher : soit l'app rouvre sur un formulaire de connexion mort, soit elle
// oblige à se reconnecter alors que la session est encore valide.

test('isLoginPageUrl : reconnaît les pages de connexion et les flux d’auth', () => {
  const login = [
    'https://accounts.google.com/',
    'https://accounts.google.com/b/0/AddMailService',
    'https://example.com/signin',
    'https://example.com/sign-in',
    'https://example.com/login',
    'https://example.com/auth/callback',
    'https://example.com/oauth/authorize',
    'https://example.com/challenge/pwd',
    'https://example.com/two-factor',
    'https://example.com/2fa',
    'https://example.com/verify',
    'https://example.com/otp',
    'https://example.com/sessions/new',
    'https://example.com/forgot-password',
    'https://example.com/reset',
  ];
  for (const u of login) assert.equal(isLoginPageUrl(u), true, u);
});

test('isLoginPageUrl : les pages normales ne sont pas des pages de connexion', () => {
  const normal = [
    'https://mail.google.com/mail/u/0/#inbox',
    'https://example.com/',
    'https://example.com/dashboard',
    'https://github.com/Clarco-Mada-digital/orbit',
  ];
  for (const u of normal) assert.equal(isLoginPageUrl(u), false, u);
});

test('isLoginPageUrl : entrée vide ou invalide = prudence (true)', () => {
  // Sans URL exploitable on repart de la « maison » plutôt que de restaurer
  // n'importe quoi.
  assert.equal(isLoginPageUrl(''), true);
  assert.equal(isLoginPageUrl(null), true);
  assert.equal(isLoginPageUrl(undefined), true);
  assert.equal(isLoginPageUrl('pas-une-url'), true);
});

test('isTokenUrl : page authentifiée à restaurer', () => {
  assert.equal(isTokenUrl('https://srv.o2switch.net:2083/cpsess1234567890/frontend/x'), true);
  assert.equal(isTokenUrl('https://example.com/app?token=abc'), true);
  assert.equal(isTokenUrl('https://example.com/app?sid=abc'), true);
  assert.equal(isTokenUrl('https://example.com/app?session=abc'), true);
  assert.equal(isTokenUrl('https://example.com/app?authkey=abc'), true);
  assert.equal(isTokenUrl('https://example.com/app?access_token=abc'), true);
});

test('isTokenUrl : page ordinaire, vide ou invalide → false', () => {
  assert.equal(isTokenUrl('https://example.com/dashboard'), false);
  assert.equal(isTokenUrl(''), false);
  assert.equal(isTokenUrl(null), false);
  assert.equal(isTokenUrl('pas-une-url'), false);
});

test('stripEphemeralParams : retire les jetons à usage unique, garde le reste', () => {
  assert.equal(
    stripEphemeralParams('https://example.com/mail?_task=mail&_token=XYZ'),
    'https://example.com/mail?_task=mail'
  );
  assert.equal(
    stripEphemeralParams('https://example.com/cb?code=abc&state=42'),
    'https://example.com/cb?state=42'
  );
  // Les jetons de SESSION restent : ce sont eux qui évitent la reconnexion
  const withSid = 'https://example.com/app?sid=abc';
  assert.equal(stripEphemeralParams(withSid), withSid);
});

test('stripEphemeralParams : rien à retirer → URL inchangée (identité stricte)', () => {
  const url = 'https://example.com/dashboard';
  assert.equal(stripEphemeralParams(url), url);
  assert.equal(stripEphemeralParams(''), '');
  assert.equal(stripEphemeralParams('pas-une-url'), 'pas-une-url');
});

test('reloadUrlFor : URL nettoyée seulement s’il y avait quelque chose à nettoyer', () => {
  assert.equal(
    reloadUrlFor('https://example.com/mail?_token=XYZ'),
    'https://example.com/mail'
  );
  // Rien à nettoyer → undefined, l'appelant fait un reload() classique
  assert.equal(reloadUrlFor('https://example.com/mail'), undefined);
  assert.equal(reloadUrlFor(''), undefined);
});

test('homeUrlFor : page de connexion → origine du site, sinon inchangée', () => {
  assert.equal(homeUrlFor('https://example.com/login?next=/x'), 'https://example.com');
  assert.equal(homeUrlFor('https://example.com/dashboard'), 'https://example.com/dashboard');
  assert.equal(homeUrlFor('pas-une-url'), 'pas-une-url');
});

// --- computeStartUrl : la décision finale --------------------------------

const RECIPES = { gmail: { url: 'https://mail.google.com/' } };

test('computeStartUrl : reprend la dernière page visitée', () => {
  const app = { recipeId: 'gmail', url: 'https://mail.google.com/mail/u/0/#sent' };
  assert.equal(computeStartUrl(app, RECIPES), 'https://mail.google.com/mail/u/0/#sent');
});

test('computeStartUrl : jamais une page de connexion → retour à la maison', () => {
  const app = { recipeId: 'gmail', url: 'https://accounts.google.com/ServiceLogin' };
  assert.equal(computeStartUrl(app, RECIPES), 'https://mail.google.com/');
});

test('computeStartUrl : URL à jeton restaurée, mais sans ses paramètres éphémères', () => {
  const cpanel = {
    url: 'https://srv.o2switch.net:2083/cpsess123456/frontend/jupiter/index.html',
    homeUrl: 'https://srv.o2switch.net:2083/',
  };
  assert.equal(computeStartUrl(cpanel, {}), cpanel.url);

  const roundcube = {
    url: 'https://webmail.example.com/?_task=mail&_token=PERIME&sid=vivant',
    homeUrl: 'https://webmail.example.com/',
  };
  assert.equal(
    computeStartUrl(roundcube, {}),
    'https://webmail.example.com/?_task=mail&sid=vivant'
  );
});

test('computeStartUrl : URL parasite sur un autre domaine → retour à la maison', () => {
  // Un widget (contacts.google.com) capturé par erreur dans l'app Gmail
  const app = { recipeId: 'gmail', url: 'https://contacts.google.com/widget' };
  assert.equal(computeStartUrl(app, RECIPES), 'https://mail.google.com/');
});

test('computeStartUrl : app personnalisée sans recette', () => {
  // Pas de homeUrl ni de recette : la « maison » est l'URL elle-même
  assert.equal(
    computeStartUrl({ url: 'https://example.com/app' }, {}),
    'https://example.com/app'
  );
  // Ajoutée sur une page de connexion : la maison devient l'origine
  assert.equal(
    computeStartUrl({ url: 'https://example.com/login' }, {}),
    'https://example.com'
  );
});

test('computeStartUrl : homeUrl explicite prioritaire sur la recette', () => {
  const app = {
    recipeId: 'gmail',
    homeUrl: 'https://mail.google.com/mail/u/1/',
    url: 'https://accounts.google.com/signin',
  };
  assert.equal(computeStartUrl(app, RECIPES), 'https://mail.google.com/mail/u/1/');
});

// --- flyPageTarget : ce qu'on accepte d'ouvrir en « lien libre » ----------
// Une page volante peut être une adresse web, ou un fichier local quand
// l'utilisateur choisit Orbit dans « Ouvrir avec » de son système. La cible
// porte sa NATURE (`kind`) : c'est elle qui décide entre <webview> et
// visionneuse de documents (voir lib/fileTypes.js).

test('flyPageTarget : une adresse web donne son domaine comme nom', () => {
  assert.deepEqual(flyPageTarget('https://www.exemple.com/a?b=1'), {
    url: 'https://www.exemple.com/a?b=1',
    name: 'exemple.com',
    local: false,
    kind: 'page',
  });
});

test('flyPageTarget : un fichier .html local donne le nom du fichier', () => {
  const t = flyPageTarget('file:///home/lea/Documents/rapport%20final.html');
  assert.equal(t.local, true);
  assert.equal(t.name, 'rapport final.html', 'le nom est décodé et sans son chemin');
  assert.equal(t.url, 'file:///home/lea/Documents/rapport%20final.html');
  assert.equal(t.kind, 'page');
});

test('flyPageTarget : les fichiers locaux lisibles sont acceptés, avec leur nature', () => {
  const cases = {
    'file:///tmp/a.htm': 'page',
    'file:///tmp/a.xhtml': 'page',
    'file:///tmp/rapport.pdf': 'pdf',
    'file:///tmp/photo.png': 'image',
    'file:///tmp/notes.md': 'markdown',
    'file:///tmp/notes.txt': 'text',
    'file:///tmp/data.json': 'json',
    'file:///tmp/table.csv': 'csv',
    'file:///tmp/app.ts': 'code',
  };
  for (const [url, kind] of Object.entries(cases)) {
    const t = flyPageTarget(url);
    assert.ok(t, `${url} devrait être ouvrable`);
    assert.equal(t.kind, kind, `nature attendue pour ${url}`);
    assert.equal(t.local, true);
  }
});

test('flyPageTarget : un .zip ou un .docx ne s’ouvre pas (cadre blanc garanti)', () => {
  // Le moteur en ferait un téléchargement, donc aucune page à afficher.
  for (const bad of ['file:///tmp/pack.zip', 'file:///tmp/rapport.docx', 'file:///tmp/setup.exe']) {
    assert.equal(flyPageTarget(bad), null, `${bad} doit être refusé`);
  }
  // Une adresse de téléchargement non plus.
  assert.equal(flyPageTarget('https://exemple.com/fichiers/pack.zip'), null);
});

test('flyPageTarget : un document distant prend le nom du fichier', () => {
  const md = flyPageTarget('https://exemple.com/docs/readme.md');
  assert.equal(md.kind, 'markdown');
  assert.equal(md.name, 'readme.md', 'le nom du fichier est plus parlant que le domaine');
  assert.equal(md.local, false);
});

test('flyPageTarget : refus de tout ce qui n’est ni web ni fichier lisible', () => {
  for (const bad of ['', '   ', 'javascript:alert(1)', 'mailto:a@b.c', 'file:///etc/passwd']) {
    assert.equal(flyPageTarget(bad), null, `${JSON.stringify(bad)} doit être refusé`);
  }
  // Un chemin nu (sans schéma file:) n'est pas traité ici : c'est le rôle du
  // processus principal, qui reçoit les arguments du système.
  assert.equal(flyPageTarget('notes.txt'), null);
});

test('outsideFallbackFor : jamais silencieux — un document refusé part au navigateur', () => {
  // Un .docx, un .zip ou un .exe n'ont AUCUN rendu dans Orbit : les refuser est
  // juste, mais ne rien faire donne le même symptôme qu'une page blanche.
  for (const unsupported of [
    'https://exemple.com/fichiers/rapport.docx',
    'https://exemple.com/fichiers/classeur.xlsx',
    'https://exemple.com/fichiers/archive.zip',
    'https://exemple.com/fichiers/setup.exe',
  ]) {
    assert.equal(
      outsideFallbackFor(unsupported),
      'browser',
      `${unsupported} doit être rendu au navigateur`
    );
  }
});

test('outsideFallbackFor : un lien qu’Orbit ouvre reste chez Orbit', () => {
  // Pas de double ouverture : si la visionneuse ou le moteur s'en charge, on
  // n'appelle pas le navigateur.
  for (const handled of [
    'https://exemple.com/docs/guide.md',
    'https://exemple.com/',
    'https://exemple.com/fichiers/photo.png',
    'https://exemple.com/fichiers/rapport.pdf',
  ]) {
    assert.equal(outsideFallbackFor(handled), null, `${handled} ne part pas au navigateur`);
  }
});

test('outsideFallbackFor : rien à ouvrir extérieurement pour les autres schémas', () => {
  // On n'invente PAS une action à la place d'une autre : un lien `javascript:`
  // ou `mailto:` n'a pas d'équivalent « navigateur » sûr ici.
  for (const other of ['', '   ', 'javascript:alert(1)', 'mailto:a@b.c', 'file:///tmp/notes.txt']) {
    assert.equal(outsideFallbackFor(other), null, `${JSON.stringify(other)} n'a pas de repli`);
  }
});
