/** The e2e OpenAPI spec connects to Redis and would hang on an unreachable default: fail at once when no test URL is given. */
module.exports = async () => {
  if (!process.env.TEST_REDIS_URL)
    throw new Error(
      'TEST_REDIS_URL is not set: run `TEST_REDIS_URL=redis://localhost:6379/15 npm run test:openapi`',
    );
};
