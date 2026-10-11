import { isActiveSuperuser } from '@libs/auth';
import type { Principal, UsersRepository } from '@libs/auth';
import { AppError, withRedisLock } from '@libs/common';
import type Redis from 'ioredis';
import { assertSuperuser } from './access-rules';

/** One lock for every write that grants or removes superuser power (access, roles, deactivating a superuser). */
const SUPERUSER_LOCK = {
  key: 'access-lock:superuser',
  ttlSeconds: 30,
  busyMessage: 'Another access change is being saved; try again.',
};

/** Runs `work` under the lock after re-reading that the caller is still an active superuser. As no write here targets the caller, at least one active superuser always remains, even when two demote each other at once. */
export async function asCurrentSuperuser<Result>(
  redis: Redis,
  users: UsersRepository,
  principal: Principal,
  work: () => Promise<Result>,
): Promise<Result> {
  assertSuperuser(principal);
  return withRedisLock(redis, SUPERUSER_LOCK, async () => {
    if (!isActiveSuperuser(await users.findById(principal.userId)))
      throw new AppError('forbidden', 403, 'You are no longer a superuser');
    return work();
  });
}
