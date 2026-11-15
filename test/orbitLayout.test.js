// ---------------------------------------------------------------------------
// Disposition en orbite (src/lib/orbitLayout.js).
//
// De la trigonométrie, donc exactement le genre de code qu'on relit sans voir
// l'erreur : un signe inversé met les apps en miroir, un quart de tour oublié
// les fait commencer à droite au lieu du haut. Ces tests comparent des
// coordonnées, ce que l'œil ne sait pas faire sur du JSX.
// ---------------------------------------------------------------------------
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ORBITED,
  PER_RING,
  orbitLayout,
  orbitPosition,
  overflowApps,
  wantsOrbit,
} from '../src/lib/orbitLayout.js';

const near = (actual, expected, label, tolerance = 0.001) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label} : ${actual} au lieu de ${expected}`
  );

const apps = (n) => Array.from({ length: n }, (_, i) => ({ id: `app-${i}`, name: `App ${i}` }));

// --- Placement sur le cercle ---------------------------------------------

test('orbitPosition : le premier élément est en HAUT, pas à droite', () => {
  // Sans le décalage de -90°, le premier partirait à trois heures : c'est
  // l'erreur classique, et elle est invisible tant qu'on n'a qu'une app.
  const first = orbitPosition(0, 4, 40);
  near(first.left, 50, 'x du premier (doit être centré)');
  near(first.top, 10, 'y du premier (doit être en haut)');
});

test('orbitPosition : la rotation va dans le SENS DES AIGUILLES', () => {
  // Quatre éléments : haut, droite, bas, gauche — dans cet ordre.
  const [top, right, bottom, left] = [0, 1, 2, 3].map((i) => orbitPosition(i, 4, 40));
  near(top.left, 50, 'haut x');
  near(top.top, 10, 'haut y');
  near(right.left, 90, 'droite x');
  near(right.top, 50, 'droite y');
  near(bottom.left, 50, 'bas x');
  near(bottom.top, 90, 'bas y');
  near(left.left, 10, 'gauche x');
  near(left.top, 50, 'gauche y');
});

test('orbitPosition : tous les éléments sont à égale distance du centre', () => {
  // La propriété qui définit un cercle. Elle attrape n'importe quelle faute
  // de calcul, quel que soit le nombre d'éléments.
  for (const count of [1, 2, 3, 5, 7, 8, 12]) {
    for (let i = 0; i < count; i += 1) {
      const p = orbitPosition(i, count, 37);
      const distance = Math.hypot(p.left - 50, p.top - 50);
      near(distance, 37, `distance au centre (${i}/${count})`, 0.0001);
    }
  }
});

test('orbitPosition : les éléments sont RÉPARTIS, pas entassés', () => {
  const count = 6;
  const positions = [...Array(count)].map((_, i) => orbitPosition(i, count, 40));
  // Aucune paire ne doit occuper le même point
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const gap = Math.hypot(positions[i].left - positions[j].left, positions[i].top - positions[j].top);
      assert.ok(gap > 1, `les éléments ${i} et ${j} se superposent`);
    }
  }
});

test('orbitPosition : nombre nul ou absurde → null, pas une coordonnée NaN', () => {
  // Une coordonnée NaN ne lève pas : elle place l'app hors de l'écran, et on
  // cherche longtemps pourquoi la page est vide.
  assert.equal(orbitPosition(0, 0, 40), null);
  assert.equal(orbitPosition(0, -3, 40), null);
  assert.equal(orbitPosition(0, NaN, 40), null);
});

// --- Mise en orbite d'une liste ------------------------------------------

test('orbitLayout : une seule orbite tant que ça tient', () => {
  const placed = orbitLayout(apps(5));
  assert.equal(placed.length, 5);
  assert.ok(placed.every((p) => p.ring === 0), 'cinq apps doivent tenir sur un seul cercle');
});

test('orbitLayout : au-delà de huit apps, une seconde orbite plus large', () => {
  const placed = orbitLayout(apps(12), { innerRadius: 33, outerRadius: 46 });
  assert.equal(placed.length, 12);
  const inner = placed.filter((p) => p.ring === 0);
  const outer = placed.filter((p) => p.ring === 1);
  assert.equal(inner.length, PER_RING);
  assert.equal(outer.length, 4);
  // La seconde orbite doit être RÉELLEMENT plus loin, sinon les deux cercles
  // se mélangent
  const innerDistance = Math.hypot(inner[0].left - 50, inner[0].top - 50);
  const outerDistance = Math.hypot(outer[0].left - 50, outer[0].top - 50);
  assert.ok(outerDistance > innerDistance, 'la seconde orbite doit être plus large');
});

test('orbitLayout : les apps en trop ne sont pas placées', () => {
  const many = apps(30);
  assert.equal(orbitLayout(many).length, MAX_ORBITED);
  assert.equal(overflowApps(many).length, 30 - MAX_ORBITED);
  // Et rien n'est perdu : placées + débordement = tout
  assert.equal(orbitLayout(many).length + overflowApps(many).length, 30);
});

test('orbitLayout : les apps gardent leur ordre et leur identité', () => {
  const placed = orbitLayout(apps(6));
  assert.deepEqual(
    placed.map((p) => p.app.id),
    ['app-0', 'app-1', 'app-2', 'app-3', 'app-4', 'app-5']
  );
});

test('orbitLayout : l’apparition suit le sens de rotation', () => {
  const placed = orbitLayout(apps(10));
  const delays = placed.map((p) => p.delay);
  // Strictement croissants : deux apps qui apparaissent ensemble cassent
  // l'effet de mise en marche
  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i] > delays[i - 1], `délai non croissant en position ${i}`);
  }
  assert.equal(delays[0], 0, 'la première app ne doit pas attendre');
});

test('orbitLayout : liste vide ou absente → rien, sans exception', () => {
  assert.deepEqual(orbitLayout([]), []);
  assert.deepEqual(orbitLayout(null), []);
  assert.deepEqual(orbitLayout(undefined), []);
  assert.deepEqual(overflowApps(null), []);
});

test('orbitLayout : une seule app est placée en haut, pas au centre', () => {
  const [only] = orbitLayout(apps(1));
  near(only.top, 50 - 33, 'une app seule doit être sur l’orbite, pas au centre');
});

// --- Quel thème demande l'orbite ? ---------------------------------------

test('wantsOrbit : le thème Tech, et tout thème qui en reprend l’esprit', () => {
  assert.equal(wantsOrbit({ skin: 'tech' }), true);
  assert.equal(wantsOrbit({ skin: 'orbit' }), false);
  assert.equal(wantsOrbit({ skin: 'paper' }), false);
  // Un thème importé qui choisit la texture « grid » cherche le même esprit :
  // il obtient l'orbite sans avoir à connaître un jeton de plus.
  assert.equal(wantsOrbit({ skin: 'nord', traits: { texture: 'grid' } }), true);
  assert.equal(wantsOrbit({ skin: 'nord', traits: { texture: 'none' } }), false);
  // Entrées absentes : pas d'orbite, et pas d'exception
  assert.equal(wantsOrbit(null), false);
  assert.equal(wantsOrbit({}), false);
});

test('orbitLayout : l’orbite extérieure est décalée, pas alignée sur l’intérieure', () => {
  // Sans décalage, les deux anneaux commencent à midi et leurs éléments
  // s'alignent radialement : on voit des rayons au lieu d'un système, et la
  // première app extérieure se pose juste au-dessus de la première intérieure.
  // Défaut constaté à l'écran, invisible à la lecture du code.
  const placed = orbitLayout(apps(16));
  const inner = placed.filter((p) => p.ring === 0);
  const outer = placed.filter((p) => p.ring === 1);
  for (const o of outer) {
    for (const i of inner) {
      const sameDirection = Math.abs(Math.atan2(o.top - 50, o.left - 50) - Math.atan2(i.top - 50, i.left - 50));
      assert.ok(sameDirection > 0.05, 'un élément extérieur est aligné avec un intérieur');
    }
  }
});

test('orbitPosition : un décalage d’angle garde le cercle intact', () => {
  // Le décalage ne doit pas déformer l'orbite : même rayon, autre position.
  const p = orbitPosition(0, 5, 40, Math.PI / 5);
  near(Math.hypot(p.left - 50, p.top - 50), 40, 'rayon après décalage');
  assert.notEqual(Math.round(p.left), 50, 'le décalage doit déplacer l’élément');
});
