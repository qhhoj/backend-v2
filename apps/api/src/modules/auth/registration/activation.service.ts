import { randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { sha256, UsersRepository } from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import { ENV, MAILER, RateLimitService } from '@libs/common';
import type { Env, MailMessage, Mailer } from '@libs/common';
import { ActivationKey } from '@libs/database';
import { Model } from 'mongoose';
import {
  ACTIVATION_RESEND_EMAIL_LIMIT,
  ACTIVATION_RESEND_IP_LIMIT,
  ACTIVATION_RESEND_WINDOW_SECONDS,
} from '../core/rate-limits';

export const ACTIVATION_DAYS = 7;

/** The activation key and its mail: issued at signup, reissued on request. */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    @InjectModel(ActivationKey.name)
    private readonly activationKeys: Model<ActivationKey>,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Stores the hash of a fresh key and returns the key itself. */
  async createKey(userId: string): Promise<string> {
    const key = randomBytes(32).toString('hex');
    await this.activationKeys.create({
      userId,
      keyHash: sha256(key),
      expiresAt: new Date(Date.now() + ACTIVATION_DAYS * 86_400_000),
    });
    return key;
  }

  mail(to: string, key: string): MailMessage {
    return {
      to,
      subject: 'Activate your QHHOJ account',
      text: `Activate your account: ${this.env.siteUrl}/activate/${key}\nThe link expires in ${ACTIVATION_DAYS} days.`,
    };
  }

  /** Always resolves the same way whether or not the email belongs to a pending signup; mails go out in the background so timing does not tell. */
  async resend(email: string, ip: string): Promise<void> {
    // Never released: every request spends budget.
    await this.rateLimit.reserve(
      [`activation-resend:ip:${ip}`],
      ACTIVATION_RESEND_IP_LIMIT,
      ACTIVATION_RESEND_WINDOW_SECONDS,
    );
    await this.rateLimit.reserve(
      [`activation-resend:email:${email.toLowerCase()}`],
      ACTIVATION_RESEND_EMAIL_LIMIT,
      ACTIVATION_RESEND_WINDOW_SECONDS,
    );
    for (const user of await this.users.findPendingByEmail(email))
      void this.reissue(user).catch((error: unknown) =>
        this.logger.error(
          `Activation resend for ${user._id} failed: ${(error as Error).message}`,
        ),
      );
  }

  private async reissue(user: UserDocument): Promise<void> {
    await this.activationKeys.deleteMany({ userId: user._id }).exec();
    await this.mailer.send(
      this.mail(user.email, await this.createKey(user._id)),
    );
  }
}
