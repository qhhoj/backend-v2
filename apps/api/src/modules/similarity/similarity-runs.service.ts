import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { SimilarityLimits, SimilarityRun } from '@libs/database';
import { enqueueSimilarity, SIMILARITY_QUEUE } from '@libs/judging';
import type { SimilarityJob } from '@libs/judging';
import { SettingsService } from '@libs/settings';
import {
  SimilarityAccessService,
  similarityNotFound,
} from './similarity-access.service';
import type { ScopeQuery, ScopeTarget } from './similarity-access.service';
import { SimilarityRunsRepository } from './similarity-runs.repository';
import { SimilarityRunResponse } from './dto/similarity-run.response';
import type { StartedSimilarityRunResponse } from './dto/started-run.response';
import {
  SIMILARITY_STALE_AFTER_MS,
  SIMILARITY_START_LIMIT,
  SIMILARITY_START_WINDOW_SECONDS,
} from './rate-limits';

/** Runs listed per scope, newest first. */
const RECENT_RUNS_LIMIT = 10;

const startRateKey = (userId: string) => `similarity-start:${userId}`;

@Injectable()
export class SimilarityRunsService {
  constructor(
    private readonly access: SimilarityAccessService,
    private readonly runs: SimilarityRunsRepository,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(SIMILARITY_QUEUE) private readonly queue: Queue<SimilarityJob>,
  ) {}

  async start(
    principal: Principal,
    query: ScopeQuery,
  ): Promise<StartedSimilarityRunResponse> {
    const target = await this.access.targetOf(principal, query);
    const releaseStart = await this.rateLimit.reserve(
      [startRateKey(principal.userId)],
      SIMILARITY_START_LIMIT,
      SIMILARITY_START_WINDOW_SECONDS,
    );
    try {
      return { runId: await this.queueNewRun(principal.userId, target) };
    } catch (error) {
      // Nothing was queued (busy scope or a failed write): the start does not count.
      await releaseStart();
      throw error;
    }
  }

  async list(
    principal: Principal,
    query: ScopeQuery,
  ): Promise<SimilarityRunResponse[]> {
    const target = await this.access.targetOf(principal, query);
    const runs = await this.runs.recentRuns(target.scopeKey, RECENT_RUNS_LIMIT);
    return this.responsesOf(runs);
  }

  async detail(
    principal: Principal,
    runId: string,
  ): Promise<SimilarityRunResponse> {
    const run = await this.runs.findRun(runId);
    if (!run || !(await this.access.canView(principal, run)))
      throw similarityNotFound();
    const [response] = await this.responsesOf([run]);
    return response;
  }

  /** Creates the scope's active run and queues its job; returns the run id. */
  private async queueNewRun(
    requestedBy: string,
    target: ScopeTarget,
  ): Promise<string> {
    const staleBefore = new Date(Date.now() - SIMILARITY_STALE_AFTER_MS);
    await this.runs.releaseStale(target.scopeKey, staleBefore);
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
    } catch (error) {
      // No job will ever finish this run: free the scope.
      await this.runs.deleteRun(runId);
      throw error;
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

  private async responsesOf(
    runs: SimilarityRun[],
  ): Promise<SimilarityRunResponse[]> {
    const groupProblemIds = runs.flatMap((run) =>
      run.groups.map((group) => uuidStr(group.problem)),
    );
    const problemCodes = await this.runs.problemCodes([
      ...new Set(groupProblemIds),
    ]);
    return runs.map((run) => SimilarityRunResponse.from(run, problemCodes));
  }
}
