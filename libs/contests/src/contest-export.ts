import { join } from 'node:path';
import { isUuid } from '@libs/database';
import { DAY_MS } from '@libs/common';

/** A contest's export and data zips are removed a week after they were built (they hold every contestant's source); an editor prepares a new one. */
export const CONTEST_ZIP_TTL_MS = 7 * DAY_MS;

const fileName = (contestId: string) => {
  if (!isUuid(contestId)) throw new Error('Not a contest id');
  return `${contestId}.export.zip`;
};
/** The id is the only variable part, so the path never leaves the root; the name differs from the data zip's. */
export const contestExportPath = (root: string, contestId: string) =>
  join(root, fileName(contestId));
