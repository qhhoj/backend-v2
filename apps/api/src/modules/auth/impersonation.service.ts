import { Injectable, Logger } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext, UserDocument } from '@libs/auth';
import { AppError } from '@libs/common';
import { AuthService } from './auth.service';

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /** Replaces the superuser's session with one for `targetId`; the target's lastLogin is not touched. */
  async start(auth: AuthContext, targetId: string) {
    if (auth.session?.impersonatorId)
      throw new AppError('forbidden', 403, 'Already impersonating');
    if (!auth.user.isSuperuser)
      throw new AppError('forbidden', 403, 'Superuser required');
    const target = await this.users.findById(targetId);
    if (!target?.isActive)
      throw new AppError('not_found', 404, 'User not found');
    if (target.isSuperuser)
      throw new AppError('forbidden', 403, 'Cannot impersonate a superuser');
    const result = await this.auth.openSession(
      target,
      {
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: auth.user._id,
        impersonatorPasswordPwned: auth.session?.passwordPwned ?? false,
      },
      auth.sessionId,
    );
    this.logger.log(`Impersonation started: ${auth.user._id} as ${target._id}`);
    return result;
  }

  /** Restores the impersonator's session; `onRevoked` runs when they lost superuser rights meanwhile. */
  async stop(auth: AuthContext, onRevoked: () => void) {
    const { session } = auth;
    if (!session?.impersonatorId)
      throw new AppError('not_impersonating', 400, 'Not impersonating');
    const impersonator = await this.users.findById(session.impersonatorId);
    if (!isActiveSuperuser(impersonator)) {
      if (auth.sessionId) await this.sessions.destroy(auth.sessionId);
      onRevoked();
      throw new AppError(
        'unauthorized',
        401,
        'Impersonator is no longer authorized',
      );
    }
    const result = await this.auth.openSession(
      impersonator,
      {
        twoFaPassed: true,
        passwordPwned: session.impersonatorPasswordPwned,
        impersonatorId: null,
      },
      auth.sessionId,
    );
    this.logger.log('Impersonation stopped');
    return result;
  }
}

const isActiveSuperuser = (user: UserDocument | null): user is UserDocument =>
  !!user?.isActive && user.isSuperuser;
