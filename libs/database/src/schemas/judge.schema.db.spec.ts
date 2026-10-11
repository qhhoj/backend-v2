import mongoose from 'mongoose';
import { startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { JudgeSchema } from './judge.schema';

describe('Judge schema', () => {
  let replSet: TestMongo;
  const Judges = mongoose.model('JudgeSchemaSpec', JudgeSchema);
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Judges.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });
  it('rejects a duplicate name and names that are not hostname-like', async () => {
    await Judges.create({ name: 'judge-01', authKeyHash: 'h' });
    await expect(
      Judges.create({ name: 'judge-01', authKeyHash: 'h' }),
    ).rejects.toThrow(/duplicate key/);
    for (const name of ['', 'has space', 'x'.repeat(51), 'a/b'])
      await expect(Judges.create({ name, authKeyHash: 'h' })).rejects.toThrow(
        /validation failed/,
      );
  });
});
