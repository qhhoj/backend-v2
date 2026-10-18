import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { ContestAccess } from '../../contests/core/contest-access';
import { ProblemAccess } from '../../problems/core/problem-access';
import { TicketAccess } from '../core/ticket-access';
import { TicketsRepository } from '../core/tickets.repository';
import { TicketContextService, allOf } from '../core/ticket-context.service';
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

  /**
   * The list's `aboutMine` count under the list's own visibility, so the badge never counts a ticket the list hides (a
   * curator without `edit_own_contest`). Staff, who may make things without an edit right, and problem or contest
   * editors are counted; everyone else is spared the lookups on every badge poll.
   */
  private async countAboutMine(principal: Principal): Promise<number> {
    const mayMake =
      TicketAccess.isStaff(principal) ||
      ProblemAccess.editableFilter(principal) !== null ||
      ContestAccess.editableFilter(principal) !== null;
    if (!mayMake) return 0;
    const [aboutMine, visible] = await Promise.all([
      this.context.aboutMineFilter(principal.userId),
      this.context.visibleTo(principal),
    ]);
    return this.tickets.countOpen(allOf([aboutMine, visible]));
  }
}
