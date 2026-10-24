import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AppError } from '../errors/app.error';
import { REDIS } from '../redis/redis.module';
import { execOrThrow } from '../redis/redis-exec';

const rateKey = (key: string) => `rate:${key}`;

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

  /** Throws the 429 when any key already holds `limit` hits; counts nothing (the caller hits once the work succeeded). */
  async assertUnder(keys: string[], limit: number): Promise<void> {
    const counts = await Promise.all(keys.map((key) => this.count(key)));
    const overLimit = keys.filter((_key, index) => counts[index] >= limit);
    if (overLimit.length > 0) throw await this.refusal(overLimit);
  }

  /** Hits every key before the guarded work; over the limit throws (hits stay counted), else returns a release that gives the attempt back. */
  async reserve(
    keys: string[],
    limit: number,
    windowSeconds: number,
  ): Promise<() => Promise<void>> {
    const counts = await Promise.all(
      keys.map((key) => this.hit(key, windowSeconds)),
    );
    const overLimit = keys.filter((_key, index) => counts[index] > limit);
    if (overLimit.length > 0) throw await this.refusal(overLimit);
    return async () => {
      await Promise.all(keys.map((key) => this.release(key)));
    };
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
