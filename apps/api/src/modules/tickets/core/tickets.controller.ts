import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { TicketListQueryDto, TicketPageQueryDto } from './dto/ticket-list.dto';
import {
  TicketIdParamDto,
  TicketProblemParamDto,
} from './dto/ticket-params.dto';
import {
  TicketDetailResponse,
  TicketListItemResponse,
} from './dto/ticket.response';
import { TicketsService } from './tickets.service';

@Controller('api/internal')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @ApiPaginatedResponse(TicketListItemResponse)
  @Get('tickets')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: TicketListQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    return this.tickets.list(auth.principal, query);
  }

  @ApiPaginatedResponse(TicketListItemResponse)
  @Get('problems/:code/tickets')
  problemList(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: TicketProblemParamDto,
    @Query() query: TicketPageQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    return this.tickets.problemList(auth.principal, code, query);
  }

  @Get('tickets/:id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
  ): Promise<TicketDetailResponse> {
    return this.tickets.detail(auth.principal, id);
  }
}
