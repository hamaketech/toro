import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 3000,
    host: true, // Expose on local network (0.0.0.0)
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

