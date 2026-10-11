/**
 * Specs that need MongoDB or Redis (`*.db.spec.ts`, `*.e2e-spec.ts`): local only, never in CI. One in-memory replica
 * set per run (jest.global-setup.js); Redis from TEST_REDIS_URL. The OpenAPI e2e specs have jest.openapi-db.config.js.
 */
const shared = require('./jest.shared');

module.exports = {
  ...shared,
  testRegex: '.*\\.(db\\.spec|e2e-spec)\\.ts$',
  testPathIgnorePatterns: [
    ...shared.testPathIgnorePatterns,
    '/openapi\\.e2e-spec\\.ts$',
  ],
  globalSetup: '<rootDir>/jest.global-setup.js',
  globalTeardown: '<rootDir>/jest.global-teardown.js',
};
