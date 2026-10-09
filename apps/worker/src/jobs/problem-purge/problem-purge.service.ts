import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { StorageService } from '@libs/common';
import { uuidStr } from '@libs/database';
import {
  enqueuePurge,
  PackageCacheService,
  PdfCacheService,
  PROBLEM_PURGE_QUEUE,
  ProblemDataFilesService,
} from '@libs/problems';
import type { ProblemPurgeJob } from '@libs/problems';
import { SettingsService } from '@libs/settings';
import { ProblemPurgeRepository } from './problem-purge.repository';
import type { PurgeTarget } from './problem-purge.repository';

const DAY_MS = 86_400_000;

export interface PurgeCounts {
  comments: number;
  revisions: number;
}

/** A purge claim this old belongs to a job that died. */
const STALE_CLAIM_MS = 60 * 60 * 1000;

/** Takes a deleted problem's heavy data and leaves the tombstone. Every step is idempotent and `purgeStartedAt` is claimed first, so a killed run is simply run again (by the job's retry, or by the sweep once the claim is an hour old) and a restore can no longer slip in; `purgedAt` is written last. Submissions and everything that points at them are never touched. */
@Injectable()
export class ProblemPurgeService {
  private readonly logger = new Logger(ProblemPurgeService.name);

  constructor(
    private readonly repository: ProblemPurgeRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly pdfCache: PdfCacheService,
    private readonly packages: PackageCacheService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    @InjectQueue(PROBLEM_PURGE_QUEUE)
    private readonly queue: Queue<ProblemPurgeJob>,
  ) {}

  /** Null for a live (or restored, or unknown) problem. Runs regardless of the grace period: the sweep and `purge-now` both decide when. */
  async purge(
    problemId: string,
    now = new Date(),
  ): Promise<PurgeCounts | null> {
    const problem = await this.repository.findTarget(problemId);
    if (!problem?.deletedAt) return null;
    if (!problem.purgedAt && !(await this.repository.claim(problemId, now)))
      return null;
    // A finished purge (purgedAt set) runs through again as a no-op; an unfinished one resumes.
    await this.removeFiles(problem);
    const counts = {
      comments: await this.repository.removeComments(problemId),
      revisions: await this.repository.removeRevisions(problemId),
    };
    await this.repository.emptyToTombstone(problemId, now);
    this.logger.log(
      JSON.stringify({
        event: 'problem-purged',
        problemId,
        code: problem.code,
        ...counts,
      }),
    );
    return counts;
  }

  /** Daily: one `purge` job per problem deleted longer ago than `problem.deleteGraceDays`. */
  async sweep(now = new Date()): Promise<number> {
    const graceMs = this.settings.get('problem.deleteGraceDays') * DAY_MS;
    const ids = await this.repository.expiredIds(
      new Date(now.getTime() - graceMs),
      new Date(now.getTime() - STALE_CLAIM_MS),
    );
    for (const id of ids) await enqueuePurge(this.queue, id);
    this.logger.log(
      JSON.stringify({ event: 'problem-purge-sweep', expired: ids.length }),
    );
    return ids.length;
  }

  private async removeFiles(problem: PurgeTarget): Promise<void> {
    await this.dataFiles.removeDirectory(problem.code);
    await this.pdfCache.delete(problem.code);
    await this.packages.deleteAll(problem.code);
    await this.removeUpload(problem, 'pdfStatementUrl', 'pdf');
    await this.removeUpload(problem, 'materialUrl', 'materials');
  }

  /** An upload another problem still points at stays. */
  private async removeUpload(
    problem: PurgeTarget,
    field: 'pdfStatementUrl' | 'materialUrl',
    kind: 'pdf' | 'materials',
  ): Promise<void> {
    const url = problem[field];
    const path = this.storage.relativePathOf(url, kind);
    if (!url || !path) return;
    const others = await this.repository.countOtherReferences(
      field,
      url,
      uuidStr(problem._id),
    );
    if (!others) await this.storage.delete(path);
  }
}
