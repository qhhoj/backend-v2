import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Header } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketSummaryResponse } from './dto/ticket-summary.response';
import { TicketSummaryService } from './ticket-summary.service';

@ApiTags('Tickets')
@Controller('api/internal/tickets/summary')
export class TicketSummaryController {
  constructor(private readonly summaries: TicketSummaryService) {}

  /**
   * Get the ticket badge counts
   *
   * @remarks
   * Returns how many open tickets are assigned to the caller and, for staff,
   * how many are waiting for staff. The browser may reuse the answer for 15
   * seconds.
   */
  @Header('Cache-Control', 'private, max-age=15')
  @Get()
  summary(@CurrentAuth() auth: AuthContext): Promise<TicketSummaryResponse> {
    return this.summaries.summary(auth.principal);
  }
}
