/**
 * Unit specs (`*.spec.ts`): pure and static, the only specs CI runs. ioredis and mongodb-memory-server are stubs that
 * throw, so a spec that needs a service fails at once; it belongs in `*.db.spec.ts` or `*.e2e-spec.ts` (test/jest/db.config.js).
 */
const shared = require('./test/jest/shared');

module.exports = {
  ...shared,
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: [
    ...shared.testPathIgnorePatterns,
    '\\.db\\.spec\\.ts$',
  ],
  moduleNameMapper: {
    ...shared.moduleNameMapper,
    ...require('./test/no-services'),
  },
};
