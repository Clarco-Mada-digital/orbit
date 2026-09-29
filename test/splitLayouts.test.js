import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPLIT_LAYOUTS,
  parseTracks,
  areaLetter,
  layoutsFor,
  layoutFor,
  defaultLayoutId,
} from '../src/lib/splitLayouts.js';

// Les gabarits sont des données : une incohérence entre `areas`, `cols`/`rows`
// et `dividers` produit une grille cassée à l'écran, sans erreur JS. D'où ces
// vérifications structurelles.

test('parseTracks : lit les fractions, avec repli sur 1', () => {
  assert.deepEqual(parseTracks('1.3fr 1fr'), [1.3, 1]);
  assert.deepEqual(parseTracks('1fr 1fr 1fr'), [1, 1, 1]);
  assert.deepEqual(parseTracks('  1fr   2fr  '), [1, 2]);
  // Une piste non numérique (auto, min-content…) vaut 1
  assert.deepEqual(parseTracks('auto 1fr'), [1, 1]);
});

test('areaLetter : zones a…d dans l’ordre des panneaux', () => {
  assert.equal(areaLetter(0), 'a');
  assert.equal(areaLetter(3), 'd');
  assert.equal(areaLetter(4), undefined);
});

test('layoutsFor : ne renvoie que les gabarits du bon nombre de zones', () => {
  for (const count of [3, 4]) {
    const list = layoutsFor(count);
    assert.ok(list.length > 0, `aucun gabarit pour ${count} apps`);
    for (const l of list) {
      const used = new Set(l.areas.match(/[a-d]/g));
      assert.equal(used.size, count, `${l.id} n’expose pas ${count} zones`);
    }
  }
  // 2 apps = mode flex, pas de gabarit ; 5+ n'existe pas
  assert.deepEqual(layoutsFor(2), []);
  assert.deepEqual(layoutsFor(5), []);
  assert.deepEqual(layoutsFor(undefined), []);
});

test('chaque gabarit : la grille `areas` colle à `cols` et `rows`', () => {
  for (const [count, list] of Object.entries(SPLIT_LAYOUTS)) {
    for (const l of list) {
      const rows = l.areas.match(/"[^"]+"/g) || [];
      const nCols = parseTracks(l.cols).length;
      const nRows = parseTracks(l.rows).length;
      assert.equal(rows.length, nRows, `${count}/${l.id} : nb de lignes ≠ rows`);
      for (const r of rows) {
        const cells = r.replace(/"/g, '').trim().split(/\s+/);
        assert.equal(cells.length, nCols, `${count}/${l.id} : ligne ${r} ≠ cols`);
      }
    }
  }
});

test('chaque gabarit : les zones sont contiguës (rectangles valides)', () => {
  // grid-template-areas exige qu'une zone forme un rectangle plein : sinon le
  // navigateur invalide TOUT le template et la grille s'effondre.
  for (const [count, list] of Object.entries(SPLIT_LAYOUTS)) {
    for (const l of list) {
      const grid = (l.areas.match(/"[^"]+"/g) || []).map((r) =>
        r.replace(/"/g, '').trim().split(/\s+/)
      );
      const seen = new Map();
      grid.forEach((row, y) =>
        row.forEach((cell, x) => {
          const b = seen.get(cell) || { x0: x, x1: x, y0: y, y1: y };
          seen.set(cell, {
            x0: Math.min(b.x0, x), x1: Math.max(b.x1, x),
            y0: Math.min(b.y0, y), y1: Math.max(b.y1, y),
          });
        })
      );
      for (const [cell, b] of seen) {
        const area = (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
        const actual = grid.flat().filter((c) => c === cell).length;
        assert.equal(area, actual, `${count}/${l.id} : la zone « ${cell} » n’est pas un rectangle`);
      }
    }
  }
});

test('chaque gabarit : les séparateurs pointent vers une frontière réelle', () => {
  for (const [count, list] of Object.entries(SPLIT_LAYOUTS)) {
    for (const l of list) {
      assert.ok(l.dividers?.length, `${count}/${l.id} : aucun séparateur ajustable`);
      for (const d of l.dividers) {
        assert.ok(d.axis === 'col' || d.axis === 'row', `${count}/${l.id} : axe ${d.axis}`);
        const tracks = parseTracks(d.axis === 'col' ? l.cols : l.rows).length;
        // `at` est l'indice d'une frontière INTERNE : 1 ≤ at ≤ tracks-1
        assert.ok(d.at >= 1 && d.at <= tracks - 1, `${count}/${l.id} : séparateur at=${d.at} hors grille`);
      }
    }
  }
});

test('chaque gabarit : identifiants uniques par nombre d’apps', () => {
  for (const [count, list] of Object.entries(SPLIT_LAYOUTS)) {
    const ids = list.map((l) => l.id);
    assert.equal(new Set(ids).size, ids.length, `${count} : identifiants dupliqués`);
  }
});

test('layoutFor : replie sur le premier gabarit si l’id est inconnu', () => {
  assert.equal(layoutFor(3, 'master-left').id, 'master-left');
  assert.equal(layoutFor(3, 'nexistepas').id, layoutsFor(3)[0].id);
  // Un id de gabarit à 4 demandé pour 3 apps ne doit pas fuiter
  assert.equal(layoutFor(3, 'grid').id, layoutsFor(3)[0].id);
  assert.equal(layoutFor(2, 'grid'), null);
});

test('defaultLayoutId : défini pour 3 et 4, absent sinon', () => {
  assert.equal(defaultLayoutId(3), 'master-left');
  assert.equal(defaultLayoutId(4), 'grid');
  assert.equal(defaultLayoutId(2), undefined);
});
