import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { execOrThrow, REDIS } from '@libs/common';
import { ACTIVE_WINDOW_MS, classifyUserAgent } from '@libs/community';
import type { ActivityRow } from './activity-row';

const USERS_KEY = 'active:users';
const ANONYMOUS_KEY = 'active:anonymous';
const BOTS_KEY = 'active:bots';
const KEYS = [USERS_KEY, ANONYMOUS_KEY, BOTS_KEY];
const KEY_TTL_SECONDS = 3600;
/** Scrapers that rotate their user agent would grow a set without bound inside the window; the oldest members go first. */
const SET_MAX_MEMBERS = 50_000;

/** Legacy realtime snapshot (a Celery job) as three sorted sets scored by last-seen milliseconds: signed-in users by user id, anonymous visitors and bots by session key. Every write and read trims what left the 30 minute window. */
@Injectable()
export class ActiveUsersStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async record(rows: ActivityRow[]): Promise<void> {
    const pipeline = this.redis.multi();
    for (const row of rows) {
      if (classifyUserAgent(row.userAgent).deviceType === 'bot')
        pipeline.zadd(BOTS_KEY, row.at.getTime(), row.sessionKey);
      else if (row.userId)
        pipeline.zadd(USERS_KEY, row.at.getTime(), row.userId);
      else pipeline.zadd(ANONYMOUS_KEY, row.at.getTime(), row.sessionKey);
    }
    for (const key of KEYS) {
      pipeline.zremrangebyscore(key, '-inf', Date.now() - ACTIVE_WINDOW_MS);
      pipeline.zremrangebyrank(key, 0, -SET_MAX_MEMBERS - 1);
      pipeline.expire(key, KEY_TTL_SECONDS);
    }
    await execOrThrow(pipeline);
  }

  async counts(now = Date.now()): Promise<{
    authenticatedUsers: number;
    anonymousVisitors: number;
    bots: number;
  }> {
    const pipeline = this.redis.multi();
    for (const key of KEYS)
      pipeline.zremrangebyscore(key, '-inf', now - ACTIVE_WINDOW_MS);
    for (const key of KEYS) pipeline.zcard(key);
    const results = await execOrThrow(pipeline);
    const [authenticatedUsers, anonymousVisitors, bots] = results.slice(
      KEYS.length,
    ) as number[];
    return { authenticatedUsers, anonymousVisitors, bots };
  }

  /** Signed-in users, most recently seen first. */
  async users(
    page: number,
    pageSize: number,
    now = Date.now(),
  ): Promise<Array<{ userId: string; lastSeenAt: Date }>> {
    const flat = await this.redis.zrevrangebyscore(
      USERS_KEY,
      '+inf',
      now - ACTIVE_WINDOW_MS,
      'WITHSCORES',
      'LIMIT',
      (page - 1) * pageSize,
      pageSize,
    );
    const entries: Array<{ userId: string; lastSeenAt: Date }> = [];
    for (let index = 0; index < flat.length; index += 2)
      entries.push({
        userId: flat[index],
        lastSeenAt: new Date(Number(flat[index + 1])),
      });
    return entries;
  }
}
