import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  hashPassword,
  passwordProblems,
  PWNED_PASSWORD_PROBLEM,
  PwnedPasswordService,
  sha256,
  UsersRepository,
} from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import {
  AppError,
  isDuplicateKey,
  MAILER,
  RateLimitService,
  REDIS,
  ValidationFailedError,
  withRedisLock,
} from '@libs/common';
import type { FieldIssue, Mailer } from '@libs/common';
import { ActivationKey, Language, Organization, uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { OrganizationPointsService } from '../../organizations/core/organization-points.service';
import { ACTIVATION_DAYS, ActivationService } from './activation.service';
import type { RegisterDto } from './dto/register.dto';
import {
  REGISTRATION_IP_LIMIT,
  REGISTRATION_WINDOW_SECONDS,
  USERNAME_CHECK_IP_LIMIT,
  USERNAME_CHECK_WINDOW_SECONDS,
} from '../core/rate-limits';

const EMAIL_LOCK_SECONDS = 30;

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
    private readonly activation: ActivationService,
    private readonly organizationPoints: OrganizationPointsService,
    @InjectModel(ActivationKey.name)
    private readonly activationKeys: Model<ActivationKey>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MAILER) private readonly mailer: Mailer,
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
      REGISTRATION_IP_LIMIT,
      REGISTRATION_WINDOW_SECONDS,
    );
    // Emails are not uniquely indexed (legacy duplicates), so serialize per email.
    const lockKey = `register-lock:email:${email.toLowerCase()}`;
    return withRedisLock(
      this.redis,
      lockKey,
      EMAIL_LOCK_SECONDS,
      'Registration in progress; try again',
      signup,
    );
  }

  /** Username/email uniqueness and password policy; throws `validation_failed` with per-field messages. Call under `withRegistrationSlot`. */
  async assertRegistrable({
    username,
    email,
    password,
    languageId,
    organizationId,
  }: RegisterDto): Promise<void> {
    const issues: FieldIssue[] = [];
    if (await this.isTaken(() => this.users.findByUsername(username)))
      issues.push({
        field: 'username',
        code: 'username_taken',
        message: 'Username is taken.',
      });
    if (await this.isTaken(() => this.users.findByEmail(email)))
      issues.push({
        field: 'email',
        code: 'email_taken',
        message: 'Email is already registered.',
      });
    if (languageId && !(await this.languages.exists({ _id: languageId })))
      issues.push({
        field: 'languageId',
        code: 'language_unknown',
        message: 'Choose one of the listed languages.',
      });
    if (
      organizationId &&
      !(await this.organizations.exists({
        _id: organizationId,
        isOpen: true,
        isUnlisted: false,
      }))
    )
      issues.push({
        field: 'organizationId',
        code: 'organization_unavailable',
        message: 'Choose one of the listed open organizations.',
      });
    const problems = passwordProblems(password, { username, email });
    if (await this.pwned.isPwned(password))
      problems.push(PWNED_PASSWORD_PROBLEM);
    issues.push(
      ...problems.map((problem) => ({ field: 'password', ...problem })),
    );
    if (issues.length)
      throw new ValidationFailedError('Registration rejected', issues);
  }

  private async registerLocked(body: RegisterDto): Promise<void> {
    await this.assertRegistrable(body);
    const { username, email, password } = body;
    const user = await this.createUser({
      username,
      email,
      password,
      isActive: false,
      ...this.profileFields(body),
    });
    let key: string;
    try {
      key = await this.activation.createKey(user._id);
    } catch (error) {
      await this.rollback(user._id, error);
      throw error;
    }
    try {
      await this.mailer.send(this.activation.mail(email, key));
    } catch (error) {
      await this.rollback(user._id, error);
      throw new AppError(
        'mail_unavailable',
        503,
        'Could not send the activation email; try again later',
      );
    }
    await this.announceMembership(user);
  }

  /** The optional signup choices as user fields. */
  profileFields({
    languageId,
    organizationId,
  }: Pick<RegisterDto, 'languageId' | 'organizationId'>): Pick<
    User,
    'languageId' | 'organizations'
  > {
    return {
      languageId: languageId ?? null,
      organizations: organizationId ? [organizationId] : [],
    };
  }

  /** Queues the organization's points recompute once the signup succeeded; never throws. */
  announceMembership(user: UserDocument): Promise<void> {
    return user.organizations.length
      ? this.organizationPoints.refresh(user.organizations.map(uuidStr))
      : Promise.resolve();
  }

  /** Whether `username` could be registered now; spends the caller's per-IP budget. */
  async usernameAvailable(username: string, ip: string): Promise<boolean> {
    await this.rateLimit.reserve(
      [`username-check:ip:${ip}`],
      USERNAME_CHECK_IP_LIMIT,
      USERNAME_CHECK_WINDOW_SECONDS,
    );
    return this.users.isUsernameFree(
      username,
      new Date(Date.now() - ACTIVATION_DAYS * 86_400_000),
    );
  }

  /** Whether any match blocks registration; abandoned signups are reclaimed one by one and the lookup repeated, since legacy data can hold several matches. */
  private async isTaken(
    find: () => Promise<UserDocument | null>,
  ): Promise<boolean> {
    const cutoff = new Date(Date.now() - ACTIVATION_DAYS * 86_400_000);
    for (let existing = await find(); existing; existing = await find()) {
      const organizationIds = await this.users.deleteStalePendingUser(
        existing._id,
        cutoff,
      );
      if (!organizationIds) return true;
      await this.activationKeys.deleteMany({ userId: existing._id }).exec();
      await this.organizationPoints.refresh(organizationIds);
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
      if (isDuplicateKey(error, 'email'))
        throw new ValidationFailedError('Registration rejected', [
          {
            field: 'email',
            code: 'email_taken',
            message: 'Email is already registered.',
          },
        ]);
      if (isDuplicateKey(error))
        throw new ValidationFailedError('Registration rejected', [
          {
            field: 'username',
            code: 'username_taken',
            message: 'Username is taken.',
          },
        ]);
      throw error;
    }
  }
}
