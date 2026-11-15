import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

// Le dépôt est en `"type": "module"` : `__dirname` n'existe pas ici. Vite le
// fournissait par accident en pré-bundlant la config ; on ne s'y fie pas.
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Deux pages, un seul bundle partagé : l'interface principale et les
      // fenêtres-panneaux (relecture, assistant) ouvertes à côté d'une fenêtre
      // détachée. Le panneau réutilise les mêmes composants et les mêmes
      // styles, il n'a pas de copie à maintenir.
      input: {
        main: path.resolve(dirname, './index.html'),
        panel: path.resolve(dirname, './panel.html'),
      },
    },
  },
  server: {
    port: 5173,
    watch: {
      // ---------------------------------------------------------------------
      // NE PAS SURVEILLER LES PROFILS ELECTRON.
      //
      // `npm run dev:fresh` lance Electron avec `--user-data-dir=.dev-profile`,
      // donc DANS le dépôt. Or Chromium y écrit en permanence : cache HTTP,
      // `Preferences`, `window-state.json`, journaux de session… Chacune de ces
      // écritures était vue par le serveur de développement comme une
      // modification du projet, et déclenchait un RECHARGEMENT COMPLET de la
      // page.
      //
      // Mesuré avant ce correctif : 2 564 rechargements en quelques minutes
      // d'utilisation normale. L'application se rechargeait plusieurs fois par
      // seconde — d'où une lenteur générale en développement, et des états
      // perdus sans raison apparente (un document en cours de lecture, une
      // fenêtre de réglages ouverte).
      //
      // Rien ici ne concerne la version livrée : c'est le confort de
      // développement, et la fiabilité de tout ce qu'on observe en dev.
      ignored: [
        '**/.dev-profile/**',
        '**/.perf-profile/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/extensions-dist/**',
        '**/.git/**',
      ],
    },
  },
});
