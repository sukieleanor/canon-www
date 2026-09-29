import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on any static host or sub-path (e.g. GitHub Pages project sites).
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
