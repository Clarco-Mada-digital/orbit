import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// La préload tourne dans un webview sandboxé : `require` ne peut pas charger un
// module local, et le fichier entier ne peut pas être importé hors d'Electron.
// On extrait donc uniquement le bloc de détection — les helpers réellement
// exécutés dans les pages — pour vérifier qu'une recherche ou un select ne
// reçoit jamais le 🔑 ni sa bulle.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'electron', 'credentials-preload.cjs'), 'utf8');
const START = source.indexOf('// --- début helpers de détection');
const END = source.indexOf('// --- fin helpers de détection');
assert.ok(START >= 0 && END > START, 'les marqueurs des helpers doivent exister');

const block = source.slice(START, END);
const helpers = vm.runInNewContext(
  `${block}\n;({ fieldText, isSearchField, isLoginUserField, isLoginInput, authScope });`
);

const { fieldText, isSearchField, isLoginUserField, isLoginInput, authScope } = helpers;

function makeForm() {
  const form = {
    tagName: 'FORM',
    contains: (el) => el.form === form,
  };
  return form;
}

function makeField({
  tagName = 'input',
  type = 'text',
  name = '',
  id = '',
  placeholder = '',
  ariaLabel = '',
  title = '',
  autocomplete = '',
  role = '',
  enterkeyhint = '',
  form = null,
  dialog = null,
  searchRoot = null,
  disabled = false,
  readOnly = false,
} = {}) {
  const attrs = {
    type,
    placeholder,
    'aria-label': ariaLabel,
    title,
    autocomplete,
    role,
    enterkeyhint,
  };
  return {
    tagName: tagName.toUpperCase(),
    type,
    name,
    id,
    autocomplete,
    form,
    disabled,
    readOnly,
    getAttribute: (key) => attrs[key] ?? null,
    closest(selector) {
      if (searchRoot && selector.includes('[role="search"]')) return searchRoot;
      if (form && selector.includes('form')) return form;
      if (dialog && selector.includes('dialog')) return dialog;
      return null;
    },
    matches: (selector) => selector === 'input' && tagName.toLowerCase() === 'input',
  };
}

test('fieldText rassemble les libellés utiles sans le type HTML', () => {
  const el = makeField({ name: 'login', id: 'user', placeholder: 'E-mail' });
  const text = fieldText(el);
  assert.match(text, /login/);
  assert.match(text, /E-mail/);
});

test('une recherche est reconnue au type, au rôle, au conteneur ou au libellé', () => {
  assert.equal(isSearchField(makeField({ type: 'search' })), true);
  assert.equal(isSearchField(makeField({ role: 'searchbox' })), true);
  assert.equal(isSearchField(makeField({ enterkeyhint: 'search' })), true);
  assert.equal(isSearchField(makeField({ placeholder: 'Rechercher un compte' })), true);
  assert.equal(isSearchField(makeField({ name: 'q' })), true);
  assert.equal(isSearchField(makeField({ searchRoot: { tagName: 'DIV' } })), true);
});

test('un vrai champ de connexion n’est pas pris pour une recherche', () => {
  assert.equal(isSearchField(makeField({ type: 'password', id: 'password' })), false);
  assert.equal(isSearchField(makeField({ placeholder: 'Nom d’utilisateur' })), false);
  assert.equal(isSearchField(makeField({ tagName: 'select', name: 'category' })), false);
});

test('un select ne peut jamais porter un identifiant', () => {
  const select = makeField({ tagName: 'select', placeholder: 'Rechercher' });
  assert.equal(isLoginUserField(select, null), false);
});

test('username, e-mail et téléphone explicites sont des identifiants', () => {
  assert.equal(isLoginUserField(makeField({ autocomplete: 'username' }), null), true);
  assert.equal(isLoginUserField(makeField({ type: 'email', placeholder: 'E-mail' }), null), true);
  assert.equal(isLoginUserField(makeField({ type: 'tel', name: 'login-phone' }), null), true);
});

test('les libellés français de connexion sont reconnus', () => {
  assert.equal(isLoginUserField(makeField({ placeholder: 'Identifiant' }), null), true);
  assert.equal(isLoginUserField(makeField({ placeholder: 'Nom d’utilisateur' }), null), true);
  assert.equal(isLoginUserField(makeField({ placeholder: 'Adresse courriel' }), null), true);
});

test('une recherche avec un libellé trompeur reste exclue', () => {
  const search = makeField({ type: 'search', placeholder: 'Search by email' });
  assert.equal(isLoginUserField(search, null), false);
});

test('les champs de nouveau mot de passe et de code 2FA ne sont pas des identifiants', () => {
  assert.equal(isLoginUserField(makeField({ autocomplete: 'new-password' }), null), false);
  assert.equal(isLoginUserField(makeField({ autocomplete: 'one-time-code' }), null), false);
});

test('un identifiant sans libellé est accepté dans le formulaire du mot de passe', () => {
  const form = makeForm();
  const pass = makeField({ type: 'password', form });
  const user = makeField({ name: 'champ1', form });
  assert.equal(authScope(pass), form);
  assert.equal(isLoginUserField(user, pass), true);
});

test('un champ d’un autre formulaire ne devient pas identifiant', () => {
  const loginForm = makeForm();
  const searchForm = makeForm();
  const pass = makeField({ type: 'password', form: loginForm });
  const searchLike = makeField({ name: 'champ2', form: searchForm });
  assert.equal(isLoginUserField(searchLike, pass), false);
});

test('isLoginInput accepte le mot de passe mais refuse une recherche', () => {
  assert.equal(isLoginInput(makeField({ type: 'password' }), null), true);
  assert.equal(isLoginInput(makeField({ type: 'search' }), null), false);
  assert.equal(isLoginInput(makeField({ autocomplete: 'username' }), null), true);
});
