import { UsersRepository } from '@libs/auth';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';

/** Requester usernames keyed by user id, for the rows of a request list. */
export async function usernamesById(
  users: UsersRepository,
  userIds: string[],
): Promise<Map<string, string>> {
  const found = await users.findByIds(unique(userIds));
  return new Map(found.map((user) => [uuidStr(user._id), user.username]));
}
