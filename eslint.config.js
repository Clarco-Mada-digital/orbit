// ---------------------------------------------------------------------------
// ESLint — filet de sécurité statique, volontairement resserré sur ce qui
// CASSE vraiment Orbit. Pas de règles de style (indentation, guillemets…) :
// elles noieraient les vrais signaux et le code est déjà homogène.
//
// Trois environnements bien distincts cohabitent dans ce dépôt :
//   - src/            → React, dans le renderer (navigateur)
//   - electron/       → Node, processus principal
//   - electron/*.cjs  → preloads CommonJS, contexte isolé
//   - extensions/     → scripts de contenu injectés dans les pages
//   - test/ scripts/  → Node
// ---------------------------------------------------------------------------
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'dist-electron/**', 'build/**', 'extensions-dist/**', 'node_modules/**'],
  },

  js.configs.recommended,

  // --- Renderer React ------------------------------------------------------
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      // `process` : shortcuts.js est partagé avec le processus principal et le
      // teste via `typeof process !== 'undefined'`.
      globals: { ...globals.browser, ...globals.es2021, process: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18.3' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // React 17+ : plus besoin d'importer React pour le JSX
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off', // pas de PropTypes dans ce projet
      // Interface en français : apostrophes et guillemets à foison, les
      // échapper rendrait le JSX illisible.
      'react/no-unescaped-entities': 'off',
      // <webview> est une balise Electron : ses attributs (partition,
      // useragent, allowpopups…) sont inconnus de react-dom.
      'react/no-unknown-property': ['error', { ignore: ['partition', 'useragent', 'allowpopups'] }],

      // Règles react-hooks v6 (nouvelles) : de vraies pistes d'amélioration,
      // mais elles demandent du refactor. En avertissement pour l'instant, à
      // résorber progressivement puis passer en erreur.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',

      // LE garde-fou qui compte : une dépendance oubliée dans un useEffect /
      // useMemo produit une closure périmée — le bug le plus coûteux à
      // diagnostiquer ici (webview qui ne se recharge pas, raccourci qui vise
      // l'ancienne app…). En warn le temps de résorber l'existant.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },

  // --- Processus principal Electron ---------------------------------------
  {
    files: ['electron/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021 },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // popup.js est chargé par popup.html DANS la fenêtre secondaire : c'est du
  // code de rendu, pas du processus principal.
  {
    files: ['electron/popup.js'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // --- Scripts de contenu des extensions -----------------------------------
  // Injectés dans la page hôte : environnement navigateur + API chrome.*
  {
    files: ['electron/extensions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
  },

  // --- Tests ---------------------------------------------------------------
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // --- Règles communes -----------------------------------------------------
  {
    files: ['**/*.{js,jsx,cjs}'],
    rules: {
      // Une variable inutilisée est presque toujours le reste d'un refactor.
      // On tolère les arguments en tête de signature et les captures d'erreur
      // nommées `_` / `e` volontairement ignorées.
      'no-unused-vars': [
        'warn',
        { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Ces trois-là sont des bugs, pas du style
      'no-undef': 'error',
      'no-fallthrough': 'error',
      // Espaces insécables/fines : ce sont des caractères RECHERCHÉS ici
      // (normalisation des nombres « 1 234 » tapés à la française).
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true }],
      // Échappements superflus dans les regex : cosmétique, pas un bug
      'no-useless-escape': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['warn', 'smart'],
      // Des `console` subsistent volontairement (journal de diagnostic)
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
