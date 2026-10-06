import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { SubmissionEffectsRepository } from '../submission-effects/submission-effects.repository';
import { SubmissionEffectsService } from '../submission-effects/submission-effects.service';

export const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** `judgedDate` is grading-begin: a grading that began up to this long before the last sweep and finished after it is still covered. */
export const SWEEP_OVERLAP_MS = 10 * 60 * 1000;
/** After a long outage the sweep looks back at most this far; graded jobs wait in Redis meanwhile. */
export const SWEEP_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** End of the last successful sweep (epoch ms). */
export const SWEEP_WATERMARK_KEY = 'effects:sweep:until';

/** Repairs what lost or failed graded jobs left stale: every user and problem touched since the last sweep is recomputed (idempotent, through the same coalesced paths as the graded job). The watermark moves only after success, so a failed sweep is covered by the next. */
@Injectable()
export class EffectsSweepService {
  constructor(
    private readonly repository: SubmissionEffectsRepository,
    private readonly effects: SubmissionEffectsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async sweep(now = Date.now()): Promise<{ users: number; problems: number }> {
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
    return { users: userIds.length, problems: problemIds.length };
  }
}
