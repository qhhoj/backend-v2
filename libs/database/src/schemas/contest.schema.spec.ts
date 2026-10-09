import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ContestSchema, MAX_CONTEST_PROBLEMS } from './contest.schema';
import { ContestParticipationSchema } from './contest-participation.schema';
import { ContestSubmissionSchema } from './contest-submission.schema';
import { SubmissionSchema } from './submission.schema';

describe('Contest schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Contests = mongoose.model('ContestSchemaSpec', ContestSchema);
  const Participations = mongoose.model(
    'ContestParticipationSchemaSpec',
    ContestParticipationSchema,
  );
  const ContestSubmissions = mongoose.model(
    'ContestSubmissionSchemaSpec',
    ContestSubmissionSchema,
  );
  const Submissions = mongoose.model(
    'ContestSubmissionStatusSpec',
    SubmissionSchema,
  );
  const window = () => ({
    startTime: new Date('2026-01-01T00:00:00Z'),
    endTime: new Date('2026-01-01T03:00:00Z'),
  });

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Contests, Participations, ContestSubmissions, Submissions].map((model) =>
        model.syncIndexes(),
      ),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('indexes managedBy for client-managed contests only, not for the null every contest carries', async () => {
    const managedBy = newId();
    await Contests.create({
      key: 'managed_1',
      name: 'Managed',
      managedBy,
      ...window(),
    });
    await Contests.create({ key: 'human_1', name: 'Human', ...window() });
    const plan = async (filter: object) =>
      JSON.stringify(await Contests.find(filter).explain('queryPlanner'));
    const typed = { $type: 'binData' };
    expect(await plan({ managedBy: { ...typed, $eq: managedBy } })).toContain(
      'IXSCAN',
    );
    expect(await plan({ managedBy: null })).not.toContain('IXSCAN');
    const index = (await Contests.collection.indexes()).find(
      (candidate) => candidate.name === 'managedBy_1',
    );
    expect(index).toMatchObject({
      partialFilterExpression: { managedBy: { $type: 'binData' } },
    });
    expect(index?.sparse).toBeUndefined();
  });

  it('defaults a new contest to a hidden, unrated default-format contest with numeric labels', async () => {
    const contest = await Contests.create({
      key: 'round_1',
      name: 'Round 1',
      ...window(),
    });
    expect(contest.toObject()).toMatchObject({
      formatName: 'default',
      formatConfig: {},
      labelStyle: 'numeric',
      scoreboardVisibility: 'V',
      pointsPrecision: 3,
      isVisible: false,
      isRated: false,
      timeLimit: null,
      accessCodeHash: null,
      frozenLastMinutes: 0,
      scoreboardCacheTimeout: 0,
      userCount: 0,
      virtualCount: 0,
      problems: [],
    });
  });

  it.each(['Round', 'round-1', '', 'x'.repeat(33)])(
    'rejects the key %p',
    async (key) => {
      await expect(
        Contests.create({ key, name: 'Bad', ...window() }),
      ).rejects.toThrow(/key/);
    },
  );

  it('keeps contest keys unique', async () => {
    await Contests.create({ key: 'unique_key', name: 'A', ...window() });
    await expect(
      Contests.create({ key: 'unique_key', name: 'B', ...window() }),
    ).rejects.toThrow(/duplicate key/);
  });

  it.each([
    [{ formatName: 'atcoder' }, /formatName/],
    [{ labelStyle: 'roman' }, /labelStyle/],
    [{ scoreboardVisibility: 'X' }, /scoreboardVisibility/],
    [{ pointsPrecision: 11 }, /pointsPrecision/],
    [{ tags: ['Bad Tag'] }, /tags/],
    [{ timeLimit: 0 }, /timeLimit/],
    [{ accessCodeHash: 'letmein' }, /accessCodeHash/],
    [{ rankingAccessCodeHash: 'letmein' }, /rankingAccessCodeHash/],
    [{ formatConfig: null }, /formatConfig/],
    [{ formatConfig: 'abc' }, /formatConfig/],
    [{ problems: [{ problem: newId(), points: -1, order: 0 }] }, /points/],
  ])('rejects %p', async (fields, field) => {
    await expect(
      Contests.create({ key: newKey(), name: 'C', ...window(), ...fields }),
    ).rejects.toThrow(field);
  });

  it('rejects a problem listed twice in a contest', async () => {
    const problem = newId();
    await expect(
      Contests.create({
        key: newKey(),
        name: 'C',
        ...window(),
        problems: [
          { problem, points: 100, order: 0 },
          { problem, points: 50, order: 1 },
        ],
      }),
    ).rejects.toThrow(/problems/);
  });

  it('caps a contest at MAX_CONTEST_PROBLEMS problems', async () => {
    const problems = (count: number) =>
      Array.from({ length: count }, (unused, order) => ({
        problem: newId(),
        points: 1,
        order,
      }));
    await Contests.create({
      key: newKey(),
      name: 'Full',
      ...window(),
      problems: problems(MAX_CONTEST_PROBLEMS),
    });
    await expect(
      Contests.create({
        key: newKey(),
        name: 'Over',
        ...window(),
        problems: problems(MAX_CONTEST_PROBLEMS + 1),
      }),
    ).rejects.toThrow(/problems/);
  });

  it('allows one participation per contest, user and virtual number', async () => {
    const fields = { contest: newId(), user: newId(), realStart: new Date() };
    await Participations.create({ ...fields, virtual: 0 });
    await Participations.create({ ...fields, virtual: 1 });
    await expect(
      Participations.create({ ...fields, virtual: 0 }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('starts a participation live, unscored, not registered and not disqualified', async () => {
    const participation = await Participations.create({
      contest: newId(),
      user: newId(),
      realStart: new Date(),
    });
    expect(participation.toObject()).toMatchObject({
      virtual: 0,
      score: 0,
      cumtime: 0,
      tiebreaker: 0,
      frozenScore: 0,
      frozenCumtime: 0,
      frozenTiebreaker: 0,
      formatData: {},
      frozenFormatData: {},
      isDisqualified: false,
      isRegistered: false,
    });
  });

  it.each([
    [{ formatData: [] }, /formatData/],
    [{ frozenFormatData: null }, /frozenFormatData/],
  ])('rejects %p', async (fields, field) => {
    await expect(
      Participations.create({
        contest: newId(),
        user: newId(),
        realStart: new Date(),
        ...fields,
      }),
    ).rejects.toThrow(field);
  });

  it('keys a contest submission by its submission id', async () => {
    const submissionId = newId();
    await ContestSubmissions.create({
      _id: submissionId,
      participation: newId(),
      contest: newId(),
      problem: newId(),
    });
    expect(
      (await ContestSubmissions.findById(submissionId).lean())?.points,
    ).toBe(0);
  });

  it('accepts the FSO pending status', async () => {
    const submission = await Submissions.create({
      user: newId(),
      problem: newId(),
      language: newId(),
      status: 'PD',
    });
    expect(submission.status).toBe('PD');
  });
});

let keys = 0;
const newKey = () => `contest_${(keys += 1)}`;
