/**
 * Jest Configuration for Unit Tests
 * Tests for core ReAct loop and utilities
 */

module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: [
    'apps/extension/src/**/*.js',
    'apps/extension/src/**/*.vue',
    '!**/node_modules/**',
  ],
  
  transform: {
    '^.+\\.vue$': '@vue/vue3-jest',
    '.+\\.(css|styl|less|sass|scss|svg|png|jpg|ttf|woff|woff2)$': 'jest-transform-stub',
    '^.+\\.jsx?$': 'babel-jest',
  },

  moduleFileExtensions: ['vue', 'js', 'json'],
  
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
  ],

  setupFiles: ['./tests/setup.js'],
};
