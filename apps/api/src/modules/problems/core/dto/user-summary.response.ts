import type { UserDocument } from '@libs/auth';

export class UserSummaryResponse {
  /** User id. */
  id!: string;
  /** Username. */
  username!: string;

  static from(user: UserDocument): UserSummaryResponse {
    return { id: user._id, username: user.username };
  }
}
