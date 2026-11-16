import { Logger } from '@nestjs/common';
import { StorageService } from '@libs/common';
import { BackupFile } from './backup-file';
import type { ContentJob, RowChange } from './content-job';
import type { JobOptions } from './job-options';

const CHUNK = 100;
const SAMPLE = 10;
const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

export interface JobReport {
  planned: number;
  written: number;
  sample: string[];
  skipped: Record<string, number>;
}

/** The first differing stretch of the change's first column, both sides, on one line. */
export function excerptOf({
  collection,
  id,
  before,
  after,
}: RowChange): string {
  const [column] = Object.keys(before);
  const [old, next] = [before[column], after[column]];
  let start = 0;
  while (start < old.length && old[start] === next[start]) start += 1;
  const from = Math.max(0, start - EXCERPT_BEFORE);
  const show = (text: string) =>
    JSON.stringify(text.slice(from, start + EXCERPT_AFTER));
  return `${collection} ${id} ${column}: ${show(old)} -> ${show(next)}`;
}

/** Dry run (default) plans every chunk and writes nothing. `apply` first stores each chunk's old columns in the backup file, then its files, then the rows. */
export async function runContentJob(
  job: ContentJob,
  options: JobOptions,
  storage: StorageService,
): Promise<JobReport> {
  const logger = new Logger(job.name);
  const report: JobReport = { planned: 0, written: 0, sample: [], skipped: {} };
  const tally = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };
  const backup = options.apply
    ? await BackupFile.create(options.backup!)
    : null;
  try {
    for await (const changes of job.scan(CHUNK, tally)) {
      report.planned += changes.length;
      for (const change of changes)
        if (report.sample.length < SAMPLE)
          report.sample.push(excerptOf(change));
      if (backup)
        report.written += await applyChunk(job, changes, backup, storage);
      logger.log(`planned ${report.planned}, written ${report.written}`);
    }
  } finally {
    await backup?.close();
  }
  return report;
}

async function applyChunk(
  job: ContentJob,
  changes: readonly RowChange[],
  backup: BackupFile,
  storage: StorageService,
): Promise<number> {
  await backup.append(changes);
  for (const change of changes)
    for (const file of change.files ?? [])
      await storage.save(file.path, file.content);
  return job.write(changes);
}

export function printReport(
  name: string,
  options: JobOptions,
  report: JobReport,
) {
  console.log(
    `${name}: ${options.apply ? 'APPLY' : 'DRY RUN'}; ${report.planned} rows to change, ${report.written} written`,
  );
  for (const [reason, count] of Object.entries(report.skipped))
    console.log(`left alone: ${reason}: ${count}`);
  if (report.sample.length)
    console.log(`first ${report.sample.length} changes:`);
  for (const line of report.sample) console.log(`  ${line}`);
  if (!options.apply)
    console.log('nothing written; add --apply --backup <file> to write');
}
