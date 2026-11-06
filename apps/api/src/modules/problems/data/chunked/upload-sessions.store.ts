import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { conflictIssue, execOrThrow, REDIS, withRedisLock } from '@libs/common';
import type { SpentCharge } from '@libs/problems';
import {
  chunkCountOf,
  MAX_OPEN_UPLOAD_SESSIONS,
  UPLOAD_SESSION_LOCK_SECONDS,
  UPLOAD_SESSION_TTL_SECONDS,
} from './chunked-upload.limits';

export interface UploadSession {
  id: string;
  userId: string;
  problemId: string;
  /** The archive's stored name (already a safe .zip name). */
  name: string;
  size: number;
  sha256: string;
  chunkCount: number;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Stored by complete: a repeated complete answers the stored data instead of storing again. */
  completed: boolean;
}

const sessionKey = (id: string) => `chunked-upload:${id}`;
const receivedKey = (id: string) => `chunked-upload:${id}:received`;
const lockKey = (id: string) => `chunked-upload:${id}:lock`;
const userKey = (userId: string) => `chunked-upload:user:${userId}`;
const heldChargeKey = (id: string) => `chunked-upload:${id}:charge`;
const HELD_CHARGES_KEY = 'chunked-upload:held-charges';
/** A held charge outlives its session this long: the hourly sweep settles it well before, and it is gone before its refund claim (7 days from the write, which starts at most 24 h before the session's expiry). */
const HELD_CHARGE_GRACE_MS = 6 * 24 * 60 * 60 * 1000;

/** A charge a complete spent for its write: `claim` makes giving it back happen once; `upload` lets the sweep check the write finished after the session is gone. */
export interface HeldCharge {
  claim: string;
  spent: SpentCharge;
  upload: Pick<UploadSession, 'problemId' | 'name' | 'size' | 'sha256'>;
}

const toSession = (fields: Record<string, string>): UploadSession => ({
  id: fields.id,
  userId: fields.userId,
  problemId: fields.problemId,
  name: fields.name,
  size: Number(fields.size),
  sha256: fields.sha256,
  chunkCount: Number(fields.chunkCount),
  expiresAt: Number(fields.expiresAt),
  completed: fields.completed === 'true',
});

/** Upload sessions in Redis, each key expiring with the session: the fields, the set of received chunk indexes, and per user the open session ids (scored by expiry). */
@Injectable()
export class UploadSessionsStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** A new session, unless its user already has `MAX_OPEN_UPLOAD_SESSIONS` open (409 `upload_sessions_full`). */
  async create(
    fields: Pick<
      UploadSession,
      'userId' | 'problemId' | 'name' | 'size' | 'sha256'
    >,
    now = Date.now(),
  ): Promise<UploadSession> {
    const session: UploadSession = {
      ...fields,
      id: randomUUID(),
      chunkCount: chunkCountOf(fields.size),
      expiresAt: now + UPLOAD_SESSION_TTL_SECONDS * 1000,
      completed: false,
    };
    await this.takeUserSlot(session, now);
    await execOrThrow(
      this.redis
        .multi()
        .hset(sessionKey(session.id), { ...session })
        .pexpireat(sessionKey(session.id), session.expiresAt),
    );
    return session;
  }

  /** Counts the session among its user's open ones; over the cap it is taken out again and refused. */
  private async takeUserSlot(
    session: UploadSession,
    now: number,
  ): Promise<void> {
    const key = userKey(session.userId);
    const results = await execOrThrow(
      this.redis
        .multi()
        .zremrangebyscore(key, '-inf', now)
        .zadd(key, session.expiresAt, session.id)
        .pexpireat(key, session.expiresAt)
        .zcard(key),
    );
    if (Number(results[3]) <= MAX_OPEN_UPLOAD_SESSIONS) return;
    await this.redis.zrem(key, session.id);
    throw conflictIssue(
      'upload',
      'upload_sessions_full',
      `At most ${MAX_OPEN_UPLOAD_SESSIONS} uploads can be open at once; finish or cancel one first.`,
    );
  }

  async get(id: string): Promise<UploadSession | null> {
    const fields = await this.redis.hgetall(sessionKey(id));
    return fields.id ? toSession(fields) : null;
  }

  async isOpen(id: string): Promise<boolean> {
    return (await this.redis.exists(sessionKey(id))) === 1;
  }

  /** The received chunk indexes, ascending. */
  async received(id: string): Promise<number[]> {
    const members = await this.redis.smembers(receivedKey(id));
    return members.map(Number).sort((left, right) => left - right);
  }

  async markReceived(session: UploadSession, index: number): Promise<void> {
    await execOrThrow(
      this.redis
        .multi()
        .sadd(receivedKey(session.id), index)
        .pexpireat(receivedKey(session.id), session.expiresAt),
    );
  }

  /** A part the session lists but the disk lost (an operator `rm`, a disk error): it must be sent again. */
  async unmarkReceived(id: string, index: number): Promise<void> {
    await this.redis.srem(receivedKey(id), index);
  }

  /** One chunk write, completion or cancel of a session at a time; another is the 409 `busy` conflict. */
  withSessionLock<Result>(
    id: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return withRedisLock(
      this.redis,
      {
        key: lockKey(id),
        ttlSeconds: UPLOAD_SESSION_LOCK_SECONDS,
        busyMessage:
          'This upload is busy with a chunk, its completion or a cancel, try again',
        renew: true,
      },
      work,
    );
  }

  /** Kept until it expires so a complete retried after a lost answer finds it; it no longer counts among the user's open sessions. The expiry is set again, so a key that was gone meanwhile is not recreated forever (a past expiry deletes it at once). */
  async markCompleted(session: UploadSession): Promise<void> {
    await execOrThrow(
      this.redis
        .multi()
        .hset(sessionKey(session.id), 'completed', 'true')
        .pexpireat(sessionKey(session.id), session.expiresAt)
        .zrem(userKey(session.userId), session.id),
    );
  }

  /** Held while complete's write runs, in its own key that outlives the session by `HELD_CHARGE_GRACE_MS`, so the sweep can still give it back once the session expired; listed in one set for the sweep. */
  async holdCharge(
    session: Pick<UploadSession, 'id' | 'expiresAt'>,
    charge: HeldCharge,
  ): Promise<void> {
    await execOrThrow(
      this.redis
        .multi()
        .set(heldChargeKey(session.id), JSON.stringify(charge))
        .pexpireat(
          heldChargeKey(session.id),
          session.expiresAt + HELD_CHARGE_GRACE_MS,
        )
        .sadd(HELD_CHARGES_KEY, session.id),
    );
  }

  async heldCharge(id: string): Promise<HeldCharge | null> {
    const charge = await this.redis.get(heldChargeKey(id));
    return charge === null ? null : (JSON.parse(charge) as HeldCharge);
  }

  async releaseCharge(id: string): Promise<void> {
    await execOrThrow(
      this.redis.multi().del(heldChargeKey(id)).srem(HELD_CHARGES_KEY, id),
    );
  }

  /** Every session id that holds (or held, until released) a charge. */
  heldChargeIds(): Promise<string[]> {
    return this.redis.smembers(HELD_CHARGES_KEY);
  }

  async remove(session: Pick<UploadSession, 'id' | 'userId'>): Promise<void> {
    await execOrThrow(
      this.redis
        .multi()
        .del(sessionKey(session.id), receivedKey(session.id))
        .zrem(userKey(session.userId), session.id),
    );
  }
}
