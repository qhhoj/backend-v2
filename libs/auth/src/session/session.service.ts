import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { REDIS, execOrThrow } from '@libs/common';
import Redis from 'ioredis';

export interface SessionData {
  userId: string;
  twoFaPassed: boolean;
  passwordPwned: boolean;
  impersonatorId: string | null;
  /** The impersonator's own passwordPwned flag, restored when impersonation stops. */
  impersonatorPasswordPwned: boolean;
  csrf: string;
  cookieIssuedAt: number;
  pendingTotpSecret: string | null;
  webauthnChallenge: string | null;
}

type StoredSession = Omit<
  SessionData,
  | 'cookieIssuedAt'
  | 'impersonatorPasswordPwned'
  | 'pendingTotpSecret'
  | 'webauthnChallenge'
>;

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
export const COOKIE_REFRESH_MS = 24 * 60 * 60 * 1000;
const sessionKey = (id: string) =>
  `session:${createHash('sha256').update(id).digest('hex')}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;
const randomToken = () => randomBytes(32).toString('base64url');

// sessions stored before these fields existed lack them
const withDefaults = (stored: string): SessionData => ({
  cookieIssuedAt: 0,
  impersonatorPasswordPwned: false,
  pendingTotpSecret: null,
  webauthnChallenge: null,
  ...(JSON.parse(stored) as Partial<SessionData> & StoredSession),
});

// cjson decodes JSON null to cjson.null and encodes it back as null
const UPDATE_LUA = `
local stored = redis.call('GET', KEYS[1])
if not stored then return false end
local session = cjson.decode(stored)
for field, value in pairs(cjson.decode(ARGV[1])) do session[field] = value end
local merged = cjson.encode(session)
redis.call('SET', KEYS[1], merged, 'EX', ARGV[2])
return merged`;
const CONSUME_LUA = `
local stored = redis.call('GET', KEYS[1])
if not stored then return false end
local session = cjson.decode(stored)
local value = session[ARGV[1]]
if value == nil or value == cjson.null then return false end
session[ARGV[1]] = cjson.null
redis.call('SET', KEYS[1], cjson.encode(session), 'EX', ARGV[2])
return value`;
interface SessionScripts {
  sessionUpdate(
    key: string,
    changes: string,
    ttlSeconds: number,
  ): Promise<string | null>;
  sessionConsume(
    key: string,
    field: string,
    ttlSeconds: number,
  ): Promise<string | null>;
}

@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    redis.defineCommand('sessionUpdate', { numberOfKeys: 1, lua: UPDATE_LUA });
    redis.defineCommand('sessionConsume', {
      numberOfKeys: 1,
      lua: CONSUME_LUA,
    });
  }

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
    return stored ? withDefaults(stored) : null;
  }

  /** Atomic server-side merge; the sliding expiry is refreshed like on read. */
  async update(
    id: string,
    changes: Partial<Omit<SessionData, 'csrf' | 'userId'>>,
  ): Promise<SessionData | null> {
    const merged = await this.scripts().sessionUpdate(
      sessionKey(id),
      JSON.stringify(changes),
      SESSION_TTL_SECONDS,
    );
    return merged ? withDefaults(merged) : null;
  }

  /** Atomically returns a single-use field and clears it. */
  async consume(
    id: string,
    field: 'webauthnChallenge' | 'pendingTotpSecret',
  ): Promise<string | null> {
    return await this.scripts().sessionConsume(
      sessionKey(id),
      field,
      SESSION_TTL_SECONDS,
    );
  }

  private scripts() {
    return this.redis as Redis & SessionScripts;
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
