import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WEATHER_CACHE_KEY,
  describeWeather,
  readWeatherCache,
  weatherUnit,
  writeWeatherCache,
} from '../src/lib/weather.js';

// lib/weather.js est la source unique de la météo (widget d'en-tête ET page
// d'accueil). On ne teste pas le réseau : seulement les décisions locales — le
// libellé d'un code WMO, l'unité demandée à l'API et le cache.

test('describeWeather : code connu → emoji + libellé', () => {
  assert.deepEqual(describeWeather(0), ['☀️', 'Ciel dégagé']);
  assert.deepEqual(describeWeather(61), ['🌧️', 'Pluie faible']);
});

test('describeWeather : code inconnu → repli neutre, jamais undefined', () => {
  assert.deepEqual(describeWeather(1234), ['🌡️', '—']);
  assert.deepEqual(describeWeather(undefined), ['🌡️', '—']);
});

test('weatherUnit : metric → celsius, imperial → fahrenheit', () => {
  assert.equal(weatherUnit('metric'), 'celsius');
  assert.equal(weatherUnit('imperial'), 'fahrenheit');
  // Absent ou inconnu : celsius, comme le réglage par défaut.
  assert.equal(weatherUnit(undefined), 'celsius');
  assert.equal(weatherUnit('n’importe quoi'), 'celsius');
});

test('cache : aller-retour pour la même ville et la même unité', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    assert.equal(readWeatherCache('Antananarivo', 'metric'), null, 'cache vide au départ');
    writeWeatherCache('Antananarivo', 'metric', { place: 'Antananarivo, MG' });
    assert.deepEqual(readWeatherCache('Antananarivo', 'metric'), { place: 'Antananarivo, MG' });
    // Changer d'unité ne doit PAS servir la valeur de l'autre unité.
    assert.equal(readWeatherCache('Antananarivo', 'imperial'), null);
    // Ville vide : jamais de cache.
    assert.equal(readWeatherCache('', 'metric'), null);
    // La clé de stockage reste celle qu'attend le widget d'en-tête.
    assert.ok(store.has(WEATHER_CACHE_KEY));
  } finally {
    delete globalThis.localStorage;
  }
});

test('cache : entrée illisible → null (on retape l’API)', () => {
  globalThis.localStorage = {
    getItem: () => '{ceci n’est pas du JSON',
    setItem: () => {},
  };
  try {
    assert.equal(readWeatherCache('Paris', 'metric'), null);
  } finally {
    delete globalThis.localStorage;
  }
});
