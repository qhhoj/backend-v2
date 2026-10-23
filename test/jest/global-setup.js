/** One MongoDB replica set for the whole jest run; `startMongo()` (libs/database/src/testing.ts) gives each caller databases of its own on it. */
const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async () => {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  globalThis.__QHHOJ_TEST_MONGO__ = replSet;
  process.env.QHHOJ_TEST_MONGO_URI = replSet.getUri('__DB__');
};
