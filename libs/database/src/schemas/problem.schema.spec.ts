import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { ProblemSchema } from './problem.schema';

describe('Problem schema', () => {
  let replSet: MongoMemoryReplSet;
  const Problems = mongoose.model('ProblemSchemaSpec', ProblemSchema);
  const base = {
    name: 'Sum',
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    typeIds: [newId()],
    groupId: newId(),
  };
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Problems.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('stores a Vietnamese translation despite the text index and finds it by $text', async () => {
    await Problems.create({
      ...base,
      code: 'tong',
      translations: [
        {
          language: 'vi',
          name: 'Tính tổng',
          description: '',
          descriptionHtml: '',
        },
      ],
    });
    expect(await Problems.find({ $text: { $search: 'tổng' } })).toHaveLength(1);
    expect(await Problems.find({ $text: { $search: 'tong' } })).toHaveLength(1);
  });
  it('weights code over name', async () => {
    await Problems.create({ ...base, code: 'sum', name: 'Tong' });
    const [first] = await Problems.find({ $text: { $search: 'tong' } }).sort({
      score: { $meta: 'textScore' },
    });
    expect(first.code).toBe('tong');
  });
  it('rejects duplicate and malformed codes', async () => {
    await expect(Problems.create({ ...base, code: 'tong' })).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      Problems.create({ ...base, code: 'Bad-Code' }),
    ).rejects.toThrow(/validation failed/);
  });
  it('refuses a per-case bridged checker', async () => {
    await expect(
      Problems.create({
        ...base,
        code: 'casebridged',
        data: { cases: [{ type: 'C', checker: 'bridged' }] },
      }),
    ).rejects.toThrow(/validation failed/);
  });
});
