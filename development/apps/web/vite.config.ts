import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const mainSiteOrigin =
    loadEnv(mode, process.cwd(), 'VITE_').VITE_MAIN_SITE_ORIGIN || 'http://127.0.0.1:3000';
  return {
    base: '/development/',
    plugins: [react()],
    server: {
      proxy: {
        '/api/development/v1': {
          target: 'http://127.0.0.1:3100',
          changeOrigin: false,
        },
        '/api/auth/me': {
          target: mainSiteOrigin,
          changeOrigin: false,
        },
        '/api/checkin': {
          target: mainSiteOrigin,
          changeOrigin: false,
        },
        '/api/notifications': {
          target: mainSiteOrigin,
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
    },
  };
});
