import type { Model } from 'mongoose';
import { ActivityWriterRepository } from './activity-writer.repository';
import type { ActivityRow } from './activity-row';

const row = (sessionKey: string, userAgent = 'UA'): ActivityRow => ({
  userId: null,
  sessionKey,
  ip: '1.1.1.1',
  userAgent,
  referer: '',
  path: '/api/internal/tags',
  method: 'GET',
  statusCode: 200,
  at: new Date(),
});

describe('ActivityWriterRepository', () => {
  const duplicate = Object.assign(new Error('E11000 duplicate key'), {
    code: 11000,
  });
  const make = (bulkWrite: jest.Mock) =>
    new ActivityWriterRepository(
      {
        insertMany: jest.fn().mockResolvedValue([]),
      } as unknown as Model<never>,
      { bulkWrite } as unknown as Model<never>,
      {} as Model<never>,
    );

  it('retries the session upsert once when another process created the session first', async () => {
    const bulkWrite = jest
      .fn()
      .mockRejectedValueOnce(duplicate)
      .mockResolvedValueOnce({});
    await expect(make(bulkWrite).write([row('a')])).resolves.toBeUndefined();
    expect(bulkWrite).toHaveBeenCalledTimes(2);
  });

  it('does not hide other failures, nor retry forever', async () => {
    const down = jest.fn().mockRejectedValue(new Error('mongo down'));
    await expect(make(down).write([row('a')])).rejects.toThrow('mongo down');
    expect(down).toHaveBeenCalledTimes(1);
    const always = jest.fn().mockRejectedValue(duplicate);
    await expect(make(always).write([row('a')])).rejects.toBe(duplicate);
    expect(always).toHaveBeenCalledTimes(2);
  });

  it('upserts one session per key, from the newest row', async () => {
    const bulkWrite = jest.fn().mockResolvedValue({});
    const first = row('a', 'Old agent');
    const newest = {
      ...row('a', 'New agent'),
      at: new Date(first.at.getTime() + 1),
    };
    await make(bulkWrite).write([first, row('b'), newest]);
    const [operations] = bulkWrite.mock.calls[0] as [
      Array<{
        updateOne: {
          filter: { sessionKey: string };
          update: { $set: { userAgent: string } };
        };
      }>,
    ];
    expect(
      operations.map(({ updateOne }) => [
        updateOne.filter.sessionKey,
        updateOne.update.$set.userAgent,
      ]),
    ).toEqual([
      ['a', 'New agent'],
      ['b', 'UA'],
    ]);
  });
});
