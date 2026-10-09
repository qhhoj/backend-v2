import { lstat, readdir } from 'node:fs/promises';
import type { Env } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { ProblemDataFilesService } from '@libs/problems';

/** The api's own stamp reader and writer, so the backfill writes exactly what the api writes. */
export type DataVersionFiles = Pick<
  ProblemDataFilesService,
  'exists' | 'readDataVersion' | 'writeDataVersion' | 'directoryOf'
>;

/** These methods read only `problemDataRoot` and never touch Redis (the data lock is not needed offline, in the window). */
export const dataVersionFiles = (root: string): DataVersionFiles =>
  new ProblemDataFilesService({ problemDataRoot: root } as Env, null as never);

export interface ProblemVersion {
  code: string;
  dataVersion: number;
}

interface StampCounts {
  written: number;
  kept: number;
  missingDirectory: number;
  invalidCode: number;
}

export interface StampSummary extends StampCounts {
  /** Codes whose data directory is, or holds, a symlink: judge-v2 refuses those (spec §11), so they would IE. */
  symlinked: string[];
}

type Outcome = keyof StampCounts;
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

/** True when the directory itself or anything under it is a symlink (links are listed, never followed). */
export async function hasSymlink(directory: string): Promise<boolean> {
  if ((await lstat(directory)).isSymbolicLink()) return true;
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries.some((entry) => entry.isSymbolicLink());
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
    symlinked: [],
  };
  for await (const problem of problems) {
    const outcome = await stampOne(problem, options);
    summary[outcome] += 1;
    const onDisk = outcome === 'written' || outcome === 'kept';
    if (onDisk && (await hasSymlink(options.files.directoryOf(problem.code))))
      summary.symlinked.push(problem.code);
  }
  return summary;
}
