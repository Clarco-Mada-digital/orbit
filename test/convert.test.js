import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertUnits,
  convertBase,
  convertColor,
  convertTime,
  parseCurrencyQuery,
  convertCurrency,
} from '../src/lib/convert.js';

// Les convertisseurs de la palette Alt+K. Comme pour le calcul, chacun doit
// renvoyer `null` dès que l'entrée ne le concerne pas : ils sont essayés en
// cascade sur CHAQUE frappe, y compris sur du texte libre.

const EN = 'en-US'; // locale stable pour comparer les chaînes formatées

// --- Unités ---------------------------------------------------------------

test('convertUnits : longueurs, dans les deux sens', () => {
  const r = convertUnits('10 km en mi', EN);
  assert.equal(r.family, 'length');
  assert.ok(Math.abs(r.value - 6.2137119) < 1e-6);

  const back = convertUnits('1 mi to km', EN);
  assert.ok(Math.abs(back.value - 1.609344) < 1e-9);
});

test('convertUnits : accepte tous les séparateurs', () => {
  for (const sep of ['in', 'to', 'en', 'vers', '->', '=>', '>', '→']) {
    const r = convertUnits(`1000 m ${sep} km`, EN);
    assert.ok(r, `séparateur « ${sep} » non reconnu`);
    assert.equal(r.value, 1);
  }
});

test('convertUnits : températures (conversion affine, pas un simple facteur)', () => {
  assert.ok(Math.abs(convertUnits('72 f in c', EN).value - 22.2222222) < 1e-6);
  assert.equal(convertUnits('0 c en f', EN).value, 32);
  assert.equal(convertUnits('0 c en k', EN).value, 273.15);
  assert.equal(convertUnits('100 c en c', EN).value, 100);
  assert.equal(convertUnits('0 c en f', EN).family, 'température');
});

test('convertUnits : données, décimal vs binaire', () => {
  assert.equal(convertUnits('5 Go en Mo', EN).value, 5000);
  assert.equal(convertUnits('1 Gio en Mio', EN).value, 1024);
  assert.equal(convertUnits('1 o en bits', EN).value, 8);
});

test('convertUnits : masses, volumes, surfaces, vitesses, durées', () => {
  assert.ok(Math.abs(convertUnits('1 lb en g', EN).value - 453.59237) < 1e-6);
  assert.ok(Math.abs(convertUnits('1 gal en l', EN).value - 3.785411784) < 1e-9);
  assert.equal(convertUnits('1 ha en m2', EN).value, 10000);
  assert.ok(Math.abs(convertUnits('100 km/h en m/s', EN).value - 27.7777777) < 1e-6);
  assert.equal(convertUnits('2 h en min', EN).value, 120);
});

test('convertUnits : familles incompatibles ou unité inconnue → null', () => {
  assert.equal(convertUnits('10 km en kg', EN), null);
  assert.equal(convertUnits('10 foo en bar', EN), null);
  assert.equal(convertUnits('10 km en', EN), null);
  assert.equal(convertUnits('bonjour', EN), null);
  assert.equal(convertUnits('', EN), null);
});

test('convertUnits : valeurs négatives et décimale française', () => {
  assert.equal(convertUnits('-40 c en f', EN).value, -40); // le point de croisement
  assert.equal(convertUnits('1,5 km en m', EN).value, 1500);
});

test('convertUnits : l’unité de sortie est affichée proprement', () => {
  assert.match(convertUnits('1 m en cm', EN).text, /cm$/);
  // Les alias verbeux sont normalisés
  assert.match(convertUnits('1 m en pouces', EN).text, /in$/);
  // La casse tapée par l'utilisateur est conservée
  assert.match(convertUnits('1 Go en Mo', EN).text, /Mo$/);
});

// --- Bases numériques -----------------------------------------------------

test('convertBase : littéral seul → décimal + les autres bases', () => {
  const r = convertBase('0xff', EN);
  assert.equal(r.value, 255);
  assert.equal(r.text, '255');
  assert.match(r.detail, /0xFF/);
  assert.match(r.detail, /0b11111111/);
  assert.equal(convertBase('0b1010', EN).value, 10);
  assert.equal(convertBase('0o755', EN).value, 493);
});

test('convertBase : conversion explicite vers une base', () => {
  assert.equal(convertBase('255 in hex', EN).text, '0xFF');
  assert.equal(convertBase('255 en binaire', EN).text, '0b11111111');
  assert.equal(convertBase('0xff en decimal', EN).text, '255');
  assert.equal(convertBase('255 en octal', EN).text, '0o377');
});

test('convertBase : base cible inconnue ou entrée non numérique → null', () => {
  assert.equal(convertBase('255 en klingon', EN), null);
  assert.equal(convertBase('gmail', EN), null);
  assert.equal(convertBase('', EN), null);
});

