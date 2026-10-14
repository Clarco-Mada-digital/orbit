import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND,
  basenameOf,
  extensionOf,
  kindForPath,
  kindForUrl,
  isViewerKind,
  isNativeKind,
  isSupportedPath,
  languageLabel,
  OPENABLE_MIME_TYPES,
} from '../src/lib/fileTypes.js';

// La classification décide de CE QU'ON FAIT d'un fichier : le lire nous-mêmes
// (types texte), le confier au moteur (page/PDF/image) ou refuser. Se tromper
// ici, c'est soit une page blanche, soit un fichier ouvert par erreur.

test('basenameOf : nom seul, sans requête, fragment ni échappement', () => {
  assert.equal(basenameOf('/home/moi/notes.md'), 'notes.md');
  assert.equal(basenameOf('file:///home/moi/mes%20notes.md'), 'mes notes.md');
  assert.equal(basenameOf('https://x.test/a/b.json?raw=1'), 'b.json');
  assert.equal(basenameOf('https://x.test/a/b.json#L12'), 'b.json');
  assert.equal(basenameOf('C:\\Users\\moi\\readme.txt'), 'readme.txt');
  assert.equal(basenameOf(''), '');
});

test('extensionOf : minuscules, sans point, vide si absente', () => {
  assert.equal(extensionOf('/x/Notes.MD'), 'md');
  // Un nom qui COMMENCE par un point n'a pas d'extension (c'est un nom entier)
  assert.equal(extensionOf('/x/.gitignore'), '');
  assert.equal(extensionOf('/x/README'), '');
  assert.equal(extensionOf('/x/archive.tar.gz'), 'gz');
});

test('kindForPath : chaque famille part dans le bon chemin de rendu', () => {
  // Types qu'Orbit met en forme lui-même
  assert.equal(kindForPath('/x/readme.md'), KIND.markdown);
  assert.equal(kindForPath('/x/doc.markdown'), KIND.markdown);
  assert.equal(kindForPath('/x/data.json'), KIND.json);
  assert.equal(kindForPath('/x/table.csv'), KIND.csv);
  assert.equal(kindForPath('/x/table.tsv'), KIND.csv);
  assert.equal(kindForPath('/x/app.ts'), KIND.code);
  assert.equal(kindForPath('/x/notes.txt'), KIND.text);
  assert.equal(kindForPath('/x/server.log'), KIND.text);
  // Types affichés nativement par le moteur
  assert.equal(kindForPath('/x/page.html'), KIND.page);
  assert.equal(kindForPath('/x/doc.pdf'), KIND.pdf);
  assert.equal(kindForPath('/x/photo.JPG'), KIND.image);
  assert.equal(kindForPath('/x/clip.mp4'), KIND.media);
  // Ni l'un ni l'autre : on ne devine pas
  assert.equal(kindForPath('/x/rapport.docx'), KIND.unknown);
  assert.equal(kindForPath('/x/archive.zip'), KIND.unknown);
});

test('kindForPath : les fichiers sans extension connus sont du texte', () => {
  assert.equal(kindForPath('/projet/README'), KIND.text);
  assert.equal(kindForPath('/x/LICENSE'), KIND.text);
  assert.equal(kindForPath('/x/Makefile'), KIND.text);
  assert.equal(kindForPath('/x/Dockerfile'), KIND.text);
  assert.equal(kindForPath('/x/.gitignore'), KIND.text);
});

test('kindForPath : une URL garde sa nature malgré requête et fragment', () => {
  assert.equal(kindForPath('https://x.test/api/doc.md?raw=1'), KIND.markdown);
  assert.equal(kindForPath('https://x.test/d.json#L3'), KIND.json);
});

test('kindForUrl : une adresse web reste une page, sauf document identifiable', () => {
  // Sans extension : page (cas de la quasi-totalité des liens)
  assert.equal(kindForUrl('https://x.test/article'), KIND.page);
  assert.equal(kindForUrl('https://x.test/'), KIND.page);
  // Extension de script serveur : le serveur produit du HTML → page
  assert.equal(kindForUrl('https://x.test/index.php'), KIND.page);
  assert.equal(kindForUrl('https://x.test/app.aspx'), KIND.page);
  // Document texte : lu et mis en forme par Orbit
  assert.equal(kindForUrl('https://x.test/readme.md'), KIND.markdown);
  assert.equal(kindForUrl('https://x.test/data.csv'), KIND.csv);
  assert.equal(kindForUrl('https://x.test/api.json'), KIND.json);
  // Téléchargement : on ne monte pas une page volante blanche
  assert.equal(kindForUrl('https://x.test/rapport.docx'), KIND.unknown);
  assert.equal(kindForUrl('https://x.test/pack.zip'), KIND.unknown);
  // Un chemin local n'est pas une URL : la règle « pas d'extension = page » ne
  // s'applique pas (on ne devine pas le contenu d'un fichier local)
  assert.equal(kindForUrl('/x/article'), KIND.unknown);
});

test('isViewerKind / isNativeKind : les deux ensembles sont disjoints', () => {
  for (const kind of Object.values(KIND)) {
    if (kind === KIND.unknown) continue;
    assert.equal(
      isViewerKind(kind) && isNativeKind(kind),
      false,
      `${kind} ne peut pas être à la fois lu par Orbit et rendu par le moteur`
    );
  }
  assert.equal(isViewerKind(KIND.markdown), true);
  assert.equal(isNativeKind(KIND.pdf), true);
  assert.equal(isViewerKind(KIND.pdf), false);
  assert.equal(isNativeKind(KIND.unknown), false);
});

test('isSupportedPath : ce qu’on accepte d’ouvrir depuis le système', () => {
  for (const ok of ['a.md', 'a.txt', 'a.json', 'a.csv', 'a.pdf', 'a.png', 'a.html', 'README']) {
    assert.equal(isSupportedPath(`/x/${ok}`), true, `${ok} devrait être ouvrable`);
  }
  for (const no of ['a.docx', 'a.zip', 'a.exe', 'a.dmg', 'a.bin']) {
    assert.equal(isSupportedPath(`/x/${no}`), false, `${no} ne devrait pas être ouvrable`);
  }
});

test('languageLabel : étiquette lisible, repli sur l’extension', () => {
  assert.equal(languageLabel('/x/app.ts'), 'TypeScript');
  assert.equal(languageLabel('/x/notes.md'), 'Markdown');
  assert.equal(languageLabel('/x/weird.zzz'), 'ZZZ');
  assert.equal(languageLabel('/x/README'), '');
});

test('OPENABLE_MIME_TYPES : déclare bien le texte et le PDF', () => {
  assert.ok(OPENABLE_MIME_TYPES.includes('text/markdown'));
  assert.ok(OPENABLE_MIME_TYPES.includes('text/plain'));
  assert.ok(OPENABLE_MIME_TYPES.includes('application/json'));
});
