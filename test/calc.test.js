import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, normalizeExpression, formatNumber } from '../src/lib/calc.js';

// Le moteur de calcul alimente la palette Alt+K. Deux exigences opposées :
// il doit calculer juste, et il doit refuser tout ce qui n'est PAS un calcul
// (sinon taper « gmail » ferait apparaître une carte « résultat »).

test('evaluate : arithmétique et priorité des opérateurs', () => {
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('10/4'), 2.5);
  assert.equal(evaluate('7 mod 3'), 1);
});

test('evaluate : puissance associative à droite', () => {
  // 2^(3^2) = 2^9 = 512, et NON (2^3)^2 = 64
  assert.equal(evaluate('2^3^2'), 512);
});

test('evaluate : moins unaire, y compris après un opérateur', () => {
  assert.equal(evaluate('-5+2'), -3);
  assert.equal(evaluate('3*-2'), -6);
  assert.equal(evaluate('2^-1'), 0.5);
  assert.equal(evaluate('-(4+1)'), -5);
});

test('evaluate : multiplication implicite', () => {
  assert.equal(evaluate('2(3+4)'), 14);
  assert.equal(evaluate('(1+1)(2+2)'), 8);
  // 2pi : la constante colle au nombre
  assert.ok(Math.abs(evaluate('2pi') - 2 * Math.PI) < 1e-12);
});

test('evaluate : fonctions à un et plusieurs arguments', () => {
  assert.equal(evaluate('sqrt(16)'), 4);
  assert.equal(evaluate('max(3;9;2)'), 9);
  assert.equal(evaluate('avg(12;18;21)'), 17);
  assert.equal(evaluate('sum(1;2;3;4)'), 10);
  assert.equal(evaluate('pow(2;10)'), 1024);
});

test('evaluate : factorielle, en postfixe comme en fonction', () => {
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('fact(5)'), 120);
  // Les factorielles non définies remontent null (NaN filtré), pas une exception
  assert.equal(evaluate('(-1)!'), null);
  assert.equal(evaluate('2.5!'), null);
});

test('evaluate : constantes', () => {
  assert.ok(Math.abs(evaluate('pi*2') - Math.PI * 2) < 1e-12);
  assert.ok(Math.abs(evaluate('e^1') - Math.E) < 1e-12);
});

test('evaluate : écriture française (virgule, milliers, ÷ ×)', () => {
  assert.equal(evaluate('3,5*2'), 7);
  assert.equal(evaluate('1 234 + 1'), 1235);
  assert.equal(evaluate('10 ÷ 4'), 2.5);
  assert.equal(evaluate('6 × 7'), 42);
  assert.equal(evaluate('10 − 4'), 6); // tiret demi-cadratin
});

test('evaluate : pourcentages', () => {
  assert.equal(evaluate('20% de 150'), 30);
  assert.equal(evaluate('20% of 150'), 30);
  assert.equal(evaluate('50% sur 80'), 40);
  // Augmentation / réduction relatives
  assert.equal(evaluate('200 + 10%'), 220);
  assert.equal(evaluate('200 - 10%'), 180);
  // Pourcentage isolé dans un calcul → simple fraction
  assert.equal(evaluate('20% * 150'), 30);
});

test('evaluate : ce qui n’est PAS un calcul renvoie null', () => {
  // Texte libre, noms d'apps, recherches : aucune carte « résultat »
  for (const notMath of ['gmail', 'slack', 'notion todo', 'bonjour le monde', '', '   ']) {
    assert.equal(evaluate(notMath), null, `« ${notMath} » ne doit pas être un calcul`);
  }
  // Un nombre seul n'est pas un calcul non plus
  assert.equal(evaluate('42'), null);
  // Mot inconnu mêlé à des chiffres
  assert.equal(evaluate('2 foobar 3'), null);
});

test('evaluate : expressions malformées → null, jamais d’exception', () => {
  for (const bad of ['(2+3', '2+3)', '2+', '*5', 'sqrt()', '((', ')(']) {
    assert.doesNotThrow(() => evaluate(bad), `« ${bad} » ne doit pas lever`);
    assert.equal(evaluate(bad), null, `« ${bad} » doit renvoyer null`);
  }
});

test('evaluate : divisions et résultats non finis → null', () => {
  // 1/0 = Infinity : pas NaN, donc remonté tel quel (le formateur l'affiche)
  assert.equal(evaluate('1/0'), Infinity);
  // 0/0 = NaN → filtré
  assert.equal(evaluate('0/0'), null);
  assert.equal(evaluate('sqrt(-1)'), null);
});

test('normalizeExpression : la virgule reste un séparateur dans un appel', () => {
  // Dans « max(3,9,2) » la virgule sépare les arguments, elle ne doit pas
  // devenir un point décimal.
  assert.equal(evaluate('max(3,9,2)'), 9);
  // Hors appel de fonction, c'est bien une décimale
  assert.equal(normalizeExpression('3,5'), '3.5');
});

test('formatNumber : lisible, sans artefact de virgule flottante', () => {
  assert.equal(formatNumber(0.1 + 0.2, 'fr-FR'), '0,3');
  assert.equal(formatNumber(1234567, 'en-US'), '1,234,567');
  assert.equal(formatNumber(2.5, 'en-US'), '2.5');
  // Au-delà de 1e15 : notation scientifique
  assert.match(formatNumber(1e20, 'en-US'), /e\+?20$/);
  // Valeurs non finies : affichées telles quelles plutôt que plantées
  assert.equal(formatNumber(Infinity), 'Infinity');
  assert.equal(formatNumber(NaN), 'NaN');
});
