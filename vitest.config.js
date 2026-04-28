/**
 * Vitest Configuration for Unit Tests
 * Tests for agent logic, tool registry, token budgeting, etc.
 */

import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [vue()],
  
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.js'],
    include: ['tests/unit/**/*.test.js'],
    exclude: ['node_modules', 'dist'],
    
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/extension/src/**/*.js',
        'apps/extension/src/**/*.vue',
        'apps/backend/**/*.js',
      ],
      exclude: [
        'node_modules',
        'tests',
      ],
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './apps/extension/src'),
    },
  },
});
