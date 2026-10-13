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
// depuis l'intégration système — un fichier .html local ouvert via « Ouvrir
// avec ». Elles ne touchent à aucun compte et disparaissent à la fermeture.

test('openFlyPage : un lien web garde son domaine comme nom', () => {
  const id = useStore.getState().openFlyPage('https://www.exemple.com/article');
  const page = flyPage(id);
  assert.equal(page.name, 'exemple.com');
  assert.equal(page.icon, '🌐');
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
  // Comme toute page volante : session jetable, visible dans tous les profils.
  assert.equal(page.ephemeral, true);
  assert.equal(page.scope, 'all');
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

test('openFlyPage : refuse ce qui n’est pas une page ouvrable', () => {
  for (const bad of ['file:///etc/passwd', 'file:///tmp/rapport.pdf', 'javascript:alert(1)', 'mailto:a@b.c', '', null]) {
    assert.equal(useStore.getState().openFlyPage(bad), null, `${JSON.stringify(bad)} doit être refusé`);
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
