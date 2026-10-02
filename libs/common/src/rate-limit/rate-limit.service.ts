import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
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

  async exceeded(keys: string[], limit: number): Promise<boolean> {
    if (!keys.length) return false;
    const counts = await this.redis.mget(keys.map(rateKey));
    return counts.some((count) => Number(count ?? 0) >= limit);
  }
}
