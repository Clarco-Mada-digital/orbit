import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerWebview,
  unregisterWebview,
  getWebContentsIdFor,
  getWebview,
  navigateApp,
} from '../src/lib/webviewRegistry.js';

// Electron lève si on interroge un <webview> avant son rattachement au DOM ou
// avant `dom-ready`. C'est le cas au premier rendu de la Topbar, donc ces
// appels doivent renvoyer une valeur de repli, jamais une exception — sinon
// l'ErrorBoundary avale toute la barre du haut.
function fakeWebview({ id = 7, throws = false } = {}) {
  return {
    getWebContentsId: () => {
      if (throws) throw new Error('The WebView must be attached to the DOM');
      return id;
    },
    loadURL(url) {
      this.loaded = url;
    },
  };
}

test('getWebContentsIdFor : renvoie null pour une app inconnue', () => {
  assert.equal(getWebContentsIdFor('jamais-vue'), null);
});

test('getWebContentsIdFor : renvoie null quand le webview lève', () => {
  registerWebview('a', fakeWebview({ throws: true }));
  try {
    assert.equal(getWebContentsIdFor('a'), null);
  } finally {
    unregisterWebview('a');
  }
});

test('getWebContentsIdFor : renvoie l\'id une fois le webview prêt', () => {
  registerWebview('b', fakeWebview({ id: 42 }));
  try {
    assert.equal(getWebContentsIdFor('b'), 42);
  } finally {
    unregisterWebview('b');
  }
});

test('un webview dérégistré redevient injoignable', () => {
  registerWebview('c', fakeWebview({ id: 1 }));
  unregisterWebview('c');
  assert.equal(getWebview('c'), null);
  assert.equal(getWebContentsIdFor('c'), null);
});

test('navigateApp : false si loadURL lève (webview pas prêt)', () => {
  const wv = fakeWebview({ id: 3 });
  wv.loadURL = () => {
    throw new Error('The WebView must be attached to the DOM');
  };
  registerWebview('d', wv);
  try {
    assert.equal(navigateApp('d', 'https://exemple.test/'), false);
  } finally {
    unregisterWebview('d');
  }
});

test('navigateApp : false sans app montée, true sinon', () => {
  assert.equal(navigateApp('absent', 'https://exemple.test/'), false);
  registerWebview('e', fakeWebview({ id: 4 }));
  try {
    assert.equal(navigateApp('e', 'https://exemple.test/'), true);
  } finally {
    unregisterWebview('e');
  }
});