import { Inject, Injectable } from '@nestjs/common';
import { hasPermission, SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext, Principal, UserDocument } from '@libs/auth';
import {
  AppError,
  conflictIssue,
  REDIS,
  ValidationFailedError,
} from '@libs/common';
import { uuidStr } from '@libs/database';
import type Redis from 'ioredis';
import { linkedProviders } from '../../auth/social/oauth-provider';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { EMAIL_TAKEN, normaliseEmail } from '../core/dto/email';
import { withEmailLock } from '../core/email-lock';
import type { UpdateUserByStaffDto } from './dto/user-edit.dto';
import { UserEditResponse } from './dto/user-edit.response';
import { asCurrentSuperuser } from '../access/superuser-lock';
import { editableTarget } from './editable-target';
import { UserCredentialsService } from './user-credentials.service';
import { fieldChanges } from './user-field-changes';
import type { Changes } from './user-field-changes';
import { UserMembershipEditor } from './user-membership-editor';
import { FeedKeysRepository } from '../../contests/feed/feed-keys.repository';

/** Same lock as registration, so a signup and a staff edit cannot claim one address together. */

/** A 403 for a field only `auth.change_user` holders may change, with its issue code. */
const needsChangeUser = (field: string, code: string) =>
  new AppError(
    'forbidden',
    403,
    `Changing ${field} needs auth.change_user`,
    undefined,
    undefined,
    {
      issues: [{ field, code, message: `You may not change ${field}.` }],
    },
  );

/** The audit entry of an e-mail change, with the social links it removed. */
const emailChanges = (user: UserDocument, email: string): Changes => ({
  email: { before: user.email, after: email },
  ...(user.socialAuth.length
    ? { socialAuth: { before: linkedProviders(user.socialAuth), after: [] } }
    : {}),
});

