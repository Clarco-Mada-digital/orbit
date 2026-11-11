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
  },
});
