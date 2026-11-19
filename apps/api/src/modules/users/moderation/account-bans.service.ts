import { Injectable } from '@nestjs/common';
import { SessionService, UsersRepository } from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import { FeedKeysRepository } from '../../contests/feed/feed-keys.repository';

/** Legacy `VNOJ_CONTEST_CHEATING_BAN_MESSAGE`: the reason of an automatic contest-cheating ban; staff cannot use it. */
export const CONTEST_CHEATING_BAN_REASON =
  'Banned for multiple cheating offenses during contests';

/** What a ban does to an account, for the staff ban and the contest-cheating ban alike. */
@Injectable()
export class AccountBans {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionService,
    private readonly feedKeys: FeedKeysRepository,
  ) {}

  /**
   * Bans an unbanned account: banned rank, unlisted, inactive (the active flag is remembered for `unban`), API token
   * cleared, every session and minted feed key revoked, so an unban brings none of them back. False when the account
   * was already banned (compare-and-set on the reason).
   */
  async ban(user: UserDocument, reason: string): Promise<boolean> {
    const won = await this.users.revokeCredentials(
      user._id,
      {
        banReason: reason,
        displayRank: 'banned',
        isUnlisted: true,
        isActive: false,
        isActiveBeforeBan: user.isActive,
        apiTokenHash: null,
      },
      { banReason: null },
    );
    if (!won) return false;
    await this.sessions.destroyAllForUser(user._id);
    await this.feedKeys.revokeMintedBy(user._id, new Date());
    return true;
  }

  /** Lifts a ban still holding `user.banReason`: rank `user`, listed, and active only if it was before the ban. False when the ban changed meanwhile. */
  unban(user: UserDocument): Promise<boolean> {
    if (user.banReason === null) return Promise.resolve(false);
    return this.users.updateIfBanReason(user._id, user.banReason, {
      banReason: null,
      displayRank: 'user',
      isUnlisted: false,
      isActive: activeAfterUnban(user),
      isActiveBeforeBan: null,
    });
  }
}

/** A ban older than `isActiveBeforeBan` has none stored: those accounts were active (legacy unban). */
export const activeAfterUnban = (user: UserDocument): boolean =>
  user.isActiveBeforeBan ?? true;
