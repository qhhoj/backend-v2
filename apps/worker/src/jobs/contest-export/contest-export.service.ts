import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { contestExportPath, contestExportTempPath } from '@libs/contests';
import type { ContestExportJob } from '@libs/contests';
import { chunkedSources, writeZipInPlace } from '../lazy-zip';
import {
  CONTEST_EXPORT_LIMITS,
  ContestExportError,
} from './contest-export.limits';
import type { ContestExportLimits } from './contest-export.limits';
import { ContestExportRepository } from './contest-export.repository';
import { exportCsv } from './export-csv';
import type { ExportRow } from './export-csv';

const safeSuffix = (extension: string) =>
  extension.replace(/[^A-Za-z0-9]/g, '') || 'txt';

@Injectable()
export class ContestExportService {
  constructor(
    private readonly repository: ContestExportRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(CONTEST_EXPORT_LIMITS) private readonly limits: ContestExportLimits,
  ) {}

  /** `submissions.csv` first, then `sources/<problem code>/<submission id>.<ext>` for every row whose problem was not deleted since the contest (a deleted problem's sources are for their owners and staff only, and the zip goes to any editor). The previous zip goes first; the new one is written beside it and renamed into place. Returns the entry count. */
  async prepare({ contestId }: ContestExportJob): Promise<number> {
    const root = this.env.contestDataRoot;
    if (!root)
      throw new ContestExportError('Contest data download is not configured');
    const [path, temporaryPath] = [
      contestExportPath(root, contestId),
      contestExportTempPath(root, contestId, randomUUID()),
    ];
    await mkdir(root, { recursive: true });
    await rm(path, { force: true });
    const contest = await this.repository.findContest(contestId);
    if (!contest) return 0;
    await this.assertWithinEntryCap(contest._id);
    const rows = await this.repository.rows(contest);
    return this.writeZip(rows, path, temporaryPath);
  }

  private async writeZip(
    rows: ExportRow[],
    path: string,
    temporaryPath: string,
  ): Promise<number> {
    const withSource = rows.filter((row) => row.hasSource);
    const names = [
      'submissions.csv',
      ...withSource.map(
        (row) =>
          `sources/${row.problem}/${row.submissionId}.${safeSuffix(row.extension)}`,
      ),
    ];
    const source = chunkedSources(
      withSource.map((row) => row.submissionId),
      this.limits.sourceChunk,
      (ids) => this.repository.sources(ids),
    );
    const csv = exportCsv(rows);
    await writeZipInPlace(
      names,
      (index) => (index === 0 ? Promise.resolve(csv) : source(index - 1)),
      {
        path,
        temporaryPath,
        maxBytes: this.limits.maxBytes,
        tooLarge: () =>
          new ContestExportError(
            `The export passes ${this.limits.maxBytes} bytes`,
          ),
      },
    );
    return names.length;
  }

  private async assertWithinEntryCap(contestId: string): Promise<void> {
    const count = await this.repository.countSubmissions(contestId);
    if (count + 1 > this.limits.maxEntries)
      throw new ContestExportError(
        `Too many submissions to export (more than ${this.limits.maxEntries - 1})`,
      );
  }
}
