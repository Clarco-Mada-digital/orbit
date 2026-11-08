// ---------------------------------------------------------------------------
// La disposition du bureau du Téléphone.
//
// C'est elle qui porte la promesse faite à deux publics opposés : un bureau nu
// pour qui veut la paix, tout sous la main pour qui veut tout. Ces tests
// verrouillent ce qui casserait l'un ou l'autre — un widget qui revient tout
// seul, une carte qu'on ne peut plus enlever, une taille qui n'existe pas.
// ---------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WIDGET_CATALOG,
  WIDGET_SIZES,
  addWidget,
  cycleWidgetSize,
  moveWidget,
  neededSources,
  normalizeDesktopLayout,
  presetLayout,
  removeWidget,
  widgetDefinition,
} from '../src/lib/phoneDesktop.js';

test('catalogue : chaque widget déclare des tailles qui existent', () => {
  for (const def of WIDGET_CATALOG) {
    assert.ok(def.type && def.label && def.hint, def.type);
    assert.ok(def.sizes.length, `${def.type} sans taille`);
    for (const size of def.sizes) {
      assert.ok(WIDGET_SIZES[size], `${def.type} : taille inconnue « ${size} »`);
    }
    // La taille par défaut doit faire partie des tailles permises, sinon le
    // premier clic sur « redimensionner » ferait un saut inexpliqué.
    assert.ok(def.sizes.includes(def.defaultSize), `${def.type} : défaut hors liste`);
  }
});

test('presetLayout : sobre reste sobre, complet couvre le catalogue', () => {
  const sobre = presetLayout('sobre');
  assert.deepEqual(sobre.map((w) => w.type), ['clock', 'favorites']);
  const complet = presetLayout('complet');
  // Tout ce qui ne demande pas d'application précise doit être proposé.
  const universels = WIDGET_CATALOG.filter((d) => !d.requiresPackage).map((d) => d.type);
  assert.deepEqual([...complet.map((w) => w.type)].sort(), [...universels].sort());
  // Identifiants uniques dans les deux cas.
  for (const layout of [sobre, complet]) {
    assert.equal(new Set(layout.map((w) => w.id)).size, layout.length);
  }
  // Un nom inconnu ne plante pas et ne remplit pas l'écran.
  assert.deepEqual(presetLayout('nawak').map((w) => w.type), ['clock', 'favorites']);
});

test('addWidget : pas de doublon, sauf pour les tuiles d’application', () => {
  let layout = [];
  layout = addWidget(layout, 'clock');
  layout = addWidget(layout, 'clock');
  assert.equal(layout.length, 1, 'deux horloges n’apprennent rien');

  // Une tuile porte une application : deux applications, deux tuiles.
  layout = addWidget(layout, 'apptile', { package: 'com.whatsapp' });
  layout = addWidget(layout, 'apptile', { package: 'com.whatsapp' });
  layout = addWidget(layout, 'apptile', { package: 'org.telegram' });
  assert.equal(layout.filter((w) => w.type === 'apptile').length, 2);

  // Une tuile SANS application n'a rien à afficher : refusée.
  assert.equal(addWidget(layout, 'apptile').length, layout.length);
  // Un type inconnu ne crée rien.
  assert.equal(addWidget(layout, 'nawak').length, layout.length);
  // Les identifiants restent uniques.
  assert.equal(new Set(layout.map((w) => w.id)).size, layout.length);
});

test('removeWidget : ce qu’on enlève ne revient pas', () => {
  const layout = presetLayout('complet');
  const sans = removeWidget(layout, layout[0].id);
  assert.equal(sans.length, layout.length - 1);
  assert.equal(sans.some((w) => w.id === layout[0].id), false);
  // Enlever une carte absente ne change rien (et ne lève pas).
  assert.equal(removeWidget(sans, 'fantome').length, sans.length);
  // On peut vider le bureau entièrement : c'est un cas normal, pas une erreur.
  let vide = layout;
  for (const widget of layout) vide = removeWidget(vide, widget.id);
  assert.deepEqual(vide, []);
});

