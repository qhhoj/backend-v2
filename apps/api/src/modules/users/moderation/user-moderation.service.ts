import { Injectable } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import { AppError } from '@libs/common';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { CONTEST_CHEATING_BAN_REASON } from '../../contests/participation/contest-participation.service';

@Injectable()
export class UserModerationService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly revisions: RevisionsRepository,
  ) {}

  /** Legacy `Profile.ban_user`, plus every session revoked (the guard also rejects inactive users on the next request). */
  async ban(
    principal: Principal,
    username: string,
    reason: string,
  ): Promise<void> {
    if (reason === CONTEST_CHEATING_BAN_REASON)
      throw new AppError('validation_failed', 400, 'Reserved ban reason', {
        reason: ['Reserved for automatic contest-cheating bans.'],
      });
    const user = await this.target(principal, username);
    if (
      !(await this.users.updateIfBanReason(user._id, null, {
        banReason: reason,
        displayRank: 'banned',
        isUnlisted: true,
        isActive: false,
      }))
    )
      throw new AppError('conflict', 409, 'That user is already banned');
    await this.sessions.destroyAllForUser(user._id);
  }

  /** Legacy `Profile.unban_user`: restores rank `user`, listed and active whatever the user was before the ban. */
  async unban(principal: Principal, username: string): Promise<void> {
    const user = await this.target(principal, username);
    if (
      user.banReason === null ||
      !(await this.users.updateIfBanReason(user._id, user.banReason, {
        banReason: null,
        displayRank: 'user',
        isUnlisted: false,
        isActive: true,
      }))
    )
      throw new AppError('conflict', 409, 'That user is not banned');
  }

  /** Recovery for a locked-out user: removes TOTP and every security key, then signs the user out everywhere. Audit-logged as a `user` revision. */
  async resetTwoFactor(principal: Principal, username: string): Promise<void> {
    const user = await this.target(principal, username);
    await this.users.update(user._id, {
      isTotpEnabled: false,
      totpKey: null,
      scratchCodes: null,
      isWebauthnEnabled: false,
      webauthnCredentials: [],
    });
    await this.sessions.destroyAllForUser(user._id);
    await this.revisions.append({
      entity: 'user',
      entityId: user._id,
      action: 'reset_two_factor',
      userId: principal.userId,
      changes: {
        isTotpEnabled: { before: user.isTotpEnabled, after: false },
        isWebauthnEnabled: { before: user.isWebauthnEnabled, after: false },
        webauthnCredentials: {
          before: user.webauthnCredentials?.length ?? 0,
          after: 0,
        },
      },
      comment: 'Two-factor reset by staff',
    });
  }

  /** Legacy `can_be_banned_by`. */
  private async target(
    principal: Principal,
    username: string,
  ): Promise<UserDocument> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new AppError('not_found', 404, 'No such user');
    if (user._id === principal.userId || user.isSuperuser)
      throw new AppError('forbidden', 403, 'You cannot moderate this user');
    return user;
  }
}
