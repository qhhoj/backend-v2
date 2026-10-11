/**
 * The OpenAPI specs (`*.openapi-spec.ts`) with the swagger CLI plugin applied (same options as nest-cli.json; the plugin
 * reads types, so isolatedModules is off). Static: the document is built from stubbed controllers, and ioredis and
 * mongodb-memory-server throw as in jest.config.js. Specs that boot the app are jest.openapi-db.config.js.
 */
const shared = require('./jest.shared');
const [swagger] = require('./nest-cli.json').compilerOptions.plugins;

module.exports = {
  ...shared,
  // ESM-only and irrelevant to the schemas: swapped for a no-op plugin (the main suite exercises /api/docs).
  moduleNameMapper: {
    ...shared.moduleNameMapper,
    ...require('./test/no-services'),
    '^@scalar/fastify-api-reference$': require.resolve('./jest.scalar-stub'),
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
              path: require.resolve('./jest.openapi.transformer'),
              options: swagger.options,
            },
          ],
        },
      },
    ],
  },
};
