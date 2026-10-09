import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { ContestSchema } from './contest.schema';
import { ContestParticipationSchema } from './contest-participation.schema';
import { ContestTagSchema } from './contest-tag.schema';

describe('Contest tag and rules schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Tags = mongoose.model('ContestTagSchemaSpec', ContestTagSchema);
  const Contests = mongoose.model('ContestRulesSchemaSpec', ContestSchema);
  const Participations = mongoose.model(
    'ContestRulesParticipationSpec',
    ContestParticipationSchema,
  );

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

  it('starts a contest with no rules, revision 0 and auto-publish off', async () => {
    const contest = await Contests.create({
      key: 'rules_defaults',
      name: 'Rules defaults',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3_600_000),
    });
    expect(contest.toObject()).toMatchObject({
      rules: '',
      rulesHtml: '',
      rulesRevision: 0,
      publishAfterEnd: false,
      publishAfterEndBy: null,
      autoPublishOutcome: null,
    });
  });

  it('refuses rules past the cap and starts a participation without acceptance', async () => {
    await expect(
      Contests.create({
        key: 'rules_long',
        name: 'Long',
        startTime: new Date(),
        endTime: new Date(Date.now() + 3_600_000),
        rules: 'x'.repeat(8193),
      }),
    ).rejects.toThrow(/rules/);
    const row = await Participations.create({
      contest: new mongoose.Types.UUID(),
      user: new mongoose.Types.UUID(),
      realStart: new Date(),
    });
    expect(row.toObject()).toMatchObject({
      rulesAcceptedAt: null,
      rulesAcceptedRevision: null,
    });
  });
});
