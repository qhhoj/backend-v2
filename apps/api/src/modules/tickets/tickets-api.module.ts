import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { ContestAccessModule } from '../contests/core/contest-access.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { TicketContextService } from './core/ticket-context.service';
import { TicketResponsesService } from './core/ticket-responses.service';
import { TicketsController } from './core/tickets.controller';
import { TicketsRepository } from './core/tickets.repository';
import { TicketsService } from './core/tickets.service';

@Module({
  imports: [AuthModule, ContestAccessModule, ProblemsApiModule],
  controllers: [TicketsController],
  providers: [
    TicketsRepository,
    TicketContextService,
    TicketResponsesService,
    TicketsService,
  ],
  exports: [TicketsRepository, TicketContextService, TicketResponsesService],
})
export class TicketsApiModule {}
