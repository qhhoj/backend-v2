import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  hashPassword,
  passwordProblems,
  PwnedPasswordService,
  UsersRepository,
} from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import { AppError, ENV, MAILER, RateLimitService } from '@libs/common';
import type { Env, Mailer } from '@libs/common';
import { ActivationKey, uuidStr } from '@libs/database';
import { Model } from 'mongoose';
import type { RegisterDto } from './dto/register.dto';

const ACTIVATION_DAYS = 7;
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_SECONDS = 60 * 60;
const MONGO_DUPLICATE_KEY = 11000;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
    @InjectModel(ActivationKey.name)
    private readonly activationKeys: Model<ActivationKey>,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async register(
    { username, email, password }: RegisterDto,
    ip: string,
  ): Promise<void> {
    // Never released: every attempt, successful or not, spends budget.
    await this.rateLimit.reserve(
      [`register:ip:${ip}`],
      REGISTRATION_LIMIT,
      REGISTRATION_WINDOW_SECONDS,
    );
    const fields: Record<string, string[]> = {};
    if (await this.users.findByUsername(username))
      fields.username = ['Username is taken.'];
    if (await this.users.findByEmail(email))
      fields.email = ['Email is already registered.'];
    const problems = passwordProblems(password, { username, email });
    if (await this.pwned.isPwned(password))
      problems.push('This password has appeared in a data breach.');
    if (problems.length) fields.password = problems;
    if (Object.keys(fields).length)
      throw new AppError(
        'validation_failed',
        400,
        'Registration rejected',
        fields,
      );

    const user = await this.createInactiveUser(username, email, password);
    const key = randomBytes(32).toString('hex');
    try {
      await this.activationKeys.create({
        userId: user._id,
        keyHash: sha256(key),
        expiresAt: new Date(Date.now() + ACTIVATION_DAYS * 86_400_000),
      });
      await this.mailer.send({
        to: email,
        subject: 'Activate your QHHOJ account',
        text: `Activate your account: ${this.env.siteUrl}/activate/${key}\nThe link expires in ${ACTIVATION_DAYS} days.`,
      });
    } catch (error) {
      this.logger.error(
        `Activation mail failed for ${user._id}: ${(error as Error).message}`,
      );
      await Promise.all([
        this.users.delete(user._id),
        this.activationKeys.deleteMany({ userId: user._id }).exec(),
      ]);
      throw new AppError(
        'mail_unavailable',
        503,
        'Could not send the activation email; try again later',
      );
    }
  }

  /** Single-use: the key is consumed atomically, and only unexpired keys match. */
  async activate(key: string): Promise<void> {
    const record = await this.activationKeys
      .findOneAndDelete({
        keyHash: sha256(key),
        expiresAt: { $gt: new Date() },
      })
      .exec();
    if (!record || !(await this.users.activate(uuidStr(record.userId))))
      throw new AppError(
        'invalid_token',
        400,
        'Activation link is invalid or expired',
      );
  }

  private async createInactiveUser(
    username: string,
    email: string,
    password: string,
  ): Promise<UserDocument> {
    try {
      return await this.users.create({
        username,
        email,
        password: await hashPassword(password),
        isActive: false,
      });
    } catch (error) {
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY)
        throw new AppError('validation_failed', 400, 'Registration rejected', {
          username: ['Username is taken.'],
        });
      throw error;
    }
  }
}
