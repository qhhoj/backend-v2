import { Injectable } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';

@Injectable()
export class SecondFactorService {
  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
  ) {}

  /** Marks the session as fully authenticated after any second factor succeeded. */
  async complete(auth: AuthContext): Promise<void> {
    if (auth.sessionId)
      await this.sessions.update(auth.sessionId, { twoFaPassed: true });
    await this.users.update(auth.user._id, { lastLogin: new Date() });
  }
}
