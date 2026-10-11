import { UsersRepository } from '@libs/auth';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { OrganizationRequest } from '@libs/database';

/** Requester usernames keyed by user id, for the rows of a request list. */
export async function usernamesById(
  users: UsersRepository,
  userIds: string[],
): Promise<Map<string, string>> {
  const found = await users.findByIds(unique(userIds));
  return new Map(found.map((user) => [uuidStr(user._id), user.username]));
}

/** Requester and decider usernames of a page of requests, in one read. */
export function requestUsernames(
  users: UsersRepository,
  requests: readonly OrganizationRequest[],
): Promise<Map<string, string>> {
  return usernamesById(
    users,
    requests.flatMap((request) =>
      request.decidedBy
        ? [uuidStr(request.user), uuidStr(request.decidedBy)]
        : [uuidStr(request.user)],
    ),
  );
}
