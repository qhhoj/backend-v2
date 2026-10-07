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
/** One name per run, so a run that lost its lock never renames or removes another run's file. */
export const contestDataTempPath = (
  root: string,
  contestId: string,
  runId: string,
) => `${contestDataPath(root, contestId)}.${runId}.tmp`;

export const canPrepareData = (
  preparedAt: Date | null,
  zipExists: boolean,
  now: Date,
): boolean =>
  preparedAt === null ||
  !zipExists ||
  preparedAt.getTime() + CONTEST_DATA_PREPARE_INTERVAL_MS < now.getTime();

/** Problem codes plus `*` and `?`, checked by the api before a job is queued. */
export const PROBLEM_GLOB_PATTERN = /^[a-z0-9_*?]{1,100}$/;

/** Legacy `fnmatch` on problem codes (`*` any run, `?` one character): greedy two-pointer matching, O(glob × code), never a regex built from input. */
export function matchesGlob(glob: string, code: string): boolean {
  let globIndex = 0;
  let codeIndex = 0;
  let starIndex = -1;
  let resumeIndex = 0;
  while (codeIndex < code.length) {
    const wildcard = glob[globIndex];
    if (
      wildcard === '?' ||
      (wildcard !== undefined &&
        wildcard !== '*' &&
        wildcard === code[codeIndex])
    ) {
      globIndex += 1;
      codeIndex += 1;
    } else if (wildcard === '*') {
      starIndex = globIndex;
      globIndex += 1;
      resumeIndex = codeIndex;
    } else if (starIndex >= 0) {
      globIndex = starIndex + 1;
      resumeIndex += 1;
      codeIndex = resumeIndex;
    } else return false;
  }
  while (glob[globIndex] === '*') globIndex += 1;
  return globIndex === glob.length;
}
