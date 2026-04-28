/**
 * Vite Configuration for Chrome Extension
 * Builds Vue.js popup UI and content/background scripts
 */

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  
  build: {
    outDir: './public/dist',
    emptyOutDir: false, // Preserve manifest.json, icons
    
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.js'),
        'service-worker': path.resolve(__dirname, 'src/background/service-worker.js'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        format: 'es',
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
