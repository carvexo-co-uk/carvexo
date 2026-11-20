import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('./client', import.meta.url));

export default defineConfig({
  root,
  envDir: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: { '/api': 'http://127.0.0.1:4174' },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
