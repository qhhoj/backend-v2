import { join } from 'node:path';
import { isUuid } from '@libs/database';

/** Legacy `DMOJ_USER_DATA_DOWNLOAD_RATELIMIT`: one prepare per day while a zip is ready. */
export const USER_DATA_PREPARE_INTERVAL_MS = 86_400_000;
/** A prepared zip (and its download link) lives seven days; the worker's sweep removes it. */
export const USER_DATA_TTL_MS = 7 * 86_400_000;

const fileName = (userId: string) => {
  if (!isUuid(userId)) throw new Error('Not a user id');
  return `${userId}.zip`;
};
/** The id is the only variable part, so the path never leaves the root. */
export const userDataPath = (root: string, userId: string) =>
  join(root, fileName(userId));
/** One name per run: a run never renames or removes another run's file. */
export const userDataTempPath = (root: string, userId: string, runId: string) =>
  `${userDataPath(root, userId)}.${runId}.tmp`;

export const canPrepareUserData = ({
  preparedAt,
  hasFreshZip,
  now,
}: {
  preparedAt: Date | null;
  hasFreshZip: boolean;
  now: Date;
}): boolean =>
  preparedAt === null ||
  !hasFreshZip ||
  preparedAt.getTime() + USER_DATA_PREPARE_INTERVAL_MS < now.getTime();

export const isUserDataExpired = (readyAt: Date, now: Date): boolean =>
  readyAt.getTime() + USER_DATA_TTL_MS <= now.getTime();
