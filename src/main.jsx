import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Avant le 3 novembre 2026, l'assistant laissait
// transformers.js recopier ses modèles dans le cache du navigateur. Le
// serveur de modèles écoute sur un port aléatoire, et ce cache range par URL
// complète : chaque lancement rajoutait une copie de 0,4 à 1,4 Go — 14 Go
// observés. Les modèles vivent déjà dans `orbit-assistant/` et l'assistant ne
// remplit plus ce cache (`useBrowserCache = false`) : on supprime le reste.
// Sans effet une fois le cache disparu.
globalThis.caches?.delete('transformers-cache').catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
