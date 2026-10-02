import { Inject, Injectable } from '@nestjs/common';
import {
  DUMMY_PASSWORD_HASH,
  generateApiToken,
  hashPassword,
  needsRehash,
  passwordProblems,
  PrincipalService,
  PwnedPasswordService,
  SessionService,
  UsersRepository,
  verifyPassword,
} from '@libs/auth';
import type { AuthContext, SessionData, UserDocument } from '@libs/auth';
import { AppError, ENV, RateLimitService } from '@libs/common';
import type { Env } from '@libs/common';
import { FAILURE_LIMIT, FAILURE_WINDOW_SECONDS } from './rate-limits';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly principals: PrincipalService,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(
    username: string,
    password: string,
    ip: string,
    previousSessionId: string | null,
  ) {
    const user = await this.users.findByUsername(username);
    const failureKeys = [
      `login:ip:${ip}`,
      user
        ? `login:user:${user._id}`
        : `login:name:${username.normalize('NFKC').toLowerCase()}`,
    ];
    // Reserve the attempt before verifying so concurrent bursts cannot exceed the limit.
    const release = await this.rateLimit.reserve(
      failureKeys,
      FAILURE_LIMIT,
      FAILURE_WINDOW_SECONDS,
    );

    const passwordValid = await verifyPassword(
      password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordValid)
      throw new AppError(
        'invalid_credentials',
        401,
        'Invalid username or password',
      );
    await release();
    this.assertLoginAllowed(user);
    const passwordPwned = await this.pwned.isPwned(password);
    // Compare-and-set: if the password changed since verification, keep the newer one.
    if (needsRehash(user.password))
      await this.users.updatePasswordIfUnchanged(
        user._id,
        user.password,
        await hashPassword(password),
      );
    return this.startSession(user, passwordPwned, previousSessionId);
  }

  assertLoginAllowed(user: UserDocument): void {
    if (!user.isActive)
      throw user.banReason !== null
        ? new AppError(
            'banned',
            403,
            `This account has been banned. Reason: ${user.banReason}`,
          )
        : new AppError('account_not_activated', 403, 'Account not activated');
  }

  /**
   * Shared by every login method (password, social); callers run `assertLoginAllowed` first. Opens a session and replaces `previousSessionId`.
   * lastLogin is recorded once no second factor is pending.
   */
  async startSession(
    user: UserDocument,
    passwordPwned: boolean,
    previousSessionId: string | null,
  ) {
    const twoFaPassed = !(user.isTotpEnabled || user.isWebauthnEnabled);
    if (twoFaPassed)
      await this.users.update(user._id, { lastLogin: new Date() });
    return this.openSession(
      user,
      { twoFaPassed, passwordPwned, impersonatorId: null },
      previousSessionId,
    );
  }

  /** The single session-opening path (also used by impersonation, which must not touch lastLogin). */
  async openSession(
    user: UserDocument,
    data: Pick<SessionData, 'twoFaPassed' | 'passwordPwned' | 'impersonatorId'>,
    previousSessionId: string | null,
  ) {
    const { id, session } = await this.sessions.create({
      ...data,
      userId: user._id,
    });
    if (previousSessionId) await this.sessions.destroy(previousSessionId);
    return {
      sessionId: id,
      session,
      user,
      principal: this.principals.build(user),
    };
  }

  /** Re-entry of the current password; shares the `password-change` failure budget across every caller. */
  async confirmPassword(auth: AuthContext, password: string): Promise<void> {
    const failureKey = `password-change:user:${auth.principal.userId}`;
    // Reserve the attempt before verifying, like login, so a stolen session cannot brute-force the current password.
    const release = await this.rateLimit.reserve(
      [failureKey],
      FAILURE_LIMIT,
      FAILURE_WINDOW_SECONDS,
    );
    if (!(await verifyPassword(password, auth.user.password)))
      throw new AppError(
        'invalid_credentials',
        400,
        'Current password is incorrect',
        { currentPassword: ['Current password is incorrect.'] },
      );
    await release();
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.confirmPassword(auth, currentPassword);
    const { userId } = auth.principal;

    const problems = passwordProblems(newPassword, auth.user);
    if (newPassword === currentPassword)
      problems.push('New password must differ from the current password.');
    if (await this.pwned.isPwned(newPassword))
      problems.push('This password has appeared in a data breach.');
    if (problems.length)
      throw new AppError('validation_failed', 400, 'Password rejected', {
        newPassword: problems,
      });
    // The API token intentionally stays valid across a password change.
    const changed = await this.users.updatePasswordIfUnchanged(
      userId,
      auth.user.password,
      await hashPassword(newPassword),
    );
    if (!changed)
      throw new AppError(
        'conflict',
        409,
        'Password was changed by another request',
      );
    await this.sessions.destroyAllForUser(userId, auth.sessionId ?? undefined);
    if (auth.sessionId)
      await this.sessions.update(auth.sessionId, { passwordPwned: false });
  }

  async regenerateApiToken(userId: string): Promise<{ token: string }> {
    const { token, hash } = generateApiToken(userId, this.env.tokenSecret);
    await this.users.update(userId, { apiTokenHash: hash });
    return { token };
  }
}
