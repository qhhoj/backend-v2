import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { DiscordModule } from '../discord/discord.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { TicketGateService } from './core/ticket-gate.service';
import { TicketContextService } from './core/ticket-context.service';
import { TicketResponsesService } from './core/ticket-responses.service';
import { TicketsController } from './core/tickets.controller';
import { TicketsRepository } from './core/tickets.repository';
import { TicketsService } from './core/tickets.service';
import { TicketCreationController } from './posting/ticket-creation.controller';
import { TicketCreationService } from './posting/ticket-creation.service';
import { TicketMessagesController } from './posting/ticket-messages.controller';
import { TicketMessagesService } from './posting/ticket-messages.service';
import { TicketEventsService } from './streams/ticket-events.service';

@Module({
  imports: [AuthModule, ContestAccessModule, DiscordModule, ProblemsApiModule],
  controllers: [
    TicketsController,
    TicketCreationController,
    TicketMessagesController,
  ],
  providers: [
    TicketsRepository,
    TicketContextService,
    TicketResponsesService,
    TicketsService,
    RateLimitService,
    TicketGateService,
    TicketEventsService,
    TicketCreationService,
    TicketMessagesService,
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
