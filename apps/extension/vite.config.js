/**
 * Vite Configuration for Chrome Extension
 * Builds Vue.js popup UI and content/background scripts
 */

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
  ],

  build: {
    outDir: './public/dist',
    emptyOutDir: false,

    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
  },
});