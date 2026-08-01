import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildDefine } from './build-info.mjs';

export default defineConfig({
  plugins: [react()],
  define: buildDefine,
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
