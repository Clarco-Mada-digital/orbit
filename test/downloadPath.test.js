import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  downloadTargetDir,
  safeFileName,
  savePlan,
  uniqueDownloadPath,
} from '../src/lib/downloadPath.js';

// Où enregistrer un téléchargement. La règle de fond : un réglage ne doit
// JAMAIS empêcher d'enregistrer — si l'utilisateur n'a rien choisi, on se
// replie sur le dossier Téléchargements du système.

test('downloadTargetDir : le dossier réglé l’emporte sur le dossier système', () => {
  assert.equal(downloadTargetDir('/home/lea/Telech/Orbit', '/home/lea/Téléchargements'), '/home/lea/Telech/Orbit');
});

test('downloadTargetDir : rien de réglé → dossier Téléchargements du système', () => {
  const systeme = '/home/lea/Téléchargements';
  for (const vide of ['', '   ', null, undefined]) {
    assert.equal(downloadTargetDir(vide, systeme), systeme, `${JSON.stringify(vide)} doit se replier`);
  }
});

test('safeFileName : un nom ne peut jamais être un chemin', () => {
  // Le nom vient du SERVEUR : il peut tout contenir.
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('..\\..\\windows\\system32\\x.exe'), 'x.exe');
  assert.equal(safeFileName('dossier/sous-dossier/photo.png'), 'photo.png');
  assert.equal(safeFileName('rapport.pdf'), 'rapport.pdf');
  // Caractères de contrôle : un nom à saut de ligne casserait l'affichage.
  assert.equal(safeFileName('a\nb\tc'), 'a b c');
});

test('safeFileName : un nom vide ou réduit à des points devient « fichier »', () => {
  for (const vide of ['', '   ', '.', '..', '...']) {
    assert.equal(safeFileName(vide), 'fichier', `${JSON.stringify(vide)} doit être remplacé`);
  }
});

test('uniqueDownloadPath : le premier nom libre est retenu', () => {
  assert.equal(uniqueDownloadPath('/dl', 'rapport.pdf', () => false), '/dl/rapport.pdf');
});

test('uniqueDownloadPath : un nom déjà pris reçoit un numéro', () => {
  const pris = new Set(['/dl/rapport.pdf', '/dl/rapport (1).pdf', '/dl/rapport (2).pdf']);
  assert.equal(uniqueDownloadPath('/dl', 'rapport.pdf', (p) => pris.has(p)), '/dl/rapport (3).pdf');
});

test('uniqueDownloadPath : un fichier SANS extension est numéroté correctement', () => {
  const pris = new Set(['/dl/README']);
  assert.equal(uniqueDownloadPath('/dl', 'README', (p) => pris.has(p)), '/dl/README (1)');
});

test('uniqueDownloadPath : un dossier avec barre oblique finale n’en double pas', () => {
  // « /dl/ » + « rapport.pdf » ne doit pas devenir « /dl//rapport.pdf ».
  assert.equal(uniqueDownloadPath('/dl/', 'rapport.pdf', () => false), '/dl/rapport.pdf');
});

test('savePlan : enregistrement direct dans le dossier réglé', () => {
  const plan = savePlan({
    configuredDir: '/data/telechargements',
    systemDir: '/home/lea/Téléchargements',
    filename: 'note.md',
    ask: false,
    exists: () => false,
  });
  assert.equal(plan.mustAsk, false);
  assert.equal(plan.dir, '/data/telechargements');
  assert.equal(plan.savePath, '/data/telechargements/note.md');
  assert.equal(plan.filename, 'note.md');
});

test('savePlan : « demander à chaque fois » ouvre la boîte, sur le dossier réglé', () => {
  const plan = savePlan({
    configuredDir: '/data/telechargements',
    systemDir: '/home/lea/Téléchargements',
    filename: 'note.md',
    ask: true,
    exists: () => false,
  });
  assert.equal(plan.mustAsk, true);
  // C'est bien le dossier de l'utilisateur qui est proposé, pas celui du
  // système : poser la question toujours au même endroit la rend inutile.
  assert.equal(plan.defaultPath, '/data/telechargements/note.md');
});

test('savePlan : « demander » sans dossier réglé propose le dossier système', () => {
  const plan = savePlan({
    configuredDir: '',
    systemDir: '/home/lea/Téléchargements',
    filename: 'note.md',
    ask: true,
    exists: () => false,
  });
  assert.equal(plan.mustAsk, true);
  assert.equal(plan.defaultPath, '/home/lea/Téléchargements/note.md');
});

test('savePlan : un nom de serveur hostile reste dans le dossier choisi', () => {
  const plan = savePlan({
    configuredDir: '/data/telechargements',
    systemDir: '/home/lea/Téléchargements',
    filename: '../../../etc/cron.d/malin',
    ask: false,
    exists: () => false,
  });
  assert.equal(plan.savePath, '/data/telechargements/malin');
});

test('savePlan : rien de réglé, rien qui encombre → dossier système, nom intact', () => {
  const plan = savePlan({
    configuredDir: '',
    systemDir: '/home/lea/Téléchargements',
    filename: 'photo.png',
    ask: false,
    exists: () => false,
  });
  assert.equal(plan.savePath, '/home/lea/Téléchargements/photo.png');
  assert.equal(plan.mustAsk, false);
});
