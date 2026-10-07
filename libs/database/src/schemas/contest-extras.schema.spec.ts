import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ContestSchema } from './contest.schema';
import { ContestAnnouncementSchema } from './contest-announcement.schema';
import { ContestOfficialRankingSchema } from './contest-official-ranking.schema';
import { ContestMossSchema } from './contest-moss.schema';
import { ContestPublicRankingLinkSchema } from './contest-public-ranking-link.schema';
import { RatingSchema } from './rating.schema';

describe('Contest extras schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Ratings = mongoose.model('RatingSchemaSpec', RatingSchema);
  const MossRows = mongoose.model('ContestMossSchemaSpec', ContestMossSchema);
  const Announcements = mongoose.model(
    'ContestAnnouncementSchemaSpec',
    ContestAnnouncementSchema,
  );
  const Links = mongoose.model(
    'ContestPublicRankingLinkSchemaSpec',
    ContestPublicRankingLinkSchema,
  );
  const Rankings = mongoose.model(
    'ContestOfficialRankingSchemaSpec',
    ContestOfficialRankingSchema,
  );
  const Contests = mongoose.model('ContestExtrasSchemaSpec', ContestSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Ratings, MossRows, Announcements, Links, Contests].map((model) =>
        model.syncIndexes(),
      ),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps one rating per user and contest and per participation', async () => {
    const fields = () => ({
      user: newId(),
      contest: newId(),
      participation: newId(),
      contestEndTime: new Date(),
      rank: 1.5,
      rating: 1400,
      mean: 1450.25,
      performance: 1500.5,
      lastRated: new Date(),
    });
    const first = await Ratings.create(fields());
    expect(first.rank).toBe(1.5);
    await expect(
      Ratings.create({ ...fields(), user: first.user, contest: first.contest }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Ratings.create({ ...fields(), participation: first.participation }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('indexes ratings for history reads and range deletes', async () => {
    const keys = (await Ratings.listIndexes()).map((index: { key: object }) =>
      JSON.stringify(index.key),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        '{"user":1,"contestEndTime":-1,"contest":-1}',
        '{"contestEndTime":1}',
      ]),
    );
  });

  it('rejects a rank below 1, a zero expiry amount and an overlong official ranking name', async () => {
    await expect(
      Ratings.create({
        user: newId(),
        contest: newId(),
        participation: newId(),
        contestEndTime: new Date(),
        rank: 0.5,
        rating: 1,
        mean: 1,
        performance: 1,
        lastRated: new Date(),
      }),
    ).rejects.toThrow(/rank/);
    await expect(
      Links.create({
        contest: newId(),
        token: 'D'.repeat(18),
        regeneratedAt: new Date(),
        expiryAmount: 0,
      }),
    ).rejects.toThrow(/expiryAmount/);
    await expect(
      Rankings.create({
        _id: newId(),
        rows: [{ username: 'u'.repeat(201), scores: [], totalScore: 0 }],
      }),
    ).rejects.toThrow(/username/);
  });

  it('accepts only the five MOSS languages and one row per contest, problem and language', async () => {
    const row = {
      contest: newId(),
      problem: newId(),
      language: 'C++',
      submissionCount: 3,
      url: null,
    };
    await MossRows.create(row);
    await expect(MossRows.create(row)).rejects.toThrow(/duplicate key/);
    await expect(MossRows.create({ ...row, language: 'Rust' })).rejects.toThrow(
      /language/,
    );
  });

  it('bounds announcement titles', async () => {
    await expect(
      Announcements.create({
        contest: newId(),
        title: 'x'.repeat(101),
        description: '',
      }),
    ).rejects.toThrow(/title/);
    await expect(
      Announcements.create({ contest: newId(), title: '', description: '' }),
    ).rejects.toThrow(/title/);
  });

  it('keeps one public ranking link per contest, unique 18-character tokens and known modes', async () => {
    const link = {
      contest: newId(),
      token: 'A'.repeat(18),
      regeneratedAt: new Date(),
    };
    const created = await Links.create(link);
    expect(created.toObject()).toMatchObject({
      status: 'public',
      expiryMode: 'U',
      expiryAmount: null,
      expiresAt: null,
    });
    await expect(
      Links.create({ ...link, token: 'B'.repeat(18) }),
    ).rejects.toThrow(/duplicate key/);
    await expect(Links.create({ ...link, contest: newId() })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      Links.create({ ...link, contest: newId(), token: 'short' }),
    ).rejects.toThrow(/token/);
    await expect(
      Links.create({
        ...link,
        contest: newId(),
        token: 'C'.repeat(18),
        expiryMode: 'X',
      }),
    ).rejects.toThrow(/expiryMode/);
  });

  it('defaults dataPreparedAt to null', async () => {
    const contest = await Contests.create({
      key: 'extras_1',
      name: 'Extras',
      startTime: new Date(),
      endTime: new Date(Date.now() + 3_600_000),
    });
    expect(contest.dataPreparedAt).toBeNull();
  });
});
