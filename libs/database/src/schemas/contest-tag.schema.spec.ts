import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { ContestTagSchema } from './contest-tag.schema';

describe('Contest tag schema', () => {
  let replSet: MongoMemoryReplSet;
  const Tags = mongoose.model('ContestTagSchemaSpec', ContestTagSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Tags.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps one tag per slug and only colours from the token set', async () => {
    await Tags.create({ slug: 'olp', name: 'Olympiad', color: 'tag-3' });
    await expect(
      Tags.create({ slug: 'olp', name: 'Again', color: 'tag-1' }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Tags.create({ slug: 'red', name: 'Red', color: 'red' }),
    ).rejects.toThrow(/color/);
    await expect(
      Tags.create({ slug: 'Bad Slug', name: 'Bad', color: 'tag-1' }),
    ).rejects.toThrow(/slug/);
  });
});
