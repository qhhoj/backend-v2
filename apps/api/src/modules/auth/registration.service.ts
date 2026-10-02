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
import {
  AppError,
  ENV,
  isDuplicateKey,
  MAILER,
  RateLimitService,
  REDIS,
} from '@libs/common';
import type { Env, Mailer } from '@libs/common';
import { ActivationKey, uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import type { RegisterDto } from './dto/register.dto';

const ACTIVATION_DAYS = 7;
const REGISTRATION_LIMIT = 5;
const REGISTRATION_WINDOW_SECONDS = 60 * 60;
const EMAIL_LOCK_SECONDS = 30;
const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

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
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  register(body: RegisterDto, ip: string): Promise<void> {
    return this.withRegistrationSlot(body.email, ip, () =>
      this.registerLocked(body),
    );
  }

  /** Runs a signup under the per-IP budget and the per-email lock; every signup path (password, social) goes through here. */
  async withRegistrationSlot<Result>(
    email: string,
    ip: string,
    signup: () => Promise<Result>,
  ): Promise<Result> {
    // Never released: every attempt, successful or not, spends budget.
    await this.rateLimit.reserve(
      [`register:ip:${ip}`],
      REGISTRATION_LIMIT,
      REGISTRATION_WINDOW_SECONDS,
    );
    // Emails are not uniquely indexed (legacy duplicates), so serialize per email.
    const lockKey = `register-lock:email:${email.toLowerCase()}`;
    const lockToken = randomBytes(16).toString('hex');
    const locked = await this.redis.set(
      lockKey,
      lockToken,
      'EX',
      EMAIL_LOCK_SECONDS,
      'NX',
    );
    if (locked !== 'OK')
      throw new AppError(
        'conflict',
        409,
        'Registration in progress; try again',
      );
    try {
      return await signup();
    } finally {
      try {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken);
      } catch (error) {
        this.logger.error(
          `Registration lock release failed: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Username/email uniqueness and password policy; throws `validation_failed` with per-field messages. Call under `withRegistrationSlot`. */
  async assertRegistrable({
    username,
    email,
    password,
  }: RegisterDto): Promise<void> {
    const fields: Record<string, string[]> = {};
    if (await this.isTaken(() => this.users.findByUsername(username)))
      fields.username = ['Username is taken.'];
    if (await this.isTaken(() => this.users.findByEmail(email)))
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
  }

  private async registerLocked({
    username,
    email,
    password,
  }: RegisterDto): Promise<void> {
    await this.assertRegistrable({ username, email, password });
    const user = await this.createUser({
      username,
      email,
      password,
      isActive: false,
    });
    const key = randomBytes(32).toString('hex');
    try {
      await this.activationKeys.create({
        userId: user._id,
        keyHash: sha256(key),
        expiresAt: new Date(Date.now() + ACTIVATION_DAYS * 86_400_000),
      });
    } catch (error) {
      await this.rollback(user._id, error);
      throw error;
    }
    try {
      await this.mailer.send({
        to: email,
        subject: 'Activate your QHHOJ account',
        text: `Activate your account: ${this.env.siteUrl}/activate/${key}\nThe link expires in ${ACTIVATION_DAYS} days.`,
      });
    } catch (error) {
      await this.rollback(user._id, error);
      throw new AppError(
        'mail_unavailable',
        503,
        'Could not send the activation email; try again later',
      );
    }
  }

  /** Whether any match blocks registration; abandoned signups are reclaimed one by one and the lookup repeated, since legacy data can hold several matches. */
  private async isTaken(
    find: () => Promise<UserDocument | null>,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - ACTIVATION_DAYS * 86_400_000);
    for (let existing = await find(); existing; existing = await find()) {
      if (!(await this.users.deleteStalePendingUser(existing._id, cutoff)))
        return true;
      await this.activationKeys.deleteMany({ userId: existing._id }).exec();
    }
    return false;
  }

  private async rollback(userId: string, cause: unknown): Promise<void> {
    this.logger.error(
      `Registration rollback for ${userId}: ${(cause as Error).message}`,
    );
    try {
      await Promise.all([
        this.users.delete(userId),
        this.activationKeys.deleteMany({ userId }).exec(),
      ]);
    } catch (error) {
      this.logger.error(
        `Registration rollback failed for ${userId}: ${(error as Error).message}`,
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

  /** Hashes the password and inserts the user; a username that lost a race maps to the same error as the up-front check. */
  async createUser({
    password,
    ...fields
  }: Partial<User> &
    Pick<User, 'username' | 'email'> & {
      password: string;
    }): Promise<UserDocument> {
    try {
      return await this.users.create({
        ...fields,
        password: await hashPassword(password),
      });
    } catch (error) {
      if (isDuplicateKey(error, 'socialAuth.uid'))
        throw new AppError(
          'conflict',
          409,
          'This social account is already linked',
        );
      if (isDuplicateKey(error))
        throw new AppError('validation_failed', 400, 'Registration rejected', {
          username: ['Username is taken.'],
        });
      throw error;
    }
  }
}
