import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ContributionsModule } from '../contributions/contributions.module';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { DiscordModule } from '../discord/discord.module';
import { EventsModule } from '../events/events.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { CannedRepliesController } from './canned/canned-replies.controller';
import { CannedRepliesRepository } from './canned/canned-replies.repository';
import { CannedRepliesService } from './canned/canned-replies.service';
import { TicketSummaryController } from './alerts/ticket-summary.controller';
import { TicketSummaryService } from './alerts/ticket-summary.service';
import { TicketGateService } from './core/ticket-gate.service';
import { TicketContextService } from './core/ticket-context.service';
import { TicketResponsesService } from './core/ticket-responses.service';
import { TicketUpdatesController } from './editing/ticket-updates.controller';
import { TicketUpdatesService } from './editing/ticket-updates.service';
import { TicketsController } from './core/tickets.controller';
import { TicketsRepository } from './core/tickets.repository';
import { TicketsService } from './core/tickets.service';
import { TicketCreationController } from './posting/ticket-creation.controller';
import { TicketCreationService } from './posting/ticket-creation.service';
import { TicketMessagesController } from './posting/ticket-messages.controller';
import { TicketMessagesService } from './posting/ticket-messages.service';
import { TicketEventsService } from './streams/ticket-events.service';
import { TicketStreamsController } from './streams/ticket-streams.controller';
import { TicketStreamsService } from './streams/ticket-streams.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ContributionsModule,
    DiscordModule,
    EventsModule,
    ProblemsApiModule,
  ],
  controllers: [
    CannedRepliesController,
    TicketsController,
    TicketCreationController,
    TicketMessagesController,
    TicketUpdatesController,
    TicketStreamsController,
    TicketSummaryController,
  ],
  providers: [
    CannedRepliesRepository,
    CannedRepliesService,
    TicketsRepository,
    TicketContextService,
    TicketResponsesService,
    TicketsService,
    RateLimitService,
    TicketGateService,
    TicketEventsService,
    TicketStreamsService,
    TicketCreationService,
    TicketMessagesService,
    TicketUpdatesService,
    TicketSummaryService,
  ],
  exports: [
    TicketsRepository,
    TicketContextService,
    TicketResponsesService,
    TicketEventsService,
    TicketGateService,
  ],
})
export class TicketsApiModule {}
