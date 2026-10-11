import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ContestPublicRankingLinkSchema } from './contest-public-ranking-link.schema';
import { RatingSchema } from './rating.schema';

describe('Contest extras schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Ratings = mongoose.model('RatingSchemaSpec', RatingSchema);
  const Links = mongoose.model(
    'ContestPublicRankingLinkSchemaSpec',
    ContestPublicRankingLinkSchema,
  );

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Ratings, Links].map((model) => model.syncIndexes()));
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

  it('keeps one public ranking link per contest, unique 18-character tokens and known modes', async () => {
    const link = {
      contest: newId(),
      token: 'A'.repeat(18),
      regeneratedAt: new Date(),
    };
    await Links.create(link);
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
});
