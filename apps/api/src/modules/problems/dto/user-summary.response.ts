import type { UserDocument } from '@libs/auth';

export class UserSummaryResponse {
  id!: string;
  username!: string;

  static from(this: void, user: UserDocument): UserSummaryResponse {
    return { id: user._id, username: user.username };
  }
}
