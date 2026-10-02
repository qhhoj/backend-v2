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
    const failureKeys = [
      `login:ip:${ip}`,
      `login:user:${username.toLowerCase()}`,
    ];
    if (await this.rateLimit.exceeded(failureKeys, LOGIN_FAILURE_LIMIT))
      throw new AppError(
        'rate_limited',
        429,
        'Too many failed logins; try again later',
      );

    const user = await this.users.findByUsername(username);
    const passwordValid = await verifyPassword(
      password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordValid) {
      await Promise.all(
        failureKeys.map((key) => this.rateLimit.hit(key, LOGIN_WINDOW_SECONDS)),
      );
      throw new AppError(
        'invalid_credentials',
        401,
        'Invalid username or password',
      );
    }
    if (!user.isActive)
      throw user.banReason !== null
        ? new AppError(
            'banned',
            403,
            `This account has been banned. Reason: ${user.banReason}`,
          )
        : new AppError('account_not_activated', 403, 'Account not activated');

    const changes: Partial<User> = { lastLogin: new Date() };
    if (needsRehash(user.password))
      changes.password = await hashPassword(password);
    await this.users.update(user._id, changes);
    const { id, session } = await this.sessions.create({
      userId: user._id,
      twoFaPassed: !(user.isTotpEnabled || user.isWebauthnEnabled),
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
