import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { ProblemAccess } from '../../problems/core/problem-access';
import { TicketAccess } from '../core/ticket-access';
import { TicketsRepository } from '../core/tickets.repository';
import { TicketContextService } from '../core/ticket-context.service';
import type { TicketSummaryResponse } from './dto/ticket-summary.response';

@Injectable()
export class TicketSummaryService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly context: TicketContextService,
  ) {}

  async summary(principal: Principal): Promise<TicketSummaryResponse> {
    const [assignedOpen, awaitingStaff, aboutMineOpen] = await Promise.all([
      this.tickets.countAssignedOpen(principal.userId),
      TicketAccess.isStaff(principal)
        ? this.tickets.countAwaitingStaff()
        : Promise.resolve(0),
      this.countAboutMine(principal),
    ]);
    return { assignedOpen, awaitingStaff, aboutMineOpen };
  }

  /** Only problem editors own problems; everyone else is spared the lookup on every badge poll. */
  private async countAboutMine(principal: Principal): Promise<number> {
    if (ProblemAccess.editableFilter(principal) === null) return 0;
    return this.tickets.countOpen(
      await this.context.aboutMineFilter(principal.userId),
    );
  }
}
