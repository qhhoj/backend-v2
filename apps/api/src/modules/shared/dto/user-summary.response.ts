import type { UserDocument } from '@libs/auth';

export class UserSummaryResponse {
  /** User id. */
  id!: string;
  /** Username. */
  username!: string;
  /** Null when unrated; clients colour the name by it. */
  rating!: number | null;

  static from(user: UserDocument): UserSummaryResponse {
    return { id: user._id, username: user.username, rating: user.rating };
  }
}
