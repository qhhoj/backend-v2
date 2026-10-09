import { BullModule } from '@nestjs/bullmq';
import { Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { AuthModule, IntegrationClientsRepository } from '@libs/auth';
import { ENV, RateLimitService, type Env } from '@libs/common';
import { CONTEST_FINAL_JUDGE_QUEUE } from '@libs/contests';
import { IntegrationClientsController } from './clients/integration-clients.controller';
import { IntegrationClientsService } from './clients/integration-clients.service';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ContestsApiModule } from '../contests/contests-api.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SyncActsAsService } from './contests/sync-acts-as.service';
import { SyncContestOwnership } from './contests/sync-contest-ownership.service';
import { SyncContestsController } from './contests/sync-contests.controller';
import { SyncContestsService } from './contests/sync-contests.service';
import { SyncContestRemovalService } from './contests/sync-contest-removal.service';
import { SyncParticipantsRepository } from './contests/sync-participants.repository';
import { SyncParticipantsService } from './contests/sync-participants.service';
import { SyncRateLimit } from './contests/sync-rate-limit.service';
import { SyncStandingsService } from './contests/sync-standings.service';

/** The sync API for integration clients and the administration of their keys. */
@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ContestsApiModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_FINAL_JUDGE_QUEUE }),
  ],
  controllers: [IntegrationClientsController, SyncContestsController],
  providers: [
    IntegrationClientsService,
    RateLimitService,
    SyncActsAsService,
    SyncContestOwnership,
    SyncContestRemovalService,
    SyncContestsService,
    SyncParticipantsRepository,
    SyncParticipantsService,
    SyncRateLimit,
    SyncStandingsService,
  ],
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
