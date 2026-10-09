import { Controller, Get, Header } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketSummaryResponse } from './dto/ticket-summary.response';
import { TicketSummaryService } from './ticket-summary.service';

@Controller('api/internal/tickets/summary')
export class TicketSummaryController {
  constructor(private readonly summaries: TicketSummaryService) {}

  /** The ticket badge; the browser may reuse it for 15 seconds. */
  @Header('Cache-Control', 'private, max-age=15')
  @Get()
  summary(@CurrentAuth() auth: AuthContext): Promise<TicketSummaryResponse> {
    return this.summaries.summary(auth.principal);
  }
}
