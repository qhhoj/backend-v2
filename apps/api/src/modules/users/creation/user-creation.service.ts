import { randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  hashPassword,
  passwordProblems,
  passwordIssues,
  PwnedPasswordService,
  UsersRepository,
} from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import {
  AppError,
  assertMailAvailable,
  isDuplicateKey,
  MAILER,
  REDIS,
  ValidationFailedError,
  withRedisLock,
} from '@libs/common';
import type { FieldIssue, Mailer } from '@libs/common';
import { uuidStr } from '@libs/database';
import type Redis from 'ioredis';
import { PasswordResetService } from '../../auth/password-reset/password-reset.service';
import { OrganizationPointsService } from '../../organizations/core/organization-points.service';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { EMAIL_TAKEN, normaliseEmail } from '../core/dto/email';
import { USERNAME_TAKEN } from '../core/dto/username';
import type { CreateUsersDto, NewUserDto } from './dto/user-creation.dto';
import type { CreatedUserResponse } from './dto/user-creation.response';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GENERATED_LENGTH = 12;
/** Rows hashed at once: PBKDF2 runs on the libuv pool, so a few in parallel use it without starving other requests. */
const PARALLEL_ROWS = 4;
/** Same lock as registration and the staff e-mail edit, so no two accounts claim one address at once. */
const EMAIL_LOCK_SECONDS = 30;
const ROW_FAILED: FieldIssue = {
  field: 'username',
  code: 'row_failed',
  message: 'The account could not be created; try this row again.',
};
const INVITE_FAILED: FieldIssue = {
  field: 'invite',
  code: 'invite_not_sent',
  message:
    'The account was created but the invite mail failed; send a reset link later.',
};

/** Twelve characters without look-alikes (legacy `batchadduser` printed eight), retried until it passes the policy for this account. */
export function generatePassword(owner: {
  username: string;
  email: string;
}): string {
  for (;;) {
    const password = Array.from(
      { length: GENERATED_LENGTH },
      () => ALPHABET[randomInt(ALPHABET.length)],
    ).join('');
    if (passwordProblems(password, owner).length === 0) return password;
  }
}

/** Per row, the issues of a name or an e-mail an earlier row of the same request uses (case-insensitive), whether or not that row is created. Pure. */
export function repeatIssues(rows: readonly NewUserDto[]): FieldIssue[][] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const name = `name:${row.username.toLowerCase()}`;
    const email = row.email ? `email:${row.email.trim().toLowerCase()}` : null;
    const issues = [
      ...(seen.has(name) ? [USERNAME_TAKEN] : []),
      ...(email && seen.has(email) ? [EMAIL_TAKEN] : []),
    ];
    seen.add(name);
    if (email) seen.add(email);
    return issues;
  });
}

const rejected = (
  row: NewUserDto,
  issues: FieldIssue[],
): CreatedUserResponse => ({
  username: row.username,
  status: 'rejected',
  id: null,
  generatedPassword: null,
  invited: false,
  issues,
});

