import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, escapeRegExp, Paginated } from '@libs/common';
import { TICKETS_PAGE_SIZE } from '@libs/community';
import type { Ticket } from '@libs/database';
import type { FilterQuery } from 'mongoose';
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
    if (query.aboutMine) clauses.push(await this.aboutMine(principal.userId));
    if (query.q) clauses.push(await this.matching(query.q));
    return this.page(query.page, allOf(clauses));
  }

  /** Tickets linked to the user's own problems (`ProblemAccess.editorOfFilter`), an index read on `linkedItem.id`. */
  async aboutMine(userId: string): Promise<FilterQuery<Ticket>> {
    return {
      'linkedItem.type': 'problem',
      'linkedItem.id': {
        $in: await this.problems.visibleIds(
          ProblemAccess.editorOfFilter(userId),
        ),
      },
    };
  }

  /** The title holds the text, or the creator's username is the text. */
  private async matching(text: string): Promise<FilterQuery<Ticket>> {
    const title = { title: { $regex: escapeRegExp(text), $options: 'i' } };
    const creators = await this.idsOf([text]);
    return creators.length
      ? { $or: [title, { user: { $in: creators } }] }
      : title;
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
      query.page,
      seesAll
        ? ofProblem
        : { $and: [ofProblem, TicketAccess.ownFilter(principal.userId)] },
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
    page: number,
    filter: FilterQuery<Ticket>,
  ): Promise<Paginated<TicketListItemResponse>> {
    const { rows, total } = await this.tickets.page(filter, page);
    return new Paginated(await this.responses.items(rows), {
      page,
      pageSize: TICKETS_PAGE_SIZE,
      total,
    });
  }

  /** Legacy `filter_visible_tickets`: own tickets plus tickets of problems the viewer edits; staff see all. The edited problems' ids are looked up (also for `edit_all_problem`, so a ticket of a deleted problem stays unreadable like in `canSee`), keeping the list an index read on `linkedItem.id`. */
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
    return { $or: clauses };
  }

  /** Unknown names match nothing. */
  private async idsOf(usernames: string[]): Promise<string[]> {
    const users = await Promise.all(
      usernames.map((username) => this.users.findByUsername(username)),
    );
    return users.flatMap((user) => (user ? [user._id] : []));
  }
}
