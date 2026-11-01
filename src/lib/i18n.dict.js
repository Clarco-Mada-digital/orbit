// ---------------------------------------------------------------------------
// Dictionnaires fr/en — DONNÉES PURES, aucune dépendance (ni React, ni store).
//
// Séparés de i18n.js pour rester importables par `node --test` : le test
// test/i18n.test.js vérifie à chaque PR que les deux langues ont exactement
// les mêmes clés, et qu’aucune clé appelée dans le code ne manque.
// ---------------------------------------------------------------------------
import * as assistant from './i18n/assistant.js';
import * as settings from './i18n/settings.js';
import * as vault from './i18n/vault.js';
import * as palette from './i18n/palette.js';
import * as topbar from './i18n/topbar.js';
import * as apps from './i18n/apps.js';

// Assemblage des morceaux (voir src/lib/i18n/). L'API ne change pas : le reste
// de l'application importe toujours `fr` et `en` depuis ce fichier.
//
// Un étalement d'objets fait gagner la DERNIÈRE occurrence en cas de doublon
// entre deux modules — ce serait silencieux. `test/i18n.test.js` refuse donc
// qu'une même clé apparaisse dans deux modules.
export const MODULES = { assistant, settings, vault, palette, topbar, apps };

export const fr = {
  ...assistant.fr,
  ...settings.fr,
  ...vault.fr,
  ...palette.fr,
  ...topbar.fr,
  ...apps.fr,
};

export const en = {
  ...assistant.en,
  ...settings.en,
  ...vault.en,
  ...palette.en,
  ...topbar.en,
  ...apps.en,
};
