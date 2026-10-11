/** The OpenAPI specs that boot the app (`openapi.e2e-spec.ts`, `*.openapi-e2e-spec.ts`): jest.openapi.config.js plus MongoDB and Redis. Local only. */
const base = require('./jest.openapi.config');
const shared = require('./jest.shared');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...shared.moduleNameMapper,
    '^@scalar/fastify-api-reference$': require.resolve('./jest.scalar-stub'),
  },
  testRegex: '.*/(openapi\\.e2e-spec|[^/]+\\.openapi-e2e-spec)\\.ts$',
  globalSetup: require.resolve('./jest.openapi.require-redis'),
  globalTeardown: require.resolve('./jest.global-teardown'),
};
