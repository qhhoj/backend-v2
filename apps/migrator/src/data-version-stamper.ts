import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';

/** The api's own stamp reader and writer, so the backfill writes exactly what the api writes. */
export type DataVersionFiles = Pick<
  ProblemDataFilesService,
  'exists' | 'readDataVersion' | 'writeDataVersion'
>;

/** These three methods read only `problemDataRoot` and never touch Redis (the data lock is not needed offline, in the window). */
export const dataVersionFiles = (root: string): DataVersionFiles =>
  new ProblemDataFilesService({ problemDataRoot: root } as Env, null as never);

export interface ProblemVersion {
  code: string;
  dataVersion: number;
}

export interface StampSummary {
  written: number;
  kept: number;
  missingDirectory: number;
  invalidCode: number;
}

type Outcome = keyof StampSummary;
interface StampOptions {
  files: DataVersionFiles;
  dryRun: boolean;
}

async function stampOne(
  { code, dataVersion }: ProblemVersion,
  { files, dryRun }: StampOptions,
): Promise<Outcome> {
  if (!PROBLEM_CODE_PATTERN.test(code)) return 'invalidCode';
  // `exists` refuses (throws) a directory that leaves the root through a symlink.
  if (!(await files.exists(code))) return 'missingDirectory';
  // A garbage stamp reads as null: replaced like a missing one.
  const current = await files.readDataVersion(code);
  if (current !== null && current >= dataVersion) return 'kept';
  if (!dryRun) await files.writeDataVersion(code, dataVersion);
  return 'written';
}

/** Idempotent: missing or lower stamps are raised to the problem's dataVersion, never lowered. Run after the last rsync. */
export async function stampDataVersions(
  problems: AsyncIterable<ProblemVersion> | Iterable<ProblemVersion>,
  options: StampOptions,
): Promise<StampSummary> {
  const summary: StampSummary = {
    written: 0,
    kept: 0,
    missingDirectory: 0,
    invalidCode: 0,
  };
  for await (const problem of problems)
    summary[await stampOne(problem, options)] += 1;
  return summary;
}
