import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService, unique } from '@libs/common';
import {
  contestPath,
  newTicketDescription,
  problemPath,
  ticketPath,
} from '@libs/community';
import { newId, uuidStr } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { contestScopeOf } from '../../contests/core/contest-scope';
import { ContestsRepository } from '../../contests/core/contests.repository';
import type { ContestDocument } from '../../contests/core/contests.repository';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { DiscordWebhooksService } from '@libs/community';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { renderField } from '../../problems/editing/problem-markup';
import { TicketNotificationsService } from '../alerts/ticket-notifications.service';
import type { TicketDetailResponse } from '../core/dto/ticket.response';
import { TICKET_LIMIT, TICKET_WINDOW_SECONDS } from '../core/rate-limits';
import { TicketAccess } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketGateService } from '../core/ticket-gate.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import type { NewTicketLink, TicketDocument } from '../core/tickets.repository';
import { TicketEventsService } from '../streams/ticket-events.service';
import type {
  NewContestTicketDto,
  NewGeneralTicketDto,
  NewTicketDto,
} from './dto/new-ticket.dto';

/** Where a new ticket goes: what it is about, who handles it, and the contest it was filed from (null outside one). */
interface TicketTarget {
  link: NewTicketLink;
  assignees: string[];
  contest: string | null;
}

/** Legacy `NewProblemTicketView`, `NewIssueTicketView` and `TicketForm`; ticket bodies use the `user` style (legacy `ticket`). */
@Injectable()
export class TicketCreationService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly problems: ProblemsRepository,
    private readonly currentContest: CurrentContestService,
    private readonly contests: ContestsRepository,
    private readonly gate: TicketGateService,
    private readonly rateLimits: RateLimitService,
    private readonly context: TicketContextService,
    private readonly responses: TicketResponsesService,
    private readonly events: TicketEventsService,
    private readonly discord: DiscordWebhooksService,
    private readonly alerts: TicketNotificationsService,
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
      contest: fromContest && current ? uuidStr(current.contest._id) : null,
      subjectLink: this.discord.link(problemPath(code)),
    });
  }

  /** A question to a contest's organisers, about the contest or one of its problems (by code). The contest must be visible to the filer, and the problem one of its problems the filer can see; assignees are the contest's authors and curators, and its editors read it. */
  async forContest(
    principal: Principal,
    key: string,
    dto: NewContestTicketDto,
  ): Promise<TicketDetailResponse> {
    await this.gate.assertCanWrite(principal);
    const contest = await this.contests.findByKey(key);
    if (
      !contest ||
      !ContestAccess.canSee(principal, ContestAccess.accessView(contest))
    )
      throw new AppError('not_found', 404, 'No such contest');
    const problemId = dto.problem
      ? await this.contestProblemId(principal, contest, dto.problem)
      : null;
    return this.file(principal, dto, {
      link: problemId
        ? { type: 'problem', id: problemId }
        : { type: 'contest', id: uuidStr(contest._id) },
      assignees: unique([...contest.authors, ...contest.curators].map(uuidStr)),
      contest: uuidStr(contest._id),
      subjectLink: this.discord.link(
        dto.problem ? problemPath(dto.problem) : contestPath(key),
      ),
    });
  }

  /** 404 unless the code names one of the contest's problems that the filer can see: as anywhere else, or as a contestant currently in this contest. */
  private async contestProblemId(
    principal: Principal,
    contest: ContestDocument,
    code: string,
  ): Promise<string> {
    const current = await this.currentContest.current(principal);
    const scope =
      current && uuidStr(current.contest._id) === uuidStr(contest._id)
        ? contestScopeOf(contest, new Date())
        : null;
    const problem = await this.problems.findForAccessByCode(code);
    const view = problem && ProblemAccess.accessView(problem);
    const inContest =
      view !== null &&
      contest.problems.some((entry) => uuidStr(entry.problem) === view.id);
    if (!view || !inContest || !ProblemAccess.canSee(principal, view, scope))
      throw new AppError('not_found', 404, 'No such problem in this contest');
    return view.id;
  }

  async general(
    principal: Principal,
    dto: NewGeneralTicketDto,
  ): Promise<TicketDetailResponse> {
    await this.gate.assertCanWrite(principal);
    return this.file(principal, dto, {
      link: { type: 'general', issueUrl: dto.issueUrl },
      assignees: [],
      contest: null,
      subjectLink: dto.issueUrl,
    });
  }

  private async file(
    principal: Principal,
    dto: NewTicketDto,
    target: TicketTarget & { subjectLink: string },
  ): Promise<TicketDetailResponse> {
    const { message, ticket } = await this.insert(principal, dto, target);
    await this.announce(principal, ticket, dto, {
      messageId: message._id,
      subjectLink: target.subjectLink,
    });
    return this.responses.detail(
      principal,
      ticket,
      await this.context.accessView(ticket),
    );
  }

  /** Rate limit, then create the ticket with its first message; a refused create gives its hit back. */
  private async insert(
    principal: Principal,
    dto: NewTicketDto,
    target: TicketTarget,
  ): Promise<{
    message: { _id: string };
    ticket: Awaited<ReturnType<TicketsRepository['create']>>;
  }> {
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
      bodyHtml: renderField(dto.body, 'user', 'body'),
      createdAt,
    };
    try {
      const ticket = await this.tickets.create(
        {
          title: dto.title,
          user: principal.userId,
          assignees: target.assignees,
          contest: target.contest,
          messages: [message],
          messageCount: 1,
          lastMessageAt: createdAt,
          lastMessageByStaff: TicketAccess.isStaff(principal),
        },
        target.link,
      );
      return { message, ticket };
    } catch (error) {
      await releaseHit();
      throw error;
    }
  }

  /** Everything told about a new ticket once it is saved: the SSE feed, Discord and the inboxes. */
  private async announce(
    principal: Principal,
    ticket: TicketDocument,
    dto: NewTicketDto,
    sent: { messageId: string; subjectLink: string },
  ): Promise<void> {
    const ticketId = uuidStr(ticket._id);
    await this.events.publish({
      type: 'new-ticket',
      ticketId,
      messageId: sent.messageId,
      open: null,
    });
    await this.discord.notify('on_new_ticket', {
      title: `New ticket on ${sent.subjectLink}`,
      description: newTicketDescription({
        title: dto.title,
        ticketUrl: this.discord.link(ticketPath(ticketId)),
        body: dto.body,
      }),
      author: this.discord.author(principal.username),
    });
    await this.alerts.filed({
      ticketId,
      title: dto.title,
      body: dto.body,
      creator: principal.userId,
      assignees: ticket.assignees.map(uuidStr),
    });
  }
}
