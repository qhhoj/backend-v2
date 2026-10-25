import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppError } from '../errors/app.error';
import { REDIS } from '../redis/redis.module';
import { execOrThrow } from '../redis/redis-exec';

const rateKey = (key: string) => `rate:${key}`;
/**
 * KEYS: the rate keys; ARGV[1]: the window, ARGV[1 + i]: KEYS[i]'s limit. Returns the 1-based indexes of the keys
 * already at their limit and then counts nothing (a refusal never touches a window, so it cannot give back a hit of a
 * later one); otherwise counts one hit on every key, starting a window where none runs.
 */
const CLAIM_SCRIPT = `
local over = {}
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[i + 1]) then over[#over + 1] = i end
end
if #over > 0 then return over end
for _, key in ipairs(KEYS) do
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ARGV[1], 'NX')
end
return over
`;

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const [count] = await execOrThrow(
      this.redis
        .multi()
        .incr(rateKey(key))
        .expire(rateKey(key), windowSeconds, 'NX'),
    );
    return count as number;
  }

  /** Hits counted in the key's current window, without counting one. */
  async count(key: string): Promise<number> {
    return Number((await this.redis.get(rateKey(key))) ?? 0);
  }

  /**
   * Hits every key before the guarded work, each against its own limit, in one atomic step; over any limit throws and
   * counts nothing, else returns a release that gives the hits back. Unlike `reserve`, a refusal costs nothing, so
   * callers can claim a budget that only finished work keeps.
   */
  async claim(
    budgets: ReadonlyArray<{ key: string; limit: number }>,
    windowSeconds: number,
  ): Promise<() => Promise<void>> {
    const keys = budgets.map(({ key }) => key);
    const overLimit = (await this.redis.eval(
      CLAIM_SCRIPT,
      keys.length,
      ...keys.map(rateKey),
      windowSeconds,
      ...budgets.map(({ limit }) => limit),
    )) as number[];
    if (overLimit.length > 0)
      throw await this.refusal(overLimit.map((index) => keys[index - 1]));
    return () => this.releaseAll(keys);
  }

  /** Hits every key before the guarded work; over the limit throws (hits stay counted), else returns a release that gives the attempt back. */
  async reserve(
    keys: string[],
    limit: number,
    windowSeconds: number,
  ): Promise<() => Promise<void>> {
    const counts = await this.hitAll(keys, windowSeconds);
    const overLimit = keys.filter((_key, index) => counts[index] > limit);
    if (overLimit.length > 0) throw await this.refusal(overLimit);
    return () => this.releaseAll(keys);
  }

  /** Hits every key; when one hit fails, gives back the ones that were counted and rethrows, so a Redis error leaves no stray hits. */
  private async hitAll(
    keys: readonly string[],
    windowSeconds: number,
  ): Promise<number[]> {
    const results = await Promise.allSettled(
      keys.map((key) => this.hit(key, windowSeconds)),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (!failed)
      return results.map(
        (result) => (result as PromiseFulfilledResult<number>).value,
      );
    await this.releaseAll(
      keys.filter((_key, index) => results[index].status === 'fulfilled'),
    );
    throw failed.reason;
  }

  private async releaseAll(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.release(key)));
  }

  /** The 429 for keys over their limit; Retry-After is the longest wait until one of their windows ends. */
  private async refusal(overLimit: string[]): Promise<AppError> {
    const remainingSeconds = await Promise.all(
      overLimit.map((key) => this.redis.ttl(rateKey(key))),
    );
    return new AppError(
      'rate_limited',
      429,
      'Too many attempts; try again later',
      undefined,
      { 'Retry-After': String(Math.max(1, ...remainingSeconds)) },
    );
  }

  /** Gives back one hit (never below zero), so only counted attempts consume budget. */
  async release(key: string): Promise<void> {
    await this.redis.eval(
      "local count = tonumber(redis.call('GET', KEYS[1])); if count and count > 0 then redis.call('DECR', KEYS[1]) end",
      1,
      rateKey(key),
    );
  }
}
