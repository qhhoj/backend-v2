import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { newId, SubmissionSchema } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import { IS_SOLVED } from './points';

describe('IS_SOLVED (legacy user_completed_ids)', () => {
  let replSet: MongoMemoryReplSet;
  const Submissions = mongoose.model('IsSolvedSpec', SubmissionSchema);
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('selects only an AC whose cases earned every point', async () => {
    const row = (result: string, casePoints: number) => ({
      _id: newId(),
      user: newId(),
      problem: newId(),
      language: newId(),
      result,
      casePoints,
      caseTotal: 10,
    });
    const rows = {
      solved: row('AC', 10),
      partial: row('AC', 7),
      wrong: row('WA', 10),
    };
    await Submissions.insertMany(Object.values(rows));
    const matched = await Submissions.aggregate<{ _id: string }>([
      { $match: { $expr: IS_SOLVED } },
    ]);
    expect(matched.map((submission) => String(submission._id))).toEqual([
      rows.solved._id,
    ]);
  });
});
