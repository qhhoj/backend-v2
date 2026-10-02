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
import type { AuthContext } from '@libs/auth';
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

  async login(username: string, password: string, ip: string) {
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
    if (!user.isActive)
      throw user.banReason !== null
        ? new AppError(
            'banned',
            403,
            `This account has been banned. Reason: ${user.banReason}`,
          )
        : new AppError('account_not_activated', 403, 'Account not activated');

    const twoFaPassed = !(user.isTotpEnabled || user.isWebauthnEnabled);
    if (twoFaPassed)
      await this.users.update(user._id, { lastLogin: new Date() });
    // Compare-and-set: if the password changed since verification, keep the newer one.
    if (needsRehash(user.password))
      await this.users.updatePasswordIfUnchanged(
        user._id,
        user.password,
        await hashPassword(password),
      );
    const { id, session } = await this.sessions.create({
      userId: user._id,
      twoFaPassed,
      passwordPwned: await this.pwned.isPwned(password),
      impersonatorId: null,
    });
    return {
      sessionId: id,
      session,
      user,
      principal: this.principals.build(user),
    };
  }

  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const { userId } = auth.principal;
    const failureKey = `password-change:user:${userId}`;
    // Reserve the attempt before verifying, like login, so a stolen session cannot brute-force the current password.
    const release = await this.rateLimit.reserve(
      [failureKey],
      FAILURE_LIMIT,
      FAILURE_WINDOW_SECONDS,
    );
    if (!(await verifyPassword(currentPassword, auth.user.password)))
      throw new AppError(
        'invalid_credentials',
        400,
        'Current password is incorrect',
        { currentPassword: ['Current password is incorrect.'] },
      );
    await release();

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
