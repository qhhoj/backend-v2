/** The OpenAPI jest config (swagger plugin on), running only the emitter `apps/api/test/openapi/emit.openapi-emit.ts`. */
module.exports = {
  ...require('./openapi.config'),
  globalSetup: undefined, // the emit needs no Redis
  testRegex: '.*\\.openapi-emit\\.ts$',
};
