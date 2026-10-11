/** Global setup of jest.openapi-db.config.js: the OpenAPI e2e specs connect to Redis and would hang on an unreachable default: fail at once when no test URL is given. Then the shared Mongo of the main config. */
const startSharedMongo = require('./jest.global-setup');

module.exports = async () => {
  if (!process.env.TEST_REDIS_URL)
    throw new Error(
      'TEST_REDIS_URL is not set: run `TEST_REDIS_URL=redis://localhost:6379/15 npm run test:openapi:db`',
    );
  await startSharedMongo();
};
