import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ProblemSchema } from './problem.schema';

describe('Problem soft-delete fields', () => {
  let replSet: MongoMemoryReplSet;
  const Problems = mongoose.model('ProblemSoftDeleteSpec', ProblemSchema);
  const fields = (code: string) => ({
    code,
    name: code,
    timeLimit: 1,
    memoryLimit: 65536,
    points: 1000,
    typeIds: [newId()],
    groupId: newId(),
  });

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Problems.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('starts a problem live: no deletedAt is stored and the live filter matches it', async () => {
    const created = await Problems.create(fields('live_one'));
    const stored = await Problems.collection.findOne({ code: 'live_one' });
    expect(stored).not.toHaveProperty('deletedAt');
    expect(
      await Problems.countDocuments({ _id: created._id, deletedAt: null }),
    ).toBe(1);
  });

  it('finds deleted problems by the range the sparse index serves, and not live ones', async () => {
    await Problems.create({
      ...fields('gone_one'),
      deletedAt: new Date(),
      deletedBy: newId(),
    });
    await Problems.create(fields('live_two'));
    const deleted = await Problems.find({
      deletedAt: { $gt: new Date(0) },
    }).lean();
    expect(deleted.map((problem) => problem.code)).toEqual(['gone_one']);
    const explained = await Problems.find({
      deletedAt: { $gt: new Date(0) },
    }).explain('queryPlanner');
    expect(JSON.stringify(explained)).toContain('deletedAt_1');
    const indexes = await Problems.collection.indexes();
    expect(indexes.find((index) => index.name === 'deletedAt_1')).toMatchObject(
      { sparse: true },
    );
  });
});
