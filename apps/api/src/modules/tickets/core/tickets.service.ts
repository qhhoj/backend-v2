import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { TICKETS_PAGE_SIZE } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Ticket } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from './dto/ticket.response';
import type {
  TicketListQueryDto,
  TicketPageQueryDto,
} from './dto/ticket-list.dto';
import { TicketAccess } from './ticket-access';
import { TicketContextService } from './ticket-context.service';
import { TicketResponsesService } from './ticket-responses.service';
import { TicketsRepository } from './tickets.repository';

/** `{}` clauses (staff see all) are dropped: an `$and` around them turns the unfiltered count into a collection scan. */
const allOf = (clauses: FilterQuery<Ticket>[]): FilterQuery<Ticket> => {
  const narrowing = clauses.filter((clause) => Object.keys(clause).length);
  return narrowing.length > 1 ? { $and: narrowing } : (narrowing[0] ?? {});
};

@Injectable()
export class TicketsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    private readonly context: TicketContextService,
    private readonly responses: TicketResponsesService,
    private readonly currentContest: CurrentContestService,
    private readonly contests: ContestsRepository,
  ) {}

  /** Legacy `TicketList`: `own` replaces the visibility rule (it is narrower), the rest narrows it; `open` filters both ways (`true` open only, `false` closed only, absent both). */
  async list(
    principal: Principal,
    query: TicketListQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    const clauses: FilterQuery<Ticket>[] = [
      query.own
        ? TicketAccess.ownFilter(principal.userId)
        : await this.visibleTo(principal),
    ];
    if (query.open !== undefined) clauses.push({ isOpen: query.open });
    if (query.awaiting) clauses.push(TicketsRepository.AWAITING_STAFF);
    if (query.user)
      clauses.push({ user: { $in: await this.idsOf(query.user) } });
    if (query.assignee)
      clauses.push({ assignees: { $in: await this.idsOf(query.assignee) } });
    return this.page(principal, query.page, allOf(clauses));
  }

  /** Legacy `ProblemTicketListView`: editors see every ticket of the problem, other viewers of the problem their own; staff see all. */
  async problemList(
    principal: Principal,
    code: string,
    query: TicketPageQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    const problem = await this.problems.findForAccessByCode(code);
    const view = problem && ProblemAccess.accessView(problem);
    // Legacy `is_editable_by` comes first: an editor in a contest that has not started still sees the list.
    const edits = view !== null && ProblemAccess.canEdit(principal, view);
    if (
      !view ||
      !(
        edits ||
        ProblemAccess.canSee(
          principal,
          view,
          await this.currentContest.scopeOf(principal),
        )
      )
    )
      throw new AppError('not_found', 404, 'No such problem');
    const ofProblem: FilterQuery<Ticket> = {
      'linkedItem.type': 'problem',
      'linkedItem.id': view.id,
    };
    const seesAll = TicketAccess.isStaff(principal) || edits;
    return this.page(
      principal,
      query.page,
      seesAll
        ? ofProblem
        : { $and: [ofProblem, TicketAccess.ownFilter(principal.userId)] },
    );
  }

  /** The tickets filed from a contest: all of them for its editors and staff, otherwise only the caller's own. 404 when the caller cannot see the contest. */
  async contestList(
    principal: Principal,
    key: string,
    query: TicketPageQueryDto,
  ): Promise<Paginated<TicketListItemResponse>> {
    const contest = await this.contests.findByKey(key);
    const view = contest && ContestAccess.accessView(contest);
    if (!contest || !view || !ContestAccess.canSee(principal, view))
      throw new AppError('not_found', 404, 'No such contest');
    const ofContest: FilterQuery<Ticket> = { contest: uuidStr(contest._id) };
    const seesAll =
      TicketAccess.isStaff(principal) || ContestAccess.canEdit(principal, view);
    return this.page(
      principal,
      query.page,
      seesAll
        ? ofContest
        : { $and: [ofContest, TicketAccess.ownFilter(principal.userId)] },
    );
  }

  async detail(
    principal: Principal,
    id: string,
  ): Promise<TicketDetailResponse> {
    const { ticket, view } = await this.context.accessible(principal, id, {
      withMessages: true,
    });
    return this.responses.detail(principal, ticket, view);
  }

  private async page(
    principal: Principal,
    page: number,
    filter: FilterQuery<Ticket>,
  ): Promise<Paginated<TicketListItemResponse>> {
    const { rows, total } = await this.tickets.page(filter, page);
    return new Paginated(await this.responses.items(principal, rows), {
      page,
      pageSize: TICKETS_PAGE_SIZE,
      total,
    });
  }

  /** Legacy `filter_visible_tickets`: own tickets plus tickets of problems the viewer edits; staff see all. The edited problems' ids are looked up (also for `edit_all_problem`, so a ticket of a deleted problem stays unreadable like in `canSee`), keeping the list an index read on `linkedItem.id`. New: tickets filed from contests the viewer edits, the same way. */
  private async visibleTo(principal: Principal): Promise<FilterQuery<Ticket>> {
    if (TicketAccess.isStaff(principal)) return {};
    const clauses: FilterQuery<Ticket>[] = [
      TicketAccess.ownFilter(principal.userId),
    ];
    const editable = ProblemAccess.editableFilter(principal);
    if (editable)
      clauses.push({
        'linkedItem.type': 'problem',
        'linkedItem.id': { $in: await this.problems.visibleIds(editable) },
      });
    clauses.push(...(await this.editedContestsClause(principal)));
    return { $or: clauses };
  }

  /** Tickets filed from contests the viewer edits, by the ids of the existing ones (with `edit_all_contest`, every contest): a deleted contest's tickets are not listed. */
  private async editedContestsClause(
    principal: Principal,
  ): Promise<FilterQuery<Ticket>[]> {
    const editable = ContestAccess.editableFilter(principal);
    if (!editable) return [];
    return [{ contest: { $in: await this.contests.idsMatching(editable) } }];
  }

  /** Unknown names match nothing. */
  private async idsOf(usernames: string[]): Promise<string[]> {
    const users = await Promise.all(
      usernames.map((username) => this.users.findByUsername(username)),
    );
    return users.flatMap((user) => (user ? [user._id] : []));
  }
}
