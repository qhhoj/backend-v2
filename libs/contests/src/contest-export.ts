import { join } from 'node:path';
import { isUuid } from '@libs/database';
import { oneJobPerContest } from './queues';
import { DAY_MS, HOUR_MS } from '@libs/common';

export const CONTEST_EXPORT_QUEUE = 'contest-export';
export const CONTEST_EXPORT_JOB = 'export';
/** The hourly sweep of `CONTEST_DATA_ROOT` (export and data zips) runs on the export queue. */
export const CONTEST_ZIP_SWEEP_JOB = 'sweep';
export const CONTEST_ZIP_SWEEP_SCHEDULER = 'contest-zip-sweep-hourly';
export const CONTEST_ZIP_SWEEP_MS = HOUR_MS;
/** A contest's export and data zips are removed a week after they were built (they hold every contestant's source); an editor prepares a new one. */
export const CONTEST_ZIP_TTL_MS = 7 * DAY_MS;
/** Zip every live contest submission with its source, plus a `submissions.csv`. */
export interface ContestExportJob {
  contestId: string;
}

const fileName = (contestId: string) => {
  if (!isUuid(contestId)) throw new Error('Not a contest id');
  return `${contestId}.export.zip`;
};
/** The id is the only variable part, so the path never leaves the root; the name differs from the data zip's. */
export const contestExportPath = (root: string, contestId: string) =>
  join(root, fileName(contestId));
export const contestExportJobId = (contestId: string) =>
  oneJobPerContest('export', contestId).jobId;