/** Staff edits of another user's profile (legacy Django `ProfileAdmin` plus the `auth.User` e-mail and active flag). Every write leaves a `user` revision. */
@Injectable()
export class UserProfileEditingService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly organizations: OrganizationsRepository,
    private readonly membership: UserMembershipEditor,
    private readonly revisions: RevisionsRepository,
    private readonly credentials: UserCredentialsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly feedKeys: FeedKeysRepository,
  ) {}

  async get(principal: Principal, username: string): Promise<UserEditResponse> {
    return this.respond(await editableTarget(this.users, principal, username));
  }

  /** Not on yourself (your own settings have their own checks). Every check runs before the first write; a write that loses a race (409) keeps the earlier ones, and whatever was written is audited. */
  async update(
    auth: AuthContext,
    username: string,
    dto: UpdateUserByStaffDto,
  ): Promise<UserEditResponse> {
    const { principal } = auth;
    const user = await editableTarget(this.users, principal, username, {
      notSelf: true,
    });
    const email = this.emailChange(principal, user, dto.email);
    const isActive = this.activationChange(principal, user, dto.isActive);
    this.assertBanKept(user, dto);
    if (email !== undefined) {
      await this.assertEmailFree(user, email);
      await this.confirmForEmail(auth, dto.currentPassword);
    }
    const membership = await this.membership.plan(user, dto.organizations);
    const { fields, changes: fieldChangeLog } = fieldChanges(user, dto);
    const changes: Changes = {};
    try {
      if (Object.keys(fields).length) {
        await this.users.update(user._id, fields);
        Object.assign(changes, fieldChangeLog);
      }
      if (isActive !== undefined) {
        // Deactivating a superuser removes superuser power: same lock and caller re-read as demoting one.
        if (user.isSuperuser && !isActive)
          await asCurrentSuperuser(this.redis, this.users, principal, () =>
            this.writeActivation(user, isActive),
          );
        else await this.writeActivation(user, isActive);
        changes.isActive = { before: user.isActive, after: isActive };
      }
      if (membership) {
        await this.membership.write(user, membership);
        changes.organizations = {
          before: membership.current,
          after: membership.next,
        };
      }
      if (email !== undefined) {
        await withEmailLock(
          this.redis,
          email,
          'This e-mail is being registered; try again',
          () => this.writeEmail(user, email),
        );
        Object.assign(changes, emailChanges(user, email));
      }
    } finally {
      await this.audit(principal, user, changes);
    }
    return this.respond((await this.users.findById(user._id))!);
  }

  /** A new e-mail plus the public reset form is an account takeover, so it needs the admin's password and credential budget like a password set. */
  private async confirmForEmail(
    auth: AuthContext,
    currentPassword: string | undefined,
  ): Promise<void> {
    if (!currentPassword)
      throw new ValidationFailedError('Password required', [
        {
          field: 'currentPassword',
          code: 'password_required',
          message: 'Enter your own password to change the e-mail.',
        },
      ]);
    await this.credentials.confirmAdmin(auth, currentPassword);
  }

  /** The ban route owns rank `banned` and the unlisting: a banned account keeps both until unbanned. */
  private assertBanKept(user: UserDocument, dto: UpdateUserByStaffDto): void {
    if (user.banReason === null) return;
    const field = (['displayRank', 'isUnlisted'] as const).find(
      (key) => dto[key] !== undefined && dto[key] !== user[key],
    );
    if (field)
      throw conflictIssue(field, 'user_banned', 'Unban the user instead');
  }

  private async audit(
    principal: Principal,
    user: UserDocument,
    changes: Changes,
  ): Promise<void> {
    if (Object.keys(changes).length)
      await this.revisions.append({
        entity: 'user',
        entityId: user._id,
        action: 'staff_edit',
        userId: principal.userId,
        changes,
        comment: 'Profile edited by staff',
      });
  }

  /** The normalised address when it differs from the stored one; needs `auth.change_user`. */
  private emailChange(
    principal: Principal,
    user: UserDocument,
    email: string | undefined,
  ): string | undefined {
    if (email === undefined) return undefined;
    const next = normaliseEmail(email);
    if (next === user.email) return undefined;
    if (!hasPermission(principal, 'auth.change_user'))
      throw needsChangeUser('email', 'email_not_editable');
    return next;
  }

  /** The new flag when it differs; needs `auth.change_user`, never a banned account (unban instead). */
  private activationChange(
    principal: Principal,
    user: UserDocument,
    isActive: boolean | undefined,
  ): boolean | undefined {
    if (isActive === undefined || isActive === user.isActive) return undefined;
    if (!hasPermission(principal, 'auth.change_user'))
      throw needsChangeUser('isActive', 'activation_not_editable');
    if (user.banReason !== null)
      throw conflictIssue('isActive', 'user_banned', 'Unban the user instead');
    return isActive;
  }

  /** Deactivation stamps `deactivatedAt` (never reclaimed as an abandoned signup) and ends every session, the API token and the contest feed keys the user minted at once (the guard also refuses inactive users). */
  private async writeActivation(
    user: UserDocument,
    isActive: boolean,
  ): Promise<void> {
    if (isActive) {
      await this.users.update(user._id, { isActive, deactivatedAt: null });
      return;
    }
    await this.users.update(user._id, {
      isActive,
      deactivatedAt: new Date(),
      apiTokenHash: null,
    });
    await this.sessions.destroyAllForUser(user._id);
    await this.feedKeys.revokeMintedBy(user._id, new Date());
  }

  /** E-mails are not uniquely indexed (legacy duplicates): checked case-insensitively before any write, and again under the lock. */
  private async assertEmailFree(
    user: UserDocument,
    email: string,
  ): Promise<void> {
    const owner = await this.users.findByEmail(email);
    if (owner && owner._id !== user._id)
      throw new ValidationFailedError('E-mail rejected', [EMAIL_TAKEN]);
  }

  /** Staff-set addresses count as verified: v2 has no unverified-e-mail state. The social links were granted for the old address, so they go with it. */
  private async writeEmail(user: UserDocument, email: string): Promise<void> {
    await this.assertEmailFree(user, email);
    await this.users.update(user._id, { email, socialAuth: [] });
  }

  private async respond(user: UserDocument): Promise<UserEditResponse> {
    const organizations = await this.organizations.findByIds(
      user.organizations.map(uuidStr),
    );
    return UserEditResponse.from(user, organizations);
  }
}
