/** The main jest config with the swagger CLI plugin applied (same options as nest-cli.json; the plugin reads types, so isolatedModules is off), running only the OpenAPI specs. */
const base = require('./package.json').jest;
const [swagger] = require('./nest-cli.json').compilerOptions.plugins;

module.exports = {
  ...base,
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
