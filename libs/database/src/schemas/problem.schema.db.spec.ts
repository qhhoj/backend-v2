import mongoose from 'mongoose';
import { startMongo } from '../testing';
import type { TestMongo } from '../testing';
import { newId } from '../uuid';
import { ProblemSchema } from './problem.schema';

describe('Problem schema', () => {
  let replSet: TestMongo;
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
  it('lets only one problem hold a Polygon problem, while unlinked problems repeat freely', async () => {
    const link = (problemId: number | null) =>
      problemId === null ? null : { problemId };
    const make = (code: string, problemId: number | null) =>
      Problems.collection.insertOne({
        ...base,
        _id: newId() as never,
        code,
        polygonLink: link(problemId),
      });
    await make('link_a', 7);
    await make('unlinked_a', null);
    await make('unlinked_b', null);
    await expect(make('link_b', 7)).rejects.toThrow(/duplicate key/);
    await make('link_c', 8);
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
