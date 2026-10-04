import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.REPOEASY_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/auth': api,
      '/badge': api,
    },
  },
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    env: {
      APP_SECRET: 'test-secret',
      SYNC_DISABLED: '1',
      BASE_URL: 'http://localhost:8787',
      GITHUB_CLIENT_ID: 'test-client',
      GITHUB_CLIENT_SECRET: 'test-client-secret',
    },
  },
});
