import type Redis from 'ioredis';
import { withRedisLock } from '@libs/common';
import { MEMBER_SLOTS_LOCK_SECONDS } from './rate-limits';

/** Every write that adds a member past a `slots` check (join, approval, signup) runs under its organization's lock, so parallel ones cannot pass the cap together. `waitSeconds` 0 refuses a held lock at once (409 `busy`). */
export function withMemberSlotsLock<Result>(
  redis: Redis,
  organizationId: string,
  work: () => Promise<Result>,
  waitSeconds = 0,
): Promise<Result> {
  return withRedisLock(
    redis,
    {
      key: `organization-members:${organizationId}`,
      ttlSeconds: MEMBER_SLOTS_LOCK_SECONDS,
      busyMessage: 'Another membership change is being made; try again',
      waitSeconds,
    },
    work,
  );
}
