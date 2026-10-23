/**
 * The OpenAPI specs (`*.openapi-spec.ts`) with the swagger CLI plugin applied (same options as nest-cli.json; the plugin
 * reads types, so isolatedModules is off). Static: the document is built from stubbed controllers, and ioredis and
 * mongodb-memory-server throw as in jest.config.js. Specs that boot the app are openapi-db.config.js.
 */
const shared = require('./shared');
const [swagger] = require('../../nest-cli.json').compilerOptions.plugins;

module.exports = {
  ...shared,
  rootDir: '../..',
  // ESM-only and irrelevant to the schemas: swapped for a no-op plugin (the main suite exercises /api/docs).
  moduleNameMapper: {
    ...shared.moduleNameMapper,
    ...require('../no-services'),
    '^@scalar/fastify-api-reference$': require.resolve('./scalar-stub'),
  },
  testRegex: '.*\\.openapi-spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.openapi.json',
        astTransformers: {
          before: [
            {
              path: require.resolve('./swagger-transformer'),
              options: swagger.options,
            },
          ],
        },
      },
    ],
  },
};
