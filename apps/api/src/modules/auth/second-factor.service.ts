import { Injectable } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import {
  DAILY_FAILURE_LIMIT,
  DAILY_WINDOW_SECONDS,
  FAILURE_LIMIT,
  FAILURE_WINDOW_SECONDS,
} from './rate-limits';

@Injectable()
export class SecondFactorService {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Marks the session as fully authenticated after any second factor succeeded. */
  async complete(auth: AuthContext): Promise<void> {
    if (auth.sessionId)
      await this.sessions.update(auth.sessionId, { twoFaPassed: true });
    await this.users.update(auth.user._id, { lastLogin: new Date() });
  }

  /**
   * Counts a second-factor attempt against the shared per-user budget (all factors share it) before it is checked,
   * so concurrent guesses cannot exceed the limit. Over the limit throws; the returned release gives the attempt back on success.
   */
  async reserveAttempt(userId: string): Promise<() => Promise<void>> {
    const releaseWindow = await this.rateLimit.reserve(
      [`second-factor:user:${userId}`],
      FAILURE_LIMIT,
      FAILURE_WINDOW_SECONDS,
    );
    const releaseDay = await this.rateLimit.reserve(
      [`second-factor:user:${userId}:day`],
      DAILY_FAILURE_LIMIT,
      DAILY_WINDOW_SECONDS,
    );
    return async () => {
      await releaseWindow();
      await releaseDay();
    };
  }
}
