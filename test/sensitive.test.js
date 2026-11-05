import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SENSITIVE_PATTERNS,
  findSensitiveMatches,
  looksLikeCardNumber,
  looksLikeIban,
  looksLikePhone,
  scaleSensitiveRects,
  sensitiveMatchIsValid,
} from '../src/lib/sensitive.js';

test('les motifs survivent à la sérialisation (ils partent dans la page)', () => {
  // Le processus principal injecte ces motifs dans un script : ils doivent
  // être des CHAÎNES, et chacune doit compiler.
  const roundTrip = JSON.parse(JSON.stringify(SENSITIVE_PATTERNS));
  assert.deepEqual(roundTrip, SENSITIVE_PATTERNS);
  for (const pattern of roundTrip) {
    assert.equal(typeof pattern.source, 'string');
    assert.doesNotThrow(() => new RegExp(pattern.source, pattern.flags));
  }
});

test('looksLikeCardNumber : la clé de Luhn distingue une carte d\'un numéro de commande', () => {
  assert.equal(looksLikeCardNumber('4242 4242 4242 4242'), true);
  assert.equal(looksLikeCardNumber('4242-4242-4242-4242'), true);
  // Un chiffre changé casse la clé.
  assert.equal(looksLikeCardNumber('4242 4242 4242 4243'), false);
  assert.equal(looksLikeCardNumber('1234567890123'), false);
  assert.equal(looksLikeCardNumber('42'), false);
  assert.equal(looksLikeCardNumber('0000000000000000'), false, 'que des zéros : pas une carte');
});

test('looksLikeIban : le modulo 97 écarte les références qui y ressemblent', () => {
  assert.equal(looksLikeIban('FR1420041010050500013M02606'), true);
  assert.equal(looksLikeIban('FR14 2004 1010 0505 0001 3M02 606'), true);
  assert.equal(looksLikeIban('GB82WEST12345698765432'), true);
  assert.equal(looksLikeIban('FR1420041010050500013M02607'), false);
  assert.equal(looksLikeIban('AB1234'), false);
});

test('looksLikePhone : assez de chiffres, mais pas trop', () => {
  assert.equal(looksLikePhone('+33 6 12 34 56 78'), true);
  assert.equal(looksLikePhone('01 45 00 00 00'), true);
  // Une année ou un prix ne sont pas des numéros.
  assert.equal(looksLikePhone('2026'), false);
  assert.equal(looksLikePhone('1234'), false);
  assert.equal(looksLikePhone('1234567890123456789'), false);
});

test('findSensitiveMatches : repère e-mail, IBAN, carte et téléphone avec leur position', () => {
  const text = 'Écrire à contact@exemple.fr ou appeler le 01 45 00 00 00.';
  const found = findSensitiveMatches(text);
  const kinds = found.map((m) => m.kind);
  assert.ok(kinds.includes('email'));
  assert.ok(kinds.includes('phone'));
  // La position doit permettre de retrouver le texte exact.
  for (const match of found) {
    assert.equal(text.slice(match.start, match.end), match.value);
  }
});

test('findSensitiveMatches : pas de chevauchement, la plus longue gagne', () => {
  // Le numéro de carte contient des suites qui ressemblent à un téléphone :
  // une seule zone doit sortir, sinon on masquerait deux fois le même endroit.
  const found = findSensitiveMatches('Carte 4242 4242 4242 4242 enregistrée');
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'card');
  for (let i = 1; i < found.length; i += 1) {
    assert.ok(found[i].start >= found[i - 1].end);
  }
});

test('findSensitiveMatches : un texte ordinaire ne déclenche rien', () => {
  assert.deepEqual(findSensitiveMatches('Réunion le 12 mars à 14 h, salle 3'), []);
  assert.deepEqual(findSensitiveMatches('   '), []);
  assert.deepEqual(findSensitiveMatches(null), []);
});

test('sensitiveMatchIsValid : la validation dépend du type', () => {
  assert.equal(sensitiveMatchIsValid('card', '4242 4242 4242 4242'), true);
  assert.equal(sensitiveMatchIsValid('card', '1111 1111 1111 1111'), false);
  assert.equal(sensitiveMatchIsValid('email', 'a@b.fr'), true);
  assert.equal(sensitiveMatchIsValid('inconnu', 'quelque chose'), true);
  assert.equal(sensitiveMatchIsValid('inconnu', '  '), false);
});

test('scaleSensitiveRects : échelle MESURÉE, pas déduite du zoom', () => {
  // Page de 800 px CSS capturée en 1600 px : facteur 2.
  const rects = scaleSensitiveRects(
    [{ kind: 'email', x: 10, y: 20, width: 100, height: 14 }],
    800,
    1600
  );
  assert.deepEqual(rects, [{ kind: 'email', x: 20, y: 40, width: 200, height: 28 }]);

  // Zone minuscule : écartée (ce n'est pas du texte lisible, et ce serait le
  // signe d'une mesure fausse).
  assert.deepEqual(scaleSensitiveRects([{ x: 0, y: 0, width: 1, height: 1 }], 800, 800), []);

  // Dimensions manquantes : aucune zone plutôt qu'un masque mal placé — un
  // masque au mauvais endroit est pire que pas de masque.
  assert.deepEqual(scaleSensitiveRects([{ x: 1, y: 1, width: 50, height: 10 }], 0, 1600), []);
  assert.deepEqual(scaleSensitiveRects(null, 800, 1600), []);
});
