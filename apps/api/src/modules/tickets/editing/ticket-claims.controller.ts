import { ApiTags } from '@nestjs/swagger';
import { Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketDetailResponse } from '../core/dto/ticket.response';
import { TicketClaimsService } from './ticket-claims.service';

@ApiTags('Tickets')
@Controller('api/internal/tickets/:id/claim')
export class TicketClaimsController {
  constructor(private readonly claims: TicketClaimsService) {}

  /**
   * Take a ticket
   *
   * @remarks
   * Makes the caller the ticket's handler ("Nhận phiếu"): staff with
   * `judge.change_ticket`, or an editor of the linked problem. A ticket the
   * caller already handles is returned unchanged. Fails with 409
   * `ticket_claimed` when someone else already handles it, also when two
   * people claim at the same moment (exactly one wins), and with 409
   * `ticket_closed` on a closed ticket. Reassigning a handled ticket is
   * `PATCH /tickets/{id}` with `assignees` (staff).
   */
  @Post()
  @HttpCode(200)
  claim(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
  ): Promise<TicketDetailResponse> {
    return this.claims.claim(auth.principal, id);
  }

  /**
   * Hand a ticket back
   *
   * @remarks
   * Removes the caller from the ticket's handlers; the others stay. Same
   * rights as taking it.
   */
  @Delete()
  release(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
  ): Promise<TicketDetailResponse> {
    return this.claims.release(auth.principal, id);
  }
}
