import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Aponta o import do SDK direto para o source TypeScript
      // Evita precisar fazer build do SDK antes de rodar o demo
      '@hous3-digital/vesta-sdk': path.resolve(__dirname, '../app/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        client1: path.resolve(__dirname, 'client1/index.html'),
        client2: path.resolve(__dirname, 'client2/index.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
