/** Adapts the swagger CLI plugin to ts-jest's AST transformer interface (see jest.openapi.config.js). */
const swagger = require('@nestjs/swagger/plugin');

module.exports = {
  name: 'nestjs-swagger-transformer',
  version: 1,
  factory: (compiler, options) =>
    // The program ts-jest keeps on the compiler is the one from its start-up; the language service holds the current one (it knows the file being compiled).
    swagger.before(options, compiler._languageService.getProgram()),
};
