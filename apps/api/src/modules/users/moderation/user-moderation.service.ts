import { Injectable } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import { AppError } from '@libs/common';

@Injectable()
export class UserModerationService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
  ) {}

  /** Legacy `Profile.ban_user`, plus every session revoked (the guard also rejects inactive users on the next request). */
  async ban(
    principal: Principal,
    username: string,
    reason: string,
  ): Promise<void> {
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

  /** Legacy `Profile.unban_user`. */
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

  /** Legacy `can_be_banned_by`. */
  private async target(
    principal: Principal,
    username: string,
  ): Promise<UserDocument> {
    const user = await this.users.findByUsername(username);
    if (!user) throw new AppError('not_found', 404, 'No such user');
    if (user._id === principal.userId || user.isSuperuser)
      throw new AppError('forbidden', 403, 'You cannot ban this user');
    return user;
  }
}
