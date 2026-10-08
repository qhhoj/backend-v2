import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketProblemParamDto } from '../core/dto/ticket-params.dto';
import { TicketDetailResponse } from '../core/dto/ticket.response';
import { NewGeneralTicketDto, NewTicketDto } from './dto/new-ticket.dto';
import { TicketCreationService } from './ticket-creation.service';

@Controller('api/internal')
export class TicketCreationController {
  constructor(private readonly creation: TicketCreationService) {}

  @Post('problems/:code/tickets')
  forProblem(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: TicketProblemParamDto,
    @Body() body: NewTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.creation.forProblem(auth.principal, code, body);
  }

  @Post('tickets/general')
  general(
    @CurrentAuth() auth: AuthContext,
    @Body() body: NewGeneralTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.creation.general(auth.principal, body);
  }
}
