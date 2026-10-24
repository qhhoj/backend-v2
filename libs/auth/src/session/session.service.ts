import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env, REDIS, execOrThrow } from '@libs/common';
import { SettingsService } from '@libs/settings';
import Redis from 'ioredis';
import { randomToken } from '../crypto';
import { SessionRecords, userSessionsKey } from './session-record';

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
/** Concurrent changes of one session each retry their compare-and-set; this bounds a pathological loop. */
const MAX_CHANGE_ATTEMPTS = 50;

// sessions stored before these fields existed lack them
const withDefaults = (json: string): SessionData => ({
  createdAt: 0,
  cookieIssuedAt: 0,
  pendingTotpSecret: null,
  webauthnChallenge: null,
  webauthnRegistrationChallenge: null,
  ...(JSON.parse(json) as Partial<SessionData> & StoredSession),
});

/** Writes ARGV[2] only while the record is still ARGV[1]; the sliding expiry of the session and of its user index is refreshed. */
const SWAP_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;
interface SessionScripts {
  sessionSwap(
    key: string,
    indexKey: string,
    expected: string,
    replacement: string,
    ttlSeconds: number,
  ): Promise<number>;
}

/** What a change writes, and what the caller gets back once it is written. */
interface SessionEdit<Result> {
  next: SessionData;
  result: Result;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly records: SessionRecords;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Pick<Env, 'sessionSecret'>,
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {
    this.records = new SessionRecords(env.sessionSecret);
    redis.defineCommand('sessionSwap', { numberOfKeys: 2, lua: SWAP_LUA });
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
    const key = this.records.keyFor(id);
    const indexKey = userSessionsKey(data.userId);
    await execOrThrow(
      this.redis
        .multi()
        .set(key, this.seal(key, session), 'EX', SESSION_TTL_SECONDS)
        .sadd(indexKey, key)
        .expire(indexKey, SESSION_TTL_SECONDS),
    );
    await this.dropExpiredMembers(indexKey);
    return { id, session };
  }

  /** Slides the 14-day expiry; a session past `auth.sessionMaxDays` since its login is destroyed instead. */
  async get(id: string): Promise<SessionData | null> {
    const key = this.records.keyFor(id);
    const stored = await this.redis.getex(key, 'EX', SESSION_TTL_SECONDS);
    const session = stored ? await this.openRecord(key, stored) : null;
    if (!session) return null;
    // Stored before sessions recorded their login: the lifetime starts now.
    if (!session.createdAt) return this.update(id, { createdAt: Date.now() });
    const maxAgeMs = this.settings.get('auth.sessionMaxDays') * DAY_MS;
    if (Date.now() - session.createdAt > maxAgeMs) {
      await this.destroy(id);
      return null;
    }
    await this.redis.expire(
      userSessionsKey(session.userId),
      SESSION_TTL_SECONDS,
    );
    return session;
  }

  /** Atomic merge (compare-and-set); the sliding expiry is refreshed like on read. */
  async update(
    id: string,
    changes: Partial<Omit<SessionData, 'csrf' | 'userId'>>,
  ): Promise<SessionData | null> {
    // a field set to undefined is left alone, as JSON drops it
    const defined = JSON.parse(JSON.stringify(changes)) as typeof changes;
    return await this.change(id, (session) => {
      const next = { ...session, ...defined };
      return { next, result: next };
    });
  }

  /** Atomically returns a single-use field and clears it. */
  async consume(
    id: string,
    field:
      | 'webauthnChallenge'
      | 'webauthnRegistrationChallenge'
      | 'pendingTotpSecret',
  ): Promise<string | null> {
    return await this.change(id, (session) => {
      const value = session[field];
      return value === null
        ? null
        : { next: { ...session, [field]: null }, result: value };
    });
  }

  async destroy(id: string): Promise<void> {
    const key = this.records.keyFor(id);
    const [stored] = await execOrThrow(this.redis.multi().get(key).del(key));
    const json = stored ? this.records.open(key, stored as string) : null;
    if (json)
      await this.redis.srem(
        userSessionsKey((JSON.parse(json) as SessionData).userId),
        key,
      );
  }

  async destroyAllForUser(userId: string, keepId?: string): Promise<void> {
    const keep = keepId && this.records.keyFor(keepId);
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

  /** Reads, edits and writes back unless the record changed in between, then retries; null when the session is gone or `edit` declines. */
  private async change<Result>(
    id: string,
    edit: (session: SessionData) => SessionEdit<Result> | null,
  ): Promise<Result | null> {
    const key = this.records.keyFor(id);
    for (let attempt = 0; attempt < MAX_CHANGE_ATTEMPTS; attempt++) {
      const stored = await this.redis.get(key);
      const session = stored ? await this.openRecord(key, stored) : null;
      const edited = session && edit(session);
      if (!stored || !session || !edited) return null;
      const swapped = await this.scripts().sessionSwap(
        key,
        userSessionsKey(session.userId),
        stored,
        this.seal(key, edited.next),
        SESSION_TTL_SECONDS,
      );
      if (swapped) return edited.result;
    }
    throw new Error('Session changed concurrently too often');
  }

  /** A record the server did not write for this key is dropped: it can only come from outside. */
  private async openRecord(
    key: string,
    stored: string,
  ): Promise<SessionData | null> {
    const json = this.records.open(key, stored);
    if (json) return withDefaults(json);
    this.logger.warn('Dropped a session record with an invalid signature');
    await this.redis.del(key);
    return null;
  }

  private seal(key: string, session: SessionData): string {
    return this.records.seal(key, JSON.stringify(session));
  }

  /** Members whose session key expired; the index itself expires with its newest session. */
  private async dropExpiredMembers(indexKey: string): Promise<void> {
    const members = await this.redis.smembers(indexKey);
    const pipeline = this.redis.pipeline();
    members.forEach((member) => pipeline.exists(member));
    const alive = await execOrThrow(pipeline);
    const expired = members.filter((_member, index) => alive[index] === 0);
    if (expired.length) await this.redis.srem(indexKey, ...expired);
  }

  private scripts() {
    return this.redis as Redis & SessionScripts;
  }
}
