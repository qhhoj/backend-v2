import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  autoSyncJobId,
  hasNewReadyPackage,
  latestPackageOf,
  POLYGON_QUEUE,
  PolygonClient,
  syncJobOf,
} from '@libs/problems';
import type { PolygonImportJob } from '@libs/problems';
import { PolygonAutoSyncRepository } from './polygon-autosync.repository';
import type { AutoSyncProblem } from './polygon-autosync.repository';

/** A queued automatic sync stays readable (and blocks a duplicate of the same package) for a day. */
const KEEP = { age: 24 * 60 * 60 };

export interface AutoSyncSummary {
  checked: number;
  queued: number;
  deferred: number;
}

@Injectable()
export class PolygonAutoSyncService {
  private readonly logger = new Logger(PolygonAutoSyncService.name);

  constructor(
    private readonly repository: PolygonAutoSyncRepository,
    private readonly polygon: PolygonClient,
    @InjectQueue(POLYGON_QUEUE)
    private readonly imports: Queue<PolygonImportJob>,
  ) {}

  /** One pass over the auto-sync problems; a problem in a running contest is deferred to a later pass. */
  async run(now = new Date()): Promise<AutoSyncSummary> {
    const summary: AutoSyncSummary = { checked: 0, queued: 0, deferred: 0 };
    if (!this.polygon.isConnected()) return summary;
    for (const problem of await this.repository.autoSyncProblems()) {
      summary.checked++;
      if (await this.repository.inRunningContest(problem._id, now))
        summary.deferred++;
      else if (await this.queueIfNewer(problem)) summary.queued++;
    }
    return summary;
  }

  /** One unreachable problem (access revoked, Polygon down) is logged and skipped, never stops the pass. */
  private async queueIfNewer(problem: AutoSyncProblem): Promise<boolean> {
    const link = problem.polygonLink;
    try {
      const latest = latestPackageOf(
        await this.polygon.packages(link.problemId),
      );
      if (!hasNewReadyPackage(link, latest)) return false;
      await this.imports.add(
        'sync',
        syncJobOf(problem, latest, {
          userId: link.linkedBy,
          maxCases: link.options.maxCases,
        }),
        {
          jobId: autoSyncJobId(problem._id, latest.id),
          removeOnComplete: KEEP,
          removeOnFail: KEEP,
        },
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Auto-sync of ${problem.code} skipped: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
