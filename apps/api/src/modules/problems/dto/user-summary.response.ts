import type { UserDocument } from '@libs/auth';

export class UserSummaryResponse {
  id!: string;
  username!: string;

  static from(user: UserDocument): UserSummaryResponse {
    return { id: user._id, username: user.username };
  }
}
