import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DUMMY_PASSWORD_HASH,
  generateApiToken,
  hashPassword,
  needsRehash,
  passwordProblems,
  PWNED_PASSWORD_PROBLEM,
  PrincipalService,
  PwnedPasswordService,
  SessionService,
  UsersRepository,
  verifyPassword,
} from '@libs/auth';
import type { AuthContext, SessionData, UserDocument } from '@libs/auth';
import {
  AppError,
  ENV,
  RateLimitService,
  ValidationFailedError,
} from '@libs/common';
import { secondFactorMethods } from '../two-factor/second-factor-methods';
import { BannedError } from './banned.error';
import type { Env } from '@libs/common';
import {
  FAILURE_LIMIT,
  FAILURE_WINDOW_SECONDS,
  SUCCESS_ACCOUNT_LIMIT,
  SUCCESS_IP_LIMIT,
} from './rate-limits';

/** Correct passwords of one account (login and confirmation share it), claimed before the hash and kept only on success: a valid-credential loop cannot run PBKDF2 without limit, and nobody else can spend it. */
const passwordSuccessBudget = (userId: string) => ({
  key: `password-success:user:${userId}`,
  limit: SUCCESS_ACCOUNT_LIMIT,
});
const loginSuccessIpBudget = (ip: string) => ({
  key: `login-success:ip:${ip}`,
  limit: SUCCESS_IP_LIMIT,
});
type Budget = { key: string; limit: number };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    // The account budget is per address too: failures from elsewhere never lock the owner out; the address budget brakes spraying.
    const account = user
      ? `user:${user._id}`
      : `name:${username.normalize('NFKC').toLowerCase()}`;
    const failureKeys = [`login:ip:${ip}`, `login:${account}:ip:${ip}`];
    const successBudgets = [
      loginSuccessIpBudget(ip),
      ...(user ? [passwordSuccessBudget(user._id)] : []),
    ];
    const passwordValid = await this.verifyMetered(
      { failureKeys, successBudgets },
      () => verifyPassword(password, user?.password ?? DUMMY_PASSWORD_HASH),
    );
    if (!user || !passwordValid)
      throw new AppError(
        'invalid_credentials',
        401,
        'Invalid username or password',
      );
    this.assertLoginAllowed(user);
    const passwordPwned = await this.pwned.isPwned(password);
    await this.upgradeWeakHash(user, password);
    return this.startSession(user, {
      isPasswordPwned: passwordPwned,
      previousSessionId,
    });
  }

  /**
   * Both budgets are taken before the hash, so concurrent attempts cannot race past either: failures (`reserve`) are
   * given back on a correct password, correct passwords (`claim`) on a wrong one; a check that fails to run (hash queue
   * full) gives both back.
   */
  private async verifyMetered(
    budgets: { failureKeys: string[]; successBudgets: Budget[] },
    verify: () => Promise<boolean>,
  ): Promise<boolean> {
    const releaseFailure = await this.rateLimit.reserve(
      budgets.failureKeys,
      FAILURE_LIMIT,
      FAILURE_WINDOW_SECONDS,
    );
    let releaseSuccess: () => Promise<void>;
    try {
      releaseSuccess = await this.rateLimit.claim(
        budgets.successBudgets,
        FAILURE_WINDOW_SECONDS,
      );
    } catch (error) {
      await releaseFailure();
      throw error;
    }
    try {
      const valid = await verify();
      await (valid ? releaseFailure() : releaseSuccess());
      return valid;
    } catch (error) {
      await Promise.all([releaseFailure(), releaseSuccess()]);
      throw error;
    }
  }

  /**
   * Best effort, after the password was accepted: a refused or failed rehash (the hash queue is full) never costs the
   * session, and the next login tries again. Compare-and-set: if the password changed since verification, keep the newer one.
   */
  private async upgradeWeakHash(
    user: UserDocument,
    password: string,
  ): Promise<void> {
    if (!needsRehash(user.password)) return;
    try {
      await this.users.updatePasswordIfUnchanged(
        user._id,
        user.password,
        await hashPassword(password),
      );
    } catch (error) {
      this.logger.warn(
        `Password rehash skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  assertLoginAllowed(user: UserDocument): void {
    if (user.isActive) return;
    if (user.banReason !== null) throw new BannedError(user.banReason);
    // Staff-deactivated accounts must not be told to check their e-mail for an activation link.
    throw user.deactivatedAt !== null
      ? new AppError('account_disabled', 403, 'Account disabled')
      : new AppError('account_not_activated', 403, 'Account not activated');
  }

  /**
   * Shared by every login method (password, social); callers run `assertLoginAllowed` first. Opens a session and replaces `previousSessionId`.
   * lastLogin is recorded once no second factor is pending.
   */
  async startSession(
    user: UserDocument,
    {
      isPasswordPwned,
      previousSessionId,
    }: { isPasswordPwned: boolean; previousSessionId: string | null },
  ) {
    const twoFaPassed = secondFactorMethods(user).length === 0;
    if (twoFaPassed)
      await this.users.update(user._id, { lastLogin: new Date() });
    return this.openSession(
      user,
      {
        twoFaPassed,
        passwordPwned: isPasswordPwned,
        impersonatorId: null,
      },
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

  /** Re-entry of the current password; shares the `password-confirm` failure budget across every caller, and the correct-password budget with login. */
  async confirmPassword(auth: AuthContext, password: string): Promise<void> {
    const { userId } = auth.principal;
    // Reserved before verifying, like login, so a stolen session cannot brute-force the current password.
    const passwordValid = await this.verifyMetered(
      {
        failureKeys: [`password-confirm:user:${userId}`],
        successBudgets: [passwordSuccessBudget(userId)],
      },
      () => verifyPassword(password, auth.user.password),
    );
    if (!passwordValid)
      throw new AppError(
        'invalid_credentials',
        400,
        'Current password is incorrect',
        { currentPassword: ['Current password is incorrect.'] },
        undefined,
        {
          issues: [
            {
              field: 'currentPassword',
              code: 'password_incorrect',
              message: 'Current password is incorrect.',
            },
          ],
        },
      );
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
      problems.push({
        code: 'password_unchanged',
        message: 'New password must differ from the current password.',
      });
    if (await this.pwned.isPwned(newPassword))
      problems.push(PWNED_PASSWORD_PROBLEM);
    if (problems.length)
      throw new ValidationFailedError(
        'Password rejected',
        problems.map((problem) => ({ field: 'newPassword', ...problem })),
      );
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
    await this.users.update(userId, { apiTokenHash: null });
    await this.sessions.destroyAllForUser(userId, auth.sessionId ?? undefined);
    if (auth.sessionId)
      await this.sessions.update(auth.sessionId, { passwordPwned: false });
  }

  /** Every session of the user, the current one included, and the API token. */
  async logoutAll(userId: string): Promise<void> {
    await this.users.update(userId, { apiTokenHash: null });
    await this.sessions.destroyAllForUser(userId);
  }

  /** A stolen session cookie alone must not mint a credential that outlives the session, so the password is re-entered. */
  async regenerateApiToken(
    auth: AuthContext,
    currentPassword: string,
  ): Promise<{ token: string }> {
    await this.confirmPassword(auth, currentPassword);
    const { userId } = auth.principal;
    const { token, hash } = generateApiToken(userId, this.env.tokenSecret);
    await this.users.update(userId, { apiTokenHash: hash });
    return { token };
  }
}
