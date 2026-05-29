// vite.config.js
// Build front-end avec Vite : trois pages (accueil, ludothèque, admin).
// Le SCSS et les modules JS sont compilés/regroupés et écrits dans `public/`,
// qui est servi tel quel par le serveur Express.
//
// La racine Vite est `src/pages` : les pages HTML sont donc écrites à plat à
// la racine de `public/` (public/index.html, public/jeux.html, …). Les scripts
// sont référencés relativement ("../scripts/…") et les fichiers de `static/`
// sont copiés tels quels (ex. /assets/boardgames.webp).
import { defineConfig } from 'vite';
import { resolve } from 'path';

const root = resolve(__dirname, 'src/pages');

export default defineConfig({
  root,
  publicDir: resolve(__dirname, 'static'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        jeux: resolve(root, 'jeux.html'),
        admin: resolve(root, 'admin.html'),
      },
    },
  },
  server: {
    // En développement (vite dev), relaie les appels API vers Express.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
