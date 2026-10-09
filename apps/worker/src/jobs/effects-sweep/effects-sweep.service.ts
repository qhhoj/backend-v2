import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SUBMISSION_GRADED_QUEUE } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { SubmissionEffectsRepository } from '../submission-effects/submission-effects.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';

export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** `judgedDate` is grading-begin: a grading that began up to this long before the last sweep and finished after it is still covered. */
export const SWEEP_OVERLAP_MS = 10 * 60 * 1000;
/** After a long outage the sweep looks back at most this far; graded jobs wait in Redis meanwhile. */
export const SWEEP_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** End of the last successful sweep (epoch ms). */
export const SWEEP_WATERMARK_KEY = 'effects:sweep:until';
/** A row due for less than this still has its graded job on the way (BullMQ retries 10 s, then 20 s, apart); the sweep leaves it to the job. */
export const EFFECTS_DUE_GRACE_MS = 2 * 60 * 1000;
/** Rows repaired per sweep, oldest first; the rest wait for the next one. */
export const EFFECTS_DUE_BATCH = 1000;

export interface SweepResult {
  users: number;
  problems: number;
  /** Finished submissions whose lost graded job was re-applied. */
  repaired: number;
}

/**
 * Repairs what lost or failed graded jobs left stale.
 * - Every finished submission whose effects are still due (`effectsDueAt`, set by the write that finished it and cleared by its graded job) gets the graded job's effects: user, problem and contest results. This covers a bridge or api that died between the write and the enqueue, whatever the row's dates.
 * - Every user and problem touched since the last sweep is recomputed (idempotent, through the same coalesced paths as the graded job). The watermark moves only after success, so a failed sweep is covered by the next.
 */
@Injectable()
export class EffectsSweepService {
  private readonly logger = new Logger(EffectsSweepService.name);

  constructor(
    private readonly repository: SubmissionEffectsRepository,
    private readonly effects: SubmissionEffectsService,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(SUBMISSION_GRADED_QUEUE)
    private readonly graded: Queue<SubmissionGradedJob>,
  ) {}

  async sweep(now = Date.now()): Promise<SweepResult> {
    const repaired = await this.repairDue(now);
    const until =
      Number(await this.redis.get(SWEEP_WATERMARK_KEY)) ||
      now - SWEEP_INTERVAL_MS;
    const from = new Date(
      Math.max(until, now - SWEEP_MAX_WINDOW_MS) - SWEEP_OVERLAP_MS,
    );
    const { userIds, problemIds } = await this.repository.touchedBetween(
      from,
      new Date(now),
    );
    for (const problemId of problemIds)
      await this.effects.recomputeProblem(problemId);
    for (const userId of userIds) await this.effects.recomputeUser(userId);
    await this.redis.set(SWEEP_WATERMARK_KEY, String(now));
    return { users: userIds.length, problems: problemIds.length, repaired };
  }

  /** A failing row is logged and goes to the back of the line; the others go on. */
  private async repairDue(now: number): Promise<number> {
    const due = await this.repository.effectsDueBefore(
      await this.dueCutoff(now),
      EFFECTS_DUE_BATCH,
    );
    let repaired = 0;
    for (const job of due) {
      try {
        await this.effects.apply(job);
        repaired += 1;
      } catch (error) {
        this.logger.error(
          `Repairing the effects of submission ${job.submissionId} failed: ${(error as Error).message}`,
        );
        await this.repository.postponeEffectsDue(job.submissionId);
      }
    }
    if (repaired)
      this.logger.warn(
        `Re-applied the effects of ${repaired} submissions whose graded job was lost`,
      );
    return repaired;
  }

  /** Rows due since before this have lost their job: due for longer than the grace, and stamped before every graded job still running or waiting (BullMQ serves them oldest first, so a row stamped later may only be queued behind them, e.g. during a bulk rejudge). A job in retry backoff is not waited for; repairing its row too is harmless. */
  private async dueCutoff(now: number): Promise<Date> {
    const [active, oldestWaiting] = await Promise.all([
      this.graded.getJobs(['active']),
      this.graded.getJobs(['waiting'], 0, 0, true),
    ]);
    const pendingSince = [...active, ...oldestWaiting].map(
      (job) => job.timestamp,
    );
    return new Date(Math.min(now - EFFECTS_DUE_GRACE_MS, ...pendingSince));
  }
}