// --- Couleurs -------------------------------------------------------------

test('convertColor : hex 6 et 3 chiffres, avec ou sans dièse', () => {
  const r = convertColor('#6366f1');
  assert.equal(r.hex, '#6366F1');
  assert.equal(r.rgb, 'rgb(99, 102, 241)');
  assert.equal(convertColor('6366f1').hex, '#6366F1');
  assert.equal(convertColor('#fff').hex, '#FFFFFF');
});

test('convertColor : rgb() et calcul HSL', () => {
  assert.equal(convertColor('rgb(99,102,241)').hex, '#6366F1');
  assert.equal(convertColor('#ff0000').hsl, 'hsl(0, 100%, 50%)');
  assert.equal(convertColor('#00ff00').hsl, 'hsl(120, 100%, 50%)');
  assert.equal(convertColor('#0000ff').hsl, 'hsl(240, 100%, 50%)');
  // Gris : teinte et saturation nulles (max === min)
  assert.equal(convertColor('#808080').hsl, 'hsl(0, 0%, 50%)');
});

test('convertColor : entrées invalides → null', () => {
  assert.equal(convertColor('#12345'), null); // ni 3 ni 6 chiffres
  assert.equal(convertColor('rgb(300,0,0)'), null); // hors bornes
  assert.equal(convertColor('gmail'), null);
  assert.equal(convertColor(''), null);
});

// --- Dates / horodatages --------------------------------------------------

const NOW = new Date('2026-09-29T10:00:00.000Z');

test('convertTime : horodatage Unix en secondes et millisecondes', () => {
  const sec = convertTime('1700000000', EN, NOW);
  assert.equal(sec.copy, '2023-11-14T22:13:20.000Z');
  const ms = convertTime('1700000000000', EN, NOW);
  assert.equal(ms.copy, '2023-11-14T22:13:20.000Z');
});

test('convertTime : calcul de date relatif', () => {
  assert.equal(convertTime('today + 30 jours', EN, NOW).copy, '2026-10-29');
  assert.equal(convertTime("aujourd'hui + 1 semaine", EN, NOW).copy, '2026-10-06');
  assert.equal(convertTime('today - 2 weeks', EN, NOW).copy, '2026-09-15');
  // Unité de durée inconnue → null
  assert.equal(convertTime('today + 3 bananes', EN, NOW), null);
});

test('convertTime : « now » donne l’instant courant', () => {
  const r = convertTime('now', EN, NOW);
  assert.equal(r.copy, String(Math.floor(NOW.getTime() / 1000)));
  assert.match(r.detail, /ISO 2026-09-29T10:00:00\.000Z/);
});

test('convertTime : texte libre → null', () => {
  assert.equal(convertTime('gmail', EN, NOW), null);
  assert.equal(convertTime('', EN, NOW), null);
  assert.equal(convertTime('42', EN, NOW), null); // trop court pour un timestamp
});

// --- Devises --------------------------------------------------------------

test('parseCurrencyQuery : reconnaît les paires connues', () => {
  assert.deepEqual(parseCurrencyQuery('100 usd en eur'), { amount: 100, from: 'usd', to: 'eur' });
  assert.deepEqual(parseCurrencyQuery('1,5 EUR to MGA'), { amount: 1.5, from: 'eur', to: 'mga' });
});

test('parseCurrencyQuery : devise inconnue, ou identique → null', () => {
  assert.equal(parseCurrencyQuery('100 zzz en eur'), null);
  assert.equal(parseCurrencyQuery('100 usd en usd'), null);
  assert.equal(parseCurrencyQuery('100 km en mi'), null); // c'est une unité, pas une devise
  assert.equal(parseCurrencyQuery('gmail'), null);
});

test('convertCurrency : passe par la base USD', () => {
  const rates = { USD: 1, EUR: 0.9, MGA: 4500 };
  const r = convertCurrency({ amount: 100, from: 'usd', to: 'eur' }, rates, EN);
  assert.ok(Math.abs(r.value - 90) < 1e-9);
  // Paire sans USD : 90 EUR → 90/0.9*4500
  const cross = convertCurrency({ amount: 90, from: 'eur', to: 'mga' }, rates, EN);
  assert.ok(Math.abs(cross.value - 450000) < 1e-6);
});

test('convertCurrency : taux absents ou incomplets → null (jamais NaN affiché)', () => {
  assert.equal(convertCurrency({ amount: 1, from: 'usd', to: 'eur' }, null, EN), null);
  assert.equal(convertCurrency(null, { USD: 1 }, EN), null);
  assert.equal(convertCurrency({ amount: 1, from: 'usd', to: 'xyz' }, { USD: 1 }, EN), null);
});