/** Legacy admin "add user" and `batchadduser`: active accounts, no activation mail; each row stands alone and a created row is always reported. */
@Injectable()
export class UserCreationService {
  private readonly logger = new Logger(UserCreationService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly pwned: PwnedPasswordService,
    private readonly passwordReset: PasswordResetService,
    private readonly organizations: OrganizationsRepository,
    private readonly points: OrganizationPointsService,
    private readonly revisions: RevisionsRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async create(
    principal: Principal,
    dto: CreateUsersDto,
  ): Promise<CreatedUserResponse[]> {
    await this.assertRequest(dto);
    const repeats = repeatIssues(dto.users);
    const results: CreatedUserResponse[] = [];
    for (let start = 0; start < dto.users.length; start += PARALLEL_ROWS) {
      const chunk = dto.users.slice(start, start + PARALLEL_ROWS);
      const created = chunk.map((row, index) =>
        this.createRow(
          principal,
          row,
          dto.organizationId,
          repeats[start + index],
        ),
      );
      results.push(...(await Promise.all(created)));
    }
    if (dto.organizationId && results.some((row) => row.status === 'created'))
      await this.points.refresh([dto.organizationId]);
    return results;
  }

  /** Request-wide refusals: an unknown organization, or invites while mail is off. */
  private async assertRequest(dto: CreateUsersDto): Promise<void> {
    if (dto.users.some((row) => row.invite)) assertMailAvailable(this.mailer);
    if (
      dto.organizationId &&
      (await this.organizations.findByIds([dto.organizationId])).length === 0
    )
      throw new ValidationFailedError('Unknown organization', [
        {
          field: 'organizationId',
          code: 'organization_unknown',
          message: 'Choose an existing organization.',
        },
      ]);
  }

  private async createRow(
    principal: Principal,
    row: NewUserDto,
    organizationId: string | undefined,
    repeats: FieldIssue[],
  ): Promise<CreatedUserResponse> {
    if (repeats.length) return rejected(row, repeats);
    const email = row.email ? normaliseEmail(row.email) : '';
    const insert = () => this.insertRow(principal, row, email, organizationId);
    try {
      return email
        ? await withRedisLock(
            this.redis,
            {
              key: `register-lock:email:${email.toLowerCase()}`,
              ttlSeconds: EMAIL_LOCK_SECONDS,
              busyMessage: 'This e-mail is being registered',
            },
            insert,
          )
        : await insert();
    } catch (error) {
      if (error instanceof AppError && error.status === 409)
        return rejected(row, [
          { field: 'email', code: 'busy', message: error.message },
        ]);
      // One failing row must not hide the rows (and one-time passwords) already created.
      this.logger.error(
        `Creating ${row.username} failed: ${(error as Error).message}`,
      );
      return rejected(row, [ROW_FAILED]);
    }
  }

  /** Checks, inserts, audits, then mails the invite; a failed invite leaves the account reported as created. */
  private async insertRow(
    principal: Principal,
    row: NewUserDto,
    email: string,
    organizationId: string | undefined,
  ): Promise<CreatedUserResponse> {
    const issues = await this.rowIssues(row, email);
    if (issues.length) return rejected(row, issues);
    const generatedPassword =
      row.password || row.invite
        ? null
        : generatePassword({ username: row.username, email });
    let user: UserDocument;
    try {
      user = await this.users.create({
        username: row.username,
        email,
        firstName: row.fullName ?? '',
        password: row.invite
          ? `!${randomBytes(20).toString('hex')}`
          : await hashPassword(row.password ?? generatedPassword!),
        isActive: true,
        organizations: organizationId ? [organizationId] : [],
      });
    } catch (error) {
      if (isDuplicateKey(error, 'username'))
        return rejected(row, [USERNAME_TAKEN]);
      throw error;
    }
    await this.audit(principal, uuidStr(user._id), row).catch(
      (error: unknown) =>
        this.logger.error(
          `Audit of created ${user._id} failed: ${(error as Error).message}`,
        ),
    );
    const inviteIssues = row.invite ? await this.invite(user) : [];
    return {
      username: row.username,
      status: 'created',
      id: uuidStr(user._id),
      generatedPassword,
      invited: row.invite === true && inviteIssues.length === 0,
      issues: inviteIssues,
    };
  }

  private async invite(user: UserDocument): Promise<FieldIssue[]> {
    try {
      await this.passwordReset.sendTo(user);
      return [];
    } catch (error) {
      this.logger.warn(
        `Invite for ${user._id} not sent: ${(error as Error).message}`,
      );
      return [INVITE_FAILED];
    }
  }

  /** The row's own problems: a taken name or e-mail, an invite without an address, a password the signup policy refuses. Abandoned signups are not reclaimed here (registration does that), so they count as taken. */
  private async rowIssues(
    row: NewUserDto,
    email: string,
  ): Promise<FieldIssue[]> {
    const issues: FieldIssue[] = [];
    if (await this.users.findByUsername(row.username, { _id: 1 }))
      issues.push(USERNAME_TAKEN);
    if (email && (await this.users.findByEmail(email)))
      issues.push(EMAIL_TAKEN);
    if (row.invite && (!email || row.password))
      issues.push({
        field: 'invite',
        code: 'invite_needs_email_only',
        message: 'An invite needs an e-mail and no password.',
      });
    if (row.password)
      issues.push(
        ...(await passwordIssues(
          this.pwned,
          row.password,
          { username: row.username, email },
          'password',
        )),
      );
    return issues;
  }

  private audit(
    principal: Principal,
    userId: string,
    row: NewUserDto,
  ): Promise<void> {
    return this.revisions.append({
      entity: 'user',
      entityId: userId,
      action: 'staff_create',
      userId: principal.userId,
      changes: {},
      comment: row.invite
        ? 'Created by staff with an invite'
        : 'Created by staff',
    });
  }
}
