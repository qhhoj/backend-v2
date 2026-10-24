import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { ENV, Env, REDIS, execOrThrow } from '@libs/common';
import Redis from 'ioredis';
import { PrincipalService } from '../principal/principal.service';
import { UsersRepository } from '../users/users.repository';
import {
  SESSION_KEY_PREFIX,
  SessionRecords,
  userSessionsKey,
} from './session-record';
import { SESSION_TTL_SECONDS } from './session.service';

/** Set once the pass completed; later boots skip it. */
export const SESSION_KEY_MIGRATION_MARKER = 'session-key-migration:v1';
const OLD_KEY = /^session:[0-9a-f]{64}$/;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/** Moves the record at KEYS[1] (still ARGV[1]) to KEYS[2] as ARGV[2] with the same expiry, and in the user index KEYS[3]. */
const MOVE_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then ttl = tonumber(ARGV[3]) end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ttl)
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[3], KEYS[1])
redis.call('SADD', KEYS[3], KEYS[2])
return 1`;
interface MigrationScripts {
  sessionMoveKey(
    oldKey: string,
    newKey: string,
    indexKey: string,
    stored: string,
    sealed: string,
    fallbackTtlMs: number,
  ): Promise<number>;
}

/** A record as the api stored it before keys were bound to the secret; null for anything else (another app's key). */
function oldRecordUserId(stored: string): string | null {
  try {
    const record = JSON.parse(stored) as Record<string, unknown>;
    return typeof record.userId === 'string' && typeof record.csrf === 'string'
      ? record.userId
      : null;
  } catch {
    return null;
  }
}

/** One pass: which users keep their session (looked up once per user), and how many sessions it ended. */
interface MigrationRun {
  keeps: Map<string, Promise<boolean>>;
  ended: number;
}

/**
 * One-off migration, idempotent, run by the api before it listens, so no session is ever looked up at its
 * old key and nobody is logged out: rebinds `session:<sha256(cookie)>` records to
 * `session:<HMAC(secret, sha256)>` with a record mac and the same expiry, then drops dead members from
 * every `user-sessions:*` index and gives each one the expiry of its longest session. Sessions of staff,
 * superusers, holders of any permission and unknown users are ended instead (they sign in again). It runs only on a
 * boot with `SESSION_KEY_MIGRATION=1`, set in the root-only env file for one deploy.
 */
@Injectable()
export class SessionKeyMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionKeyMigrationService.name);
  private readonly records: SessionRecords;
  private readonly enabled: boolean;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Pick<Env, 'sessionSecret' | 'sessionKeyMigration'>,
    @Inject(UsersRepository)
    private readonly users: Pick<UsersRepository, 'findById'>,
    @Inject(PrincipalService)
    private readonly principals: Pick<PrincipalService, 'build'>,
  ) {
    this.records = new SessionRecords(env.sessionSecret);
    this.enabled = env.sessionKeyMigration;
    redis.defineCommand('sessionMoveKey', { numberOfKeys: 3, lua: MOVE_LUA });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (
      !this.enabled ||
      (await this.redis.exists(SESSION_KEY_MIGRATION_MARKER))
    )
      return;
    const run: MigrationRun = { keeps: new Map(), ended: 0 };
    const moved = await this.forEachKey(`${SESSION_KEY_PREFIX}*`, (key) =>
      this.moveKey(key, run),
    );
    const indexes = await this.forEachKey('user-sessions:*', (key) =>
      this.tidyIndex(key),
    );
    await this.redis.set(
      SESSION_KEY_MIGRATION_MARKER,
      new Date().toISOString(),
    );
    this.logger.log(
      `Session keys bound to SESSION_SECRET: ${moved} sessions, ${run.ended} staff sessions ended, ${indexes} user indexes`,
    );
  }

  /** Runs `visit` on each key matching `pattern`; returns how many it counted. */
  private async forEachKey(
    pattern: string,
    visit: (key: string) => Promise<number>,
  ): Promise<number> {
    let counted = 0;
    const stream = this.redis.scanStream({ match: pattern, count: 500 });
    for await (const keys of stream as AsyncIterable<string[]>)
      for (const key of keys) counted += await visit(key);
    return counted;
  }

  private async moveKey(oldKey: string, run: MigrationRun): Promise<number> {
    if (!OLD_KEY.test(oldKey)) return 0;
    const stored = await this.redis.get(oldKey);
    const userId = stored && oldRecordUserId(stored);
    if (!stored || !userId) return 0;
    if (!(await this.keepsSession(userId, run))) {
      await execOrThrow(
        this.redis.multi().del(oldKey).srem(userSessionsKey(userId), oldKey),
      );
      run.ended++;
      return 0;
    }
    const newKey = this.records.keyForDigest(
      oldKey.slice(SESSION_KEY_PREFIX.length),
    );
    return await (this.redis as Redis & MigrationScripts).sessionMoveKey(
      oldKey,
      newKey,
      userSessionsKey(userId),
      stored,
      this.records.seal(newKey, stored),
      SESSION_TTL_MS,
    );
  }

  private keepsSession(userId: string, run: MigrationRun): Promise<boolean> {
    let keeps = run.keeps.get(userId);
    if (!keeps) {
      keeps = this.isPlainUser(userId);
      run.keeps.set(userId, keeps);
    }
    return keeps;
  }

  /** A known user with no staff or superuser flag and no permission, directly or through a group. */
  private async isPlainUser(userId: string): Promise<boolean> {
    const user = await this.users.findById(userId);
    if (!user) return false;
    const principal = this.principals.build(user);
    return (
      !principal.isSuperuser &&
      !principal.isStaff &&
      principal.permissions.size === 0
    );
  }

  /** Drops members whose session is gone; the index lives as long as its longest session. */
  private async tidyIndex(indexKey: string): Promise<number> {
    const members = await this.redis.smembers(indexKey);
    const pipeline = this.redis.pipeline();
    members.forEach((member) => pipeline.pttl(member));
    const ttls = (await execOrThrow(pipeline)) as number[];
    const dead = members.filter((_member, index) => ttls[index] === -2);
    const longest = Math.max(
      0,
      ...ttls.map((ttl) => (ttl === -1 ? SESSION_TTL_MS : ttl)),
    );
    if (dead.length) await this.redis.srem(indexKey, ...dead);
    if (longest > 0) await this.redis.pexpire(indexKey, longest);
    else await this.redis.del(indexKey);
    return 1;
  }
}
