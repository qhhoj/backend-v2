import { Inject, Injectable } from '@nestjs/common';
import { REDIS, execOrThrow } from '@libs/common';
import { SettingsService } from '@libs/settings';
import Redis from 'ioredis';
import { randomToken, sha256 } from '../crypto';

export interface SessionData {
  userId: string;
  twoFaPassed: boolean;
  passwordPwned: boolean;
  impersonatorId: string | null;
  csrf: string;
  /** Login time (ms): the session ends `auth.sessionMaxDays` after it, however often it is used. */
  createdAt: number;
  cookieIssuedAt: number;
  pendingTotpSecret: string | null;
  webauthnChallenge: string | null;
  webauthnRegistrationChallenge: string | null;
}

type StoredSession = Omit<
  SessionData,
  | 'createdAt'
  | 'cookieIssuedAt'
  | 'pendingTotpSecret'
  | 'webauthnChallenge'
  | 'webauthnRegistrationChallenge'
>;

export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
export const COOKIE_REFRESH_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const sessionKey = (id: string) => `session:${sha256(id)}`;
const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

// sessions stored before these fields existed lack them
const withDefaults = (stored: string): SessionData => ({
  createdAt: 0,
  cookieIssuedAt: 0,
  pendingTotpSecret: null,
  webauthnChallenge: null,
  webauthnRegistrationChallenge: null,
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
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {
    redis.defineCommand('sessionUpdate', { numberOfKeys: 1, lua: UPDATE_LUA });
    redis.defineCommand('sessionConsume', {
      numberOfKeys: 1,
      lua: CONSUME_LUA,
    });
  }

  async create(
    data: Omit<
      SessionData,
      | 'csrf'
      | 'createdAt'
      | 'cookieIssuedAt'
      | 'pendingTotpSecret'
      | 'webauthnChallenge'
      | 'webauthnRegistrationChallenge'
    >,
  ): Promise<{ id: string; session: SessionData }> {
    const id = randomToken();
    const now = Date.now();
    const session: SessionData = {
      ...data,
      csrf: randomToken(),
      createdAt: now,
      cookieIssuedAt: now,
      pendingTotpSecret: null,
      webauthnChallenge: null,
      webauthnRegistrationChallenge: null,
    };
    await this.forgetExpired(data.userId);
    await execOrThrow(
      this.redis
        .multi()
        .set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS)
        .sadd(userSessionsKey(data.userId), sessionKey(id)),
    );
    return { id, session };
  }

  /** Sessions end by TTL without leaving the user's set: drop the members whose key is gone (a key is never reused, so a missing one never comes back). */
  private async forgetExpired(userId: string): Promise<void> {
    const members = await this.redis.smembers(userSessionsKey(userId));
    if (!members.length) return;
    const exists = await execOrThrow(
      members.reduce(
        (pipeline, member) => pipeline.exists(member),
        this.redis.pipeline(),
      ),
    );
    const expired = members.filter((_member, index) => exists[index] === 0);
    if (expired.length)
      await this.redis.srem(userSessionsKey(userId), ...expired);
  }

  /** Slides the 14-day expiry; a session past `auth.sessionMaxDays` since its login is destroyed instead. */
  async get(id: string): Promise<SessionData | null> {
    const stored = await this.redis.getex(
      sessionKey(id),
      'EX',
      SESSION_TTL_SECONDS,
    );
    if (!stored) return null;
    const session = withDefaults(stored);
    // Stored before sessions recorded their login: the lifetime starts now.
    if (!session.createdAt) return this.update(id, { createdAt: Date.now() });
    const maxAgeMs = this.settings.get('auth.sessionMaxDays') * DAY_MS;
    if (Date.now() - session.createdAt <= maxAgeMs) return session;
    await this.destroy(id);
    return null;
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
    field:
      | 'webauthnChallenge'
      | 'webauthnRegistrationChallenge'
      | 'pendingTotpSecret',
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
