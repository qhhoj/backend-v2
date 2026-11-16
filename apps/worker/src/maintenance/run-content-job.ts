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
  /** Planned rows whose new text differs from the old by more than whitespace. */
  significant: number;
  written: number;
  sample: string[];
  skipped: Record<string, number>;
}

const withoutWhitespace = (text: string) =>
  text.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

/** True when some column differs by more than whitespace. */
export function isSignificant({ before, after }: RowChange): boolean {
  return Object.keys(before).some(
    (column) =>
      withoutWhitespace(before[column]) !== withoutWhitespace(after[column]),
  );
}

/** The first differing stretch of the change's first column, both sides, on one line. */
export function excerptOf({
  collection,
  id,
  before,
  after,
}: RowChange): string {
  const column =
    Object.keys(before).find(
      (name) =>
        withoutWhitespace(before[name]) !== withoutWhitespace(after[name]),
    ) ?? Object.keys(before)[0];
  const [old, next] = [before[column], after[column]];
  let start = 0;
  while (start < old.length && old[start] === next[start]) start += 1;
  const from = Math.max(0, start - EXCERPT_BEFORE);
  const show = (text: string) =>
    JSON.stringify(text.slice(from, start + EXCERPT_AFTER));
  return `${collection} ${id} ${column}: ${show(old)} -> ${show(next)}`;
}

/** Dry run (default) plans every chunk and writes nothing. `apply` first stores each chunk's old and new columns in the backup file, then its files, then the rows. */
export async function runContentJob(
  job: ContentJob,
  options: JobOptions,
  storage: StorageService,
): Promise<JobReport> {
  const logger = new Logger(job.name);
  const report: JobReport = {
    planned: 0,
    significant: 0,
    written: 0,
    sample: [],
    skipped: {},
  };
  const tally = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };
  const backup = options.apply
    ? await BackupFile.create(options.backup!)
    : null;
  try {
    for await (const changes of job.scan(CHUNK, tally)) {
      report.planned += changes.length;
      for (const change of changes.filter(isSignificant)) {
        report.significant += 1;
        if (report.sample.length < SAMPLE)
          report.sample.push(excerptOf(change));
      }
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
    `${name}: ${options.apply ? 'APPLY' : 'DRY RUN'}; ${report.planned} rows to change (${report.significant} differ by more than whitespace), ${report.written} written`,
  );
  for (const [reason, count] of Object.entries(report.skipped))
    console.log(`left alone: ${reason}: ${count}`);
  if (report.sample.length)
    console.log(
      `first ${report.sample.length} rows that differ by more than whitespace:`,
    );
  for (const line of report.sample) console.log(`  ${line}`);
  if (!options.apply)
    console.log('nothing written; add --apply --backup <file> to write');
}
