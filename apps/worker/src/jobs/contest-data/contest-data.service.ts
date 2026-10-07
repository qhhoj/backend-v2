import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  contestDataPath,
  contestDataTempPath,
  matchesGlob,
} from '@libs/contests';
import type { ContestDataJob } from '@libs/contests';
import { ContestDataRepository } from './contest-data.repository';
import { CONTEST_DATA_LIMITS, ContestDataError, planEntries } from './data-zip';
import type { ContestDataLimits } from './data-zip';
import { chunkedSources, writeZipInPlace } from '../lazy-zip';

@Injectable()
export class ContestDataService {
  constructor(
    private readonly repository: ContestDataRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(CONTEST_DATA_LIMITS) private readonly limits: ContestDataLimits,
  ) {}

  /** Legacy `prepare_contest_data`. The previous zip goes first; the new one is written beside it and renamed into place. Returns the entry count. */
  async prepare({
    contestId,
    problemGlob,
    results,
  }: ContestDataJob): Promise<number> {
    const root = this.env.contestDataRoot;
    if (!root)
      throw new ContestDataError('Contest data download is not configured');
    const [path, temporary] = [
      contestDataPath(root, contestId),
      contestDataTempPath(root, contestId, randomUUID()),
    ];
    await mkdir(root, { recursive: true });
    await rm(path, { force: true });
    const contest = await this.repository.findContest(contestId);
    if (!contest) return 0;
    const problems = contest.problems
      .filter((problem) => matchesGlob(problemGlob, problem.code))
      .map((problem) => problem.id);
    const rows = await this.repository.rows(contest._id, problems, results);
    if (rows.length > this.limits.maxEntries)
      throw new ContestDataError(
        `More than ${this.limits.maxEntries} submissions; narrow the filter`,
      );
    const entries = planEntries(rows);
    await writeZipInPlace(
      entries.map((entry) => entry.name),
      chunkedSources(
        entries.map((entry) => entry.submissionId),
        this.limits.sourceChunk,
        (ids) => this.repository.sources(ids),
      ),
      path,
      temporary,
      this.limits.maxBytes,
      () =>
        new ContestDataError(
          `The sources pass ${this.limits.maxBytes} bytes; narrow the filter`,
        ),
    );
    return entries.length;
  }
}
