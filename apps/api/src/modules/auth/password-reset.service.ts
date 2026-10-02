import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  createPasswordResetToken,
  hashPassword,
  passwordProblems,
  passwordResetTokenValid,
  PwnedPasswordService,
  readPasswordResetToken,
  SessionService,
  UsersRepository,
} from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import { AppError, ENV, MAILER, RateLimitService } from '@libs/common';
import type { Env, Mailer } from '@libs/common';

const IP_LIMIT = 10;
const EMAIL_LIMIT = 3;
const WINDOW_SECONDS = 60 * 60;

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

  /** Always resolves the same way whether or not the email is known; mails go out in the background so timing does not reveal it. */
  async request(email: string, ip: string): Promise<void> {
    // Never released: every request spends budget.
    await this.rateLimit.reserve(
      [`password-reset:ip:${ip}`],
      IP_LIMIT,
      WINDOW_SECONDS,
    );
    await this.rateLimit.reserve(
      [`password-reset:email:${email.toLowerCase()}`],
      EMAIL_LIMIT,
      WINDOW_SECONDS,
    );
    const users = await this.users.findActiveByEmail(email);
    for (const user of users)
      if (!user.password.startsWith('!'))
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
      user.password.startsWith('!') ||
      !passwordResetTokenValid(parsed, tokenOwner(user), this.env.tokenSecret)
    )
      throw invalidToken();
    const problems = passwordProblems(newPassword, user);
    if (await this.pwned.isPwned(newPassword))
      problems.push('This password has appeared in a data breach.');
    if (problems.length)
      throw new AppError('validation_failed', 400, 'Password rejected', {
        newPassword: problems,
      });
    const changed = await this.users.updatePasswordIfUnchanged(
      user._id,
      user.password,
      await hashPassword(newPassword),
    );
    if (!changed) throw invalidToken();
    await this.sessions.destroyAllForUser(user._id);
  }
}
