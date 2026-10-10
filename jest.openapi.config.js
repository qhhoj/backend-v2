/** The main jest config with the swagger CLI plugin applied (same options as nest-cli.json; the plugin reads types, so isolatedModules is off), running only the OpenAPI specs. */
const base = require('./package.json').jest;
const [swagger] = require('./nest-cli.json').compilerOptions.plugins;

module.exports = {
  ...base,
  globalSetup: require.resolve('./jest.openapi.require-redis'),
  // ESM-only and irrelevant to the schemas: swapped for a no-op plugin (the main suite exercises /api/docs).
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@scalar/fastify-api-reference$': require.resolve('./jest.scalar-stub'),
  },
  testPathIgnorePatterns: ['/node_modules/'],
  testRegex: '.*/(openapi\\.e2e-spec|[^/]+\\.openapi-spec)\\.ts$',
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
