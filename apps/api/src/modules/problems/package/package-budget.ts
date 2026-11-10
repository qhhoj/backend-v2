import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { execOrThrow, RateLimitService, REDIS } from '@libs/common';
import type { ProblemPackageJob } from '@libs/problems';
import {
  PACKAGE_LIMIT,
  PACKAGE_USER_LIMIT,
  PACKAGE_WINDOW_SECONDS,
} from './package-rate-limits';

const userKey = (userId: string) => `package:user:${userId}`;
const problemKey = (userId: string, code: string) =>
  `package:user:${userId}:${code}`;
/** The users whose request queued or joined the build of one key, so a build refused for the test data's state can give each request back. */
const spendersKey = ({ code, key }: ProblemPackageJob) =>
  `package-spent:${code}.${key}`;

/** The editor's package requests: one per request, per user and per problem; given back when the build fails because of the test data's state, which the editor did not cause by asking. */
@Injectable()
export class PackageBudget {
  constructor(
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** The per-user budget first, then the per-problem one; a refusal by either leaves the other budget as it was, so a refused request costs the editor nothing but the counter that refused it. */
  async spend(userId: string, code: string): Promise<void> {
    const releaseUser = await this.rateLimit.reserve(
      [userKey(userId)],
      PACKAGE_USER_LIMIT,
      PACKAGE_WINDOW_SECONDS,
    );
    try {
      await this.rateLimit.reserve(
        [problemKey(userId, code)],
        PACKAGE_LIMIT,
        PACKAGE_WINDOW_SECONDS,
      );
    } catch (error) {
      await releaseUser();
      throw error;
    }
  }

  /** Records that `userId` spent a request on the build of `build`; kept for the budget's window. */
  async recordSpender(build: ProblemPackageJob, userId: string): Promise<void> {
    const key = spendersKey(build);
    await execOrThrow(
      this.redis.multi().rpush(key, userId).expire(key, PACKAGE_WINDOW_SECONDS),
    );
  }

  /** Gives back every request recorded for the build of `build`, once: the record is read and removed in one step. */
  async refund(build: ProblemPackageJob): Promise<void> {
    const key = spendersKey(build);
    const [userIds] = (await execOrThrow(
      this.redis.multi().lrange(key, 0, -1).del(key),
    )) as [string[], number];
    for (const userId of userIds) {
      await this.rateLimit.release(userKey(userId));
      await this.rateLimit.release(problemKey(userId, build.code));
    }
  }
}
