import type { Model } from 'mongoose';
import { toUuid, uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';

/** Bytes per organization over its private problems (test data plus the uploaded PDF statement and material), grouped by the FIRST listed organization (the one charged). Deleted-but-not-purged problems count (the data is still on disk); a purged tombstone holds none. Organizations with nothing are absent from the map. */
export async function sumStoredBytesByOrganization(
  problems: Model<Problem>,
  organizationIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = organizationIds.map(toUuid);
  const rows = await problems.aggregate<{ _id: unknown; bytes: number }>([
    {
      $match: {
        isOrganizationPrivate: true,
        purgedAt: null,
        organizations: { $in: ids },
      },
    },
    {
      $group: {
        _id: { $arrayElemAt: ['$organizations', 0] },
        bytes: {
          $sum: {
            $add: [
              '$dataBytes',
              { $ifNull: ['$pdfStatementBytes', 0] },
              { $ifNull: ['$materialBytes', 0] },
            ],
          },
        },
      },
    },
    { $match: { _id: { $in: ids } } },
  ]);
  return new Map(rows.map((row) => [uuidStr(row._id), row.bytes]));
}
