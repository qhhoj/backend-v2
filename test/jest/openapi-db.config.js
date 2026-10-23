/** The OpenAPI specs that boot the app (`openapi.e2e-spec.ts`, `*.openapi-e2e-spec.ts`): openapi.config.js plus MongoDB and Redis. Local only. */
const base = require('./openapi.config');
const shared = require('./shared');

module.exports = {
  ...base,
  moduleNameMapper: {
    ...shared.moduleNameMapper,
    '^@scalar/fastify-api-reference$': require.resolve('./scalar-stub'),
  },
  testRegex: '.*/(openapi\\.e2e-spec|[^/]+\\.openapi-e2e-spec)\\.ts$',
  globalSetup: require.resolve('./require-redis'),
  globalTeardown: require.resolve('./global-teardown'),
};
