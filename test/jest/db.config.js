/**
 * Specs that need MongoDB or Redis (`*.db.spec.ts`, `*.e2e-spec.ts`): run by the CI `db` job and locally. One
 * in-memory replica set per run (global-setup.js); Redis from TEST_REDIS_URL. The OpenAPI e2e specs have openapi-db.config.js.
 */
const shared = require('./shared');

module.exports = {
  ...shared,
  rootDir: '../..',
  testRegex: '.*\\.(db\\.spec|e2e-spec)\\.ts$',
  testPathIgnorePatterns: [
    ...shared.testPathIgnorePatterns,
    '/openapi\\.e2e-spec\\.ts$',
  ],
  globalSetup: '<rootDir>/test/jest/global-setup.js',
  globalTeardown: '<rootDir>/test/jest/global-teardown.js',
};
