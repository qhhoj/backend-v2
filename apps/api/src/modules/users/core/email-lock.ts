import { withRedisLock } from '@libs/common';
import type Redis from 'ioredis';

/** E-mails are not uniquely indexed (legacy duplicates), so every path that claims an address (signup, staff create, staff e-mail edit) serialises on this one lock. */
const EMAIL_LOCK_SECONDS = 30;

export const withEmailLock = <Result>(
  redis: Redis,
  email: string,
  busyMessage: string,
  work: () => Promise<Result>,
): Promise<Result> =>
  withRedisLock(
    redis,
    {
      key: `register-lock:email:${email.toLowerCase()}`,
      ttlSeconds: EMAIL_LOCK_SECONDS,
      busyMessage,
    },
    work,
  );
