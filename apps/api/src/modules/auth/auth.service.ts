import { Injectable } from '@nestjs/common';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  PrincipalService,
  PwnedPasswordService,
  SessionService,
  UsersRepository,
  verifyPassword,
} from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { User } from '@libs/database';

export const LOGIN_FAILURE_LIMIT = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly principals: PrincipalService,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
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
    const counts = await Promise.all(
      failureKeys.map((key) => this.rateLimit.hit(key, LOGIN_WINDOW_SECONDS)),
    );
    if (counts.some((count) => count > LOGIN_FAILURE_LIMIT))
      throw new AppError(
        'rate_limited',
        429,
        'Too many failed logins; try again later',
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
    await Promise.all(failureKeys.map((key) => this.rateLimit.release(key)));
    if (!user.isActive)
      throw user.banReason !== null
        ? new AppError(
            'banned',
            403,
            `This account has been banned. Reason: ${user.banReason}`,
          )
        : new AppError('account_not_activated', 403, 'Account not activated');

    const twoFaPassed = !(user.isTotpEnabled || user.isWebauthnEnabled);
    const changes: Partial<User> = twoFaPassed ? { lastLogin: new Date() } : {};
    if (needsRehash(user.password))
      changes.password = await hashPassword(password);
    if (Object.keys(changes).length) await this.users.update(user._id, changes);
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
}
