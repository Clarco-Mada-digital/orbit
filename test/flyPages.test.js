import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlyPage, flyPageId, flyPageIcon, flyPageColor, flyPageLabel } from '../src/lib/flyPages.js';
import { flyPageTarget } from '../src/lib/urls.js';

// La FORME d'une page volante décide de son affichage : `kind` envoie le
// document à la visionneuse d'Orbit ou au <webview>, et `sessionKey` garantit
// qu'une page de passage ne touche pas aux cookies d'un compte connecté.
//
// Ces tests ne passent pas par le magasin : la construction vit dans
// lib/flyPages.js justement pour être vérifiable sans zustand (voir
// test/fly-pages.test.js pour les tests au niveau du magasin).

const pageFor = (url, opts = {}) =>
  buildFlyPage({ id: 'fly-1', target: flyPageTarget(url), now: 1000, ...opts });

test('un lien web : domaine comme nom, globe, partition jetable', () => {
  const page = pageFor('https://www.exemple.com/article');
  assert.equal(page.name, 'exemple.com');
  assert.equal(page.icon, '🌐');
  assert.equal(page.kind, 'page');
  assert.equal(page.filePath, null, 'une adresse web n’a pas de fichier local');
  assert.equal(page.scope, 'all', 'une page volante n’appartient à aucun profil');
  assert.equal(page.ephemeral, true);
  assert.equal(page.private, false);
  assert.equal(page.sessionKey, 'fly:fly-1');
  assert.equal(page.url, page.homeUrl);
  assert.equal(page.createdAt, 1000);
});

test('une page privée : lunettes, violet, partition « priv »', () => {
  const page = pageFor('https://exemple.com', { isPrivate: true, id: 'priv-1' });
  assert.equal(page.icon, '🕶️');
  assert.equal(page.color, '#7c3aed');
  assert.equal(page.private, true);
  assert.equal(page.sessionKey, 'priv:priv-1');
});

test('la nature du document donne son icône et sa couleur', () => {
  // L'icône annonce ce qu'on va voir : c'est aussi ce qui dit à l'interface
  // quel moteur d'affichage utiliser.
  assert.equal(pageFor('https://exemple.com/notes.md').kind, 'markdown');
  assert.equal(pageFor('https://exemple.com/notes.md').icon, '📝');
  assert.equal(pageFor('https://exemple.com/data.json').icon, '🧾');
  assert.equal(pageFor('https://exemple.com/table.csv').icon, '📊');
  assert.equal(pageFor('https://exemple.com/doc.pdf').icon, '📕');
  // Un fichier de code SERVI PAR LE WEB reste une page (`flyPageTarget` ne le
  // route pas vers la visionneuse) : c'est l'ouverture d'un fichier local qui
  // produit la nature « code ».
  assert.equal(pageFor('https://exemple.com/script.py').kind, 'page');
  assert.equal(flyPageIcon({ kind: 'code', local: true }, false), '💻');
  // Une nature inconnue ne laisse pas la page sans apparence.
  assert.equal(flyPageIcon({ kind: 'inconnu', local: false }, false), '🌐');
  assert.equal(flyPageIcon({ kind: 'inconnu', local: true }, false), '📄');
  assert.equal(flyPageColor({ kind: 'inconnu' }, false), '#64748b');
});

test('un fichier HTML local reste un document, pas un site', () => {
  // Le globe est réservé aux adresses web : un .html sur le disque est un
  // document qu'on ouvre, pas un site qu'on visite.
  const target = { url: 'file:///tmp/rapport.html', name: 'rapport.html', kind: 'page', local: true };
  const page = buildFlyPage({ id: 'fly-2', target, filePath: '/tmp/rapport.html' });
  assert.equal(page.icon, '📄');
  assert.equal(page.filePath, '/tmp/rapport.html');
});

test('le chemin local est ignoré pour une adresse web', () => {
  // Sinon la visionneuse tenterait de lire un fichier qui n'a rien à voir avec
  // la page affichée.
  const page = pageFor('https://exemple.com/a.md', { filePath: '/tmp/autre.md' });
  assert.equal(page.filePath, null);
});

test('le nom affiché d’un lien libre devient le titre de la page', () => {
  // Avant chargement, une page volante n'a que son domaine : c'est‑à‑dire le
  // lien brut. Dès que le moteur annonce le titre, la barre latérale doit s'en
  // servir — comme un onglet de navigateur.
  const page = pageFor('https://exemple.com/article');
  assert.equal(flyPageLabel(page), 'exemple.com', 'sans titre : le domaine');
  assert.equal(flyPageLabel({ ...page, title: 'Exemple — Actualités' }), 'Exemple — Actualités');
  assert.equal(
    flyPageLabel({ ...page, title: '  Un   titre\n très  long  ' }),
    'Un titre très long',
    'espaces réduits au rendu d’un seul nom'
  );
  assert.equal(flyPageLabel({ ...page, title: '   ' }), 'exemple.com', 'titre vide : repli');
  assert.equal(flyPageLabel({ ...page, title: '' }), 'exemple.com');
  // Une page privée est aussi un lien : son titre est pertinent (la pastille
  // de lunettes reste affichée sur l'icône).
  const priv = pageFor('https://exemple.com', { isPrivate: true, id: 'priv-1' });
  assert.equal(flyPageLabel({ ...priv, title: 'Boîte de réception' }), 'Boîte de réception');
});

test('le nom d’une app installée et d’un document local ne bougent pas', () => {
  // Le titre d'une page ne doit JAMAIS écraser le nom choisi par l'utilisateur.
  assert.equal(
    flyPageLabel({ name: 'Mon Gmail', title: 'Boîte de réception', ephemeral: false }),
    'Mon Gmail'
  );
  // Un fichier local garde son nom de fichier : le titre de son contenu
  // désignerait mal ce qui est ouvert sur le disque.
  const target = { url: 'file:///tmp/rapport.html', name: 'rapport.html', kind: 'page', local: true };
  const doc = buildFlyPage({ id: 'fly-3', target, filePath: '/tmp/rapport.html', now: 1 });
  assert.equal(flyPageLabel({ ...doc, title: 'Rapport annuel' }), 'rapport.html');
  assert.equal(flyPageLabel(null), '');
});

test('deux pages ouvertes dans la même milliseconde ont des identifiants distincts', () => {
  // Le système passe plusieurs fichiers d'un coup au lancement : sans le
  // compteur, deux pages partageraient un identifiant, se fermeraient ensemble
  // et casseraient les clés React.
  const a = flyPageId(false, 1, 5000);
  const b = flyPageId(false, 2, 5000);
  assert.notEqual(a, b);
  assert.equal(a, 'fly-5000-1');
  assert.equal(flyPageId(true, 3, 5000), 'priv-5000-3');
});

test('l’ordre d’affichage suit la position demandée', () => {
  assert.equal(pageFor('https://exemple.com', { order: 4 }).order, 4);
  assert.equal(pageFor('https://exemple.com').order, 0);
});
