import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-Origin-Isolation auch im Entwicklungsserver (für mehrkernige KI/RAW-Entwicklung)
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['libraw-wasm'] },
  worker: { format: 'es' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
