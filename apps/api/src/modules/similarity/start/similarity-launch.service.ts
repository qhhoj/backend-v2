import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { SimilarityError, SimilarityLimits } from '@libs/database';
import { enqueueSimilarity, SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import { SettingsService } from '@libs/settings';
import type { ScopeTarget } from '../core/similarity-access.service';
import { SimilarityRunsRepository } from '../core/similarity-runs.repository';

const NEVER_QUEUED: SimilarityError = 'internal_error';

/** The second step of a start, after access and the rate limit (`SimilarityStartService`): frees a stale run, creates the scope's one active run with the limits in force now, and queues its job. */
@Injectable()
export class SimilarityLaunchService {
  private readonly logger = new Logger(SimilarityLaunchService.name);

  constructor(
    private readonly runs: SimilarityRunsRepository,
    private readonly settings: SettingsService,
    @InjectQueue(SIMILARITY_QUEUE) private readonly queue: Queue<SimilarityJob>,
  ) {}

  /** Returns the run id; 409 while the scope has an active run. */
  async createAndQueue(
    requestedBy: string,
    target: ScopeTarget,
  ): Promise<string> {
    await this.runs.releaseStale(target.scopeKey);
    const run = await this.runs.createRun({
      ...target,
      requestedBy,
      limits: this.currentLimits(),
    });
    if (!run)
      throw new AppError(
        'conflict',
        409,
        'A similarity run is already active for this scope',
      );
    const runId = uuidStr(run._id);
    try {
      await enqueueSimilarity(this.queue, runId);
    } catch (enqueueError) {
      await this.discardUnqueued(runId);
      throw enqueueError;
    }
    return runId;
  }

  /** Snapshotted on the run: the worker never reads settings. */
  private currentLimits(): SimilarityLimits {
    return {
      minPercent: this.settings.get('similarity.minPercent'),
      maxPairs: this.settings.get('similarity.maxPairs'),
      maxSubmissions: this.settings.get('similarity.maxSubmissions'),
    };
  }

  /** No job will ever finish this run: remove it, or at least free its scope. Never throws, so the caller still sees the enqueue error. */
  private async discardUnqueued(runId: string): Promise<void> {
    try {
      await this.runs.deleteRun(runId);
    } catch (deleteError) {
      this.logger.error(`Deleting unqueued run ${runId} failed`, deleteError);
      await this.runs
        .failRun(runId, NEVER_QUEUED)
        .catch((failError: unknown) =>
          this.logger.error(`Failing unqueued run ${runId} failed`, failError),
        );
    }
  }
}
