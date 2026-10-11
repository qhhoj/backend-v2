import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketDetailResponse } from '../core/dto/ticket.response';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketUpdatesService } from './ticket-updates.service';

@ApiTags('Tickets')
@Controller('api/internal/tickets/:id')
export class TicketUpdatesController {
  constructor(private readonly updates: TicketUpdatesService) {}

  /**
   * Update a ticket
   *
   * @remarks
   * Changes only the fields sent: `isOpen` (close or reopen), `notes`
   * (assignees and staff), `isContributive` (staff only, never on their own
   * ticket, counts toward the creator's contribution points) and `assignees`
   * (staff only, usernames of active users, replaces the list; 400
   * `assignee_unknown` otherwise), `title` and `problem` (staff only: retitle,
   * or link the ticket to the problem with that code instead; 400
   * `problem_unknown` for no such problem). Everything is checked before one
   * write, so
   * a refused request changes nothing. Fails with 409 `conflict` if the ticket
   * changed meanwhile.
   */
  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.updates.update(auth.principal, id, body);
  }
}
