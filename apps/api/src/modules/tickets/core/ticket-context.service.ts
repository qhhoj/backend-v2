import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { contestPath, problemPath } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Contest, Ticket, TicketLinkType } from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import type { FilterQuery } from 'mongoose';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type {
  TicketContestResponse,
  TicketLinkResponse,
} from './dto/ticket.response';
import { TicketAccess } from './ticket-access';
import type { TicketAccessView } from './ticket-access';
import { TicketsRepository } from './tickets.repository';
import type { TicketDocument } from './tickets.repository';

/** `{}` clauses (staff see all) are dropped: an `$and` around them turns the unfiltered count into a collection scan. */
export const allOf = (clauses: FilterQuery<Ticket>[]): FilterQuery<Ticket> => {
  const narrowing = clauses.filter((clause) => Object.keys(clause).length);
  return narrowing.length > 1 ? { $and: narrowing } : (narrowing[0] ?? {});
};

/** What a ticket shows about itself: the linked item, and the contest it was filed from. */
export interface TicketSubject {
  link: TicketLinkResponse;
  contest: TicketContestResponse | null;
}

const contestIdOf = (ticket: TicketDocument): string | null =>
  ticket.contest ? uuidStr(ticket.contest) : null;

/** Everything that needs a ticket's surroundings: the linked problem and the contest for access, the linked item for display. */
@Injectable()
export class TicketContextService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly problems: ProblemsRepository,
    private readonly contests: ContestsRepository,
  ) {}

  async accessView(ticket: TicketDocument): Promise<TicketAccessView> {
    const contestId = contestIdOf(ticket);
    const [problem, [contest]] = await Promise.all([
      ticket.linkedItem.type === 'problem'
        ? this.problems.findForAccess(uuidStr(ticket.linkedItem.id))
        : null,
      this.contests.findByIds(contestId ? [contestId] : []),
    ]);
    return {
      creator: uuidStr(ticket.user),
      assignees: ticket.assignees.map(uuidStr),
      problem: problem && ProblemAccess.accessView(problem),
      contest: contest ? ContestAccess.accessView(contest) : null,
    };
  }

  /**
   * Tickets about what the user makes: linked to a problem they author, curate or suggested (`ProblemAccess.editorOfFilter`),
   * or filed from a contest they author or curate (`ContestAccess.editorOfFilter`). The list's `aboutMine` and the summary's
   * count; index reads on `linkedItem.id` and `contest`.
   */
  async aboutMineFilter(userId: string): Promise<FilterQuery<Ticket>> {
    const [problemIds, contestIds] = await Promise.all([
      this.problems.visibleIds(ProblemAccess.editorOfFilter(userId)),
      this.contests.idsMatching(ContestAccess.editorOfFilter(userId)),
    ]);
    return {
      $or: [
        { 'linkedItem.type': 'problem', 'linkedItem.id': { $in: problemIds } },
        { contest: { $in: contestIds } },
      ],
    };
  }

  /** Legacy `filter_visible_tickets`: own tickets plus tickets of problems the viewer edits; staff see all. The edited problems' ids are looked up (also for `edit_all_problem`, so a ticket of a deleted problem stays unreadable like in `canSee`), keeping the list an index read on `linkedItem.id`. New: tickets filed from contests the viewer edits, the same way. */
  async visibleTo(principal: Principal): Promise<FilterQuery<Ticket>> {
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

  /** 404 for unknown or malformed ids, 403 for an existing ticket the viewer may not read (UUIDs are not guessable; legacy parity). */
  async accessible(
    principal: Principal,
    id: string,
    { withMessages = false }: { withMessages?: boolean } = {},
  ): Promise<{ ticket: TicketDocument; view: TicketAccessView }> {
    const ticket = await this.tickets.findById(id, { withMessages });
    if (!ticket) throw new AppError('not_found', 404, 'No such ticket');
    const view = await this.accessView(ticket);
    if (!TicketAccess.canSee(principal, view))
      throw new AppError('forbidden', 403, 'You cannot read this ticket');
    return { ticket, view };
  }

  /** Display data of the linked items and contests, keyed by ticket id: one lookup per kind, however many tickets. A contest the reader cannot see is left out, as the filed-from contest and as the linked item (a problem's editor reads its tickets from any contest). */
  async subjects(
    principal: Principal,
    tickets: TicketDocument[],
  ): Promise<Map<string, TicketSubject>> {
    const linkedIds = (type: TicketLinkType) =>
      tickets
        .filter((ticket) => ticket.linkedItem.type === type)
        .map((ticket) => uuidStr(ticket.linkedItem.id));
    const contestIds = tickets.flatMap((ticket) => contestIdOf(ticket) ?? []);
    const [problems, issues, contests] = await Promise.all([
      this.problems.findSummaries(linkedIds('problem')),
      this.tickets.findIssues(linkedIds('general')),
      this.contests.findByIds([...contestIds, ...linkedIds('contest')]),
    ]);
    const found: Lookups = {
      problems: byId(problems),
      issues: byId(issues),
      contests: byId(
        contests.filter((contest) =>
          ContestAccess.canSee(principal, ContestAccess.accessView(contest)),
        ),
      ),
    };
    return new Map(
      tickets.map((ticket) => {
        const contest = found.contests.get(contestIdOf(ticket) ?? '');
        const subject: TicketSubject = {
          link: linkOf(ticket, found),
          contest: contest ? { key: contest.key, name: contest.name } : null,
        };
        return [uuidStr(ticket._id), subject];
      }),
    );
  }
}

interface Lookups {
  problems: Map<string, { code: string; name: string }>;
  issues: Map<string, { issueUrl: string }>;
  /** Only the contests the reader can see. */
  contests: Map<string, Contest>;
}

const byId = <T extends { _id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [uuidStr(row._id), row]));

/** A deleted problem, or a contest that is deleted or hidden from the reader, keeps its type and id, with no key and no url. */
function linkOf(ticket: TicketDocument, found: Lookups): TicketLinkResponse {
  const { type } = ticket.linkedItem;
  const id = uuidStr(ticket.linkedItem.id);
  if (type === 'general') {
    const url = found.issues.get(id)?.issueUrl ?? '';
    return { type, id, key: null, title: url, url };
  }
  if (type === 'problem') {
    const problem = found.problems.get(id);
    return problem
      ? {
          type,
          id,
          key: problem.code,
          title: problem.name,
          url: problemPath(problem.code),
        }
      : { type, id, key: null, title: 'Deleted problem', url: '' };
  }
  const contest = found.contests.get(id);
  return contest
    ? {
        type,
        id,
        key: contest.key,
        title: contest.name,
        url: contestPath(contest.key),
      }
    : { type, id, key: null, title: 'Unavailable contest', url: '' };
}
