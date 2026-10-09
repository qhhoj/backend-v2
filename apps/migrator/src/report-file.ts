import { writeFile } from 'node:fs/promises';

/** One `job: line` per distinct report line, in job order. Lines carry legacy ids, codes and keys only, never row content. */
export function reportText(reports: Record<string, string[]>): string {
  return Object.entries(reports)
    .flatMap(([job, lines]) => lines.map((line) => `${job}: ${line}`))
    .join('\n');
}

/** Saves every report line (mode 600; the console shows only a few per job). */
export async function writeReportFile(
  path: string,
  reports: Record<string, string[]>,
): Promise<void> {
  await writeFile(path, `${reportText(reports)}\n`, { mode: 0o600 });
}
