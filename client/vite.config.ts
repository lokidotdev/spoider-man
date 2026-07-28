import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(here, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Three and the Rapier wasm bundle dominate the payload and almost
        // never change; splitting them keeps game-code rebuilds cheap to cache.
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: {
      // Only used when VITE_SERVER_URL is unset: the client then talks to its
      // own origin and this forwards the socket to a local game server.
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
