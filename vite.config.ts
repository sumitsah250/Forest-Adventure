import { defineConfig } from 'vite';
import { serviceWorker } from './scripts/vite-sw-plugin.mjs';

export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  // Emits sw.js so the games install as apps and load from cache on later visits.
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
    assetsInlineLimit: 0,
    rollupOptions: {
      // Two games: the forest (index.html) and Campus Quest (campus.html).
      input: { main: 'index.html', campus: 'campus.html' },
    },
  },
});
