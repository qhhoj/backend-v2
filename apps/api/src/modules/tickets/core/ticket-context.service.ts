import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { problemPath } from '@libs/community';
import { uuidStr } from '@libs/database';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { TicketLinkResponse } from './dto/ticket.response';
import { TicketAccess } from './ticket-access';
import type { TicketAccessView } from './ticket-access';
import { TicketsRepository } from './tickets.repository';
import type { TicketDocument } from './tickets.repository';

/** Everything that needs a ticket's surroundings: the linked problem for access, the linked item for display. */
@Injectable()
export class TicketContextService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly problems: ProblemsRepository,
  ) {}

  async accessView(ticket: TicketDocument): Promise<TicketAccessView> {
    const problem =
      ticket.linkedItem.type === 'problem'
        ? await this.problems.findForAccess(uuidStr(ticket.linkedItem.id))
        : null;
    return {
      creator: uuidStr(ticket.user),
      assignees: ticket.assignees.map(uuidStr),
      problem: problem && ProblemAccess.accessView(problem),
    };
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

  /** Display data of the linked items, keyed by ticket id. */
  async links(
    tickets: TicketDocument[],
  ): Promise<Map<string, TicketLinkResponse>> {
    const linkedIds = (type: 'problem' | 'general') =>
      tickets
        .filter((ticket) => ticket.linkedItem.type === type)
        .map((ticket) => uuidStr(ticket.linkedItem.id));
    const [problems, issues] = await Promise.all([
      this.problems.findSummaries(linkedIds('problem')),
      this.tickets.findIssues(linkedIds('general')),
    ]);
    const problemById = new Map(
      problems.map((problem) => [uuidStr(problem._id), problem]),
    );
    const issueById = new Map(
      issues.map((issue) => [uuidStr(issue._id), issue]),
    );
    return new Map(
      tickets.map((ticket) => {
        const { type } = ticket.linkedItem;
        const id = uuidStr(ticket.linkedItem.id);
        const problem = problemById.get(id);
        const issue = issueById.get(id);
        const link: TicketLinkResponse =
          type === 'problem'
            ? problem
              ? {
                  type,
                  id,
                  key: problem.code,
                  title: problem.name,
                  url: problemPath(problem.code),
                }
              : { type, id, key: null, title: 'Deleted problem', url: '' }
            : {
                type,
                id,
                key: null,
                title: issue?.issueUrl ?? '',
                url: issue?.issueUrl ?? '',
              };
        return [uuidStr(ticket._id), link];
      }),
    );
  }
}
