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
  cookieIssuedAt: number;
  pendingTotpSecret: string | null;
  webauthnChallenge: string | null;
}

type StoredSession = Omit<
  SessionData,
  'cookieIssuedAt' | 'pendingTotpSecret' | 'webauthnChallenge'
>;

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
export const COOKIE_REFRESH_MS = 24 * 60 * 60 * 1000;
const sessionKey = (id: string) =>
  `session:${createHash('sha256').update(id).digest('hex')}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;
const randomToken = () => randomBytes(32).toString('base64url');

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(
    data: Omit<
      SessionData,
      'csrf' | 'cookieIssuedAt' | 'pendingTotpSecret' | 'webauthnChallenge'
    >,
  ): Promise<{ id: string; session: SessionData }> {
    const id = randomToken();
    const session: SessionData = {
      ...data,
      csrf: randomToken(),
      cookieIssuedAt: Date.now(),
      pendingTotpSecret: null,
      webauthnChallenge: null,
    };
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
    // sessions stored before these fields existed lack them
    return stored
      ? {
          cookieIssuedAt: 0,
          pendingTotpSecret: null,
          webauthnChallenge: null,
          ...(JSON.parse(stored) as Partial<SessionData> & StoredSession),
        }
      : null;
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
