import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const contentScript = readFileSync(
  new URL('../electron/extensions/text-snippets/content.js', import.meta.url),
  'utf8'
);

function createSnippetRuntime({ allowPasswordFields = false } = {}) {
  const listeners = new Map();
  const stored = { allowPasswordFields };

  class InputEventMock {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
  }

  class InputElement {
    constructor(value, type = 'text') {
      this.tagName = 'INPUT';
      this._value = value;
      this.type = type;
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
      return name === 'type' ? this.type : null;
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
    setTimeout(callback) { callback(); },
  });

  function typeSeparator(target, composedPath = [target]) {
    const event = {
      key: ' ',
      keyCode: 32,
      target,
      isComposing: false,
      composedPath: () => composedPath,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
    };
    listeners.get('keydown')(event);
    return event;
  }

  function typeInput(target, composedPath = [target]) {
    const event = {
      key: 'l',
      target,
      isComposing: false,
      composedPath: () => composedPath,
    };
    listeners.get('input')(event);
  }

  return { InputElement, typeSeparator, typeInput };
}

test('Text Snippets expands immediately in a modal input without waiting for a separator', () => {
  const { InputElement, typeInput } = createSnippetRuntime();
  const input = new InputElement(';email', 'email');
  const modalHost = { tagName: 'LOGIN-DIALOG', nodeType: 1 };

  typeInput(input, [input, modalHost]);

  assert.equal(input.value, 'prenom.nom@example.com');
});

test('Text Snippets expands in a login input inside an open shadow-root modal', () => {
  const { InputElement, typeSeparator } = createSnippetRuntime();
  const input = new InputElement(';email', 'email');
  const modalHost = { tagName: 'LOGIN-DIALOG', nodeType: 1 };

  typeSeparator(modalHost, [input, modalHost]);

  assert.equal(input.value, 'prenom.nom@example.com ');
});

test('Text Snippets keeps password fields disabled unless explicitly enabled', () => {
  const { InputElement, typeSeparator } = createSnippetRuntime();
  const input = new InputElement(';email', 'password');

  typeSeparator(input);

  assert.equal(input.value, ';email');
});

test('Text Snippets can expand a password field after explicit opt-in', () => {
  const { InputElement, typeSeparator } = createSnippetRuntime({ allowPasswordFields: true });
  const input = new InputElement(';email', 'password');

  typeSeparator(input);

  assert.equal(input.value, 'prenom.nom@example.com ');
});
