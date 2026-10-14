import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractOpenables, isWebLink, toOpenable } from '../electron/open-links.js';

// Le système lance Orbit avec ce qu'il a sous la main : une URL de lien, ou le
// CHEMIN d'un fichier associé. Ces tests verrouillent ce qu'on accepte
// d'ouvrir — accepter trop large, c'est charger n'importe quoi dans une page
// volante (un .docx y donnait un cadre BLANC, le moteur en faisant un
// téléchargement) ; refuser trop, c'est une association qui ne fait rien.
//
// Ce qu'Orbit sait MONTRER depuis la visionneuse : pages, PDF, images, médias
// et tous les formats texte (md, txt, json, csv, code…). Le reste (binaires,
// archives, documents bureautiques) n'est pas ouvert : il part au navigateur.

const CWD = '/home/dev/projet';

test('isWebLink : http et https seulement', () => {
  assert.equal(isWebLink('http://exemple.com'), true);
  assert.equal(isWebLink('https://exemple.com/a?b=1#c'), true);
  for (const bad of ['ftp://exemple.com', 'mailto:a@b.c', 'javascript:alert(1)', 'exemple.com', '']) {
    assert.equal(isWebLink(bad), false, `${bad} n’est pas un lien web`);
  }
});

test('toOpenable : une adresse web passe telle quelle', () => {
  assert.deepEqual(toOpenable('https://exemple.com/page', { cwd: CWD }), {
    kind: 'url',
    url: 'https://exemple.com/page',
  });
});

test('toOpenable : espaces et guillemets autour de l’argument sont tolérés', () => {
  assert.equal(toOpenable('  https://exemple.com/x  ', { cwd: CWD }).url, 'https://exemple.com/x');
  // Certaines entrées de bureau citent le chemin.
  const quoted = toOpenable('"https://exemple.com/y"', { cwd: CWD });
  assert.equal(quoted.url, 'https://exemple.com/y');
});

test('toOpenable : un chemin local de page HTML devient une URL file:', () => {
  const item = toOpenable('pages/index.html', { cwd: CWD });
  assert.equal(item.kind, 'file');
  assert.equal(item.path, path.join(CWD, 'pages/index.html'));
  assert.equal(item.url, pathToFileURL(path.join(CWD, 'pages/index.html')).href);
  // Un chemin ABSOLU reste absolu (le répertoire courant ne s'y ajoute pas).
  assert.equal(toOpenable('/tmp/a/b.htm', { cwd: CWD }).path, '/tmp/a/b.htm');
});

test('toOpenable : une URL file: est acceptée pour tout ce qu’on sait montrer', () => {
  assert.equal(toOpenable('file:///tmp/rapport.html', { cwd: CWD }).kind, 'file');
  assert.equal(toOpenable('file:///C:/Dossier/page.xhtml', { cwd: CWD }).kind, 'file');
  // Le PDF et l'image sont rendus par le moteur, comme la page HTML.
  assert.equal(toOpenable('file:///tmp/rapport.pdf', { cwd: CWD }).kind, 'file');
  assert.equal(toOpenable('file:///tmp/photo.png', { cwd: CWD }).kind, 'file');
  // Les documents texte passent par la visionneuse d'Orbit.
  for (const name of ['notes.md', 'notes.txt', 'data.json', 'table.csv', 'app.ts', 'README']) {
    assert.equal(
      toOpenable(`file:///tmp/${name}`, { cwd: CWD }).kind,
      'file',
      `${name} devrait pouvoir s’ouvrir dans Orbit`
    );
  }
});

test('toOpenable : ce qui ne s’affiche pas ne s’ouvre pas', () => {
  // Ni un binaire, ni une archive, ni un document bureautique : ouvrir ça
  // donnerait une page blanche (le moteur en fait un téléchargement).
  for (const name of ['archive.tar.gz', 'rapport.docx', 'pack.zip', 'setup.exe', 'image.iso']) {
    assert.equal(toOpenable(`file:///tmp/${name}`, { cwd: CWD }), null, `${name} ne doit rien ouvrir`);
  }
});

test('toOpenable : ce qui n’est ni un lien ni un fichier lisible → null', () => {
  for (const arg of ['', '   ', '--no-sandbox', '.', '/usr/bin/orbit']) {
    assert.equal(toOpenable(arg, { cwd: CWD }), null, `${JSON.stringify(arg)} ne doit rien ouvrir`);
  }
});

test('toOpenable : les notes et le code s’ouvrent depuis « Ouvrir avec »', () => {
  assert.equal(toOpenable('notes.txt', { cwd: CWD }).kind, 'file');
  assert.equal(toOpenable('src/app.js', { cwd: CWD }).path, path.join(CWD, 'src/app.js'));
  assert.equal(toOpenable('Dockerfile', { cwd: CWD }).kind, 'file');
});

test('toOpenable : les extensions de page sont insensibles à la casse', () => {
  assert.equal(toOpenable('/tmp/PAGE.HTML', { cwd: CWD }).kind, 'file');
});

test('extractOpenables : ignore les options, dédoublonne, garde l’ordre', () => {
  const argv = [
    '/opt/orbit/orbit',
    '--inspect=5858',
    'https://exemple.com/a',
    '/tmp/page.html',
    'https://exemple.com/a',
    '.',
  ];
  const items = extractOpenables(argv, { cwd: CWD });
  assert.deepEqual(
    items.map((i) => i.url),
    ['https://exemple.com/a', pathToFileURL('/tmp/page.html').href]
  );
});

test('extractOpenables : `ignore` écarte une URL (serveur de dev)', () => {
  const argv = ['http://localhost:5173/', 'https://exemple.com/'];
  const items = extractOpenables(argv, { cwd: CWD, ignore: ['http://localhost:5173/'] });
  assert.deepEqual(
    items.map((i) => i.url),
    ['https://exemple.com/']
  );
});

test('extractOpenables : liste vide ou absente → aucun lien', () => {
  assert.deepEqual(extractOpenables([], { cwd: CWD }), []);
  assert.deepEqual(extractOpenables(undefined, { cwd: CWD }), []);
});
