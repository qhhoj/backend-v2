import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const startMongo = () =>
  MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
