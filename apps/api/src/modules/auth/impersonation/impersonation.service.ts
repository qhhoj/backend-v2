import { Injectable, Logger } from '@nestjs/common';
import { isActiveSuperuser, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import { AuthService } from '../core/auth.service';

@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
  ) {}

  /** Replaces the superuser's session with one for `targetId`; the target's lastLogin is not touched. The new session carries the epoch the superuser's session was checked at, so a later revocation by the superuser ends it. */
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
    const opened = await this.auth.openSession(
      target,
      {
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: auth.user._id,
        impersonatorEpoch: auth.session!.credentialEpoch,
      },
      auth.sessionId,
    );
    this.logger.log(`Impersonation started: ${auth.user._id} as ${target._id}`);
    return opened;
  }

  /** Restores the impersonator's session, re-checking their rights and credential epoch on a fresh read (the guard checked them at the start of the request). */
  async stop(auth: AuthContext) {
    const { session } = auth;
    if (!session?.impersonatorId)
      throw new AppError('not_impersonating', 400, 'Not impersonating');
    const impersonator = await this.users.findById(session.impersonatorId);
    if (
      !isActiveSuperuser(impersonator) ||
      impersonator.credentialEpoch !== session.impersonatorEpoch
    )
      throw new AppError(
        'unauthorized',
        401,
        'Impersonator is no longer authorized',
      );
    const opened = await this.auth.openSession(
      impersonator,
      {
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: null,
      },
      auth.sessionId,
    );
    this.logger.log(
      `Impersonation stopped: ${impersonator._id} as ${auth.user._id}`,
    );
    return opened;
  }
}
