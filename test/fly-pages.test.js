import { test } from 'node:test';
import assert from 'node:assert/strict';

// `useStore` persiste via localStorage. zustand lit précisément
// `window.localStorage` — il n'y a pas de `window` sous Node, donc on pose un
// stub EN MÉMOIRE avant d'importer le store. Sans lui, zustand se rabat sur « pas
// de stockage » (le store marche, mais en criant un avertissement à chaque
// écriture) et on testerait un chemin différent de celui de l'application.
const memory = new Map();
const localStorageStub = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window = { localStorage: localStorageStub };
globalThis.localStorage = localStorageStub;

const { useStore } = await import('../src/stores/useStore.js');

const flyPage = (id) => useStore.getState().flyPages.find((p) => p.id === id);

// Les pages volantes sont des « liens libres » : une adresse de passage, ou —
// depuis l'intégration système — un document local ouvert via « Ouvrir avec ».
// Elles ne touchent à aucun compte et disparaissent à la fermeture.
//
// Chaque page porte sa NATURE (`kind`), qui décide de l'affichage : les formats
// texte passent par la visionneuse d'Orbit, les autres par le <webview>.

test('openFlyPage : un lien web garde son domaine comme nom', () => {
  const id = useStore.getState().openFlyPage('https://www.exemple.com/article');
  const page = flyPage(id);
  assert.equal(page.name, 'exemple.com');
  assert.equal(page.icon, '🌐');
  assert.equal(page.kind, 'page');
  assert.equal(page.filePath, null, 'une adresse web n’a pas de fichier local');
  assert.equal(page.scope, 'all');
  assert.equal(page.ephemeral, true);
  assert.equal(page.private, false);
});

test('openFlyPage : un fichier .html local devient une page volante', () => {
  const id = useStore.getState().openFlyPage('file:///home/lea/Documents/rapport%20final.html');
  const page = flyPage(id);
  assert.ok(page, 'la page doit être créée');
  assert.equal(page.url, 'file:///home/lea/Documents/rapport%20final.html');
  assert.equal(page.name, 'rapport final.html', 'nom du fichier, décodé');
  assert.equal(page.icon, '📄');
  assert.equal(page.kind, 'page');
  // Comme toute page volante : session jetable, visible dans tous les profils.
  assert.equal(page.ephemeral, true);
  assert.equal(page.scope, 'all');
});

test('openFlyPage : un document texte local part en VISIONNEUSE', () => {
  // C'est le cas qui affichait une page blanche : le moteur ne sait pas rendre
  // un markdown (et sur beaucoup de serveurs il en fait un téléchargement).
  const cases = [
    ['file:///tmp/README.md', 'markdown', '📝'],
    ['file:///tmp/data.json', 'json', '🧾'],
    ['file:///tmp/table.csv', 'csv', '📊'],
    ['file:///tmp/app.ts', 'code', '💻'],
    ['file:///tmp/notes.txt', 'text', '📄'],
  ];
  for (const [url, kind, icon] of cases) {
    const id = useStore.getState().openFlyPage(url, { filePath: '/chemin/reel.txt' });
    const page = flyPage(id);
    assert.equal(page.kind, kind, `nature attendue pour ${url}`);
    assert.equal(page.icon, icon);
    assert.equal(page.filePath, '/chemin/reel.txt', 'le chemin réel sert à la lecture');
    assert.equal(page.ephemeral, true);
  }
});

test('openFlyPage : un document texte distant n’a pas de chemin local', () => {
  const id = useStore.getState().openFlyPage('https://exemple.com/docs/guide.md');
  const page = flyPage(id);
  assert.equal(page.kind, 'markdown');
  assert.equal(page.name, 'guide.md');
  assert.equal(page.filePath, null);
});

test('openFlyPage : un PDF et une image restent confiés au moteur', () => {
  assert.equal(flyPage(useStore.getState().openFlyPage('file:///tmp/rapport.pdf')).kind, 'pdf');
  assert.equal(flyPage(useStore.getState().openFlyPage('file:///tmp/photo.png')).kind, 'image');
});

test('openFlyPage : réutilise la page déjà ouverte sur la même adresse', () => {
  const first = useStore.getState().openFlyPage('https://exemple.com/x');
  const again = useStore.getState().openFlyPage('https://exemple.com/x');
  assert.equal(again, first, 'pas de doublon');
});

test('openFlyPage : un lien reçu en page privée ne réutilise pas la normale', () => {
  const normal = useStore.getState().openFlyPage('https://prive.example/y');
  const priv = useStore.getState().openFlyPage('https://prive.example/y', { private: true });
  assert.notEqual(priv, normal, 'deux sessions distinctes');
  assert.equal(flyPage(priv).private, true);
});

test('openFlyPage : refuse ce qui donnerait une page blanche', () => {
  // Ni un binaire, ni une archive, ni un document bureautique : le moteur en
  // ferait un téléchargement silencieux, donc un cadre vide. Mieux vaut refuser
  // (le lien s'ouvre alors dans le navigateur du système).
  for (const bad of [
    'file:///etc/passwd',
    'file:///tmp/pack.zip',
    'file:///tmp/rapport.docx',
    'https://exemple.com/fichiers/setup.exe',
    'javascript:alert(1)',
    'mailto:a@b.c',
    '',
    null,
  ]) {
    assert.equal(useStore.getState().openFlyPage(bad), null, `${JSON.stringify(bad)} doit être refusé`);
  }
});

test('JAMAIS SILENCIEUX : un document refusé est confié au navigateur système', () => {
  // Le principe se vérifie ici de bout en bout : le store refuse d'ouvrir un
  // onglet (.docx → aucun rendu ici), MAIS il ne reste pas muet — il demande
  // au processus principal d'ouvrir le lien dans le navigateur, qui le
  // téléchargera. Sans ça, l'utilisateur croirait à un lien mort.
  const appels = [];
  globalThis.window.electronAPI = { openOutside: (u) => appels.push(u) };
  try {
    const docx = useStore.getState().openFlyPage('https://exemple.com/fichiers/rapport.docx');
    assert.equal(docx, null, 'aucun onglet n’est ouvert');
    assert.deepEqual(appels, ['https://exemple.com/fichiers/rapport.docx'], 'mais le navigateur est appelé UNE fois');

    // Un lien qu’Orbit sait afficher ne part PAS au navigateur (pas de double
    // ouverture, pas de fuite vers l’extérieur).
    useStore.getState().openFlyPage('https://exemple.com/docs/guide.md');
    useStore.getState().openFlyPage('https://exemple.com/');
    assert.equal(appels.length, 1, 'le navigateur n’est appelé que pour un refus');

    // Un schéma non web n’a aucun repli : on n’invente pas d’action.
    useStore.getState().openFlyPage('mailto:a@b.c');
    useStore.getState().openFlyPage('javascript:alert(1)');
    assert.equal(appels.length, 1, 'javascript: et mailto: ne déclenchent rien');
  } finally {
    delete globalThis.window.electronAPI;
  }
});

test('les pages volantes ne sont pas persistées (éphémères par construction)', () => {
  // Le store écrit bien dans le stockage fourni (c'est le chemin de
  // l'application), mais `partialize` en EXCLUT `flyPages` : un lien reçu de
  // l'extérieur ne doit pas survivre à la fermeture d'Orbit.
  useStore.getState().openFlyPage('https://ephemere.example/y');
  assert.ok(memory.has('orbit-storage'), 'le store doit écrire son état');
  const saved = JSON.parse(memory.get('orbit-storage'));
  assert.ok(!('flyPages' in saved.state), 'flyPages ne doit pas être persisté');
});
