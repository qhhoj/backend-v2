import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ContestSchema } from './contest.schema';
import { ContestBalloonSchema } from './contest-balloon.schema';
import { ContestFeedKeySchema } from './contest-feed-key.schema';

describe('contest operations schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Balloons = mongoose.model(
    'ContestBalloonSchemaSpec',
    ContestBalloonSchema,
  );
  const FeedKeys = mongoose.model(
    'ContestFeedKeySchemaSpec',
    ContestFeedKeySchema,
  );
  const Contests = mongoose.model('ContestOpsSchemaSpec', ContestSchema);
  const HASH = 'a'.repeat(64);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Balloons, FeedKeys, Contests].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps one delivery per contest, team and problem', async () => {
    const fields = {
      contest: newId(),
      participation: newId(),
      problem: newId(),
      deliveredAt: new Date(),
      deliveredBy: newId(),
    };
    await Balloons.create(fields);
    await expect(Balloons.create(fields)).rejects.toThrow(/duplicate key/);
    await expect(
      Balloons.create({ ...fields, problem: newId() }),
    ).resolves.toBeDefined();
  });

  it('stores a feed key hashed, defaults to the freeze-safe mode and refuses a plain key or an unknown mode', async () => {
    const fields = {
      contest: newId(),
      keyHash: HASH,
      createdBy: newId(),
      expiresAt: new Date(Date.now() + 1000),
    };
    const stored = await FeedKeys.create(fields);
    expect(stored.mode).toBe('frozen-until-release');
    expect(stored.revokedAt).toBeNull();
    expect(stored.releasedAt).toBeNull();
    await expect(
      FeedKeys.create({ ...fields, keyHash: 'qhf_plain' }),
    ).rejects.toThrow(/keyHash/);
    await expect(
      FeedKeys.create({ ...fields, mode: 'always' }),
    ).rejects.toThrow(/mode/);
  });

  it('adds balloons off, an empty staff list and no export request to a contest', async () => {
    const contest = await Contests.create({
      key: 'ops_defaults',
      name: 'Ops',
      startTime: new Date(),
      endTime: new Date(),
    });
    expect(contest.balloons).toBe(false);
    expect(contest.balloonStaff).toEqual([]);
    expect(contest.exportPreparedAt).toBeNull();
  });
});
