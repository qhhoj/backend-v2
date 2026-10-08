import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketDetailResponse } from '../core/dto/ticket.response';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketUpdatesService } from './ticket-updates.service';

@Controller('api/internal/tickets/:id')
export class TicketUpdatesController {
  constructor(private readonly updates: TicketUpdatesService) {}

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
    @Body(new RefuseNullFieldsPipe()) body: UpdateTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.updates.update(auth.principal, id, body);
  }
}
