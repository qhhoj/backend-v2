import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createPasswordResetToken,
  hashPassword,
  passwordProblems,
  PWNED_PASSWORD_PROBLEM,
  passwordResetTokenValid,
  PwnedPasswordService,
  readPasswordResetToken,
  SessionService,
  UsersRepository,
} from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import {
  AppError,
  ENV,
  MAILER,
  RateLimitService,
  ValidationFailedError,
} from '@libs/common';
import type { Env, Mailer } from '@libs/common';
import {
  PASSWORD_RESET_EMAIL_LIMIT,
  PASSWORD_RESET_IP_LIMIT,
  PASSWORD_RESET_WINDOW_SECONDS,
} from '../core/rate-limits';

const invalidToken = () =>
  new AppError('invalid_token', 400, 'Reset link is invalid or expired');
const tokenOwner = (user: UserDocument) => ({
  id: user._id,
  password: user.password,
  lastLogin: user.lastLogin,
});

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Also serves active accounts with an unusable (`!`) hash: the reset sets their first password. Always resolves the same way whether or not the email is known; mails go out in the background so timing does not reveal it. */
  async request(email: string, ip: string): Promise<void> {
    // Never released: every request spends budget.
    await this.rateLimit.reserve(
      [`password-reset:ip:${ip}`],
      PASSWORD_RESET_IP_LIMIT,
      PASSWORD_RESET_WINDOW_SECONDS,
    );
    await this.rateLimit.reserve(
      [`password-reset:email:${email.toLowerCase()}`],
      PASSWORD_RESET_EMAIL_LIMIT,
      PASSWORD_RESET_WINDOW_SECONDS,
    );
    const users = await this.users.findActiveByEmail(email);
    for (const user of users)
      void this.sendResetMail(user).catch((error: unknown) =>
        this.logger.error(
          `Password reset mail for ${user._id} failed: ${(error as Error).message}`,
        ),
      );
  }

  private async sendResetMail(user: UserDocument): Promise<void> {
    const token = createPasswordResetToken(
      tokenOwner(user),
      this.env.tokenSecret,
    );
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your QHHOJ password',
      text: `Reset your password: ${this.env.siteUrl}/reset-password/${token}\nThe link expires in 3 days.`,
    });
  }

  async confirm(token: string, newPassword: string): Promise<void> {
    const parsed = readPasswordResetToken(token);
    const user = parsed && (await this.users.findById(parsed.userId));
    if (
      !parsed ||
      !user ||
      !user.isActive ||
      !passwordResetTokenValid(parsed, tokenOwner(user), this.env.tokenSecret)
    )
      throw invalidToken();
    const problems = passwordProblems(newPassword, user);
    if (await this.pwned.isPwned(newPassword))
      problems.push(PWNED_PASSWORD_PROBLEM);
    if (problems.length)
      throw new ValidationFailedError(
        'Password rejected',
        problems.map((problem) => ({ field: 'newPassword', ...problem })),
      );
    const changed = await this.users.updatePasswordIfUnchanged(
      user._id,
      user.password,
      await hashPassword(newPassword),
    );
    if (!changed) throw invalidToken();
    // Reset is the recovery path: a leaked API token must not survive it.
    await this.users.update(user._id, { apiTokenHash: null });
    await this.sessions.destroyAllForUser(user._id);
  }
}
