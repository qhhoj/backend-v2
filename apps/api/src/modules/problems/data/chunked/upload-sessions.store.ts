import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { conflictIssue, execOrThrow, REDIS, withRedisLock } from '@libs/common';
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
}

const sessionKey = (id: string) => `chunked-upload:${id}`;
const receivedKey = (id: string) => `chunked-upload:${id}:received`;
const lockKey = (id: string) => `chunked-upload:${id}:lock`;
const userKey = (userId: string) => `chunked-upload:user:${userId}`;

const toSession = (fields: Record<string, string>): UploadSession => ({
  id: fields.id,
  userId: fields.userId,
  problemId: fields.problemId,
  name: fields.name,
  size: Number(fields.size),
  sha256: fields.sha256,
  chunkCount: Number(fields.chunkCount),
  expiresAt: Number(fields.expiresAt),
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

  /** One chunk write or completion of a session at a time; another is the 409 `busy` conflict. */
  withSessionLock<Result>(
    id: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    return withRedisLock(
      this.redis,
      {
        key: lockKey(id),
        ttlSeconds: UPLOAD_SESSION_LOCK_SECONDS,
        busyMessage: 'Another chunk of this upload is being written, try again',
        renew: true,
      },
      work,
    );
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
