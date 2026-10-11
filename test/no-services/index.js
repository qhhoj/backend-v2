/** Maps ioredis and mongodb-memory-server to stubs that throw on use: configs that must run without MongoDB or Redis spread this into moduleNameMapper. */
module.exports = {
  '^ioredis$': require.resolve('./ioredis'),
  '^mongodb-memory-server$': require.resolve('./mongodb-memory-server'),
};
