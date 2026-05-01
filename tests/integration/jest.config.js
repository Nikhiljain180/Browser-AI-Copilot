/**
 * Jest Configuration for Integration Tests
 * Tests for the Node.js backend proxy
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/integration/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
};
