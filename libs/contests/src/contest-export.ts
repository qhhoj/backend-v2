import { join } from 'node:path';
import { isUuid } from '@libs/database';
import { oneJobPerContest } from './queues';

export const CONTEST_EXPORT_QUEUE = 'contest-export';
export const CONTEST_EXPORT_JOB = 'export';
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
/** One name per run, so a run that lost its lock never renames or removes another run's file. */
export const contestExportTempPath = (
  root: string,
  contestId: string,
  runId: string,
) => `${contestExportPath(root, contestId)}.${runId}.tmp`;
export const contestExportJobId = (contestId: string) =>
  oneJobPerContest('export', contestId).jobId;
