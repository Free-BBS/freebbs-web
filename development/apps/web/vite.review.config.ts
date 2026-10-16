import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'dist-review',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./src/showcase-review/main.tsx', import.meta.url)),
      name: 'FreeBbsShowcaseReview',
      formats: ['iife'],
      fileName: () => 'review.js',
      cssFileName: 'review',
    },
  },
});
