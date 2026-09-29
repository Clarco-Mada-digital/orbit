import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipes, categories } from '../src/lib/recipes.js';

// Le catalogue d'apps est un gros objet écrit à la main : chaque ajout est une
// occasion de glisser une clé dupliquée, une catégorie inexistante ou une URL
// mal collée. Rien de tout ça ne lève d'erreur — l'app apparaît juste cassée
// dans la boutique. Ces tests attrapent le problème à la PR.

const entries = Object.entries(recipes);

test('le catalogue n’est pas vide', () => {
  assert.ok(entries.length > 50, `seulement ${entries.length} recettes`);
});

test('la clé de l’objet correspond au champ id', () => {
  // App.jsx retrouve une recette par `app.recipeId` : un décalage ici casse
  // l'icône et l'URL « maison » de l'app installée.
  for (const [key, r] of entries) {
    assert.equal(r.id, key, `la recette « ${key} » déclare id « ${r.id} »`);
  }
});

test('champs obligatoires présents et non vides', () => {
  for (const [key, r] of entries) {
    for (const field of ['id', 'name', 'url', 'icon', 'color', 'category']) {
      assert.equal(typeof r[field], 'string', `${key}.${field} manquant ou non textuel`);
      assert.notEqual(r[field].trim(), '', `${key}.${field} est vide`);
    }
  }
});

test('toutes les URL sont en https et analysables', () => {
  for (const [key, r] of entries) {
    let u;
    assert.doesNotThrow(() => { u = new URL(r.url); }, `${key} : URL invalide « ${r.url} »`);
    assert.equal(u.protocol, 'https:', `${key} : ${r.url} n’est pas en https`);
    assert.equal(r.url.trim(), r.url, `${key} : espaces autour de l’URL`);
  }
});

test('les icônes de marque sont des URL https valides', () => {
  for (const [key, r] of entries) {
    if (!r.brandIcon) continue;
    let u;
    assert.doesNotThrow(() => { u = new URL(r.brandIcon); }, `${key} : brandIcon invalide`);
    assert.equal(u.protocol, 'https:', `${key} : brandIcon non https`);
  }
});

test('chaque recette pointe vers une catégorie existante', () => {
  for (const [key, r] of entries) {
    assert.ok(r.category in categories, `${key} : catégorie inconnue « ${r.category} »`);
  }
});

test('les couleurs sont des hex valides', () => {
  for (const [key, r] of entries) {
    assert.match(r.color, /^#[0-9a-fA-F]{6}$/, `${key} : couleur « ${r.color} »`);
  }
  for (const [key, c] of Object.entries(categories)) {
    assert.match(c.color, /^#[0-9a-fA-F]{6}$/, `catégorie ${key} : couleur « ${c.color} »`);
  }
});

test('pas de nom d’app en double', () => {
  const seen = new Map();
  for (const [key, r] of entries) {
    const norm = r.name.trim().toLowerCase();
    assert.ok(!seen.has(norm), `« ${r.name} » apparaît dans ${seen.get(norm)} et ${key}`);
    seen.set(norm, key);
  }
});

test('chaque catégorie a un nom, une icône et une couleur', () => {
  for (const [key, c] of Object.entries(categories)) {
    for (const field of ['name', 'icon', 'color']) {
      assert.equal(typeof c[field], 'string', `catégorie ${key} : ${field} manquant`);
      assert.notEqual(c[field].trim(), '', `catégorie ${key} : ${field} vide`);
    }
  }
});

test('aucune catégorie déclarée n’est inutilisée', () => {
  // Une catégorie vide affiche un onglet sans résultat dans la boutique.
  const used = new Set(entries.map(([, r]) => r.category));
  const orphans = Object.keys(categories).filter((c) => !used.has(c));
  assert.deepEqual(orphans, [], 'catégories sans aucune app');
});
