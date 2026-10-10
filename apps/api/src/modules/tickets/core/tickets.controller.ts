import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Tickets')
@Controller('api/internal')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /**
   * List tickets
   *
   * @remarks
   * Returns tickets the caller may read: their own and those assigned to them,
   * tickets of problems they can edit, and every ticket for holders of
   * `judge.change_ticket`. Filter with `open`, `own` (only tickets they filed
   * or are assigned to), and repeated `user` and `assignee` usernames (at most
   * 10 each; unknown names match nothing). Paged with `page`.
   */
  @ApiPaginatedResponse(TicketListItemResponse)
  @Get('tickets')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: TicketListQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    return this.tickets.list(auth.principal, query);
  }

  /**
   * List the tickets of a problem
   *
   * @remarks
   * Returns the tickets filed about a problem: all of them for staff and
   * problem editors, otherwise only the caller's own. Fails with 404
   * `not_found` when the caller cannot see the problem. Paged with `page`.
   */
  @ApiPaginatedResponse(TicketListItemResponse)
  @Get('problems/:code/tickets')
  problemList(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: TicketProblemParamDto,
    @Query() query: TicketPageQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    return this.tickets.problemList(auth.principal, code, query);
  }

  /**
   * Get a ticket
   *
   * @remarks
   * Returns the ticket with its messages, notes, assignees and timeline.
   * Readable by its creator, its assignees, editors of the linked problem and
   * staff. Fails with 404 `not_found` for an unknown id and 403 `forbidden`
   * for a ticket the caller may not read.
   */
  @Get('tickets/:id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
  ): Promise<TicketDetailResponse> {
    return this.tickets.detail(auth.principal, id);
  }
}