test('cycleWidgetSize : fait le tour des tailles permises, et d’elles seules', () => {
  const def = widgetDefinition('storage');
  let layout = addWidget([], 'storage');
  const vues = [];
  for (let i = 0; i < def.sizes.length + 1; i += 1) {
    vues.push(layout[0].size);
    layout = cycleWidgetSize(layout, layout[0].id);
  }
  // Toutes les tailles permises sont passées, puis ça recommence.
  assert.deepEqual(vues.slice(0, def.sizes.length).sort(), [...def.sizes].sort());
  assert.equal(vues[def.sizes.length], vues[0]);
  // Un identifiant inconnu laisse la disposition intacte.
  assert.deepEqual(cycleWidgetSize(layout, 'fantome'), layout);
});

test('moveWidget : réordonne sans rien perdre', () => {
  const layout = presetLayout('complet');
  const premier = layout[0].id;
  const dernier = layout[layout.length - 1].id;
  const moved = moveWidget(layout, premier, dernier);
  assert.equal(moved.length, layout.length);
  assert.equal(moved[moved.length - 1].id, premier);
  // Même ensemble de cartes, autre ordre.
  assert.deepEqual([...moved.map((w) => w.id)].sort(), [...layout.map((w) => w.id)].sort());
  // Déplacements impossibles : inchangé.
  assert.deepEqual(moveWidget(layout, premier, premier), layout);
  assert.deepEqual(moveWidget(layout, 'fantome', dernier), layout);
});

test('normalizeDesktopLayout : une disposition venue des réglages est nettoyée', () => {
  const layout = normalizeDesktopLayout([
    { id: 'a', type: 'clock', size: 'wide' },        // taille non permise → défaut
    { id: 'a', type: 'storage', size: 'sm' },        // identifiant déjà pris
    { type: 'nawak' },                               // type inconnu
    { type: 'apptile' },                             // tuile sans application
    { type: 'apptile', package: 'com.whatsapp' },
  ]);
  assert.deepEqual(layout.map((w) => w.type), ['clock', 'storage', 'apptile']);
  assert.equal(layout[0].size, widgetDefinition('clock').defaultSize);
  assert.equal(new Set(layout.map((w) => w.id)).size, layout.length);
  assert.equal(layout[2].package, 'com.whatsapp');
  // Un bureau vide reste vide : c'est un choix, pas une absence de réglage.
  assert.deepEqual(normalizeDesktopLayout([]), []);
  assert.deepEqual(normalizeDesktopLayout(null), []);
  // Plafond : une disposition absurde ne fait pas rendre mille cartes.
  assert.equal(
    normalizeDesktopLayout(Array.from({ length: 80 }, () => ({ type: 'clock' }))).length <= 24,
    true
  );
});

test('normalizeDesktopLayout : l’ancienne forme en booléens est convertie', () => {
  const converti = normalizeDesktopLayout({ clock: true, calls: false, favorites: true });
  const types = converti.map((w) => w.type);
  assert.ok(types.includes('clock'));
  assert.ok(types.includes('favorites'));
  assert.equal(types.includes('calls'), false);
  // Les widgets qui n'existaient pas dans l'ancienne forme ne s'invitent pas :
  // ils demandent une lecture sur le téléphone que personne n'a demandée.
  for (const nouveau of ['screen', 'calendar', 'media', 'storage']) {
    assert.equal(types.includes(nouveau), false, nouveau);
  }
});

test('neededSources : on n’interroge le téléphone que pour ce qui s’affiche', () => {
  // Un bureau sobre ne déclenche AUCUNE lecture supplémentaire : c'est ce qui
  // le rend léger pour qui n'en veut pas.
  assert.deepEqual([...neededSources(presetLayout('sobre'))], []);

  const sources = neededSources(presetLayout('complet'));
  for (const source of ['screen', 'calendar', 'media', 'storage', 'calls']) {
    assert.ok(sources.has(source), source);
  }
  // Retirer la carte Agenda retire la lecture de l'agenda.
  const sansAgenda = presetLayout('complet').filter((w) => w.type !== 'calendar');
  assert.equal(neededSources(sansAgenda).has('calendar'), false);
  assert.deepEqual([...neededSources(null)], []);
});
