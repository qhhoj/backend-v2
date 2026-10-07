import { join } from 'node:path';
import { isUuid } from '@libs/database';

/** Legacy `DMOJ_CONTEST_DATA_DOWNLOAD_RATELIMIT`: one prepare per day unless the zip is missing. */
export const CONTEST_DATA_PREPARE_INTERVAL_MS = 86_400_000;

const fileName = (contestId: string) => {
  if (!isUuid(contestId)) throw new Error('Not a contest id');
  return `${contestId}.zip`;
};
/** The id is the only variable part, so the path never leaves the root. */
export const contestDataPath = (root: string, contestId: string) =>
  join(root, fileName(contestId));
export const contestDataTempPath = (root: string, contestId: string) =>
  `${contestDataPath(root, contestId)}.tmp`;

export const canPrepareData = (
  preparedAt: Date | null,
  zipExists: boolean,
  now: Date,
): boolean =>
  preparedAt === null ||
  !zipExists ||
  preparedAt.getTime() + CONTEST_DATA_PREPARE_INTERVAL_MS < now.getTime();
