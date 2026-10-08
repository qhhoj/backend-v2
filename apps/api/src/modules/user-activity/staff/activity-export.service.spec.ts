import { Readable } from 'node:stream';
import { ACTIVITY_EXPORT_MAX_ROWS } from '@libs/community';
import { ActivityExportService } from './activity-export.service';
import type { ActivityLogRow } from './activity-logs.repository';

const rowAt = (index: number): ActivityLogRow => ({
  _id: String(index),
  userId: null,
  at: new Date(index),
  ip: '1.1.1.1',
  path: `/p${index}`,
  method: 'GET',
  statusCode: 200,
  userAgent: '',
  referer: '',
});

describe('ActivityExportService', () => {
  const exportOf = (total: number, limits: number[] = []) =>
    new ActivityExportService(
      {
        cursor: (_filter: unknown, limit: number) => {
          limits.push(limit);
          return Readable.from(
            Array.from({ length: total }, (_value, index) => rowAt(index)),
          );
        },
      } as never,
      {
        scopeOf: () => Promise.resolve({ kind: 'any' }),
        usernames: () => Promise.resolve(new Map()),
      } as never,
    );

  it('streams the rows in chunks of at most 1000 lines, header first', async () => {
    const chunks: string[] = [];
    for await (const chunk of exportOf(2500).lines({ days: 7 }))
      chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.split('\r\n').length - 1)).toEqual([
      1, 1000, 1000, 500,
    ]);
  });

  it('asks the cursor for at most the export cap', async () => {
    const limits: number[] = [];
    for await (const chunk of exportOf(1, limits).lines({ days: 7 }))
      void chunk;
    expect(limits).toEqual([ACTIVITY_EXPORT_MAX_ROWS]);
  });
});
