import mongoose from 'mongoose';
import { startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { newId } from '../uuid';
import { SimilarityPairSchema } from './similarity-pair.schema';
import { SimilarityRunSchema } from './similarity-run.schema';

describe('similarity schemas', () => {
  let replSet: TestMongo;
  const Runs = mongoose.model('SimilarityRunSchemaSpec', SimilarityRunSchema);
  const Pairs = mongoose.model(
    'SimilarityPairSchemaSpec',
    SimilarityPairSchema,
  );
  const limits = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
  const run = (overrides: Record<string, unknown> = {}) => {
    const problem = newId();
    return {
      scope: 'problem',
      scopeKey: `problem:${problem}`,
      problem,
      requestedBy: newId(),
      limits,
      ...overrides,
    };
  };

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Runs, Pairs].map((model) => model.syncIndexes()));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('allows one active run per scope, but any number of finished ones', async () => {
    const first = run();
    await Runs.create(first);
    await expect(Runs.create(first)).rejects.toThrow(/duplicate key/);
    await Runs.updateOne(
      { scopeKey: first.scopeKey },
      { active: false, status: 'done' },
    );
    await Runs.create(first);
    await Runs.create({ ...first, active: false, status: 'failed' });
    expect(await Runs.countDocuments({ scopeKey: first.scopeKey })).toBe(3);
  });

  it('refuses unknown scopes, statuses and error codes', async () => {
    await expect(Runs.create(run({ scope: 'user' }))).rejects.toThrow(/scope/);
    await expect(Runs.create(run({ status: 'paused' }))).rejects.toThrow(
      /status/,
    );
    await expect(
      Runs.create(run({ status: 'failed', error: 'disk on fire' })),
    ).rejects.toThrow(/error/);
  });

  it('bounds pair similarity to 0..1 and line ranges to 1 or more', async () => {
    const pair = (overrides: Record<string, unknown> = {}) => ({
      run: newId(),
      problem: newId(),
      language: 'cpp',
      left: { submission: newId(), user: newId() },
      right: { submission: newId(), user: newId() },
      similarity: 0.9,
      longestFragment: 12,
      totalOverlap: 30,
      fragments: [{ leftStart: 1, leftEnd: 4, rightStart: 2, rightEnd: 5 }],
      ...overrides,
    });
    await Pairs.create(pair());
    await expect(Pairs.create(pair({ similarity: 1.2 }))).rejects.toThrow(
      /similarity/,
    );
    await expect(
      Pairs.create(
        pair({
          fragments: [{ leftStart: 0, leftEnd: 1, rightStart: 1, rightEnd: 1 }],
        }),
      ),
    ).rejects.toThrow(/leftStart/);
    await expect(
      Pairs.create(pair({ right: { submission: newId() } })),
    ).rejects.toThrow(/user/);
  });
});
