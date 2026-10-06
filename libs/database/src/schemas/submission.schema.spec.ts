import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import {
  MAX_CASE_FEEDBACK_LENGTH,
  MAX_SOURCE_LENGTH,
  SubmissionSchema,
} from './submission.schema';
import { SubmissionSourceSchema } from './submission-source.schema';

describe('Submission schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Submissions = mongoose.model('SubmissionSchemaSpec', SubmissionSchema);
  const Sources = mongoose.model(
    'SubmissionSourceSchemaSpec',
    SubmissionSourceSchema,
  );
  const references = () => ({
    user: newId(),
    problem: newId(),
    language: newId(),
  });
  const acceptedCase = {
    position: 1,
    status: 'AC',
    time: 0.1,
    memory: 1024,
    points: 1,
    total: 1,
  };
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Submissions.syncIndexes(), Sources.syncIndexes()]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('starts queued at normal priority, ungraded and never requeued', async () => {
    const submission = await Submissions.create(references());
    expect(submission.toObject()).toMatchObject({
      status: 'QU',
      result: null,
      priority: 1,
      points: null,
      casePoints: 0,
      caseTotal: 0,
      requeueCount: 0,
      judgedOn: null,
      contest: null,
      lockedAfter: null,
    });
    expect(submission.date.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it.each([
    [{ status: 'PD' }],
    [{ result: 'XX' }],
    [{ priority: 4 }],
    [{ cases: [{ ...acceptedCase, status: 'RJ' }] }],
    [
      {
        cases: [
          {
            ...acceptedCase,
            feedback: 'x'.repeat(MAX_CASE_FEEDBACK_LENGTH + 1),
          },
        ],
      },
    ],
  ])('rejects %j', async (fields) => {
    await expect(
      Submissions.create({ ...references(), ...fields }),
    ).rejects.toThrow(/validation failed/);
  });
  it('leaves cases out of queries unless selected', async () => {
    const { _id } = await Submissions.create({
      ...references(),
      cases: [acceptedCase],
    });
    expect((await Submissions.findById(_id).lean())?.cases).toBeUndefined();
    expect(
      (await Submissions.findById(_id).select('+cases').lean())?.cases,
    ).toEqual([
      expect.objectContaining({ position: 1, status: 'AC', batch: null }),
    ]);
  });
  it('keys a source by its submission id and caps it at 65536 characters', async () => {
    const id = newId();
    await Sources.create({ _id: id, source: 'x'.repeat(MAX_SOURCE_LENGTH) });
    expect((await Sources.findById(id))?.source).toHaveLength(
      MAX_SOURCE_LENGTH,
    );
    await expect(Sources.create({ _id: id, source: 'again' })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      Sources.create({
        _id: newId(),
        source: 'x'.repeat(MAX_SOURCE_LENGTH + 1),
      }),
    ).rejects.toThrow(/validation failed/);
  });
});
