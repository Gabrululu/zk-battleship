import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@noir-lang/noir_js', '@aztec/bb.js'],
  },
  server: {
    port: 3000,
    headers: {
      // Required for SharedArrayBuffer used by bb.js WASM threads
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
