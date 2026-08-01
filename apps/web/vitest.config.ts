import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { buildDefine } from './build-info.mjs';

export default defineConfig({
  plugins: [react()],
  define: buildDefine,
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
  },
});
