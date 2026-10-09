import { Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { AuthModule, IntegrationClientsRepository } from '@libs/auth';
import { ENV, RateLimitService, type Env } from '@libs/common';
import { IntegrationClientsController } from './clients/integration-clients.controller';
import { IntegrationClientsService } from './clients/integration-clients.service';

/** The sync API for integration clients and the administration of their keys. */
@Module({
  imports: [AuthModule],
  controllers: [IntegrationClientsController],
  providers: [IntegrationClientsService, RateLimitService],
})
export class SyncModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(SyncModule.name);

  constructor(
    private readonly clients: IntegrationClientsRepository,
    @Inject(ENV) private readonly env: Pick<Env, 'trustProxy'>,
  ) {}

  /** Behind a proxy without `TRUST_PROXY`, `request.ip` is the proxy's address, so a client's CIDR check sees the proxy instead of the client (preflight M15). */
  async onApplicationBootstrap(): Promise<void> {
    if (this.env.trustProxy !== false) return;
    if (!(await this.clients.countActive())) return;
    this.logger.warn(
      'Integration clients exist but TRUST_PROXY is off: their CIDR check sees the proxy address, not the client address',
    );
  }
}
