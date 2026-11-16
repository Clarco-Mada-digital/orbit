import test from 'node:test';
import assert from 'node:assert/strict';
import { pageMenuScript, serializeMenuTemplate } from '../electron/page-menu.js';

test('serializeMenuTemplate : entrées, séparateurs et sous-menus', () => {
  const openLink = { label: 'Ouvrir le lien', click() {} };
  const visible = { label: 'Zone visible', click() {} };
  const full = { label: 'Page entière', click() {} };
  const template = [
    openLink,
    { type: 'separator' },
    { type: 'separator' },
    { label: 'Désactivé', enabled: false, click() {} },
    { label: "Capture d'écran", submenu: [visible, { type: 'separator' }, full] },
    { type: 'separator' },
  ];

  const { model, byId } = serializeMenuTemplate(template);

  assert.deepEqual(
    model.map((entry) => (entry.sep ? 'sep' : entry.label)),
    ['Ouvrir le lien', 'sep', 'Désactivé', "Capture d'écran"]
  );
  // Un seul séparateur entre deux entrées, aucun en tête ni en queue.
  assert.equal(model.filter((entry) => entry.sep).length, 1);
  assert.equal(model[2].disabled, true);
  // Sous-menu aplati en liste : les identifiants restent uniques et retrouvent
  // l'entrée d'origine (c'est elle qui porte le `click`).
  const submenu = model[3].submenu;
  assert.deepEqual(
    submenu.map((entry) => (entry.sep ? 'sep' : entry.label)),
    ['Zone visible', 'sep', 'Page entière']
  );
  assert.equal(byId.get(model[0].id), openLink);
  assert.equal(byId.get(submenu[0].id), visible);
  assert.equal(byId.get(submenu[2].id), full);
  assert.equal(new Set([...byId.keys()]).size, 5);
});

test('serializeMenuTemplate : rien à afficher', () => {
  assert.deepEqual(serializeMenuTemplate([]).model, []);
  assert.deepEqual(serializeMenuTemplate([{ type: 'separator' }]).model, []);
  assert.deepEqual(serializeMenuTemplate(null).model, []);
});

test('serializeMenuTemplate : la rangée d’icônes remplace les entrées de navigation', () => {
  const back = { label: 'Précédent', enabled: false, click() {} };
  const forward = { label: 'Suivant', click() {} };
  const reload = { label: 'Recharger', click() {} };
  const copyUrl = { label: "Copier l'adresse de la page", click() {} };
  const external = { label: 'Ouvrir la page dans le navigateur', click() {} };
  const visible = { label: 'Zone visible', click() {} };
  const full = { label: 'Page entière', click() {} };
  const template = [
    back,
    forward,
    reload,
    external,
    copyUrl,
    { type: 'separator' },
    { label: "Capture d'écran", submenu: [visible, full] },
    { label: 'Inspecter', click() {} },
  ];

  const { model, byId, bar } = serializeMenuTemplate(template);

  // Précédent/Suivant/Recharger/ouvrir/copier vivent dans la rangée d'icônes :
  // ils ne sont plus des lignes de texte (pas de doublon), et le séparateur
  // qui les suivait se retrouve en tête — il est donc retiré.
  assert.deepEqual(
    model.map((entry) => (entry.sep ? 'sep' : entry.label)),
    ["Capture d'écran", 'Inspecter']
  );
  assert.deepEqual(
    bar.map((entry) => entry.icon),
    ['back', 'forward', 'reload', 'external', 'link', 'camera']
  );
  // Le bouton appareil photo capture la zone visible : il emprunte l'entrée du
  // sous-menu, qui porte déjà l'action.
  assert.equal(bar[5].id, model[0].submenu[0].id);
  assert.equal(byId.get(bar[5].id), visible);
  // Un bouton garde l'état désactivé de l'entrée d'origine.
  assert.equal(bar[0].enabled, false);
  // « Capture d'écran » reste en texte : elle propose les autres modes.
  assert.ok(!bar.some((entry) => entry.id === model[0].id));
});

test('serializeMenuTemplate : une icône par entrée, la plus précise gagne', () => {
  const { model } = serializeMenuTemplate([
    { label: 'Copier', click() {} },
    { label: "Copier l'adresse du lien", click() {} },
    { label: 'Traduire la sélection (→ fr)', click() {} },
    { label: 'Libellé inconnu', click() {} },
  ]);

  assert.deepEqual(
    model.map((entry) => entry.icon),
    ['copy', 'link', 'languages', '']
  );
});

test('pageMenuScript : le libellé ne peut pas casser le script injecté', () => {
  const label = 'L\'apostrophe "citée" et le `backtick`\n-- </script> ${x}';
  const { model, bar } = serializeMenuTemplate([{ label, click() {} }]);
  const script = pageMenuScript({ model, bar }, { x: 12.4, y: 30 });

  // Le texte reste une donnée (JSON), jamais du code : le script se compile et
  // le libellé y figure tel quel, échappé.
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes(JSON.stringify(label)));
  assert.ok(script.includes(`"model":${JSON.stringify(model)}`));
  assert.ok(script.includes(`"bar":${JSON.stringify(bar)}`));
  assert.ok(script.includes('"x":12'));
});

test('pageMenuScript : coordonnées assainies', () => {
  const { model } = serializeMenuTemplate([{ label: 'Test', click() {} }]);
  const script = pageMenuScript({ model }, { x: -40, y: Number.NaN });
  assert.ok(script.includes('"x":0'));
  assert.ok(script.includes('"y":0'));
});
