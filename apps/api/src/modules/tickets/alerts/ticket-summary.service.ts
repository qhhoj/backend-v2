import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { TicketAccess } from '../core/ticket-access';
import { TicketsRepository } from '../core/tickets.repository';
import type { TicketSummaryResponse } from './dto/ticket-summary.response';

@Injectable()
export class TicketSummaryService {
  constructor(private readonly tickets: TicketsRepository) {}

  async summary(principal: Principal): Promise<TicketSummaryResponse> {
    const [assignedOpen, awaitingStaff] = await Promise.all([
      this.tickets.countAssignedOpen(principal.userId),
      TicketAccess.isStaff(principal)
        ? this.tickets.countAwaitingStaff()
        : Promise.resolve(0),
    ]);
    return { assignedOpen, awaitingStaff };
  }
}
