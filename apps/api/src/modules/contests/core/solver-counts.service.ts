import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { solverCountsCacheKey } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { ParticipationsRepository } from './participations.repository';

/** How long a count may lag behind the ranking when nothing purges it: at most one aggregate per contest and frozen view per window. */
export const SOLVER_COUNTS_CACHE_SECONDS = 30;

/** Solver counts for the contest detail, read through Redis; concurrent misses on a key in this process share one aggregate.
 * A caller that shares an in-flight read gets the problem list of the first caller, so a count may lack a problem edited meanwhile until the TTL or the next purge. */
@Injectable()
export class SolverCountsService {
  private readonly inFlight = new Map<string, Promise<Map<string, number>>>();

  constructor(
    private readonly participations: ParticipationsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  countsOf(
    contest: Contest,
    isFrozenView: boolean,
  ): Promise<Map<string, number>> {
    const cacheKey = solverCountsCacheKey(uuidStr(contest._id), isFrozenView);
    const running = this.inFlight.get(cacheKey);
    if (running) return running;
    const read = this.readThrough(contest, cacheKey, isFrozenView).finally(() =>
      this.inFlight.delete(cacheKey),
    );
    this.inFlight.set(cacheKey, read);
    return read;
  }

  /** Redis hit, or one aggregate and write. */
  private async readThrough(
    contest: Contest,
    cacheKey: string,
    isFrozenView: boolean,
  ): Promise<Map<string, number>> {
    const hit = await this.redis.get(cacheKey);
    if (hit)
      return new Map(Object.entries(JSON.parse(hit) as Record<string, number>));
    const counts = await this.participations.solverCountsOf(
      uuidStr(contest._id),
      contest.problems.map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
      isFrozenView,
    );
    await this.redis.set(
      cacheKey,
      JSON.stringify(Object.fromEntries(counts)),
      'EX',
      SOLVER_COUNTS_CACHE_SECONDS,
    );
    return counts;
  }
}
