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

test('pageMenuScript : le libellé ne peut pas casser le script injecté', () => {
  const label = 'L\'apostrophe "citée" et le `backtick`\n-- </script> ${x}';
  const { model } = serializeMenuTemplate([{ label, click() {} }]);
  const script = pageMenuScript(model, { x: 12.4, y: 30 });

  // Le texte reste une donnée (JSON), jamais du code : le script se compile et
  // le libellé y figure tel quel, échappé.
  assert.doesNotThrow(() => new Function(script));
  assert.ok(script.includes(JSON.stringify(label)));
  assert.ok(script.includes(JSON.stringify({ model, x: 12, y: 30 })));
});

test('pageMenuScript : coordonnées assainies', () => {
  const { model } = serializeMenuTemplate([{ label: 'Test', click() {} }]);
  const script = pageMenuScript(model, { x: -40, y: Number.NaN });
  assert.ok(script.includes('"x":0'));
  assert.ok(script.includes('"y":0'));
});
