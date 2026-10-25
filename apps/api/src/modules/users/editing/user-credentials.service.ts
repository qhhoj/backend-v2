import { Injectable } from '@nestjs/common';
import {
  hashPassword,
  passwordIssues,
  PwnedPasswordService,
  SessionService,
  UsersRepository,
} from '@libs/auth';
import type { AuthContext, UserDocument } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  RateLimitService,
  ValidationFailedError,
} from '@libs/common';
import { AuthService } from '../../auth/core/auth.service';
import { linkedProviders } from '../../auth/social/oauth-provider';
import { PasswordResetService } from '../../auth/password-reset/password-reset.service';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import {
  ADMIN_CREDENTIAL_LIMIT,
  ADMIN_CREDENTIAL_WINDOW_SECONDS,
} from '../core/rate-limits';
import { editableTarget } from './editable-target';
import type { Changes } from './user-field-changes';

interface AuditEntry {
  action: string;
  comment: string;
  changes?: Changes;
}

/** Staff credential actions on another user (legacy Django `auth.User` admin). Audit rows never hold a password or a hash. */
@Injectable()
export class UserCredentialsService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly pwned: PwnedPasswordService,
    private readonly rateLimit: RateLimitService,
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** The admin re-enters their own password; the user's sessions and API token are revoked, like a password reset. */
  async setPassword(
    auth: AuthContext,
    username: string,
    {
      currentPassword,
      newPassword,
    }: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const user = await editableTarget(this.users, auth.principal, username, {
      notSelf: true,
    });
    await this.confirmAdmin(auth, currentPassword);
    await this.assertAcceptable(user, newPassword);
    if (
      !(await this.users.updatePasswordIfUnchanged(
        user._id,
        user.password,
        await hashPassword(newPassword, { requester: auth.ip }),
      ))
    )
      throw new AppError(
        'conflict',
        409,
        'Password was changed by another request',
      );
    await this.users.update(user._id, {
      apiTokenHash: null,
      passwordSetBeforeVerification: false,
    });
    await this.sessions.destroyAllForUser(user._id);
    await this.audit(auth, user, {
      action: 'staff_set_password',
      comment: 'Password set by staff; sessions and API token revoked',
    });
  }

  /** Mails the user a reset link (the public reset flow's per-e-mail budget applies); the account must be active and have an address. */
  async sendResetLink(auth: AuthContext, username: string): Promise<void> {
    const user = await editableTarget(this.users, auth.principal, username, {
      notSelf: true,
    });
    if (!user.isActive)
      throw conflictIssue(
        'user',
        'account_inactive',
        'The account is not active',
      );
    if (!user.email)
      throw conflictIssue(
        'email',
        'email_missing',
        'The user has no e-mail address',
      );
    await this.passwordReset.sendTo(user);
    await this.audit(auth, user, {
      action: 'staff_send_reset_link',
      comment: `Password reset link sent to ${user.email}`,
    });
  }

  /** Recovery when a provider identity no longer belongs to the user: no provider signs in to the account any more. Sessions already open stay; setting a password ends them. */
  async removeSocialLinks(auth: AuthContext, username: string): Promise<void> {
    const user = await editableTarget(this.users, auth.principal, username, {
      notSelf: true,
    });
    await this.users.update(user._id, { socialAuth: [] });
    await this.audit(auth, user, {
      action: 'staff_remove_social_links',
      comment: 'Social sign-in links removed by staff',
      changes: {
        socialAuth: { before: linkedProviders(user.socialAuth), after: [] },
      },
    });
  }

  /** The signup policy plus the breach check, reported on `newPassword`. */
  private async assertAcceptable(
    user: UserDocument,
    password: string,
  ): Promise<void> {
    const issues = await passwordIssues(
      this.pwned,
      password,
      user,
      'newPassword',
    );
    if (issues.length)
      throw new ValidationFailedError('Password rejected', issues);
  }

  /** A credential change spends the admin's hourly budget (never given back), then needs their own password (shared `password-confirm` failure budget). */
  async confirmAdmin(
    auth: AuthContext,
    currentPassword: string,
  ): Promise<void> {
    await this.rateLimit.reserve(
      [`admin-credential:user:${auth.principal.userId}`],
      ADMIN_CREDENTIAL_LIMIT,
      ADMIN_CREDENTIAL_WINDOW_SECONDS,
    );
    await this.auth.confirmPassword(auth, currentPassword);
  }

  private audit(
    auth: AuthContext,
    user: UserDocument,
    { action, comment, changes = {} }: AuditEntry,
  ): Promise<void> {
    return this.revisions.append({
      entity: 'user',
      entityId: user._id,
      action,
      userId: auth.principal.userId,
      changes,
      comment,
    });
  }
}
