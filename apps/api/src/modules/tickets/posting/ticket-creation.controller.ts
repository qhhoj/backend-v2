import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketProblemParamDto } from '../core/dto/ticket-params.dto';
import { TicketDetailResponse } from '../core/dto/ticket.response';
import { ContestKeyParamDto } from '../../contests/core/dto/contest-params.dto';
import {
  NewContestTicketDto,
  NewGeneralTicketDto,
  NewTicketDto,
} from './dto/new-ticket.dto';
import { TicketCreationService } from './ticket-creation.service';

@ApiTags('Tickets')
@Controller('api/internal')
export class TicketCreationController {
  constructor(private readonly creation: TicketCreationService) {}

  /**
   * File a ticket about a problem
   *
   * @remarks
   * Opens a ticket with a title and first message about a problem the caller
   * can see (404 `not_found` otherwise). The assignees are the problem's
   * authors, or the contest's authors when the caller is in a contest that
   * includes the problem. Muted users are refused (403 `forbidden` with issue
   * code `muted`). Limited to 5 tickets per 10 minutes (429 `rate_limited`).
   * The new ticket is pushed on the ticket event stream, announced on Discord
   * and sent to the assignees' inboxes.
   */
  @Post('problems/:code/tickets')
  forProblem(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: TicketProblemParamDto,
    @Body() body: NewTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.creation.forProblem(auth.principal, code, body);
  }

  /**
   * File a general ticket
   *
   * @remarks
   * Opens a ticket about the site rather than a problem, with the `issueUrl`
   * of the page concerned (http or https). It has no assignees, so staff are
   * notified. Same limits and refusals as filing a ticket about a problem.
   */
  @Post('tickets/general')
  general(
    @CurrentAuth() auth: AuthContext,
    @Body() body: NewGeneralTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.creation.general(auth.principal, body);
  }

  /**
   * Ask a contest's organisers
   *
   * @remarks
   * Opens a ticket filed from a contest the caller can see (404 `not_found`
   * otherwise): about the contest, or about one of its problems given by
   * `problem` code (404 when it is not a problem of the contest the caller can
   * see). The assignees are the contest's authors and curators, and its editors
   * can read it. Same limits, refusals and notifications as filing a ticket
   * about a problem.
   */
  @Post('contests/:key/tickets')
  forContest(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() body: NewContestTicketDto,
  ): Promise<TicketDetailResponse> {
    return this.creation.forContest(auth.principal, key, body);
  }
}
