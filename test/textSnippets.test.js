import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const contentScript = readFileSync(
  new URL('../electron/extensions/text-snippets/content.js', import.meta.url),
  'utf8'
);

// Harnais : le content script tourne dans un faux document qui retient ses
// écouteurs. On peut alors « presser » une touche sur un champ donné.
function createSnippetRuntime({ allowPasswordFields = false, snippets = {}, trigger = ';' } = {}) {
  const listeners = new Map();
  const stored = { allowPasswordFields, snippets, trigger, enabled: true };

  class InputEventMock {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  class InputElement {
    constructor(value, { type = 'text', attrs = {} } = {}) {
      this.tagName = 'INPUT';
      this._value = value;
      this.type = type;
      this.attrs = attrs;
      this.selectionStart = value.length;
      this.selectionEnd = value.length;
      this.readOnly = false;
      this.disabled = false;
      this.style = {};
      this.events = [];
    }

    get value() {
      return this._value;
    }

    set value(value) {
      this._value = value;
    }

    getAttribute(name) {
      if (name === 'type') return this.type;
      return this.attrs[name] ?? null;
    }

    focus() {}

    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }

    dispatchEvent(event) {
      this.events.push(event);
    }
  }

  const document = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    body: { appendChild() {} },
    createElement() {
      return { style: {}, remove() {} };
    },
  };
  const chrome = {
    storage: {
      local: {
        get(_keys, callback) {
          callback(stored);
        },
      },
      onChanged: { addListener() {} },
    },
    runtime: { lastError: null },
  };

  runInNewContext(contentScript, {
    chrome,
    document,
    window: { getSelection: () => null },
    HTMLInputElement: InputElement,
    HTMLTextAreaElement: class TextAreaElement extends InputElement {},
    InputEvent: InputEventMock,
    Event: InputEventMock,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    console: { log() {} },
    setTimeout(callback) {
      callback();
    },
  });

  function press(target, key) {
    assert.ok(listeners.has('keydown'), 'le content script doit écouter la frappe');
    const event = {
      key,
      keyCode: key.length === 1 ? key.charCodeAt(0) : 9,
      target,
      isComposing: false,
      composedPath: () => [target],
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    listeners.get('keydown')(event);
    return event;
  }

  // Un événement `input` : l'ancien déclenchement « dès la dernière lettre ».
  function typeInput(target) {
    const event = {
      key: 'l',
      target,
      isComposing: false,
      composedPath: () => [target],
    };
    listeners.get('input')?.(event);
  }

  return { InputElement, press, typeInput };
}

test('Tab déclenche l’expansion et n’envoie pas la touche au site', () => {
  const { InputElement, press } = createSnippetRuntime();
  const input = new InputElement(';email', { type: 'email' });

  const event = press(input, 'Tab');

  assert.equal(input.value, 'prenom.nom@example.com');
  assert.equal(event.defaultPrevented, true, 'Tab ne doit pas valider le formulaire');
});

test('l’espace et la ponctuation déclenchent aussi, séparateur conservé', () => {
  const { InputElement, press } = createSnippetRuntime();
  const space = new InputElement(';addr');
  press(space, ' ');
  assert.equal(space.value, '12 rue des Lilas, 75011 Paris ');

  const punct = new InputElement(';tel');
  press(punct, '.');
  assert.equal(punct.value, '+33 6 12 34 56 78.');
});

test('rien ne se déclenche pendant la frappe (pas d’expansion à la dernière lettre)', () => {
  const { InputElement, press, typeInput } = createSnippetRuntime();
  const input = new InputElement(';email', { type: 'email' });

  typeInput(input);

  assert.equal(input.value, ';email', 'la frappe seule ne doit rien remplacer');
  assert.equal(press(input, 'l').defaultPrevented, false);
  assert.equal(input.value, ';email');
});

test('« tel » et « telpro » ne se marchent plus dessus', () => {
  const { InputElement, press } = createSnippetRuntime({
    snippets: { telpro: 'Numéro professionnel' },
  });

  const pro = new InputElement(';telpro');
  press(pro, 'Tab');
  assert.equal(pro.value, 'Numéro professionnel');

  const perso = new InputElement(';tel');
  press(perso, 'Tab');
  assert.equal(perso.value, '+33 6 12 34 56 78');
});

test('les champs de mot de passe et de confirmation restent exclus par défaut', () => {
  const { InputElement, press } = createSnippetRuntime();

  const password = new InputElement(';email', { type: 'password' });
  press(password, 'Tab');
  assert.equal(password.value, ';email');

  // Champ tapé en « text » mais qui s'annonce comme un mot de passe.
  const confirm = new InputElement(';email', {
    type: 'text',
    attrs: { name: 'confirme_mot_de_passe', autocomplete: 'new-password' },
  });
  press(confirm, 'Tab');
  assert.equal(confirm.value, ';email');
});

test('un champ email / identifiant fonctionne, même nommé « confirm_email »', () => {
  const { InputElement, press } = createSnippetRuntime();

  const email = new InputElement(';email', { type: 'email', attrs: { name: 'confirm_email' } });
  press(email, 'Tab');
  assert.equal(email.value, 'prenom.nom@example.com');

  const username = new InputElement(';email', { type: 'text', attrs: { name: 'username' } });
  press(username, 'Tab');
  assert.equal(username.value, 'prenom.nom@example.com');
});

test('les champs de mot de passe redeviennent utilisables après autorisation explicite', () => {
  const { InputElement, press } = createSnippetRuntime({ allowPasswordFields: true });
  const input = new InputElement(';email', { type: 'password' });

  press(input, 'Tab');

  assert.equal(input.value, 'prenom.nom@example.com');
});

test('une abréviation inconnue n’est pas touchée', () => {
  const { InputElement, press } = createSnippetRuntime();
  const input = new InputElement(';inconnu');

  const event = press(input, 'Tab');

  assert.equal(input.value, ';inconnu');
  assert.equal(event.defaultPrevented, false, 'Tab garde son rôle normal');
});
