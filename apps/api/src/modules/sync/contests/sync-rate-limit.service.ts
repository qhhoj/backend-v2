import { Injectable } from '@nestjs/common';
import type { ServiceClientPrincipal } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { SYNC_LIMIT, SYNC_WINDOW_SECONDS } from './rate-limits';

/** One budget per client across every sync route. */
@Injectable()
export class SyncRateLimit {
  constructor(private readonly rateLimit: RateLimitService) {}

  async charge(client: ServiceClientPrincipal): Promise<void> {
    await this.rateLimit.reserve(
      [`sync:client:${client.clientId}`],
      SYNC_LIMIT,
      SYNC_WINDOW_SECONDS,
    );
  }
}
