import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePassword, generatePassphrase } from '../electron/passgen.js';

test('generatePassword : longueur par défaut = 20', () => {
  assert.equal(generatePassword().password.length, 20);
});

test('generatePassword : longueur bornée [8, 128]', () => {
  assert.equal(generatePassword({ length: 3 }).password.length, 8);
  assert.equal(generatePassword({ length: 999 }).password.length, 128);
  assert.equal(generatePassword({ length: 32 }).password.length, 32);
});

test('generatePassword : jeu lisible par défaut (pas de l/1/I/O/0)', () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generatePassword({ length: 40 }).password;
    assert.ok(!/[l1IO0]/.test(p), `caractère ambigu dans « ${p} »`);
  }
});

test('generatePassword : au moins un chiffre garanti (groupe digits)', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.ok(/[0-9]/.test(generatePassword({ length: 8 }).password));
  }
});

test('generatePassword : symboles seulement si demandés', () => {
  const sym = /[!@#$%^&*()\-_=+[\]{};:,.?]/;
  // Sans l'option : jamais de symbole.
  for (let i = 0; i < 30; i += 1) {
    assert.ok(!sym.test(generatePassword({ length: 30 }).password));
  }
  // Avec l'option : au moins un garanti.
  for (let i = 0; i < 30; i += 1) {
    assert.ok(sym.test(generatePassword({ length: 30, symbols: true }).password));
  }
});

test('generatePassphrase : n mots (3..10) + un chiffre final', () => {
  const { password } = generatePassphrase(5);
  const parts = password.split('-');
  assert.equal(parts.length, 6); // 5 mots + 1 nombre
  assert.match(parts[5], /^\d+$/);
  assert.equal(generatePassphrase(1).password.split('-').length, 4); // borné à 3 mots
  assert.equal(generatePassphrase(50).password.split('-').length, 11); // borné à 10
});
