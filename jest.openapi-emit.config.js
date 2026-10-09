/** The OpenAPI jest config (swagger plugin on), running only the emitter `apps/api/test/openapi/emit.openapi-emit.ts`. */
module.exports = {
  ...require('./jest.openapi.config'),
  testRegex: '.*\\.openapi-emit\\.ts$',
};
