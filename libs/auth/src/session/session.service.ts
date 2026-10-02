import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { REDIS, execOrThrow } from '@libs/common';
import Redis from 'ioredis';

export interface SessionData {
  userId: string;
  twoFaPassed: boolean;
  passwordPwned: boolean;
  impersonatorId: string | null;
  csrf: string;
}

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const sessionKey = (id: string) =>
  `session:${createHash('sha256').update(id).digest('hex')}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;
const randomToken = () => randomBytes(32).toString('base64url');

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(
    data: Omit<SessionData, 'csrf'>,
  ): Promise<{ id: string; session: SessionData }> {
    const id = randomToken();
    const session: SessionData = { ...data, csrf: randomToken() };
    await execOrThrow(
      this.redis
        .multi()
        .set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
        .sadd(userSessionsKey(data.userId), sessionKey(id)),
    );
    return { id, session };
  }

  async get(id: string): Promise<SessionData | null> {
    const stored = await this.redis.getex(
      sessionKey(id),
      'EX',
      SESSION_TTL_SECONDS,
    );
    return stored ? (JSON.parse(stored) as SessionData) : null;
  }

  async update(
    id: string,
    changes: Partial<Omit<SessionData, 'csrf' | 'userId'>>,
  ): Promise<SessionData | null> {
    const current = await this.get(id);
    if (!current) return null;
    const session = { ...current, ...changes };
    const written = await this.redis.set(
      sessionKey(id),
      JSON.stringify(session),
      'EX',
      SESSION_TTL_SECONDS,
      'XX',
    );
    return written ? session : null;
  }

  async destroy(id: string): Promise<void> {
    const [stored] = await execOrThrow(
      this.redis.multi().get(sessionKey(id)).del(sessionKey(id)),
    );
    if (stored)
      await this.redis.srem(
        userSessionsKey((JSON.parse(stored as string) as SessionData).userId),
        sessionKey(id),
      );
  }

  async destroyAllForUser(userId: string, keepId?: string): Promise<void> {
    const keep = keepId && sessionKey(keepId);
    const doomed = (await this.redis.smembers(userSessionsKey(userId))).filter(
      (key) => key !== keep,
    );
    if (doomed.length)
      await execOrThrow(
        this.redis
          .multi()
          .del(...doomed)
          .srem(userSessionsKey(userId), ...doomed),
      );
  }
}
