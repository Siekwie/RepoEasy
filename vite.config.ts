import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.REPOEASY_API ?? 'http://127.0.0.1:8787';

// `--mode admin` builds the owner's admin page (src/web/admin) into dist/admin. It is served by
// its own listener (src/server/admin-web.ts) and is kept out of dist/web, which is public.
export default defineConfig(({ mode }) => {
  const admin = mode === 'admin';
  return {
    root: admin ? 'src/web/admin' : 'src/web',
    publicDir: admin ? '../public' : 'public',
    plugins: [react()],
    build: {
      outDir: admin ? '../../../dist/admin' : '../../dist/web',
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
  };
});
