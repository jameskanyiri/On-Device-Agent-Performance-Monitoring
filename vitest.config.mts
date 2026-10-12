import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    // `server-only` throws outside Next's server bundle; tests import server code directly.
    alias: { 'server-only': new URL('./test/server-only.ts', import.meta.url).pathname },
  },
});
