import { withRedisLock } from '@libs/common';
import type Redis from 'ioredis';

/** E-mails are not uniquely indexed (legacy duplicates), so every path that claims an address (signup, staff create, staff e-mail edit) serialises on this one lock, renewed while the work runs (a signup waits in the password-hash queue for longer than the 30 s expiry). */
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
      renew: true,
    },
    work,
  );
