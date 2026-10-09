import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { newTicketDescription, problemPath, ticketPath } from '@libs/community';
import { newId, uuidStr } from '@libs/database';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { renderField } from '../../problems/editing/problem-markup';
import type { TicketDetailResponse } from '../core/dto/ticket.response';
import { TICKET_LIMIT, TICKET_WINDOW_SECONDS } from '../core/rate-limits';
import { TicketAccess } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketGateService } from '../core/ticket-gate.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import { TicketEventsService } from '../streams/ticket-events.service';
import type { NewGeneralTicketDto, NewTicketDto } from './dto/new-ticket.dto';

type TicketLink =
  { type: 'problem'; id: string } | { type: 'general'; issueUrl: string };

/** Legacy `NewProblemTicketView`, `NewIssueTicketView` and `TicketForm`; ticket bodies use the `user` style (legacy `ticket`). */
@Injectable()
export class TicketCreationService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly problems: ProblemsRepository,
    private readonly currentContest: CurrentContestService,
    private readonly gate: TicketGateService,
    private readonly rateLimits: RateLimitService,
    private readonly context: TicketContextService,
    private readonly responses: TicketResponsesService,
    private readonly events: TicketEventsService,
    private readonly discord: DiscordWebhooksService,
  ) {}

  /** The problem must be visible to the filer (with their contest scope); assignees are the contest authors when the filer is in a contest that has the problem, else the problem's authors. */
  async forProblem(
    principal: Principal,
    code: string,
    dto: NewTicketDto,
  ): Promise<TicketDetailResponse> {
    await this.gate.assertCanWrite(principal);
    const problem = await this.problems.findForAccessByCode(code);
    const current = await this.currentContest.current(principal);
    const view = problem && ProblemAccess.accessView(problem);
    if (
      !view ||
      !ProblemAccess.canSee(
        principal,
        view,
        this.currentContest.scopeFrom(current),
      )
    )
      throw new AppError('not_found', 404, 'No such problem');
    const fromContest = current?.contest.problems.some(
      (entry) => uuidStr(entry.problem) === view.id,
    );
    const assignees =
      fromContest && current
        ? current.contest.authors.map(uuidStr)
        : view.authors;
    return this.file(principal, dto, {
      link: { type: 'problem', id: view.id },
      assignees,
      subjectLink: this.discord.link(problemPath(code)),
    });
  }

  async general(
    principal: Principal,
    dto: NewGeneralTicketDto,
  ): Promise<TicketDetailResponse> {
    await this.gate.assertCanWrite(principal);
    return this.file(principal, dto, {
      link: { type: 'general', issueUrl: dto.issueUrl },
      assignees: [],
      subjectLink: dto.issueUrl,
    });
  }

  private async file(
    principal: Principal,
    dto: NewTicketDto,
    target: { link: TicketLink; assignees: string[]; subjectLink: string },
  ): Promise<TicketDetailResponse> {
    const { link, assignees, subjectLink } = target;
    const bodyHtml = renderField(dto.body, 'user', 'body');
    const releaseHit = await this.rateLimits.reserve(
      [`ticket:${principal.userId}`],
      TICKET_LIMIT,
      TICKET_WINDOW_SECONDS,
    );
    const createdAt = new Date();
    const message = {
      _id: newId(),
      user: principal.userId,
      body: dto.body,
      bodyHtml,
      createdAt,
    };
    let ticket;
    try {
      ticket = await this.tickets.create(
        {
          title: dto.title,
          user: principal.userId,
          assignees,
          messages: [message],
          messageCount: 1,
          lastMessageAt: createdAt,
          lastMessageByStaff: TicketAccess.isStaff(principal),
        },
        link,
      );
    } catch (error) {
      await releaseHit();
      throw error;
    }
    const ticketId = uuidStr(ticket._id);
    await this.events.publish({
      type: 'new-ticket',
      ticketId,
      messageId: message._id,
      open: null,
    });
    await this.discord.notify('on_new_ticket', {
      title: `New ticket on ${subjectLink}`,
      description: newTicketDescription({
        title: dto.title,
        ticketUrl: this.discord.link(ticketPath(ticketId)),
        body: dto.body,
      }),
      author: this.discord.author(principal.username),
    });
    return this.responses.detail(
      principal,
      ticket,
      await this.context.accessView(ticket),
    );
  }
}
