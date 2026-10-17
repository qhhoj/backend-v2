import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { timelineEventsOf } from '@libs/community';
import { uuidStr } from '@libs/database';
import { TicketNotificationsService } from '../alerts/ticket-notifications.service';
import type { TicketDetailResponse } from '../core/dto/ticket.response';
import { TicketAccess } from '../core/ticket-access';
import type { TicketAccessView } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import type { TicketDocument } from '../core/tickets.repository';

/** What a claim or a hand-back turns the assignee list into; null when the caller may not make that change. */
type AssigneesChange = (
  caller: string,
  assignees: readonly string[],
) => string[] | null;

/** A ticket nobody handles becomes the caller's; one the caller already handles stays as it is. */
const claimed: AssigneesChange = (caller, assignees) => {
  if (assignees.includes(caller)) return [...assignees];
  return assignees.length === 0 ? [caller] : null;
};
/** The caller leaves the list; the other handlers stay. */
const handedBack: AssigneesChange = (caller, assignees) =>
  assignees.filter((id) => id !== caller);

const MAX_ATTEMPTS = 2;
const alreadyClaimed = () =>
  new AppError(
    'ticket_claimed',
    409,
    'Someone else already handles this ticket',
  );

/**
 * "Nhận phiếu": one click makes the caller the ticket's handler, so two staff never answer the same ticket. A claim only
 * succeeds on a ticket nobody handles; a second claimer gets 409 `ticket_claimed`, also when both click at once (the write
 * is a compare-and-set on the assignee list). Reassigning a handled ticket stays the staff `assignees` edit.
 */
@Injectable()
export class TicketClaimsService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly context: TicketContextService,
    private readonly responses: TicketResponsesService,
    private readonly alerts: TicketNotificationsService,
  ) {}

  claim(principal: Principal, ticketId: string): Promise<TicketDetailResponse> {
    return this.change(principal, ticketId, claimed, { openOnly: true });
  }

  release(
    principal: Principal,
    ticketId: string,
  ): Promise<TicketDetailResponse> {
    return this.change(principal, ticketId, handedBack);
  }

  /** A write that lost a race is decided again on the fresh list once: a second claimer then sees the first one's claim. */
  private async change(
    principal: Principal,
    ticketId: string,
    next: AssigneesChange,
    { openOnly = false } = {},
  ): Promise<TicketDetailResponse> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++)
      if (await this.tryChange(principal, ticketId, next, openOnly))
        return this.detail(principal, ticketId);
    throw new AppError(
      'conflict',
      409,
      'The ticket changed while you were editing it; reload and try again',
    );
  }

  /** False when another write changed the assignees between the read and this write. */
  private async tryChange(
    principal: Principal,
    ticketId: string,
    next: AssigneesChange,
    openOnly: boolean,
  ): Promise<boolean> {
    const { ticket, view } = await this.context.accessible(principal, ticketId);
    if (!TicketAccess.canClaim(principal, view))
      throw new AppError(
        'forbidden',
        403,
        'Only staff and editors of the problem can take a ticket',
      );
    if (openOnly && !ticket.isOpen)
      throw new AppError('ticket_closed', 409, 'Reopen the ticket first');
    const assignees = next(principal.userId, view.assignees);
    if (assignees === null) throw alreadyClaimed();
    if (sameMembers(assignees, view.assignees)) return true;
    return this.write(principal, ticket, view, assignees);
  }

  private async write(
    principal: Principal,
    ticket: TicketDocument,
    view: TicketAccessView,
    assignees: string[],
  ): Promise<boolean> {
    const before = {
      isOpen: ticket.isOpen,
      isContributive: ticket.isContributive,
      assignees: view.assignees,
    };
    const changes = { assignees };
    const timeline = timelineEventsOf({
      actor: principal.userId,
      at: new Date(),
      before,
      changes,
    });
    const ticketId = uuidStr(ticket._id);
    if (!(await this.tickets.update(ticketId, changes, before, timeline)))
      return false;
    await this.alerts.updated({
      actor: principal.userId,
      ticketId,
      ticketTitle: ticket.title,
      owner: view.creator,
      assigneesBefore: view.assignees,
      changes,
    });
    return true;
  }

  private async detail(
    principal: Principal,
    ticketId: string,
  ): Promise<TicketDetailResponse> {
    const fresh = await this.tickets.findById(ticketId, {
      withMessages: true,
    });
    if (!fresh) throw new AppError('not_found', 404, 'No such ticket');
    return this.responses.detail(
      principal,
      fresh,
      await this.context.accessView(fresh),
    );
  }
}

const sameMembers = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));
