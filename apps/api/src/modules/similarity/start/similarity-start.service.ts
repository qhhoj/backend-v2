import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import type { ScopeQueryDto } from '../core/dto/scope-query.dto';
import {
  SIMILARITY_START_LIMIT,
  SIMILARITY_START_WINDOW_SECONDS,
} from '../core/rate-limits';
import { SimilarityAccessService } from '../core/similarity-access.service';
import type { StartedSimilarityRunResponse } from './dto/started-run.response';
import { SimilarityLaunchService } from './similarity-launch.service';

const startRateKey = (userId: string) => `similarity-start:${userId}`;

/** Starts a run for a scope the caller edits, within the per-user start limit. */
@Injectable()
export class SimilarityStartService {
  constructor(
    private readonly access: SimilarityAccessService,
    private readonly rateLimit: RateLimitService,
    private readonly launcher: SimilarityLaunchService,
  ) {}

  async start(
    principal: Principal,
    query: ScopeQueryDto,
  ): Promise<StartedSimilarityRunResponse> {
    const target = await this.access.targetOf(principal, query);
    const releaseStart = await this.rateLimit.reserve(
      [startRateKey(principal.userId)],
      SIMILARITY_START_LIMIT,
      SIMILARITY_START_WINDOW_SECONDS,
    );
    try {
      return { runId: await this.launcher.launch(principal.userId, target) };
    } catch (error) {
      // Nothing was queued (busy scope or a failed write): the start does not count.
      await releaseStart();
      throw error;
    }
  }
}
